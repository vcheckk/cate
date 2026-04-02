// =============================================================================
// Session persistence — save/restore workspace state as JSON.
// Ported from SessionSnapshot.swift + SessionStore.swift
// =============================================================================

import { useAppStore, getCanvasOperations } from '../stores/appStore'
import type { StoreApi } from 'zustand'
import type { CanvasStore } from '../stores/canvasStore'
import type {
  SessionSnapshot,
  NodeSnapshot,
  MultiWorkspaceSession,
  PanelWindowSnapshot,
  DetachedDockWindowSnapshot,
  PanelType,
} from '../../shared/types'
import { useDockStore } from '../stores/dockStore'
import { terminalRegistry } from './terminalRegistry'

// -----------------------------------------------------------------------------
// Terminal restore data — populated during restoreSession(), consumed by
// terminalRegistry.getOrCreate() and replayTerminalLog().
// -----------------------------------------------------------------------------

export const terminalRestoreData = new Map<string, { cwd?: string; replayFromId?: string }>()

// Deferred snapshots for inactive workspaces — restored on first switch
export const deferredSnapshots = new Map<string, SessionSnapshot>()

// -----------------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------------

export async function saveSession(): Promise<void> {
  const appState = useAppStore.getState()

  // Sync current canvas state back to the selected workspace before saving
  // After this call, workspace.canvasNodes/regions/zoom/viewport are up to date
  appState.syncCanvasToWorkspace(appState.selectedWorkspaceId)

  // Re-read app state after sync (syncCanvasToWorkspace updates workspace data)
  const updatedState = useAppStore.getState()

  const snapshots: SessionSnapshot[] = []

  // Skip ephemeral workspaces (no panels, no rootPath, and not deferred)
  const persistableWorkspaces = updatedState.workspaces.filter(
    (ws) => Object.keys(ws.panels).length > 0 || ws.rootPath || deferredSnapshots.has(ws.id),
  )

  for (const workspace of persistableWorkspaces) {
    // If this workspace has a deferred snapshot (never switched to), re-use
    // the original snapshot data instead of serializing the empty store state.
    const deferred = deferredSnapshots.get(workspace.id)
    if (deferred) {
      snapshots.push(deferred)
      continue
    }

    const isSelected = workspace.id === updatedState.selectedWorkspaceId
    // After syncCanvasToWorkspace, workspace data is always up to date
    const nodes = workspace.canvasNodes
    const regions = workspace.regions

    const nodeSnapshots: NodeSnapshot[] = Object.values(nodes).map((node) => {
      const panel = workspace.panels[node.panelId]
      return {
        panelId: node.panelId,
        panelType: panel?.type ?? 'terminal',
        title: panel?.title ?? '',
        origin: node.origin,
        size: node.size,
        filePath: panel?.filePath ?? undefined,
        url: panel?.url ?? undefined,
        regionId: node.regionId ?? undefined,
      }
    })

    // For each terminal node in the selected workspace, fetch current working directory
    // Batch all CWD requests concurrently for better performance
    if (isSelected) {
      const cwdPromises: { snap: NodeSnapshot; promise: Promise<string | null> }[] = []
      for (const snap of nodeSnapshots) {
        if (snap.panelType === 'terminal') {
          const entry = terminalRegistry.getEntry(snap.panelId)
          if (entry?.ptyId) {
            cwdPromises.push({
              snap,
              promise: window.electronAPI.terminalGetCwd(entry.ptyId).catch(() => null),
            })
          }
        }
      }
      const results = await Promise.all(cwdPromises.map((p) => p.promise))
      for (let j = 0; j < cwdPromises.length; j++) {
        const cwd = results[j]
        if (cwd) {
          cwdPromises[j].snap.workingDirectory = cwd
        }
      }
    }

    // Capture dock state — live from the dock store for the selected workspace,
    // or from the workspace's last-saved dockState for inactive workspaces.
    const dockSnapshot = isSelected
      ? useDockStore.getState().getSnapshot()
      : workspace.dockState ?? undefined

    snapshots.push({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      rootPath: workspace.rootPath || null,
      zoomLevel: workspace.zoomLevel,
      viewportOffset: workspace.viewportOffset,
      nodes: nodeSnapshots,
      regions: Object.keys(regions).length > 0 ? { ...regions } : undefined,
      dockState: dockSnapshot,
    })
  }

  const selectedIndex = persistableWorkspaces.findIndex((w) => w.id === appState.selectedWorkspaceId)

  // Capture panel window snapshots from main process
  let panelWindows: PanelWindowSnapshot[] | undefined
  try {
    const pwList = await window.electronAPI.panelWindowsList()
    if (pwList && pwList.length > 0) {
      panelWindows = pwList.map((pw) => ({
        panel: pw.panel,
        bounds: pw.bounds,
        workspaceId: pw.workspaceId,
      }))
    }
  } catch {
    // Panel window listing not available — skip
  }

  // Capture dock window snapshots from main process
  let dockWindows: DetachedDockWindowSnapshot[] | undefined
  try {
    const dwList = await window.electronAPI.dockWindowsList()
    if (dwList && dwList.length > 0) {
      dockWindows = dwList
    }
  } catch {
    // Dock window listing not available — skip
  }

  const session: MultiWorkspaceSession = {
    version: 2,
    selectedWorkspaceIndex: selectedIndex >= 0 ? selectedIndex : null,
    workspaces: snapshots,
    panelWindows,
    dockWindows,
  }

  try {
    await window.electronAPI.sessionSave(session as any) // session save accepts any JSON
  } catch {
    // Silently ignore save failures
  }
}

// -----------------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------------

export async function loadSession(): Promise<MultiWorkspaceSession | SessionSnapshot | null> {
  try {
    const data = await window.electronAPI.sessionLoad()
    if (!data) return null
    // Check if it's the new multi-workspace format
    if ((data as any).version === 2 || Array.isArray((data as any).workspaces)) {
      return data as unknown as MultiWorkspaceSession
    }
    // Legacy single-workspace format
    return data as SessionSnapshot
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Restore
// -----------------------------------------------------------------------------

export async function restoreSession(snapshot: SessionSnapshot, canvasStoreApi?: StoreApi<CanvasStore>): Promise<void> {
  if (!snapshot?.nodes) {
    console.warn('[session] invalid snapshot (no nodes), skipping restore')
    return
  }

  const appStore = useAppStore.getState()

  // Get canvas store state — either from explicit parameter or via canvasOps
  const getCanvasState = () => canvasStoreApi?.getState() ?? null

  const wsId = appStore.selectedWorkspaceId
  console.debug(`[session] restoring workspace ${wsId}: ${snapshot.nodes.length} nodes`)
  const t0 = performance.now()

  // Restore regions first and build old→new ID mapping
  const regionIdMap = new Map<string, string>()
  const cs = getCanvasState()
  if (snapshot.regions && cs) {
    for (const region of Object.values(snapshot.regions)) {
      const newId = cs.addRegion(region.label, region.origin, region.size, region.color)
      regionIdMap.set(region.id, newId)
    }
  }

  for (let i = 0; i < snapshot.nodes.length; i++) {
    const nodeSnap = snapshot.nodes[i]
    console.debug(`[session] restoring node ${i + 1}/${snapshot.nodes.length}: ${nodeSnap.panelType} (panelId=${nodeSnap.panelId})`)
    const position = nodeSnap.origin
    const size = nodeSnap.size

    switch (nodeSnap.panelType) {
      case 'terminal': {
        const panelId = appStore.createTerminal(wsId, undefined, position)
        terminalRestoreData.set(panelId, {
          cwd: nodeSnap.workingDirectory ?? undefined,
          replayFromId: nodeSnap.panelId,
        })
        const canvasState = getCanvasState()
        if (canvasState) {
          const newNodeId = canvasState.nodeForPanel(panelId)
          if (newNodeId) {
            canvasState.moveNode(newNodeId, position)
            canvasState.resizeNode(newNodeId, size)
            if (nodeSnap.regionId) {
              const mappedRegionId = regionIdMap.get(nodeSnap.regionId)
              if (mappedRegionId) canvasState.setNodeRegion(newNodeId, mappedRegionId)
            }
          }
        }
        break
      }
      case 'editor': {
        const panelId = appStore.createEditor(wsId, nodeSnap.filePath ?? undefined)
        const canvasState = getCanvasState()
        if (canvasState) {
          const newNodeId = canvasState.nodeForPanel(panelId)
          if (newNodeId) {
            canvasState.moveNode(newNodeId, position)
            canvasState.resizeNode(newNodeId, size)
            if (nodeSnap.regionId) {
              const mappedRegionId = regionIdMap.get(nodeSnap.regionId)
              if (mappedRegionId) canvasState.setNodeRegion(newNodeId, mappedRegionId)
            }
          }
        }
        break
      }
      case 'browser': {
        const panelId = appStore.createBrowser(wsId, nodeSnap.url ?? undefined)
        const canvasState = getCanvasState()
        if (canvasState) {
          const newNodeId = canvasState.nodeForPanel(panelId)
          if (newNodeId) {
            canvasState.moveNode(newNodeId, position)
            canvasState.resizeNode(newNodeId, size)
            if (nodeSnap.regionId) {
              const mappedRegionId = regionIdMap.get(nodeSnap.regionId)
              if (mappedRegionId) canvasState.setNodeRegion(newNodeId, mappedRegionId)
            }
          }
        }
        break
      }
    }
  }

  const canvasState = getCanvasState()
  if (canvasState) {
    canvasState.setZoom(snapshot.zoomLevel)
    canvasState.setViewportOffset(snapshot.viewportOffset)

    // Auto-assign regionId for migrated workspaces (nodes without regionId)
    const finalState = getCanvasState()!
    const allRegions = Object.values(finalState.regions)
    for (const node of Object.values(finalState.nodes)) {
      if (!node.regionId && allRegions.length > 0) {
        for (const region of allRegions) {
          const overlapX = Math.max(0, Math.min(node.origin.x + node.size.width, region.origin.x + region.size.width) - Math.max(node.origin.x, region.origin.x))
          const overlapY = Math.max(0, Math.min(node.origin.y + node.size.height, region.origin.y + region.size.height) - Math.max(node.origin.y, region.origin.y))
          const overlapArea = overlapX * overlapY
          const nodeArea = node.size.width * node.size.height
          if (nodeArea > 0 && overlapArea / nodeArea > 0.5) {
            canvasState.setNodeRegion(node.id, region.id)
            break
          }
        }
      }
    }
  }

  // Restore dock state if present
  if (snapshot.dockState) {
    try {
      useDockStore.getState().restoreSnapshot(snapshot.dockState)
      console.debug(`[session] dock state restored for workspace ${wsId}`)
    } catch (err) {
      console.warn('[session] failed to restore dock state:', err)
    }
  }

  console.debug(`[session] workspace ${wsId} restored in ${(performance.now() - t0).toFixed(1)}ms`)
}

// -----------------------------------------------------------------------------
// Replay terminal scrollback log
//
// Called by terminalRegistry after the PTY is fully wired and the xterm
// instance is live. Reads the persisted log for the original panel ID,
// writes it to the terminal, then clears the restore entry.
// -----------------------------------------------------------------------------

export async function replayTerminalLog(panelId: string): Promise<void> {
  const data = terminalRestoreData.get(panelId)
  if (!data?.replayFromId) return

  const logData = await window.electronAPI.terminalLogRead(data.replayFromId)
  if (!logData) {
    terminalRestoreData.delete(panelId)
    return
  }

  const entry = terminalRegistry.getEntry(panelId)
  if (!entry) {
    terminalRestoreData.delete(panelId)
    return
  }

  // Write a dim "restoring" header then replay the raw log bytes
  entry.terminal.write('\x1b[90mRestoring terminal history...\x1b[0m\r\n')
  entry.terminal.write(logData)

  terminalRestoreData.delete(panelId)
}

// -----------------------------------------------------------------------------
// Restore — multi-workspace
// -----------------------------------------------------------------------------

export async function restoreMultiWorkspaceSession(session: MultiWorkspaceSession, canvasStoreApi?: StoreApi<CanvasStore>): Promise<void> {
  const appStore = useAppStore.getState()
  const tTotal = performance.now()
  console.debug(`[session] restoring multi-workspace session: ${session.workspaces.length} workspaces`)

  // Clear any existing workspaces so we don't duplicate on every restart
  const existingIds = appStore.workspaces.map((w) => w.id)
  for (const id of existingIds) {
    appStore.removeWorkspace(id)
  }

  const selectedIdx = session.selectedWorkspaceIndex ?? 0

  // Create all workspaces (entries only) and only restore the active one's panels
  const wsIds: string[] = []
  for (let i = 0; i < session.workspaces.length; i++) {
    const snapshot = session.workspaces[i]
    console.debug(`[session] workspace ${i + 1}/${session.workspaces.length}: "${snapshot.workspaceName}" (${snapshot.nodes.length} nodes)`)
    const wsId = appStore.addWorkspace(snapshot.workspaceName, snapshot.rootPath ?? undefined)
    wsIds.push(wsId)

    if (i === selectedIdx) {
      // Select and fully restore the active workspace
      appStore.selectWorkspace(wsId)
      await restoreSession(snapshot, canvasStoreApi)
    } else {
      // Defer restoration — store the snapshot for lazy loading on first switch
      deferredSnapshots.set(wsId, snapshot)
    }
  }

  // Re-select the originally selected workspace (may be a no-op if already selected)
  if (selectedIdx < wsIds.length) {
    appStore.selectWorkspace(wsIds[selectedIdx])
  }

  // Recreate panel windows that were open at the time of last save
  if (session.panelWindows && session.panelWindows.length > 0) {
    console.debug(`[session] restoring ${session.panelWindows.length} panel windows`)
    for (const pw of session.panelWindows) {
      try {
        const snapshot: import('../../shared/types').PanelTransferSnapshot = {
          panel: pw.panel,
          geometry: {
            origin: { x: pw.bounds.x, y: pw.bounds.y },
            size: { width: pw.bounds.width, height: pw.bounds.height },
          },
          sourceLocation: { type: 'canvas', canvasId: '', canvasNodeId: '' },
        }
        const newWindowId = await window.electronAPI.panelTransfer(snapshot)
        if (typeof newWindowId === 'number') {
          // Position the new panel window to its saved bounds
          // The main process createWindow positions it, but we passed geometry in the snapshot
          console.debug(`[session] panel window restored: ${pw.panel.title} (windowId=${newWindowId})`)
        }
      } catch (err) {
        console.warn(`[session] failed to restore panel window "${pw.panel.title}":`, err)
      }
    }
  }

  // Recreate dock windows that were open at the time of last save
  if (session.dockWindows && session.dockWindows.length > 0) {
    console.debug(`[session] restoring ${session.dockWindows.length} dock windows`)
    for (const dw of session.dockWindows) {
      try {
        // For each panel in the dock window, create a transfer snapshot and create
        // a dock window. The first panel creates the window; remaining panels get
        // transferred to it.
        const panelIds = Object.keys(dw.panels)
        if (panelIds.length === 0) continue

        const firstPanel = dw.panels[panelIds[0]]
        const snapshot: import('../../shared/types').PanelTransferSnapshot = {
          panel: firstPanel,
          geometry: {
            origin: { x: dw.bounds.x, y: dw.bounds.y },
            size: { width: dw.bounds.width, height: dw.bounds.height },
          },
          sourceLocation: { type: 'detached', windowId: -1 },
        }

        await window.electronAPI.dragDetach(snapshot, dw.workspaceId)
        console.debug(`[session] dock window restored: ${panelIds.length} panels`)
      } catch (err) {
        console.warn(`[session] failed to restore dock window:`, err)
      }
    }
  }

  console.debug(`[session] full session restored in ${(performance.now() - tTotal).toFixed(1)}ms`)
}

// -----------------------------------------------------------------------------
// Restore a deferred workspace — called on first switch to an inactive workspace
// -----------------------------------------------------------------------------

export async function restoreDeferredWorkspace(workspaceId: string, canvasStoreApi?: StoreApi<CanvasStore>): Promise<void> {
  const snapshot = deferredSnapshots.get(workspaceId)
  if (!snapshot) return
  deferredSnapshots.delete(workspaceId)
  await restoreSession(snapshot, canvasStoreApi)
}

// -----------------------------------------------------------------------------
// Auto-save (debounced)
// -----------------------------------------------------------------------------

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveSetUp = false

export function setupAutoSave(canvasStoreApi?: StoreApi<CanvasStore>): () => void {
  if (autoSaveSetUp) {
    return () => {}
  }
  autoSaveSetUp = true

  const unsubCanvas = canvasStoreApi
    ? canvasStoreApi.subscribe(() => {
        if (autoSaveTimer) clearTimeout(autoSaveTimer)
        autoSaveTimer = setTimeout(() => saveSession(), 5000)
      })
    : () => {}

  const unsubApp = useAppStore.subscribe(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => saveSession(), 5000)
  })

  const unsubDock = useDockStore.subscribe(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => saveSession(), 5000)
  })

  return () => {
    unsubCanvas()
    unsubApp()
    unsubDock()
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveSetUp = false
  }
}
