// =============================================================================
// FileTreeNode — Recursive tree node for the file explorer.
// Ported from FileTreeNodeView in FileExplorerView.swift + FileTreeNode.swift
// =============================================================================

import React, { useCallback, useState } from 'react'
import type { FileTreeNode as FileTreeNodeType } from '../../shared/types'

// -----------------------------------------------------------------------------
// Icon mapping — extension to inline SVG icons with colors
// Mirrors the Swift sfSymbolName mapping from FileTreeNode.swift
// -----------------------------------------------------------------------------

interface IconDef {
  icon: React.ReactNode
  color: string
}

function getFileIcon(extension: string, isDirectory: boolean, isExpanded: boolean): IconDef {
  if (isDirectory) {
    return isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER
  }

  switch (extension.toLowerCase()) {
    case 'swift':
      return ICON_SWIFT
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return ICON_JS
    case 'py':
      return ICON_PY
    case 'json':
      return ICON_JSON
    case 'md':
    case 'markdown':
      return ICON_MD
    case 'html':
    case 'htm':
      return ICON_HTML
    case 'css':
    case 'scss':
      return ICON_CSS
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return ICON_IMAGE
    default:
      return ICON_DEFAULT
  }
}

// -----------------------------------------------------------------------------
// SVG icon components (simple inline, no external dependency)
// Using lucide-react style paths at 16x16
// -----------------------------------------------------------------------------

const ChevronRight: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="4.5 2.5 7.5 6 4.5 9.5" />
  </svg>
)

const FolderIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1z" />
  </svg>
)

const FolderOpenIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1z" />
    <path d="M2 8h12" />
  </svg>
)

const FileIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2z" />
    <polyline points="9 2 9 6 13 6" />
  </svg>
)

const FileCodeIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2z" />
    <polyline points="9 2 9 6 13 6" />
    <polyline points="6.5 9.5 5 11 6.5 12.5" />
    <polyline points="9.5 9.5 11 11 9.5 12.5" />
  </svg>
)

const CodeIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4.5 4 1.5 8 4.5 12" />
    <polyline points="11.5 4 14.5 8 11.5 12" />
    <line x1="9.5" y1="3" x2="6.5" y2="13" />
  </svg>
)

const FileTextIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2z" />
    <polyline points="9 2 9 6 13 6" />
    <line x1="5.5" y1="9" x2="10.5" y2="9" />
    <line x1="5.5" y1="11.5" x2="8.5" y2="11.5" />
  </svg>
)

const BracesIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3C3 3 2.5 3.5 2.5 4.5V6.5C2.5 7.5 1.5 8 1.5 8s1 .5 1 1.5v2c0 1 .5 1.5 1.5 1.5" />
    <path d="M12 3c1 0 1.5.5 1.5 1.5V6.5c0 1 1 1.5 1 1.5s-1 .5-1 1.5v2c0 1-.5 1.5-1.5 1.5" />
  </svg>
)

const GlobeIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <line x1="2" y1="8" x2="14" y2="8" />
    <path d="M8 2a10.5 10.5 0 0 1 2.8 6A10.5 10.5 0 0 1 8 14a10.5 10.5 0 0 1-2.8-6A10.5 10.5 0 0 1 8 2z" />
  </svg>
)

const PaintbrushIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2l4 4-6 6H4v-4l6-6z" />
    <path d="M4 12c-1 1-2 1.5-2.5 1.5S1 13 1 12.5 1.5 11 2.5 11" />
  </svg>
)

const ImageIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
    <circle cx="5.5" cy="5.5" r="1" />
    <polyline points="14 10 10.5 7 4 14" />
  </svg>
)

// Pre-created icon elements to avoid recreating JSX on every render
const ICON_FOLDER_OPEN: IconDef = { icon: <FolderOpenIcon />, color: '#E2B855' }
const ICON_FOLDER: IconDef = { icon: <FolderIcon />, color: '#E2B855' }
const ICON_SWIFT: IconDef = { icon: <CodeIcon />, color: '#F97316' }
const ICON_JS: IconDef = { icon: <FileCodeIcon />, color: '#EAB308' }
const ICON_PY: IconDef = { icon: <FileCodeIcon />, color: '#3B82F6' }
const ICON_JSON: IconDef = { icon: <BracesIcon />, color: '#A78BFA' }
const ICON_MD: IconDef = { icon: <FileTextIcon />, color: '#9CA3AF' }
const ICON_HTML: IconDef = { icon: <GlobeIcon />, color: '#3B82F6' }
const ICON_CSS: IconDef = { icon: <PaintbrushIcon />, color: '#A855F7' }
const ICON_IMAGE: IconDef = { icon: <ImageIcon />, color: '#14B8A6' }
const ICON_DEFAULT: IconDef = { icon: <FileIcon />, color: '#9CA3AF' }

// -----------------------------------------------------------------------------
// FileTreeNode component
// -----------------------------------------------------------------------------

interface FileTreeNodeProps {
  node: FileTreeNodeType
  depth: number
  gitFiles?: Set<string>
  onFileClick: (path: string) => void
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  depth,
  gitFiles,
  onFileClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(node.isExpanded)
  const [children, setChildren] = useState<FileTreeNodeType[]>(node.children)
  const [isLoading, setIsLoading] = useState(false)

  // Determine if this node should be dimmed (not in git tracked files)
  const isDimmed = gitFiles != null && !node.isDirectory && !gitFiles.has(node.path)

  const iconDef = getFileIcon(node.fileExtension, node.isDirectory, isExpanded)

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClick = useCallback(async () => {
    if (node.isDirectory) {
      const willExpand = !isExpanded
      setIsExpanded(willExpand)

      if (willExpand && children.length === 0 && window.electronAPI) {
        setIsLoading(true)
        try {
          const entries = await window.electronAPI.fsReadDir(node.path)
          setChildren(entries)
        } catch {
          setChildren([])
        } finally {
          setIsLoading(false)
        }
      }
    } else {
      onFileClick(node.path)
    }
  }, [node, isExpanded, children.length, onFileClick])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Node row */}
      <div
        className={`h-7 flex items-center gap-1.5 px-2 text-sm text-white/70 hover:bg-white/[0.05] cursor-pointer rounded-sm ${
          isDimmed ? 'opacity-40' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        draggable={!node.isDirectory}
        onDragStart={(e: React.DragEvent) => {
          if (node.isDirectory) return
          e.dataTransfer.setData('application/canvaside-file', node.path)
          e.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {/* Chevron for directories */}
        {node.isDirectory ? (
          <span
            className="flex-shrink-0 text-white/40 transition-transform duration-150"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            <ChevronRight />
          </span>
        ) : (
          <span className="flex-shrink-0 w-3" />
        )}

        {/* File/folder icon */}
        <span className="flex-shrink-0" style={{ color: iconDef.color }}>
          {iconDef.icon}
        </span>

        {/* Name */}
        <span className="truncate">{node.name}</span>

        {/* Loading indicator for lazy-loaded directories */}
        {isLoading && (
          <span className="text-xs text-white/30 ml-auto">...</span>
        )}
      </div>

      {/* Expanded children */}
      {node.isDirectory && isExpanded && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              gitFiles={gitFiles}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
