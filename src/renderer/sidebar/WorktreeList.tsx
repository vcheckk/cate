// =============================================================================
// WorktreeList — Collapsible list of local git worktrees.
// =============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, GitBranch } from 'lucide-react'

interface GitWorktree {
  path: string
  branch: string
  isBare: boolean
  isCurrent: boolean
}

interface WorktreeListProps {
  rootPath: string
  /** Called on mount and when parent triggers a refresh. */
  refreshKey?: number
}

export const WorktreeList: React.FC<WorktreeListProps> = ({ rootPath, refreshKey }) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const hasAutoExpanded = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.gitWorktreeList(rootPath)
      setWorktrees(result)
      // Auto-expand on first load if there are multiple worktrees
      if (result.length > 1 && !hasAutoExpanded.current) {
        setCollapsed(false)
        hasAutoExpanded.current = true
      }
    } catch {
      setWorktrees([])
    }
  }, [rootPath])

  useEffect(() => { refresh() }, [refresh, refreshKey])

  if (worktrees.length <= 1) return null

  const basename = (p: string) => p.split('/').pop() || p

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full px-3 py-1 text-xs text-white/40 uppercase hover:text-white/60 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        Worktrees ({worktrees.length})
      </button>
      {!collapsed && worktrees.map((wt) => (
        <div
          key={wt.path}
          className="flex items-center gap-2 px-3 py-1 text-xs"
        >
          <GitBranch size={12} className={wt.isCurrent ? 'text-green-400' : 'text-white/30'} />
          <span className={wt.isCurrent ? 'text-white/80 font-medium' : 'text-white/50'}>
            {wt.branch}
          </span>
          <span className="text-white/20 truncate ml-auto">{basename(wt.path)}</span>
        </div>
      ))}
    </div>
  )
}
