// =============================================================================
// DragGhost — floating preview that follows the cursor during dock-aware drags.
// Shows the panel title and type icon as a small pill.
// =============================================================================

import React from 'react'
import { useDockDragStore } from '../hooks/useDockDrag'
import { Terminal, Globe, FileText, GitBranch, FolderOpen, LayoutGrid, Layout } from 'lucide-react'
import type { PanelType } from '../../shared/types'

function PanelIcon({ type }: { type: PanelType }) {
  const props = { size: 12, className: 'text-white/70' }
  switch (type) {
    case 'terminal': return <Terminal {...props} />
    case 'browser': return <Globe {...props} />
    case 'editor': return <FileText {...props} />
    case 'git': return <GitBranch {...props} />
    case 'fileExplorer': return <FolderOpen {...props} />
    case 'projectList': return <LayoutGrid {...props} />
    case 'canvas': return <Layout {...props} />
  }
}

export default function DragGhost() {
  const isDragging = useDockDragStore((s) => s.isDragging)
  const panelType = useDockDragStore((s) => s.draggedPanelType)
  const panelTitle = useDockDragStore((s) => s.draggedPanelTitle)
  const cursorPosition = useDockDragStore((s) => s.cursorPosition)

  if (!isDragging || !cursorPosition || !panelType) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: cursorPosition.x + 12,
        top: cursorPosition.y + 12,
        zIndex: 99999,
        pointerEvents: 'none',
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#2a2a3a] border border-[#4a9eff]/40 rounded-md shadow-lg">
        <PanelIcon type={panelType} />
        <span className="text-xs text-white/80 whitespace-nowrap max-w-[150px] truncate">
          {panelTitle}
        </span>
      </div>
    </div>
  )
}
