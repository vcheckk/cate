import React from 'react'
import { useCanvasStore } from '../stores/canvasStore'

const SnapGuides: React.FC = () => {
  const guides = useCanvasStore((s) => s.snapGuides)
  if (guides.x === null && guides.y === null) return null

  const color = 'rgba(74, 158, 255, 0.6)'
  const extent = 100000

  return (
    <>
      {guides.x !== null && (
        <div style={{
          position: 'absolute',
          left: guides.x,
          top: -extent / 2,
          width: 1,
          height: extent,
          backgroundColor: color,
          pointerEvents: 'none',
        }} />
      )}
      {guides.y !== null && (
        <div style={{
          position: 'absolute',
          left: -extent / 2,
          top: guides.y,
          width: extent,
          height: 1,
          backgroundColor: color,
          pointerEvents: 'none',
        }} />
      )}
    </>
  )
}

export default React.memo(SnapGuides)
