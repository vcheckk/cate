// =============================================================================
// Terminal IPC handlers — manages node-pty terminal processes
// =============================================================================

import { IPty, spawn as ptySpawn } from 'node-pty'
import { ipcMain } from 'electron'
import os from 'os'
import { execFile } from 'child_process'
import {
  TERMINAL_CREATE,
  TERMINAL_WRITE,
  TERMINAL_RESIZE,
  TERMINAL_KILL,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_GET_CWD,
  TERMINAL_LOG_READ,
  TERMINAL_LOG_DELETE,
} from '../../shared/ipc-channels'
import { getOrCreateLogger, removeLogger, flushAll as flushAllLoggers } from './terminalLogger'
import { sendToWindow, windowFromEvent } from '../windowRegistry'
import { getShellEnv } from '../shellEnv'

// Active terminal PTY instances keyed by terminal ID
const terminals: Map<string, IPty> = new Map()

// Shell PIDs keyed by terminal ID — exported for shell.ts process monitor
export const terminalPids: Map<string, number> = new Map()

// Which window owns each terminal (windowId)
const terminalOwners: Map<string, number> = new Map()

// =============================================================================
// Terminal transfer buffering — holds PTY output during cross-window migration
// =============================================================================

interface TerminalTransferState {
  buffer: Buffer[]
  bufferSize: number
  targetWindowId: number
}

const transferStates = new Map<string, TerminalTransferState>()
const MAX_TRANSFER_BUFFER = 64 * 1024 // 64 KB
const TRANSFER_TIMEOUT_MS = 5000

/**
 * Begin buffering PTY output for a terminal being transferred to another window.
 * Output is accumulated until acknowledgeTerminalTransfer() is called.
 */
export function beginTerminalTransfer(ptyId: string, targetWindowId: number): void {
  transferStates.set(ptyId, {
    buffer: [],
    bufferSize: 0,
    targetWindowId,
  })

  // Safety timeout: if ACK never arrives, flush back to source and cancel
  setTimeout(() => {
    const state = transferStates.get(ptyId)
    if (!state) return // already acknowledged
    // Flush buffer to whatever window currently owns the terminal
    const ownerWindowId = terminalOwners.get(ptyId)
    if (ownerWindowId != null) {
      for (const chunk of state.buffer) {
        sendToWindow(ownerWindowId, TERMINAL_DATA, ptyId, chunk.toString())
      }
    }
    transferStates.delete(ptyId)
  }, TRANSFER_TIMEOUT_MS)
}

/**
 * Complete a terminal transfer: flush buffered output to the new window and
 * update the terminal owner mapping.
 */
export function acknowledgeTerminalTransfer(ptyId: string): void {
  const state = transferStates.get(ptyId)
  if (!state) return

  const { targetWindowId, buffer } = state

  // Update ownership
  terminalOwners.set(ptyId, targetWindowId)

  // Flush buffered data to the target window
  for (const chunk of buffer) {
    sendToWindow(targetWindowId, TERMINAL_DATA, ptyId, chunk.toString())
  }

  transferStates.delete(ptyId)
}

/**
 * Get the owning window ID for a terminal.
 */
export function getTerminalOwner(terminalId: string): number | undefined {
  return terminalOwners.get(terminalId)
}

/**
 * Reassign a terminal to a different window (e.g. when dragging a panel out).
 */
export function reassignTerminalWindow(terminalId: string, newWindowId: number): void {
  terminalOwners.set(terminalId, newWindowId)
}

function createTerminal(
  id: string,
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  env: Record<string, string>,
  ownerWindowId: number,
): void {
  // Use the resolved shell environment (full PATH from login shell) and
  // strip npm/node env vars injected by electron-vite so they don't leak
  // into user shells (e.g. npm_config_prefix conflicts with nvm)
  const cleanEnv = Object.fromEntries(
    Object.entries(getShellEnv()).filter(
      ([key]) => !key.startsWith('npm_') && !key.startsWith('ELECTRON_'),
    ),
  )

  const ptyProcess = ptySpawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...cleanEnv, ...env },
  })

  terminals.set(id, ptyProcess)
  terminalPids.set(id, ptyProcess.pid)
  terminalOwners.set(id, ownerWindowId)

  // Buffer PTY output and flush at ~60fps to avoid hammering IPC on fast output
  let dataBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  ptyProcess.onData((data: string) => {
    // Log to disk for session restore
    const logger = getOrCreateLogger(id)
    logger.append(data)

    // If this terminal is being transferred, buffer instead of forwarding
    const transferState = transferStates.get(id)
    if (transferState) {
      const chunk = Buffer.from(data)
      transferState.buffer.push(chunk)
      transferState.bufferSize += chunk.length
      // Evict oldest chunks if over cap
      while (transferState.bufferSize > MAX_TRANSFER_BUFFER && transferState.buffer.length > 1) {
        transferState.bufferSize -= transferState.buffer.shift()!.length
      }
      return
    }

    dataBuffer += data
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        if (dataBuffer) {
          const windowId = terminalOwners.get(id)
          if (windowId != null) {
            sendToWindow(windowId, TERMINAL_DATA, id, dataBuffer)
          }
        }
        dataBuffer = ''
      }, 16)
    }
  })

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    const windowId = terminalOwners.get(id)
    terminals.delete(id)
    terminalPids.delete(id)
    terminalOwners.delete(id)
    if (windowId != null) {
      sendToWindow(windowId, TERMINAL_EXIT, id, exitCode)
    }
  })
}

function writeTerminal(id: string, data: string): void {
  const pty = terminals.get(id)
  if (pty) {
    pty.write(data)
  }
}

function resizeTerminal(id: string, cols: number, rows: number): void {
  const pty = terminals.get(id)
  if (pty) {
    pty.resize(cols, rows)
  }
}

function killTerminal(id: string): void {
  const logger = getOrCreateLogger(id)
  logger.flush()
  removeLogger(id)  // flush + stop timer + remove from map (keeps files)

  const pty = terminals.get(id)
  if (pty) {
    pty.kill()
    terminals.delete(id)
    terminalPids.delete(id)
    terminalOwners.delete(id)
  }
}

function getTerminalPid(id: string): number | undefined {
  return terminalPids.get(id)
}

export function registerHandlers(): void {
  ipcMain.handle(
    TERMINAL_CREATE,
    async (
      event,
      options: { cols: number; rows: number; cwd?: string; shell?: string },
    ): Promise<string> => {
      const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const shell = options.shell || process.env.SHELL || '/bin/zsh'
      const cwd = options.cwd || os.homedir()
      const win = windowFromEvent(event)
      const windowId = win?.id ?? -1
      createTerminal(id, shell, cwd, options.cols, options.rows, {}, windowId)
      return id
    },
  )

  ipcMain.handle(TERMINAL_WRITE, async (_event, terminalId: string, data: string) => {
    writeTerminal(terminalId, data)
  })

  ipcMain.handle(
    TERMINAL_RESIZE,
    async (_event, terminalId: string, cols: number, rows: number) => {
      resizeTerminal(terminalId, cols, rows)
    },
  )

  ipcMain.handle(TERMINAL_KILL, async (_event, terminalId: string) => {
    killTerminal(terminalId)
  })

  // Get terminal's current working directory via lsof
  ipcMain.handle(TERMINAL_GET_CWD, async (_event, ptyId: string): Promise<string | null> => {
    const pid = terminalPids.get(ptyId)
    if (!pid) return null
    return new Promise((resolve) => {
      execFile('lsof', ['-d', 'cwd', '-p', `${pid}`, '-Fn'], {
        encoding: 'utf-8',
        timeout: 2000,
      }, (err, stdout) => {
        if (err || !stdout) {
          resolve(null)
          return
        }
        const lines = stdout.split('\n')
        const nameLine = lines.find(l => l.startsWith('n'))
        resolve(nameLine ? nameLine.slice(1) : null)
      })
    })
  })

  // Read terminal log for session restore
  ipcMain.handle(TERMINAL_LOG_READ, async (_event, terminalId: string): Promise<string | null> => {
    const { TerminalLogger } = await import('./terminalLogger')
    const logger = new TerminalLogger(terminalId)
    const data = logger.readAll()
    return data || null
  })

  // Delete terminal log files
  ipcMain.handle(TERMINAL_LOG_DELETE, async (_event, terminalId: string): Promise<void> => {
    const { TerminalLogger } = await import('./terminalLogger')
    const logger = new TerminalLogger(terminalId)
    logger.delete()
  })
}

export { getTerminalPid, flushAllLoggers }
