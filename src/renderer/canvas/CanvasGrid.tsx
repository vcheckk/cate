// =============================================================================
// CanvasGrid — SVG grid overlay rendered behind canvas nodes.
// Ported from CanvasView.swift drawGrid() method.
//
// Performance: offset subscription is imperative (canvasApi.subscribe) so this
// component never re-renders during pan. It only re-renders when zoom,
// containerSize, or gridStyle/gridSpacing change.
// =============================================================================

import React, { useRef, useEffect, useMemo } from 'react'
import { useCanvasStoreContext, useCanvasStoreApi } from '../stores/CanvasStoreContext'
import { useSettingsStore } from '../stores/settingsStore'

interface CanvasGridProps {
  containerWidth: number
  containerHeight: number
}

/** Compute the SVG position/size for the visible canvas rect. */
function computeGridBounds(
  offsetX: number,
  offsetY: number,
  zoom: number,
  containerWidth: number,
  containerHeight: number,
  gridSpacing: number,
): { startX: number; startY: number; gridWidth: number; gridHeight: number } {
  const left = -offsetX / zoom
  const top = -offsetY / zoom
  const right = (-offsetX + containerWidth) / zoom
  const bottom = (-offsetY + containerHeight) / zoom

  const startX = Math.floor(left / gridSpacing) * gridSpacing
  const startY = Math.floor(top / gridSpacing) * gridSpacing
  const endX = Math.ceil(right / gridSpacing) * gridSpacing
  const endY = Math.ceil(bottom / gridSpacing) * gridSpacing

  return {
    startX,
    startY,
    gridWidth: endX - startX,
    gridHeight: endY - startY,
  }
}

const CanvasGrid: React.FC<CanvasGridProps> = ({
  containerWidth,
  containerHeight,
}) => {
  const gridStyle = useSettingsStore((s) => s.gridStyle)
  const gridSpacing = useSettingsStore((s) => s.gridSpacing)
  const zoom = useCanvasStoreContext((s) => s.zoomLevel)
  // NOTE: viewportOffset is intentionally NOT subscribed here via React.
  // Instead we read it once to seed the imperative subscription below.
  const canvasApi = useCanvasStoreApi()

  const svgRef = useRef<SVGSVGElement>(null)

  // Seed values so we can apply the initial position synchronously.
  const initialOffset = canvasApi.getState().viewportOffset

  // Stable ref to current props so the subscription callback always reads fresh values.
  const propsRef = useRef({ containerWidth, containerHeight, gridSpacing, zoom })
  propsRef.current = { containerWidth, containerHeight, gridSpacing, zoom }

  // Imperatively update SVG position/size on offset changes — no React re-render.
  useEffect(() => {
    const applyBounds = (offsetX: number, offsetY: number) => {
      const svg = svgRef.current
      if (!svg) return
      const { containerWidth: cw, containerHeight: ch, gridSpacing: gs, zoom: z } = propsRef.current
      const { startX, startY, gridWidth, gridHeight } = computeGridBounds(offsetX, offsetY, z, cw, ch, gs)
      svg.style.left = `${startX}px`
      svg.style.top = `${startY}px`
      svg.style.width = `${gridWidth}px`
      svg.style.height = `${gridHeight}px`
    }

    // Apply immediately with current offset
    const { viewportOffset } = canvasApi.getState()
    applyBounds(viewportOffset.x, viewportOffset.y)

    // Subscribe to store — only update DOM, no setState
    const unsubscribe = canvasApi.subscribe((state, prev) => {
      if (state.viewportOffset !== prev.viewportOffset) {
        applyBounds(state.viewportOffset.x, state.viewportOffset.y)
      }
    })
    return unsubscribe
    // Re-run when zoom or container size changes (those DO require a re-render anyway)
  }, [canvasApi, zoom, containerWidth, containerHeight, gridSpacing])

  if (gridStyle === 'blank') {
    return null
  }

  // Compute initial SVG bounds from the seed offset (zoom/container changes trigger re-render)
  const { startX, startY, gridWidth, gridHeight } = computeGridBounds(
    initialOffset.x,
    initialOffset.y,
    zoom,
    containerWidth,
    containerHeight,
    gridSpacing,
  )

  if (gridStyle === 'dots') {
    return (
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          left: startX,
          top: startY,
          width: gridWidth,
          height: gridHeight,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <defs>
          <pattern
            id="grid-dots"
            x={0}
            y={0}
            width={gridSpacing}
            height={gridSpacing}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={0}
              cy={0}
              r={1}
              fill="var(--grid-dot)"
            />
          </pattern>
        </defs>
        {/* 100%/100% so the rect always fills the SVG even when we resize it imperatively */}
        <rect
          x={0}
          y={0}
          width="100%"
          height="100%"
          fill="url(#grid-dots)"
        />
      </svg>
    )
  }

  // gridStyle === 'lines'
  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        left: startX,
        top: startY,
        width: gridWidth,
        height: gridHeight,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <defs>
        <pattern
          id="grid-lines"
          x={0}
          y={0}
          width={gridSpacing}
          height={gridSpacing}
          patternUnits="userSpaceOnUse"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={gridSpacing}
            stroke="var(--grid-line)"
            strokeWidth={0.5}
          />
          <line
            x1={0}
            y1={0}
            x2={gridSpacing}
            y2={0}
            stroke="var(--grid-line)"
            strokeWidth={0.5}
          />
        </pattern>
      </defs>
      {/* 100%/100% so the rect always fills the SVG even when we resize it imperatively */}
      <rect
        x={0}
        y={0}
        width="100%"
        height="100%"
        fill="url(#grid-lines)"
      />
    </svg>
  )
}

export default React.memo(CanvasGrid)
