// =============================================================================
// Git Monitor — polls git branch + dirty status per workspace
// =============================================================================

import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import log from '../logger'
import { validateCwd } from './pathValidation'
import {
  GIT_BRANCH_UPDATE,
  GIT_MONITOR_START,
  GIT_MONITOR_STOP,
} from '../../shared/ipc-channels'
import { sendToWindow, windowFromEvent } from '../windowRegistry'

const POLL_INTERVAL_MS = 5000

interface MonitorEntry {
  interval: ReturnType<typeof setInterval>
  ownerWindowId: number
  /** AbortController for the currently in-flight execFile calls. */
  abortController: AbortController | null
}

const activeMonitors: Map<string, MonitorEntry> = new Map()
const lastState: Map<string, { branch: string; isDirty: boolean }> = new Map()

function pollGitStatus(
  ownerWindowId: number,
  workspaceId: string,
  rootPath: string,
  entry: MonitorEntry,
): void {
  // Abort any previous in-flight calls for this workspace
  entry.abortController?.abort()
  const ac = new AbortController()
  entry.abortController = ac

  execFile(
    'git',
    ['-C', rootPath, 'branch', '--show-current'],
    { timeout: 3000, signal: ac.signal },
    (err, branchOut, branchErr) => {
      if (err) {
        // Ignore AbortError — this is intentional cancellation on stop
        if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') return
        log.debug('git branch failed for %s: %s', rootPath, branchErr || err.message)
        return
      }

      const branch = branchOut.trim()
      if (!branch) return

      execFile(
        'git',
        ['-C', rootPath, 'status', '--porcelain', '-uno'],
        { timeout: 3000, signal: ac.signal },
        (err2, statusOut, statusErr) => {
          if (err2) {
            if ((err2 as NodeJS.ErrnoException).code === 'ABORT_ERR') return
            log.debug('git status failed for %s: %s', rootPath, statusErr || err2.message)
            return
          }

          // Clear the in-flight controller now that this poll completed
          if (entry.abortController === ac) {
            entry.abortController = null
          }

          const isDirty = statusOut.trim().length > 0

          const prev = lastState.get(workspaceId)
          if (prev && prev.branch === branch && prev.isDirty === isDirty) return

          lastState.set(workspaceId, { branch, isDirty })
          sendToWindow(ownerWindowId, GIT_BRANCH_UPDATE, workspaceId, branch, isDirty)
        },
      )
    },
  )
}

/**
 * Stop all monitors owned by a specific window (called on window close).
 */
export function stopMonitorsForWindow(windowId: number): void {
  for (const [workspaceId, entry] of activeMonitors) {
    if (entry.ownerWindowId === windowId) {
      clearInterval(entry.interval)
      entry.abortController?.abort()
      activeMonitors.delete(workspaceId)
      lastState.delete(workspaceId)
    }
  }
}

export function registerHandlers(): void {
  ipcMain.on(GIT_MONITOR_START, (event, workspaceId: string, rootPath: string) => {
    const validRoot = validateCwd(rootPath)
    const existing = activeMonitors.get(workspaceId)
    if (existing) {
      clearInterval(existing.interval)
      existing.abortController?.abort()
    }

    const win = windowFromEvent(event)
    const ownerWindowId = win?.id ?? -1

    // Create the entry first so pollGitStatus can reference it for AbortController
    const entry: MonitorEntry = {
      interval: null as unknown as ReturnType<typeof setInterval>,
      ownerWindowId,
      abortController: null,
    }

    pollGitStatus(ownerWindowId, workspaceId, validRoot, entry)
    entry.interval = setInterval(() => {
      pollGitStatus(ownerWindowId, workspaceId, validRoot, entry)
    }, POLL_INTERVAL_MS)

    activeMonitors.set(workspaceId, entry)
  })

  ipcMain.on(GIT_MONITOR_STOP, (_event, workspaceId: string) => {
    const entry = activeMonitors.get(workspaceId)
    if (entry) {
      clearInterval(entry.interval)
      entry.abortController?.abort()
      activeMonitors.delete(workspaceId)
    }
    lastState.delete(workspaceId)
  })
}
