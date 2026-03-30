// =============================================================================
// Auto-updater — checks for new releases on GitHub and installs updates.
// =============================================================================

import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let updateAvailable = false

export function initAutoUpdater(): void {
  // Don't check for updates in dev mode
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    updateAvailable = true

    const win = BrowserWindow.getFocusedWindow()
    dialog
      .showMessageBox({
        ...(win ? { parentWindow: win } : {}),
        type: 'info',
        title: 'Update Available',
        message: `A new version of Cate (v${info.version}) is available.`,
        detail: 'Would you like to download and install it?',
        buttons: ['Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-downloaded', () => {
    const win = BrowserWindow.getFocusedWindow()
    dialog
      .showMessageBox({
        ...(win ? { parentWindow: win } : {}),
        type: 'info',
        title: 'Update Ready',
        message: 'The update has been downloaded.',
        detail: 'Restart Cate now to apply the update?',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  // Check on launch (after a short delay to not block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)

  // Check every 4 hours
  setInterval(
    () => {
      if (!updateAvailable) {
        autoUpdater.checkForUpdates().catch(() => {})
      }
    },
    4 * 60 * 60 * 1000,
  )
}

export function checkForUpdatesManually(): void {
  updateAvailable = false
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
        const win = BrowserWindow.getFocusedWindow()
        dialog.showMessageBox({
          ...(win ? { parentWindow: win } : {}),
          type: 'info',
          title: 'No Updates',
          message: 'You are running the latest version of Cate.',
        })
      }
    })
    .catch((err) => {
      const win = BrowserWindow.getFocusedWindow()
      dialog.showMessageBox({
        ...(win ? { parentWindow: win } : {}),
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: err.message || 'Please check your internet connection.',
      })
    })
}
