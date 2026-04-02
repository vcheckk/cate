// =============================================================================
// Window Registry — tracks all BrowserWindows for multi-window IPC routing
// =============================================================================

import { BrowserWindow } from 'electron'
import type { CateWindowType, DockStateSnapshot, PanelState } from '../shared/types'

/** All tracked windows keyed by their Electron window ID. */
const windows = new Map<number, BrowserWindow>()

/** Window type for each tracked window. */
const windowTypes = new Map<number, CateWindowType>()

/** Panel metadata for panel windows (set after transfer). */
const panelWindowMeta = new Map<number, { panel: PanelState; workspaceId?: string }>()

/** Dock window state — synced periodically from renderer for session persistence. */
const dockWindowState = new Map<number, { dockState: DockStateSnapshot; panels: Record<string, PanelState>; workspaceId: string }>()

/**
 * Register a BrowserWindow. Automatically unregisters on close.
 */
export function registerWindow(win: BrowserWindow, type: CateWindowType = 'main'): void {
  windows.set(win.id, win)
  windowTypes.set(win.id, type)
  win.on('closed', () => {
    windows.delete(win.id)
    windowTypes.delete(win.id)
    panelWindowMeta.delete(win.id)
    dockWindowState.delete(win.id)
  })
}

/**
 * Store panel metadata for a panel window (called after transfer).
 */
export function setPanelWindowMeta(windowId: number, panel: PanelState, workspaceId?: string): void {
  panelWindowMeta.set(windowId, { panel, workspaceId })
}

/**
 * Get panel metadata for a panel window.
 */
export function getPanelWindowMeta(windowId: number): { panel: PanelState; workspaceId?: string } | undefined {
  return panelWindowMeta.get(windowId)
}

/**
 * Get the window type for a given window ID.
 */
export function getWindowType(id: number): CateWindowType | undefined {
  return windowTypes.get(id)
}

/**
 * Get a window by its Electron window ID.
 */
export function getWindow(id: number): BrowserWindow | undefined {
  const win = windows.get(id)
  if (win && !win.isDestroyed()) return win
  return undefined
}

/**
 * Get all active (non-destroyed) windows.
 */
export function getAllWindows(): BrowserWindow[] {
  const result: BrowserWindow[] = []
  for (const win of windows.values()) {
    if (!win.isDestroyed()) result.push(win)
  }
  return result
}

/**
 * Send an IPC message to a specific window by ID. No-op if window is gone.
 */
export function sendToWindow(windowId: number, channel: string, ...args: unknown[]): void {
  const win = windows.get(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

/**
 * Broadcast an IPC message to ALL tracked windows.
 */
export function broadcastToAll(channel: string, ...args: unknown[]): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

/**
 * Broadcast an IPC message to all windows EXCEPT the specified one.
 */
export function broadcastToAllExcept(excludeId: number, channel: string, ...args: unknown[]): void {
  for (const [id, win] of windows.entries()) {
    if (id !== excludeId && !win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

/**
 * Resolve the BrowserWindow that owns an IPC event's sender.
 * Returns undefined if the window is destroyed or not found.
 */
export function windowFromEvent(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): BrowserWindow | undefined {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) return win
  return undefined
}

/**
 * Get all active panel windows with their metadata and bounds.
 */
export function listPanelWindows(): Array<{ windowId: number; panel: PanelState; workspaceId?: string; bounds: { x: number; y: number; width: number; height: number } }> {
  const result: Array<{ windowId: number; panel: PanelState; workspaceId?: string; bounds: { x: number; y: number; width: number; height: number } }> = []
  for (const [id, type] of windowTypes.entries()) {
    if (type !== 'panel') continue
    const win = windows.get(id)
    if (!win || win.isDestroyed()) continue
    const meta = panelWindowMeta.get(id)
    if (!meta) continue
    const bounds = win.getBounds()
    result.push({
      windowId: id,
      panel: meta.panel,
      workspaceId: meta.workspaceId,
      bounds,
    })
  }
  return result
}

// =============================================================================
// Dock window state management
// =============================================================================

/**
 * Store dock window state (synced periodically from renderer).
 */
export function setDockWindowState(
  windowId: number,
  state: { dockState: DockStateSnapshot; panels: Record<string, PanelState>; workspaceId: string },
): void {
  dockWindowState.set(windowId, state)
}

/**
 * Get dock window state.
 */
export function getDockWindowState(windowId: number): { dockState: DockStateSnapshot; panels: Record<string, PanelState>; workspaceId: string } | undefined {
  return dockWindowState.get(windowId)
}

/**
 * List all dock windows with their state and bounds.
 */
export function listDockWindows(): Array<{
  windowId: number
  dockState: DockStateSnapshot
  panels: Record<string, PanelState>
  bounds: { x: number; y: number; width: number; height: number }
  workspaceId: string
}> {
  const result: Array<{
    windowId: number
    dockState: DockStateSnapshot
    panels: Record<string, PanelState>
    bounds: { x: number; y: number; width: number; height: number }
    workspaceId: string
  }> = []
  for (const [id, type] of windowTypes.entries()) {
    if (type !== 'dock') continue
    const win = windows.get(id)
    if (!win || win.isDestroyed()) continue
    const state = dockWindowState.get(id)
    if (!state) continue
    const bounds = win.getBounds()
    result.push({
      windowId: id,
      ...state,
      bounds,
    })
  }
  return result
}
