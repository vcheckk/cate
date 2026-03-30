import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron'
import path from 'path'
import { SHELL_SHOW_IN_FOLDER, HTTP_FETCH } from '../shared/ipc-channels'
import { registerHandlers as registerTerminalHandlers, flushAllLoggers } from './ipc/terminal'
import { registerHandlers as registerFilesystemHandlers } from './ipc/filesystem'
import { registerHandlers as registerGitHandlers } from './ipc/git'
import { registerHandlers as registerShellHandlers } from './ipc/shell'
import { registerHandlers as registerGitMonitorHandlers } from './ipc/git-monitor'
import { registerHandlers as registerStoreHandlers } from './store'
import { registerHandlers as registerMCPHandlers } from './ipc/mcp'
import { buildApplicationMenu } from './menu'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = path.join(__dirname, '../../build/icon-1024.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Cate',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1E1E24',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }


  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Register all IPC handlers with mainWindow reference
  registerTerminalHandlers(mainWindow)
  registerFilesystemHandlers(mainWindow)
  registerGitHandlers()
  registerShellHandlers(mainWindow)
  registerGitMonitorHandlers(mainWindow)
  registerStoreHandlers()
  registerMCPHandlers(mainWindow)
}

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
ipcMain.handle('capture-page', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  const image = await mainWindow.webContents.capturePage()
  return image.toDataURL()
})

// Set app name before menu and window creation
app.setName('Cate')

// Build application menu
buildApplicationMenu()

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  // Flush all terminal loggers so scrollback is persisted to disk
  flushAllLoggers()
})
