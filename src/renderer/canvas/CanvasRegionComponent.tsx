import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import type { CanvasRegion } from '../../shared/types'
import { useCanvasStoreContext, useCanvasStoreApi } from '../stores/CanvasStoreContext'
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'

// Preset region colors
const REGION_COLORS = [
  'rgba(74, 158, 255, 0.08)',   // blue (default)
  'rgba(52, 199, 89, 0.08)',    // green
  'rgba(255, 149, 0, 0.08)',    // orange
  'rgba(255, 69, 58, 0.08)',    // red
  'rgba(175, 82, 222, 0.08)',   // purple
  'rgba(255, 214, 10, 0.08)',   // yellow
  'rgba(0, 199, 190, 0.08)',    // teal
  'rgba(255, 55, 95, 0.08)',    // pink
]

const REGION_MIN_SIZE = 100

interface Props {
  region: CanvasRegion
  zoomLevel: number
}

type ResizeHandle = 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  topLeft: 'nwse-resize',
  topRight: 'nesw-resize',
  bottomLeft: 'nesw-resize',
  bottomRight: 'nwse-resize',
}

const CanvasRegionComponent: React.FC<Props> = ({ region, zoomLevel }) => {
  const canvasApi = useCanvasStoreApi()
  const isSelected = useCanvasStoreContext((s) => s.selectedRegionIds.has(region.id))
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; lastClientX: number; lastClientY: number } | null>(null)
  const listenersAbortRef = useRef<AbortController | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(region.label)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Clean up any active drag/resize listeners on unmount
  useEffect(() => {
    return () => { listenersAbortRef.current?.abort() }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      e.stopPropagation()
      return
    }
    if (e.button !== 0) return
    e.stopPropagation()

    // Shift-click: toggle selection
    if (e.shiftKey) {
      canvasApi.getState().toggleRegionSelection(region.id)
      return
    }

    // Select this region if not already selected
    if (!canvasApi.getState().selectedRegionIds.has(region.id)) {
      canvasApi.getState().selectRegions([region.id])
    }

    // Start drag
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: region.origin.x,
      originY: region.origin.y,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
    }

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const zoom = canvasApi.getState().zoomLevel

      const state = canvasApi.getState()

      // Determine if this is truly a multi-drag (more than just this region + its children)
      const hasOtherRegions = state.selectedRegionIds.size > 1
      const hasExternalNodes = (() => {
        for (const nodeId of state.selectedNodeIds) {
          const n = state.nodes[nodeId]
          if (n && n.regionId !== region.id) return true
        }
        return false
      })()
      const isMultiDrag = hasOtherRegions || hasExternalNodes

      if (isMultiDrag) {
        // Multi-drag: use incremental deltas to avoid compounding
        const incrDx = (ev.clientX - dragRef.current.lastClientX) / zoom
        const incrDy = (ev.clientY - dragRef.current.lastClientY) / zoom
        dragRef.current.lastClientX = ev.clientX
        dragRef.current.lastClientY = ev.clientY

        // Move all selected nodes
        for (const nodeId of state.selectedNodeIds) {
          const n = state.nodes[nodeId]
          if (n) state.moveNode(nodeId, { x: n.origin.x + incrDx, y: n.origin.y + incrDy })
        }
        // Move all selected regions (without cascading to children — they're already moved above)
        for (const rid of state.selectedRegionIds) {
          const r = canvasApi.getState().regions[rid]
          if (r) canvasApi.getState().resizeRegion(rid, r.size, { x: r.origin.x + incrDx, y: r.origin.y + incrDy })
        }
      } else {
        // Single-region drag: use moveRegion which cascades to contained nodes
        const totalDx = (ev.clientX - dragRef.current.startX) / zoom
        const totalDy = (ev.clientY - dragRef.current.startY) / zoom
        canvasApi.getState().moveRegion(region.id, {
          x: dragRef.current.originX + totalDx,
          y: dragRef.current.originY + totalDy,
        })
      }
    }

    const handleMouseUp = () => {
      listenersAbortRef.current?.abort()
      listenersAbortRef.current = null
      dragRef.current = null
    }

    listenersAbortRef.current?.abort()
    const controller = new AbortController()
    listenersAbortRef.current = controller
    const { signal } = controller
    window.addEventListener('mousemove', handleMouseMove, { signal })
    window.addEventListener('mouseup', handleMouseUp, { signal })
  }, [region.id, region.origin.x, region.origin.y])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(region.label)
    setIsEditing(true)
  }, [region.label])

  const handleRenameSubmit = useCallback(() => {
    if (editValue.trim()) {
      canvasApi.getState().renameRegion(region.id, editValue.trim())
    }
    setIsEditing(false)
  }, [region.id, editValue])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const colorSubmenu: ContextMenuItem[] = REGION_COLORS.map((color) => ({
      label: color === REGION_COLORS[0] ? 'Blue' : color === REGION_COLORS[1] ? 'Green' : color === REGION_COLORS[2] ? 'Orange' : color === REGION_COLORS[3] ? 'Red' : color === REGION_COLORS[4] ? 'Purple' : color === REGION_COLORS[5] ? 'Yellow' : color === REGION_COLORS[6] ? 'Teal' : 'Pink',
      icon: (
        <span style={{
          display: 'inline-block', width: 14, height: 14, borderRadius: 3,
          backgroundColor: color.replace(/[\d.]+\)$/, '0.4)'),
          border: region.color === color ? '2px solid rgba(74, 158, 255, 0.8)' : '1px solid rgba(255,255,255,0.2)',
        }} />
      ),
      onClick: () => canvasApi.getState().updateRegionColor(region.id, color),
    }))

    return [
      {
        label: 'Rename',
        onClick: () => { setEditValue(region.label); setIsEditing(true) },
      },
      {
        label: 'Change Color',
        onClick: () => {},
        submenu: colorSubmenu,
      },
      { label: '', separator: true, onClick: () => {} },
      {
        label: 'Dissolve Region',
        onClick: () => canvasApi.getState().dissolveRegion(region.id),
      },
      {
        label: 'Delete Region',
        onClick: () => canvasApi.getState().removeRegion(region.id),
      },
      {
        label: 'Delete Region + Contents',
        danger: true,
        onClick: () => {
          canvasApi.getState().selectRegions([region.id])
          canvasApi.getState().deleteSelection(true)
        },
      },
    ]
  }, [region.id, region.label, region.color])

  // Resize handle mouse down
  const handleResizeStart = useCallback((e: React.MouseEvent, handle: ResizeHandle) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startOrigin = { ...region.origin }
    const startSize = { ...region.size }

    const handleMouseMove = (ev: MouseEvent) => {
      const zoom = canvasApi.getState().zoomLevel
      const dx = (ev.clientX - startX) / zoom
      const dy = (ev.clientY - startY) / zoom

      let newX = startOrigin.x
      let newY = startOrigin.y
      let newW = startSize.width
      let newH = startSize.height

      const h = handle.toLowerCase()
      if (h.includes('right')) { newW += dx }
      if (h.includes('left')) { newX += dx; newW -= dx }
      if (h.includes('bottom')) { newH += dy }
      if (h.includes('top')) { newY += dy; newH -= dy }

      // Clamp minimum
      if (newW < REGION_MIN_SIZE) {
        const excess = REGION_MIN_SIZE - newW
        newW = REGION_MIN_SIZE
        if (h.includes('left')) newX -= excess
      }
      if (newH < REGION_MIN_SIZE) {
        const excess = REGION_MIN_SIZE - newH
        newH = REGION_MIN_SIZE
        if (h.includes('top')) newY -= excess
      }

      canvasApi.getState().resizeRegion(region.id, { width: newW, height: newH }, { x: newX, y: newY })
    }

    const handleMouseUp = () => {
      listenersAbortRef.current?.abort()
      listenersAbortRef.current = null
    }

    listenersAbortRef.current?.abort()
    const controller = new AbortController()
    listenersAbortRef.current = controller
    const { signal } = controller
    window.addEventListener('mousemove', handleMouseMove, { signal })
    window.addEventListener('mouseup', handleMouseUp, { signal })
  }, [region.id, region.origin, region.size])

  const handleSize = 8

  return (
    <>
      <div
        data-region-id={region.id}
        style={{
          position: 'absolute',
          left: region.origin.x,
          top: region.origin.y,
          width: region.size.width,
          height: region.size.height,
          backgroundColor: region.color,
          borderRadius: 12,
          border: isSelected ? '2px solid rgba(74, 158, 255, 0.8)' : '1.5px dashed rgba(255,255,255,0.15)',
          zIndex: region.zOrder,
          cursor: 'grab',
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Label */}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit()
              if (e.key === 'Escape') setIsEditing(false)
              e.stopPropagation()
            }}
            style={{
              position: 'absolute',
              top: -26,
              left: 6,
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.8)',
              backgroundColor: 'rgba(30, 30, 36, 0.9)',
              border: '1px solid rgba(74, 158, 255, 0.5)',
              borderRadius: 4,
              padding: '1px 6px',
              outline: 'none',
              minWidth: 60,
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: -24,
              left: 8,
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.5)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            {region.label}
          </div>
        )}
      </div>

      {/* Resize handles — shown when selected */}
      {isSelected && (
        <>
          {/* Corner handles */}
          {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as ResizeHandle[]).map((handle) => (
            <div
              key={handle}
              style={{
                position: 'absolute',
                left: region.origin.x + (handle.includes('Left') ? -handleSize / 2 : region.size.width - handleSize / 2),
                top: region.origin.y + (handle.includes('top') || handle === 'topLeft' || handle === 'topRight' ? -handleSize / 2 : region.size.height - handleSize / 2),
                width: handleSize,
                height: handleSize,
                backgroundColor: 'rgba(74, 158, 255, 0.9)',
                borderRadius: 2,
                cursor: HANDLE_CURSORS[handle],
                zIndex: 99998,
              }}
              onMouseDown={(e) => handleResizeStart(e, handle)}
            />
          ))}
          {/* Edge handles */}
          {(['top', 'bottom', 'left', 'right'] as ResizeHandle[]).map((handle) => {
            const isHoriz = handle === 'top' || handle === 'bottom'
            return (
              <div
                key={handle}
                style={{
                  position: 'absolute',
                  left: region.origin.x + (handle === 'left' ? -handleSize / 2 : handle === 'right' ? region.size.width - handleSize / 2 : region.size.width / 2 - handleSize / 2),
                  top: region.origin.y + (handle === 'top' ? -handleSize / 2 : handle === 'bottom' ? region.size.height - handleSize / 2 : region.size.height / 2 - handleSize / 2),
                  width: isHoriz ? handleSize : handleSize,
                  height: isHoriz ? handleSize : handleSize,
                  backgroundColor: 'rgba(74, 158, 255, 0.7)',
                  borderRadius: 2,
                  cursor: HANDLE_CURSORS[handle],
                  zIndex: 99998,
                }}
                onMouseDown={(e) => handleResizeStart(e, handle)}
              />
            )
          })}
        </>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

export default React.memo(CanvasRegionComponent)
