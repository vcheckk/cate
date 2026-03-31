// =============================================================================
// Notification IPC handlers — OS-level notifications via Electron Notification API
// =============================================================================

import { ipcMain, Notification, app, BrowserWindow } from 'electron'
import { NOTIFY_OS, NOTIFY_ACTION } from '../../shared/ipc-channels'
import type { NotificationAction } from '../../shared/types'

export function registerHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    NOTIFY_OS,
    async (
      _event,
      payload: { title: string; body: string; action?: NotificationAction },
    ) => {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: payload.title,
          body: payload.body,
        })

        notification.on('click', () => {
          // Focus the main window
          if (!mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
          }

          // Send the action back to the renderer so it can execute it
          if (payload.action && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(NOTIFY_ACTION, payload.action)
          }
        })

        notification.show()
      }

      // Dock bounce on macOS
      if (process.platform === 'darwin') {
        app.dock?.bounce('informational')
      }
    },
  )
}
