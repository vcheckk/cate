// =============================================================================
// DockResizeHandle — drag handle between dock zones or between split children.
// =============================================================================

import React, { useCallback, useRef } from 'react'

interface DockResizeHandleProps {
  direction: 'horizontal' | 'vertical' // horizontal = left/right drag, vertical = up/down drag
  onResize: (delta: number) => void
  onDoubleClick?: () => void
}

export default function DockResizeHandle({ direction, onResize, onDoubleClick }: DockResizeHandleProps) {
  const dragging = useRef(false)
  const lastPos = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const current = direction === 'horizontal' ? ev.clientX : ev.clientY
        const delta = current - lastPos.current
        if (delta !== 0) {
          onResize(delta)
          lastPos.current = current
        }
      }

      const onMouseUp = () => {
        dragging.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, onResize],
  )

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      className={`
        flex-shrink-0 relative group
        ${isHorizontal ? 'w-[5px] cursor-col-resize' : 'h-[5px] cursor-row-resize'}
      `}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Visible indicator on hover */}
      <div
        className={`
          absolute bg-blue-500/0 group-hover:bg-blue-500/40 transition-colors duration-150
          ${isHorizontal ? 'inset-y-0 left-[1px] right-[1px]' : 'inset-x-0 top-[1px] bottom-[1px]'}
        `}
      />
    </div>
  )
}
