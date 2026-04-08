// =============================================================================
// Workspace Manager — main-process source of truth for workspace metadata.
//
// Stores WorkspaceInfo[] (id, name, color, rootPath).
// Canvas/panel state lives in each renderer window — only metadata is shared.
// =============================================================================

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import log from './logger'
import {
  WORKSPACE_LIST,
  WORKSPACE_CREATE,
  WORKSPACE_UPDATE,
  WORKSPACE_REMOVE,
  WORKSPACE_GET,
  WORKSPACE_CHANGED,
} from '../shared/ipc-channels'
import type { WorkspaceInfo } from '../shared/types'
import { broadcastToAll, windowFromEvent } from './windowRegistry'
import { addAllowedRoot } from './ipc/pathValidation'

// In-memory workspace list — authoritative source of truth
const workspaces: Map<string, WorkspaceInfo> = new Map()

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/** Accepts standard UUIDs (from randomUUID) and any safe alphanumeric id. */
const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/

function isValidWorkspaceId(id: string): boolean {
  return WORKSPACE_ID_RE.test(id)
}

/**
 * Returns true when rootPath is a real directory that lives inside the
 * current user's home directory. Rejects anything outside ~/ to prevent a
 * tampered session file from registering arbitrary system paths.
 */
function isValidRootPath(rootPath: string): boolean {
  try {
    const resolved = path.resolve(rootPath)
    const home = os.homedir()
    if (!resolved.startsWith(home + path.sep) && resolved !== home) {
      log.warn('workspaceManager: rootPath outside home dir, rejecting: %s', rootPath)
      return false
    }
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      log.warn('workspaceManager: rootPath is not a directory, rejecting: %s', rootPath)
      return false
    }
    return true
  } catch {
    log.warn('workspaceManager: rootPath does not exist or is unreadable, rejecting: %s', rootPath)
    return false
  }
}

function generateId(): string {
  return randomUUID()
}

// -----------------------------------------------------------------------------
// Public API (called by IPC handlers)
// -----------------------------------------------------------------------------

function listWorkspaces(): WorkspaceInfo[] {
  return Array.from(workspaces.values())
}

function getWorkspace(id: string): WorkspaceInfo | null {
  return workspaces.get(id) ?? null
}

function createWorkspace(name?: string, rootPath?: string, id?: string): WorkspaceInfo {
  // Validate caller-supplied id; fall back to a fresh UUID if invalid.
  const resolvedId = id && isValidWorkspaceId(id) ? id : generateId()
  if (id && resolvedId !== id) {
    log.warn('workspaceManager: invalid workspace id supplied, generating new one (supplied: %s)', id)
  }

  const info: WorkspaceInfo = {
    id: resolvedId,
    name: name ?? 'Workspace',
    color: '',
    rootPath: rootPath ?? '',
  }
  workspaces.set(info.id, info)
  log.info('Workspace created: %s (%s)', info.id, info.rootPath || 'no root')
  // Register workspace root as an allowed path for filesystem/git access
  // — only after validating the path is a real directory inside ~/
  if (info.rootPath && isValidRootPath(info.rootPath)) {
    addAllowedRoot(info.rootPath)
  } else if (info.rootPath) {
    log.warn('workspaceManager: rootPath rejected for new workspace %s: %s', info.id, info.rootPath)
  }
  return info
}

function updateWorkspace(id: string, changes: Partial<Omit<WorkspaceInfo, 'id'>>): WorkspaceInfo | null {
  if (!isValidWorkspaceId(id)) {
    log.warn('workspaceManager: updateWorkspace called with invalid id: %s', id)
    return null
  }
  const existing = workspaces.get(id)
  if (!existing) return null
  const updated = { ...existing, ...changes }
  workspaces.set(id, updated)
  // Register updated workspace root as an allowed path
  // — only after validating the path is a real directory inside ~/
  if (updated.rootPath && isValidRootPath(updated.rootPath)) {
    addAllowedRoot(updated.rootPath)
  } else if (updated.rootPath) {
    log.warn('workspaceManager: rootPath rejected for updated workspace %s: %s', id, updated.rootPath)
  }
  return updated
}

function removeWorkspace(id: string): boolean {
  if (!isValidWorkspaceId(id)) {
    log.warn('workspaceManager: removeWorkspace called with invalid id: %s', id)
    return false
  }
  const removed = workspaces.delete(id)
  if (removed) log.info('Workspace removed: %s', id)
  return removed
}

// -----------------------------------------------------------------------------
// Broadcast helper — notify all windows of workspace list change
// -----------------------------------------------------------------------------

function broadcastWorkspaceChange(originWindowId?: number): void {
  broadcastToAll(WORKSPACE_CHANGED, listWorkspaces(), originWindowId ?? null)
}

// -----------------------------------------------------------------------------
// IPC handler registration
// -----------------------------------------------------------------------------

export function registerWorkspaceHandlers(): void {
  // List all workspaces
  ipcMain.handle(WORKSPACE_LIST, async () => {
    return listWorkspaces()
  })

  // Get a single workspace by ID
  ipcMain.handle(WORKSPACE_GET, async (_event, id: string) => {
    return getWorkspace(id)
  })

  // Create a new workspace
  ipcMain.handle(
    WORKSPACE_CREATE,
    async (event, options?: { name?: string; rootPath?: string; id?: string }) => {
      const info = createWorkspace(options?.name, options?.rootPath, options?.id)
      const win = windowFromEvent(event)
      broadcastWorkspaceChange(win?.id)
      return info
    },
  )

  // Update workspace metadata
  ipcMain.handle(
    WORKSPACE_UPDATE,
    async (event, id: string, changes: Partial<Omit<WorkspaceInfo, 'id'>>) => {
      const updated = updateWorkspace(id, changes)
      if (updated) {
        const win = windowFromEvent(event)
        broadcastWorkspaceChange(win?.id)
      }
      return updated
    },
  )

  // Remove a workspace
  ipcMain.handle(WORKSPACE_REMOVE, async (event, id: string) => {
    const removed = removeWorkspace(id)
    if (removed) {
      const win = windowFromEvent(event)
      broadcastWorkspaceChange(win?.id)
    }
    return removed
  })
}
