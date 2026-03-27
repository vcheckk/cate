import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import {
  Terminal,
  Globe,
  FileCode2,
  FolderOpen,
  Keyboard,
  Folder,
} from 'lucide-react'

// Abbreviate home directory in paths
function abbreviatePath(fullPath: string): string {
  const home = '/Users/'
  if (fullPath.startsWith(home)) {
    const rest = fullPath.slice(home.length)
    const slashIdx = rest.indexOf('/')
    return '~' + (slashIdx >= 0 ? rest.slice(slashIdx) : '')
  }
  return fullPath
}

export default function WelcomePage({ workspaceId }: { workspaceId: string }) {
  const [recentProjects, setRecentProjects] = useState<string[]>([])

  useEffect(() => {
    window.electronAPI.recentProjectsGet().then(setRecentProjects).catch(() => {})
  }, [])

  const openFolder = useCallback(async () => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      useAppStore.getState().setWorkspaceRootPath(workspaceId, path)
    }
  }, [workspaceId])

  const openRecentProject = useCallback(
    (path: string) => {
      useAppStore.getState().setWorkspaceRootPath(workspaceId, path)
    },
    [workspaceId],
  )

  const newTerminal = useCallback(() => {
    useAppStore.getState().createTerminal(workspaceId)
  }, [workspaceId])

  const newEditor = useCallback(() => {
    useAppStore.getState().createEditor(workspaceId)
  }, [workspaceId])

  const newBrowser = useCallback(() => {
    useAppStore.getState().createBrowser(workspaceId)
  }, [workspaceId])

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="pointer-events-auto max-w-2xl w-full px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white/90 tracking-tight">
            CanvasIDE
          </h1>
          <p className="text-sm text-white/40 mt-1">
            Infinite canvas for coding
          </p>
        </div>

        {/* Two-column layout: Start + Recent */}
        <div className="flex gap-12">
          {/* Start actions */}
          <div className="flex-1">
            <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
              Start
            </h2>
            <div className="flex flex-col gap-1">
              <ActionItem
                icon={<FolderOpen size={16} />}
                label="Open Folder..."
                onClick={openFolder}
              />
              <ActionItem
                icon={<Terminal size={16} />}
                label="New Terminal"
                shortcut="⌘T"
                onClick={newTerminal}
              />
              <ActionItem
                icon={<FileCode2 size={16} />}
                label="New Editor"
                shortcut="⌘⇧E"
                onClick={newEditor}
              />
              <ActionItem
                icon={<Globe size={16} />}
                label="New Browser"
                shortcut="⌘⇧B"
                onClick={newBrowser}
              />
            </div>
          </div>

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div className="flex-1">
              <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                Recent
              </h2>
              <div className="flex flex-col gap-0.5">
                {recentProjects.map((projectPath) => {
                  const name = projectPath.split('/').filter(Boolean).pop() ?? projectPath
                  const parent = abbreviatePath(
                    projectPath.split('/').slice(0, -1).join('/'),
                  )
                  return (
                    <button
                      key={projectPath}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-white/5 transition-colors group"
                      onClick={() => openRecentProject(projectPath)}
                    >
                      <Folder
                        size={14}
                        className="text-white/30 group-hover:text-white/60 flex-shrink-0"
                      />
                      <span className="text-sm text-blue-400 group-hover:text-blue-300 truncate">
                        {name}
                      </span>
                      <span className="text-xs text-white/25 truncate">
                        {parent}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Keyboard shortcuts */}
        <div className="mt-10 pt-6 border-t border-white/5">
          <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
            Keyboard Shortcuts
          </h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <ShortcutRow keys="⌘T" label="New Terminal" />
            <ShortcutRow keys="⌘⇧B" label="New Browser" />
            <ShortcutRow keys="⌘⇧E" label="New Editor" />
            <ShortcutRow keys="⌘K" label="Command Palette" />
            <ShortcutRow keys="⌘\" label="Toggle Sidebar" />
            <ShortcutRow keys="⌘0" label="Reset Zoom" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
}) {
  return (
    <button
      className="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-white/5 transition-colors group"
      onClick={onClick}
    >
      <span className="text-white/30 group-hover:text-white/60">{icon}</span>
      <span className="text-sm text-blue-400 group-hover:text-blue-300">
        {label}
      </span>
      {shortcut && (
        <span className="ml-auto text-xs text-white/20">{shortcut}</span>
      )}
    </button>
  )
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/50 font-mono w-10 text-right">
        {keys}
      </span>
      <span className="text-xs text-white/30">{label}</span>
    </div>
  )
}
