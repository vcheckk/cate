// =============================================================================
// CanvasAnnotationComponent — renders sticky notes and text labels on the canvas.
// =============================================================================

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import type { CanvasAnnotation } from '../../shared/types'
import { useCanvasStoreApi } from '../stores/CanvasStoreContext'
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'

// Preset colors for sticky notes
const STICKY_COLORS = [
  { label: 'Yellow', value: 'rgba(255, 214, 0, 0.9)' },
  { label: 'Green', value: 'rgba(52, 199, 89, 0.7)' },
  { label: 'Blue', value: 'rgba(74, 158, 255, 0.7)' },
  { label: 'Orange', value: 'rgba(255, 149, 0, 0.7)' },
  { label: 'Red', value: 'rgba(255, 69, 58, 0.7)' },
  { label: 'Purple', value: 'rgba(175, 82, 222, 0.7)' },
  { label: 'Pink', value: 'rgba(255, 55, 95, 0.7)' },
  { label: 'Teal', value: 'rgba(0, 199, 190, 0.7)' },
]

// Preset colors for text labels
const LABEL_COLORS = [
  { label: 'Default', value: 'transparent' },
  { label: 'White', value: 'rgba(255, 255, 255, 0.6)' },
  { label: 'Yellow', value: 'rgba(255, 214, 0, 0.7)' },
  { label: 'Green', value: 'rgba(52, 199, 89, 0.6)' },
  { label: 'Blue', value: 'rgba(74, 158, 255, 0.6)' },
  { label: 'Orange', value: 'rgba(255, 149, 0, 0.6)' },
  { label: 'Red', value: 'rgba(255, 69, 58, 0.6)' },
  { label: 'Purple', value: 'rgba(175, 82, 222, 0.6)' },
]

interface Props {
  annotation: CanvasAnnotation
}

const ColorSwatch: React.FC<{ color: string; selected: boolean }> = ({ color, selected }) => (
  <span
    style={{
      display: 'inline-block',
      width: 14,
      height: 14,
      borderRadius: 3,
      backgroundColor: color === 'transparent' ? 'rgba(255,255,255,0.15)' : color,
      border: selected ? '2px solid rgba(74, 158, 255, 0.8)' : '1px solid rgba(255,255,255,0.2)',
      verticalAlign: 'middle',
    }}
  />
)

const CanvasAnnotationComponent: React.FC<Props> = ({ annotation }) => {
  const canvasApi = useCanvasStoreApi()
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(annotation.content)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const dragAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => { dragAbortRef.current?.abort() }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) { e.stopPropagation(); return }
    if (e.button !== 0 || isEditing) return
    e.stopPropagation()
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: annotation.origin.x, originY: annotation.origin.y,
    }
    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const zoom = canvasApi.getState().zoomLevel
      const dx = (ev.clientX - dragRef.current.startX) / zoom
      const dy = (ev.clientY - dragRef.current.startY) / zoom
      canvasApi.getState().moveAnnotation(annotation.id, {
        x: dragRef.current.originX + dx,
        y: dragRef.current.originY + dy,
      })
    }
    const handleUp = () => {
      dragAbortRef.current?.abort()
      dragAbortRef.current = null
      dragRef.current = null
    }
    dragAbortRef.current?.abort()
    const controller = new AbortController()
    dragAbortRef.current = controller
    const { signal } = controller
    window.addEventListener('mousemove', handleMove, { signal })
    window.addEventListener('mouseup', handleUp, { signal })
  }, [annotation.id, annotation.origin, isEditing])

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
    setEditContent(annotation.content)
  }, [annotation.content])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    canvasApi.getState().updateAnnotation(annotation.id, editContent)
  }, [annotation.id, editContent])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
  }, [])

  const isStickyNote = annotation.type === 'stickyNote'

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const colors = isStickyNote ? STICKY_COLORS : LABEL_COLORS
    const colorSubmenu: ContextMenuItem[] = colors.map((c) => ({
      label: c.label,
      icon: <ColorSwatch color={c.value} selected={annotation.color === c.value} />,
      onClick: () => canvasApi.getState().updateAnnotationColor(annotation.id, c.value),
    }))

    return [
      {
        label: 'Edit',
        onClick: () => { setIsEditing(true); setEditContent(annotation.content) },
      },
      {
        label: 'Change Color',
        onClick: () => {},
        submenu: colorSubmenu,
      },
      { label: '', separator: true, onClick: () => {} },
      {
        label: isStickyNote ? 'Delete Note' : 'Delete Label',
        danger: true,
        onClick: () => canvasApi.getState().removeAnnotation(annotation.id),
      },
    ]
  }, [annotation.id, annotation.content, annotation.color, isStickyNote])

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: annotation.origin.x,
          top: annotation.origin.y,
          width: annotation.size.width,
          height: isStickyNote ? annotation.size.height : 'auto',
          backgroundColor: annotation.color,
          borderRadius: isStickyNote ? 4 : 0,
          padding: isStickyNote ? 12 : 4,
          cursor: isEditing ? 'text' : 'grab',
          zIndex: -500, // Between regions (-1000) and panels (0+)
          boxShadow: isStickyNote ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
          userSelect: isEditing ? 'text' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {isEditing ? (
          <textarea
            autoFocus
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === 'Escape') handleBlur() }}
            style={{
              width: '100%',
              height: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: isStickyNote ? '#1a1a1a' : 'rgba(255,255,255,0.6)',
              fontSize: isStickyNote ? 13 : 14,
              fontWeight: isStickyNote ? 400 : 600,
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div style={{
            color: isStickyNote ? '#1a1a1a' : 'rgba(255,255,255,0.6)',
            fontSize: isStickyNote ? 13 : 14,
            fontWeight: isStickyNote ? 400 : 600,
            whiteSpace: isStickyNote ? 'pre-wrap' : 'nowrap',
            overflow: 'hidden',
          }}>
            {annotation.content}
          </div>
        )}
      </div>

      {contextMenuPos && (
        <ContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          items={contextMenuItems}
          onClose={() => setContextMenuPos(null)}
        />
      )}
    </>
  )
}

export default React.memo(CanvasAnnotationComponent)
