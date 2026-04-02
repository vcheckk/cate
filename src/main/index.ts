import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } from 'electron'
import path from 'path'
import { SHELL_SHOW_IN_FOLDER, HTTP_FETCH } from '../shared/ipc-channels'
import {
  WINDOW_CREATE, WINDOW_GET_ID, WINDOW_GET_TYPE,
  PANEL_TRANSFER, PANEL_RECEIVE, PANEL_TRANSFER_ACK,
  PANEL_WINDOWS_LIST, PANEL_WINDOW_DOCK_BACK,
  DRAG_START, DRAG_DETACH, DRAG_END,
  DOCK_WINDOW_INIT, DOCK_WINDOW_SYNC_STATE, DOCK_WINDOWS_LIST,
  CROSS_WINDOW_DRAG_START, CROSS_WINDOW_DRAG_UPDATE, CROSS_WINDOW_DRAG_DROP, CROSS_WINDOW_DRAG_CANCEL, CROSS_WINDOW_DRAG_RESOLVE,
} from '../shared/ipc-channels'
import { registerHandlers as registerTerminalHandlers, flushAllLoggers } from './ipc/terminal'
import { registerHandlers as registerFilesystemHandlers, stopWatchersForWindow } from './ipc/filesystem'
import { registerHandlers as registerGitHandlers } from './ipc/git'
import { registerHandlers as registerShellHandlers, unregisterTerminalsForWindow } from './ipc/shell'
import { registerHandlers as registerGitMonitorHandlers, stopMonitorsForWindow } from './ipc/git-monitor'
import { registerHandlers as registerStoreHandlers } from './store'
import { registerHandlers as registerMCPHandlers } from './ipc/mcp'
import { registerHandlers as registerNotificationHandlers } from './ipc/notifications'
import { writeDragTempFile, cleanupDragTempFile, createDragGhostImage } from './ipc/drag'
import { registerWindow, getWindowType, sendToWindow, broadcastToAll, broadcastToAllExcept, setPanelWindowMeta, listPanelWindows, getWindow, setDockWindowState, listDockWindows } from './windowRegistry'
import { registerWorkspaceHandlers } from './workspaceManager'
import { buildApplicationMenu, rebuildApplicationMenu } from './menu'
import { initShellEnv } from './shellEnv'
import { beginTerminalTransfer, acknowledgeTerminalTransfer } from './ipc/terminal'
import type { CateWindowParams, DockWindowInitPayload, PanelState, PanelTransferSnapshot, WindowDockState } from '../shared/types'

function createWindow(params?: CateWindowParams): BrowserWindow {
  const iconPath = path.join(__dirname, '../../build/icon-1024.png')
  const windowType = params?.type ?? 'main'
  const isPanel = windowType === 'panel'
  const isDock = windowType === 'dock'

  const win = new BrowserWindow({
    width: isDock ? 700 : isPanel ? 700 : 1200,
    height: isDock ? 500 : isPanel ? 500 : 800,
    minWidth: isDock ? 400 : isPanel ? undefined : 800,
    minHeight: isDock ? 300 : isPanel ? undefined : 600,
    title: isDock ? 'Cate' : isPanel ? 'Cate Panel' : 'Cate',
    titleBarStyle: isPanel ? 'hidden' : isDock ? 'hiddenInset' : 'hiddenInset',
    frame: isDock ? true : !isPanel,
    backgroundColor: '#1E1E24',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  // Track this window in the registry with its type
  registerWindow(win, windowType)

  // Capture ID before window is destroyed (win.id throws after 'closed')
  const windowId = win.id

  // Clean up window-owned resources on close
  win.on('closed', () => {
    stopWatchersForWindow(windowId)
    unregisterTerminalsForWindow(windowId)
    stopMonitorsForWindow(windowId)
    // Rebuild menu to update panel/dock window list
    if (isPanel || isDock) rebuildApplicationMenu()
  })

  // Rebuild menu when panel/dock windows are created
  if (isPanel || isDock) {
    win.webContents.once('did-finish-load', () => {
      rebuildApplicationMenu()
    })
  }

  // Build query string from params
  const queryParts: string[] = []
  queryParts.push(`type=${encodeURIComponent(windowType)}`)
  if (params?.panelType) queryParts.push(`panelType=${encodeURIComponent(params.panelType)}`)
  if (params?.panelId) queryParts.push(`panelId=${encodeURIComponent(params.panelId)}`)
  if (params?.workspaceId) queryParts.push(`workspaceId=${encodeURIComponent(params.workspaceId)}`)
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      search: query ? query.slice(1) : undefined,
    })
  }

  return win
}

// =============================================================================
// Drag ghost window — a tiny borderless always-on-top window that follows the
// cursor during cross-window drags so the user has visual feedback outside any
// app window.
// =============================================================================

let dragGhostWin: BrowserWindow | null = null

function createDragGhostWindow(panelType: string, panelTitle: string): void {
  if (dragGhostWin && !dragGhostWin.isDestroyed()) {
    dragGhostWin.destroy()
  }

  dragGhostWin = new BrowserWindow({
    width: 200,
    height: 32,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Ignore mouse events so the ghost doesn't interfere with drop targets
  dragGhostWin.setIgnoreMouseEvents(true)

  // Render a simple HTML pill as the ghost
  const iconMap: Record<string, string> = {
    terminal: '⬛', browser: '🌐', editor: '📄', git: '🔀',
    fileExplorer: '📁', projectList: '📋', canvas: '🖼️',
  }
  const icon = iconMap[panelType] || '📄'
  const safeTitle = panelTitle.replace(/'/g, '&#39;').replace(/</g, '&lt;').slice(0, 30)
  const html = `data:text/html;charset=utf-8,<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { background: transparent; overflow: hidden; -webkit-app-region: no-drag; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
    background: rgba(42,42,58,0.95); border: 1px solid rgba(74,158,255,0.4);
    border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    font: 12px -apple-system, sans-serif; color: rgba(255,255,255,0.8);
    white-space: nowrap; }
</style></head><body><div class="pill"><span>${icon}</span><span>${safeTitle}</span></div></body></html>`

  dragGhostWin.loadURL(html)
  dragGhostWin.webContents.once('did-finish-load', () => {
    if (dragGhostWin && !dragGhostWin.isDestroyed()) {
      dragGhostWin.showInactive()
    }
  })
}

function moveDragGhostWindow(screenX: number, screenY: number): void {
  if (dragGhostWin && !dragGhostWin.isDestroyed()) {
    dragGhostWin.setPosition(screenX + 12, screenY + 12, false)
  }
}

function destroyDragGhostWindow(): void {
  if (dragGhostWin && !dragGhostWin.isDestroyed()) {
    dragGhostWin.destroy()
  }
  dragGhostWin = null
}

// =============================================================================
// Register all IPC handlers ONCE (not per-window)
// =============================================================================

function registerAllHandlers(): void {
  registerTerminalHandlers()
  registerFilesystemHandlers()
  registerGitHandlers()
  registerShellHandlers()
  registerGitMonitorHandlers()
  registerStoreHandlers()
  registerMCPHandlers()
  registerNotificationHandlers()
  registerWorkspaceHandlers()

  // Shell: Reveal in Finder
  ipcMain.handle(SHELL_SHOW_IN_FOLDER, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // HTTP: Fetch from main process (no CORS)
  ipcMain.handle(HTTP_FETCH, async (_event, url: string): Promise<{ ok: boolean; status: number; text: string }> => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Cate/1.0' },
      })
      clearTimeout(timeout)
      const text = await res.text()
      return { ok: res.ok, status: res.status, text }
    } catch (err: any) {
      return { ok: false, status: 0, text: err.message || 'Fetch failed' }
    }
  })

  // Dialog handlers
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Project Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_event, options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Capture page screenshot for panel previews
  ipcMain.handle('capture-page', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return null
    const image = await win.webContents.capturePage()
    return image.toDataURL()
  })

  // Window management
  ipcMain.handle(WINDOW_CREATE, async (_event, params?: CateWindowParams) => {
    const win = createWindow(params)
    return win.id
  })

  ipcMain.handle(WINDOW_GET_ID, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.id ?? null
  })

  ipcMain.handle(WINDOW_GET_TYPE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    return getWindowType(win.id) ?? 'main'
  })

  // Panel transfer protocol
  ipcMain.handle(PANEL_TRANSFER, async (event, snapshot: PanelTransferSnapshot, targetWindowId?: number) => {
    // Begin terminal buffering if this is a terminal transfer
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, targetWindowId ?? -1)
    }

    if (targetWindowId) {
      // Transfer to existing window
      sendToWindow(targetWindowId, PANEL_RECEIVE, snapshot)
      // Track panel metadata for the target window
      setPanelWindowMeta(targetWindowId, snapshot.panel, undefined)
    } else {
      // Create a new panel window and send the transfer there
      const newWin = createWindow({
        type: 'panel',
        panelType: snapshot.panel.type,
        panelId: snapshot.panel.id,
        workspaceId: undefined,
      })

      // Track panel metadata
      setPanelWindowMeta(newWin.id, snapshot.panel, undefined)

      // Position at saved geometry if available
      if (snapshot.geometry) {
        newWin.setBounds({
          x: Math.round(snapshot.geometry.origin.x),
          y: Math.round(snapshot.geometry.origin.y),
          width: Math.round(snapshot.geometry.size.width),
          height: Math.round(snapshot.geometry.size.height),
        })
      }

      // Update target for terminal buffering
      if (snapshot.terminalPtyId) {
        beginTerminalTransfer(snapshot.terminalPtyId, newWin.id)
      }

      // Wait for the window to be ready, then send the snapshot
      newWin.webContents.once('did-finish-load', () => {
        sendToWindow(newWin.id, PANEL_RECEIVE, snapshot)
      })

      return newWin.id
    }
  })

  ipcMain.handle(PANEL_TRANSFER_ACK, async (_event, ptyId?: string) => {
    if (ptyId) {
      acknowledgeTerminalTransfer(ptyId)
    }
  })

  // List all active panel windows with their metadata and bounds
  ipcMain.handle(PANEL_WINDOWS_LIST, async () => {
    return listPanelWindows()
  })

  // Double-click panel window title bar → close the panel window and signal main window to dock
  ipcMain.handle(PANEL_WINDOW_DOCK_BACK, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    // Broadcast to main window(s) that this panel should be re-docked
    broadcastToAll(PANEL_WINDOW_DOCK_BACK, win.id)
    // Close the panel window
    win.close()
  })

  // Cross-window drag-and-drop
  ipcMain.handle(DRAG_START, async (event, snapshot: PanelTransferSnapshot) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const tempFile = writeDragTempFile(snapshot)
    const icon = createDragGhostImage()

    win.webContents.startDrag({
      file: tempFile,
      icon,
    })
  })

  ipcMain.handle(DRAG_DETACH, async (_event, snapshot: PanelTransferSnapshot, workspaceId?: string) => {
    const cursor = screen.getCursorScreenPoint()

    // Begin terminal buffering if applicable
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, -1)
    }

    const newWin = createWindow({
      type: 'dock',
      panelType: snapshot.panel.type,
      panelId: snapshot.panel.id,
      workspaceId,
    })

    // Update terminal transfer target now that we have the window ID
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, newWin.id)
    }

    // Position at cursor
    const display = screen.getDisplayNearestPoint(cursor)
    newWin.setBounds({
      x: cursor.x - display.bounds.x,
      y: cursor.y - display.bounds.y,
      width: snapshot.geometry?.size?.width ?? 700,
      height: snapshot.geometry?.size?.height ?? 500,
    })

    // Build initial dock state: single center zone with one tab stack
    const initPayload: DockWindowInitPayload = {
      panels: { [snapshot.panel.id]: snapshot.panel },
      dockState: buildSinglePanelDockState(snapshot.panel.id),
      workspaceId: workspaceId ?? '',
    }

    // Send the init payload + transfer snapshot once the window is ready
    newWin.webContents.once('did-finish-load', () => {
      sendToWindow(newWin.id, DOCK_WINDOW_INIT, initPayload)
      sendToWindow(newWin.id, PANEL_RECEIVE, snapshot)
    })

    cleanupDragTempFile()
    broadcastToAll(DRAG_END)

    return newWin.id
  })

  ipcMain.on(DRAG_END, () => {
    cleanupDragTempFile()
    broadcastToAll(DRAG_END)
  })

  // Dock window state sync (renderer -> main for session persistence)
  ipcMain.handle(DOCK_WINDOW_SYNC_STATE, async (event, state: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setDockWindowState(win.id, state as { dockState: any; panels: Record<string, PanelState>; workspaceId: string })
  })

  // List all dock windows with state and bounds
  ipcMain.handle(DOCK_WINDOWS_LIST, async () => {
    return listDockWindows()
  })

  // Cross-window drag coordination
  let crossWindowDragState: {
    snapshot: PanelTransferSnapshot
    sourceWindowId: number
    pollTimer: ReturnType<typeof setInterval> | null
  } | null = null

  // Used by CROSS_WINDOW_DRAG_RESOLVE to detect if a target window claimed the drop
  let crossWindowDropClaimed = false
  let crossWindowDropClaimedResolve: (() => void) | null = null

  ipcMain.handle(CROSS_WINDOW_DRAG_START, async (event, snapshot: PanelTransferSnapshot, _screenPos: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    crossWindowDragState = {
      snapshot,
      sourceWindowId: win.id,
      pollTimer: null,
    }

    // Create the native drag ghost window
    createDragGhostWindow(snapshot.panel.type, snapshot.panel.title)

    // Poll cursor position: move ghost, broadcast to all windows EXCEPT source
    crossWindowDragState.pollTimer = setInterval(() => {
      if (!crossWindowDragState) return
      const pos = screen.getCursorScreenPoint()
      moveDragGhostWindow(pos.x, pos.y)
      broadcastToAllExcept(crossWindowDragState.sourceWindowId, CROSS_WINDOW_DRAG_UPDATE, pos, crossWindowDragState.snapshot)
    }, 33) // ~30fps
  })

  ipcMain.handle(CROSS_WINDOW_DRAG_DROP, async (event, _panelId: string) => {
    if (crossWindowDragState) {
      if (crossWindowDragState.pollTimer) {
        clearInterval(crossWindowDragState.pollTimer)
      }
      // Notify source window to remove the panel
      sendToWindow(crossWindowDragState.sourceWindowId, DRAG_END)
      crossWindowDragState = null
    }
    destroyDragGhostWindow()

    // Signal the resolve handler that a target window claimed the drop
    if (crossWindowDropClaimedResolve) {
      crossWindowDropClaimedResolve()
    } else {
      crossWindowDropClaimed = true
    }
  })

  ipcMain.handle(CROSS_WINDOW_DRAG_CANCEL, async () => {
    if (!crossWindowDragState) return
    if (crossWindowDragState.pollTimer) {
      clearInterval(crossWindowDragState.pollTimer)
    }
    crossWindowDragState = null
    destroyDragGhostWindow()
    broadcastToAll(DRAG_END)
  })

  // Resolve cross-window drag on mouseup from source window.
  // Broadcasts DRAG_END, waits briefly for a target window to claim via crossWindowDragDrop,
  // then returns whether the drop was claimed. If not, source falls back to dragDetach.
  ipcMain.handle(CROSS_WINDOW_DRAG_RESOLVE, async () => {
    if (!crossWindowDragState) return { claimed: false }

    const sourceId = crossWindowDragState.sourceWindowId

    // Stop polling
    if (crossWindowDragState.pollTimer) {
      clearInterval(crossWindowDragState.pollTimer)
      crossWindowDragState.pollTimer = null
    }

    // Mark as resolving — crossWindowDragDrop will set claimed flag
    crossWindowDragState = null
    destroyDragGhostWindow()

    // Broadcast DRAG_END to non-source windows so target windows check their drop targets
    broadcastToAllExcept(sourceId, DRAG_END)

    // Wait briefly for a target window to call crossWindowDragDrop
    return new Promise<{ claimed: boolean }>((resolve) => {
      // Check if already claimed (race condition guard)
      if (crossWindowDropClaimed) {
        crossWindowDropClaimed = false
        resolve({ claimed: true })
        return
      }

      // Set up a short timeout — if no window claims within 80ms, report unclaimed
      const timeout = setTimeout(() => {
        crossWindowDropClaimedResolve = null
        crossWindowDropClaimed = false
        resolve({ claimed: false })
      }, 80)

      // Store resolver so crossWindowDragDrop can trigger it
      crossWindowDropClaimedResolve = () => {
        clearTimeout(timeout)
        crossWindowDropClaimedResolve = null
        crossWindowDropClaimed = false
        resolve({ claimed: true })
      }
    })
  })
}

// =============================================================================
// Helpers
// =============================================================================

/** Build a WindowDockState with a single panel in the center zone */
function buildSinglePanelDockState(panelId: string): WindowDockState {
  const stackId = crypto.randomUUID()
  return {
    left: { position: 'left', visible: false, size: 260, layout: null },
    right: { position: 'right', visible: false, size: 260, layout: null },
    bottom: { position: 'bottom', visible: false, size: 240, layout: null },
    center: {
      position: 'center',
      visible: true,
      size: 0,
      layout: {
        type: 'tabs',
        id: stackId,
        panelIds: [panelId],
        activeIndex: 0,
      },
    },
  }
}

// =============================================================================
// App lifecycle
// =============================================================================

// Set app name before menu and window creation
app.setName('Cate')

// Build application menu
buildApplicationMenu()

app.whenReady().then(async () => {
  // Resolve the user's real shell environment before registering handlers.
  // This ensures MCP servers, `which` lookups, etc. see the full PATH.
  await initShellEnv()
  registerAllHandlers()
  createWindow({ type: 'main' })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow({ type: 'main' })
  }
})

app.on('before-quit', () => {
  // Flush all terminal loggers so scrollback is persisted to disk
  flushAllLoggers()
})
