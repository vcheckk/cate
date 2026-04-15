// =============================================================================
// Auto-updater — checks for new releases on GitHub and installs updates.
// Uses electron-updater natively; when the native updater is unavailable, the
// fallback path only performs version discovery and manual release-page routing.
// It intentionally does not mount, spawn, or replace downloaded assets unless
// a verified installer path is added in the future.
// =============================================================================

import { app, dialog, BrowserWindow, shell, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from './logger'
import { flushAllLoggers } from './ipc/terminal'
import { SESSION_FLUSH_SAVE, SESSION_FLUSH_SAVE_DONE } from '../shared/ipc-channels'
import { getWindowType } from './windowRegistry'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GITHUB_OWNER = '0-AI-UG'
const GITHUB_REPO = 'cate'
const API_LATEST_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// ---------------------------------------------------------------------------
// Pre-update session flush — ask the renderer to persist session state before
// the app restarts for an update. Returns a promise that resolves once the
// renderer ACKs (or after a 3s timeout if the renderer is unresponsive).
// ---------------------------------------------------------------------------

function flushSessionBeforeUpdate(): Promise<void> {
  return new Promise<void>((resolve) => {
    flushAllLoggers()
    const allWindows = BrowserWindow.getAllWindows()
    const mainWin = allWindows.find((w) => !w.isDestroyed() && getWindowType(w.id) === 'main')
    if (!mainWin) {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      log.warn('[auto-updater] Session flush timed out, proceeding with update')
      resolve()
    }, 3000)
    ipcMain.once(SESSION_FLUSH_SAVE_DONE, () => {
      clearTimeout(timeout)
      log.info('[auto-updater] Session flush confirmed before update')
      resolve()
    })
    mainWin.webContents.send(SESSION_FLUSH_SAVE)
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let isManualCheck = false
let fallbackInProgress = false

/** Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Native-updater dialog (shown when electron-updater finds an update)
// ---------------------------------------------------------------------------

function showUpdateDialog(info: { version: string }): void {
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
}

// ---------------------------------------------------------------------------
// Fallback update check via GitHub Releases API
// ---------------------------------------------------------------------------

interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

async function fallbackCheckForUpdate(manual: boolean): Promise<void> {
  if (fallbackInProgress) return
  fallbackInProgress = true

  try {
    log.info('[fallback-updater] Checking GitHub releases API…')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(API_LATEST_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': `Cate/${app.getVersion()}`, Accept: 'application/vnd.github.v3+json' },
    })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`)
    const data = (await res.json()) as GitHubRelease

    const latestVersion = data.tag_name
    const currentVersion = app.getVersion()
    log.info('[fallback-updater] Latest: %s  Current: v%s', latestVersion, currentVersion)

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      if (manual) {
        const win = BrowserWindow.getFocusedWindow()
        dialog.showMessageBox({
          ...(win ? { parentWindow: win } : {}),
          type: 'info',
          title: 'No Updates',
          message: 'You are running the latest version of Cate.',
        })
      }
      return
    }

    // Native fallback intentionally avoids installing downloaded binaries until
    // a verified installer path exists.
    const parentWin = BrowserWindow.getFocusedWindow()
    const { response } = await dialog.showMessageBox({
      ...(parentWin ? { parentWindow: parentWin } : {}),
      type: 'info',
      title: 'Update Available',
      message: `Cate ${latestVersion} is available (you have v${currentVersion}).`,
      detail: 'Automatic installation is unavailable in this build. Open the release page to download the verified installer manually?',
      buttons: ['Open Release Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return
    shell.openExternal(data.html_url)
  } catch (err: any) {
    log.error('[fallback-updater] Error:', err)
    if (manual) {
      const win = BrowserWindow.getFocusedWindow()
      dialog.showMessageBox({
        ...(win ? { parentWindow: win } : {}),
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: err.message || 'Please check your internet connection.',
      })
    }
  } finally {
    fallbackInProgress = false
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initAutoUpdater(): void {
  // Don't check for updates in dev mode
  if (!app.isPackaged) return

  log.info('Auto-updater initialized')

  autoUpdater.on('update-available', (info) => {
    log.info('Update available: v%s', info.version)
    showUpdateDialog(info)
  })

  autoUpdater.on('update-not-available', () => {
    log.info('No updates available')
    if (isManualCheck) {
      isManualCheck = false
      const win = BrowserWindow.getFocusedWindow()
      dialog.showMessageBox({
        ...(win ? { parentWindow: win } : {}),
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version of Cate.',
      })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded, ready to install')
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
      .then(async ({ response }) => {
        if (response === 0) {
          await flushSessionBeforeUpdate()
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...')
  })

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
    // Native auto-update failed (e.g. no code signing) — try fallback
    const wasManual = isManualCheck
    isManualCheck = false
    fallbackCheckForUpdate(wasManual)
  })

  // Check on launch (after a short delay to not block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('[auto-updater] Startup check threw, trying fallback:', err)
      fallbackCheckForUpdate(false)
    })
  }, 5000)

  // Check every 4 hours
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.warn('[auto-updater] Periodic check threw, trying fallback:', err)
        fallbackCheckForUpdate(false)
      })
    },
    4 * 60 * 60 * 1000,
  )
}

export function checkForUpdatesManually(): void {
  isManualCheck = true
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('[auto-updater] Manual check threw, trying fallback:', err)
    isManualCheck = false
    fallbackCheckForUpdate(true)
  })
}
