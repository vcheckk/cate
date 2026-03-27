// =============================================================================
// useProcessMonitor — React hook bridging to the main process shell monitor.
// Ported from ProcessMonitor.swift event handling and notification triggers.
// =============================================================================

import { useEffect, useRef } from 'react'
import { useStatusStore } from '../stores/statusStore'
import { useAppStore } from '../stores/appStore'
import { playCommandFinished, playClaudeNeedsInput } from '../lib/notifications'
import type { TerminalActivity, ClaudeCodeState, NodeActivityState } from '../../shared/types'

// -----------------------------------------------------------------------------
// Previous state tracking for transition detection
// -----------------------------------------------------------------------------

interface PreviousTerminalState {
  claudeState: ClaudeCodeState
  nodeActivityType: NodeActivityState['type'] | null
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

/**
 * Subscribe to shell activity updates from the main process and update the
 * status store accordingly. Plays sound notifications on state transitions
 * (command finished, Claude waiting for input).
 *
 * Should be called once per workspace, typically in the workspace root component.
 */
export function useProcessMonitor(workspaceId: string): void {
  // Track previous states per terminal to detect transitions
  const previousStatesRef = useRef<Map<string, PreviousTerminalState>>(new Map())

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onShellActivityUpdate) return

    const store = useStatusStore.getState

    const unsubscribe = api.onShellActivityUpdate(
      (terminalId: string, activityRaw: unknown, claudeStateRaw: unknown) => {
        const terminalActivity = activityRaw as TerminalActivity
        const claudeState = (claudeStateRaw as ClaudeCodeState) ?? 'notRunning'

        // Retrieve previous state for this terminal
        const prevMap = previousStatesRef.current
        const prev = prevMap.get(terminalId) || {
          claudeState: 'notRunning' as ClaudeCodeState,
          nodeActivityType: null,
        }

        // --- Update status store ---

        // 1. Terminal activity
        store().setTerminalActivity(workspaceId, terminalId, terminalActivity)

        // 2. Claude Code state
        store().setClaudeState(workspaceId, terminalId, claudeState)

        // --- Derive node activity and trigger notifications ---
        // The main process does not send nodeId or nodeActivity directly.
        // We derive nodeActivity from claudeState transitions, matching the
        // Swift ProcessMonitor logic.

        let currentNodeActivityType: NodeActivityState['type'] | null = null

        // Detect transition to waitingForInput
        if (claudeState === 'waitingForInput' && prev.claudeState !== 'waitingForInput') {
          currentNodeActivityType = 'claudeWaitingForInput'
          playClaudeNeedsInput()
        }

        // Detect command finished: terminal went from running to idle
        if (
          terminalActivity.type === 'idle' &&
          prev.claudeState === 'notRunning' &&
          claudeState === 'notRunning'
        ) {
          // Only trigger if we previously had activity (avoid initial idle state)
          if (prev.nodeActivityType === null && prevMap.has(terminalId)) {
            // Terminal was already idle — no transition
          }
        }

        // Detect Claude finished
        if (claudeState === 'finished' && prev.claudeState !== 'finished') {
          currentNodeActivityType = 'commandFinished'
          playCommandFinished()
        }

        // If Claude transitions from waitingForInput to running, clear the node activity
        if (claudeState === 'running' && prev.claudeState === 'waitingForInput') {
          currentNodeActivityType = 'normal'
        }

        // Update previous state
        prevMap.set(terminalId, {
          claudeState,
          nodeActivityType: currentNodeActivityType ?? prev.nodeActivityType,
        })
      },
    )

    return () => {
      unsubscribe()
    }
  }, [workspaceId])

  // --- Port updates ---
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onShellPortsUpdate) return

    const unsubscribe = api.onShellPortsUpdate((terminalId: string, ports: number[]) => {
      useStatusStore.getState().setTerminalPorts(terminalId, ports)
    })

    return () => { unsubscribe() }
  }, [])

  // --- CWD updates ---
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onShellCwdUpdate) return

    const unsubscribe = api.onShellCwdUpdate((terminalId: string, cwd: string) => {
      useStatusStore.getState().setTerminalCwd(terminalId, cwd)
    })

    return () => { unsubscribe() }
  }, [])

  // --- Git branch updates ---
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onGitBranchUpdate) return

    const unsubscribe = api.onGitBranchUpdate(
      (workspaceId: string, branch: string, isDirty: boolean) => {
        useStatusStore.getState().setGitInfo(workspaceId, branch, isDirty)
      },
    )

    return () => { unsubscribe() }
  }, [])

  // --- Start git monitor for workspace ---
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.gitMonitorStart) return

    const ws = useAppStore.getState().getWorkspace(workspaceId)
    if (ws?.rootPath) {
      api.gitMonitorStart(workspaceId, ws.rootPath)
    }

    return () => {
      api.gitMonitorStop?.(workspaceId)
    }
  }, [workspaceId])
}
