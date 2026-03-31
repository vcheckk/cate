// =============================================================================
// Notification Store — Zustand state for in-app toasts + OS notification dispatch
// =============================================================================

import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'
import { useAppStore } from './appStore'
import { useCanvasStore } from './canvasStore'
import { terminalRegistry } from '../lib/terminalRegistry'
import type { NotificationAction } from '../../shared/types'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Notification {
  id: string
  title: string
  body: string
  type: 'info' | 'success' | 'warning'
  timestamp: number
  action?: NotificationAction
}

interface NotificationStoreState {
  /** Persistent list shown in bell popup */
  notifications: Notification[]
  /** Transient toasts shown bottom-right, auto-dismissed */
  toasts: Notification[]
}

interface NotificationStoreActions {
  notify: (payload: {
    title: string
    body: string
    type?: Notification['type']
    action?: NotificationAction
  }) => void
  dismissToast: (id: string) => void
  dismissNotification: (id: string) => void
  clearAll: () => void
  executeAction: (action: NotificationAction) => void
}

export type NotificationStore = NotificationStoreState & NotificationStoreActions

// Keep Toast as alias for backward compat with ToastContainer
export type Toast = Notification

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const MAX_TOASTS = 3
const MAX_NOTIFICATIONS = 50
const AUTO_DISMISS_MS = 5000

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

let counter = 0

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  toasts: [],

  notify({ title, body, type = 'info', action }) {
    const settings = useSettingsStore.getState()
    if (!settings.notificationsEnabled) return
    if (settings.notificationMode === 'off') return

    const isFocused = document.hasFocus()
    const skipWhenFocused = settings.notifyOnlyWhenUnfocused && isFocused
    const mode = settings.notificationMode

    // OS notification (suppressed when focused if notifyOnlyWhenUnfocused is on)
    if ((mode === 'os' || mode === 'both') && !skipWhenFocused) {
      window.electronAPI?.notifyOS({ title, body, action })
    }

    const id = `notif-${++counter}`
    const entry: Notification = { id, title, body, type, timestamp: Date.now(), action }

    // Always add to persistent history
    set((state) => {
      const notifications = [entry, ...state.notifications].slice(0, MAX_NOTIFICATIONS)
      return { notifications }
    })

    // In-app toast (always shown regardless of focus)
    if (mode === 'inApp' || mode === 'both') {
      set((state) => {
        const toasts = [...state.toasts, entry]
        while (toasts.length > MAX_TOASTS) toasts.shift()
        return { toasts }
      })

      // Auto-dismiss toast only (notification stays in history)
      setTimeout(() => {
        get().dismissToast(id)
      }, AUTO_DISMISS_MS)
    }
  },

  dismissToast(id) {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  dismissNotification(id) {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
  },

  clearAll() {
    set({ notifications: [], toasts: [] })
  },

  executeAction(action) {
    switch (action.type) {
      case 'focusTerminal': {
        const { workspaceId, terminalId } = action
        useAppStore.getState().selectWorkspace(workspaceId)
        // terminalId is the ptyId — resolve to panelId for canvas lookup
        const panelId = terminalRegistry.panelIdForPty(terminalId) ?? terminalId
        // Use setTimeout to ensure workspace switch has applied
        setTimeout(() => {
          const nodeId = useCanvasStore.getState().nodeForPanel(panelId)
          if (nodeId) {
            useCanvasStore.getState().focusAndCenter(nodeId)
          }
        }, 50)
        break
      }
    }
  },
}))

// -----------------------------------------------------------------------------
// Subscribe to OS notification click actions from main process
// -----------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  const api = (window as any).electronAPI
  if (api?.onNotifyAction) {
    api.onNotifyAction((action: NotificationAction) => {
      useNotificationStore.getState().executeAction(action)
    })
  }
}
