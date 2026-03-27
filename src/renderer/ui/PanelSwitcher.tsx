import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore } from '../stores/uiStore'
import { useCanvasStore } from '../stores/canvasStore'
import { useAppStore } from '../stores/appStore'
import type { PanelType } from '../../shared/types'

function panelColor(type: PanelType): string {
  switch (type) {
    case 'terminal': return '#34C759'
    case 'browser': return '#007AFF'
    case 'editor': return '#FF9500'
    case 'aiChat': return '#AF52DE'
    case 'git': return '#FF3B30'
  }
}

export function PanelSwitcher() {
  const show = useUIStore((s) => s.showPanelSwitcher)
  const nodes = useCanvasStore((s) => s.nodes)
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const workspace = useAppStore((s) => s.workspaces.find(w => w.id === s.selectedWorkspaceId))

  const nodeList = Object.values(nodes).sort((a, b) => a.creationIndex - b.creationIndex)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRef = useRef<HTMLDivElement>(null)

  // Reset selection when opened — start at next panel after focused
  useEffect(() => {
    if (show) {
      const focusedIdx = nodeList.findIndex(n => n.id === focusedNodeId)
      const nextIdx = focusedIdx >= 0 ? (focusedIdx + 1) % nodeList.length : 0
      setSelectedIndex(nextIdx)
    }
  }, [show])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedIndex])

  const close = useCallback(() => {
    useUIStore.getState().setShowPanelSwitcher(false)
  }, [])

  const selectItem = useCallback((index: number) => {
    const node = nodeList[index]
    if (!node) return
    useCanvasStore.getState().focusAndCenter(node.id)
    close()
  }, [nodeList, close])

  const advanceSelection = useCallback(() => {
    setSelectedIndex((prev) => (prev + 1) % nodeList.length)
  }, [nodeList.length])

  // Listen for cycle event from useShortcuts (Cmd+E while open)
  useEffect(() => {
    if (!show) return
    const handler = () => advanceSelection()
    window.addEventListener('panel-switcher-next', handler)
    return () => window.removeEventListener('panel-switcher-next', handler)
  }, [show, advanceSelection])

  // Keyboard navigation
  useEffect(() => {
    if (!show) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        advanceSelection()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + nodeList.length) % nodeList.length)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        selectItem(selectedIndex)
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [show, selectedIndex, nodeList, close, selectItem, advanceSelection])

  if (!show || nodeList.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={close}
    >
      <div
        className="flex gap-4 px-2 py-3 max-w-[90vw] overflow-x-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {nodeList.map((node, i) => {
          const panel = workspace?.panels[node.panelId]
          const type = panel?.type || 'terminal'
          const title = panel?.title || 'Panel'
          const isSelected = i === selectedIndex
          const color = panelColor(type)

          // Compute thumbnail dimensions preserving real aspect ratio
          const maxThumbW = 180
          const maxThumbH = 120
          const aspect = node.size.width / Math.max(node.size.height, 1)
          let thumbW: number, thumbH: number
          if (aspect > maxThumbW / maxThumbH) {
            thumbW = maxThumbW
            thumbH = maxThumbW / aspect
          } else {
            thumbH = maxThumbH
            thumbW = maxThumbH * aspect
          }

          return (
            <div
              key={node.id}
              ref={isSelected ? selectedRef : undefined}
              className="flex flex-col items-center cursor-pointer transition-all duration-150"
              style={{
                opacity: isSelected ? 1 : 0.5,
                transform: isSelected ? 'scale(1.08)' : 'scale(1)',
              }}
              onClick={() => selectItem(i)}
            >
              {/* Panel preview — real proportions, no wrapper card */}
              <div
                style={{
                  width: thumbW,
                  height: thumbH,
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#1E1E24',
                  border: isSelected ? `2px solid ${color}` : '2px solid rgba(255,255,255,0.08)',
                  boxShadow: isSelected
                    ? `0 0 20px ${color}33, 0 4px 16px rgba(0,0,0,0.4)`
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  position: 'relative',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {/* Title bar */}
                <div style={{
                  height: 14,
                  backgroundColor: '#28282E',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 4,
                  gap: 2,
                }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: color, opacity: 0.8 }} />
                  <span style={{ fontSize: 5, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {title}
                  </span>
                </div>
                {/* Content area — simulated based on panel type */}
                <div style={{ padding: '3px 4px' }}>
                  {type === 'terminal' && (
                    <>
                      <div style={{ height: 3, width: '60%', backgroundColor: 'rgba(52,199,89,0.25)', borderRadius: 1, marginBottom: 3 }} />
                      <div style={{ height: 3, width: '45%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 1, marginBottom: 3 }} />
                      <div style={{ height: 3, width: '70%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, marginBottom: 3 }} />
                      <div style={{ height: 3, width: '30%', backgroundColor: 'rgba(52,199,89,0.2)', borderRadius: 1 }} />
                    </>
                  )}
                  {type === 'editor' && (
                    <>
                      <div style={{ height: 3, width: '80%', backgroundColor: 'rgba(255,149,0,0.15)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '55%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '90%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '40%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '65%', backgroundColor: 'rgba(255,149,0,0.12)', borderRadius: 1 }} />
                    </>
                  )}
                  {type === 'browser' && (
                    <>
                      <div style={{ height: 5, width: '100%', backgroundColor: 'rgba(0,122,255,0.08)', borderRadius: 2, marginBottom: 3 }} />
                      <div style={{ height: 3, width: '85%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '60%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1 }} />
                    </>
                  )}
                  {(type === 'aiChat' || type === 'git') && (
                    <>
                      <div style={{ height: 3, width: '70%', backgroundColor: `${color}20`, borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '50%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, marginBottom: 2 }} />
                      <div style={{ height: 3, width: '80%', backgroundColor: `${color}15`, borderRadius: 1 }} />
                    </>
                  )}
                </div>
              </div>
              {/* Label below */}
              <span
                className="truncate text-center mt-2"
                style={{
                  fontSize: 11,
                  color: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                  maxWidth: thumbW,
                  fontWeight: isSelected ? 500 : 400,
                }}
              >
                {title}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
