// =============================================================================
// CanvasDropZone — a drop zone that appears on canvas panels during dock drags.
// Dropping a panel here merges it back into the canvas as a new node.
// =============================================================================

import React, { useState, useEffect, useContext } from 'react'
import type { StoreApi } from 'zustand'
import type { CanvasStore } from '../stores/canvasStore'
import { useDockDragStore } from '../hooks/useDockDrag'
import { DockStoreContext } from '../stores/DockStoreContext'

interface CanvasDropZoneProps {
  canvasStoreApi: StoreApi<CanvasStore>
}

export default function CanvasDropZone({ canvasStoreApi }: CanvasDropZoneProps) {
  const isDragging = useDockDragStore((s) => s.isDragging)
  const dragSource = useDockDragStore((s) => s.dragSource)

  // Only show for dock-sourced drags (not canvas-to-canvas)
  if (!isDragging || !dragSource || dragSource.type !== 'dock') return null

  return <CanvasDropZoneInner canvasStoreApi={canvasStoreApi} />
}

function CanvasDropZoneInner({ canvasStoreApi }: CanvasDropZoneProps) {
  const [hovering, setHovering] = useState(false)
  const dockStoreApi = useContext(DockStoreContext)

  // While hovering, suppress dock drop targets that the mousemove handler
  // keeps resolving underneath us
  useEffect(() => {
    if (!hovering) return
    const interval = setInterval(() => {
      const state = useDockDragStore.getState()
      if (state.activeDropTarget) {
        state.setDropTarget(null)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [hovering])

  return (
    <div
      onPointerEnter={() => {
        setHovering(true)
        useDockDragStore.getState().setDropTarget(null)
      }}
      onPointerLeave={() => setHovering(false)}
      onPointerUp={() => {
        const dragState = useDockDragStore.getState()
        const { draggedPanelId, draggedPanelType, dragSource } = dragState
        if (!draggedPanelId || !draggedPanelType) return

        // Remove from dock source
        if (dragSource?.type === 'dock') {
          dockStoreApi.getState().undockPanel(draggedPanelId)
        }

        // Add to canvas
        canvasStoreApi.getState().addNode(draggedPanelId, draggedPanelType)

        // End the drag immediately so the initiator's mouseup is a no-op
        useDockDragStore.getState().endDrag()
        document.body.classList.remove('canvas-interacting')
      }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        pointerEvents: 'auto',
        animation: 'canvasDropZoneIn 250ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`
        @keyframes canvasDropZoneIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes canvasDropPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 158, 255, 0.3); }
          50%      { box-shadow: 0 0 0 8px rgba(74, 158, 255, 0); }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 20,
          background: hovering ? 'rgba(74, 158, 255, 0.15)' : 'rgba(30, 30, 30, 0.9)',
          border: hovering
            ? '1px solid rgba(74, 158, 255, 0.6)'
            : '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(12px)',
          padding: '10px 24px',
          minWidth: 200,
          textAlign: 'center',
          transition: 'background 200ms ease, border-color 200ms ease, transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          transform: hovering ? 'scale(1.05)' : 'scale(1)',
          animation: hovering ? 'canvasDropPulse 1.2s ease-in-out infinite' : 'none',
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: hovering ? 'rgba(74, 158, 255, 1)' : 'rgba(255, 255, 255, 0.5)',
            transition: 'color 200ms ease',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          Drop into canvas
        </span>
      </div>
    </div>
  )
}
