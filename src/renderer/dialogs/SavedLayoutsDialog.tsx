// =============================================================================
// SavedLayoutsDialog — Manager for named canvas layouts.
// Save the current canvas arrangement, load one, or delete it.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react'
import { X, FloppyDisk, Trash, FolderOpen } from '@phosphor-icons/react'
import { useUIStore } from '../stores/uiStore'
import { useAppStore } from '../stores/appStore'
import { useCanvasStoreApi } from '../stores/CanvasStoreContext'
import log from '../lib/logger'

export function SavedLayoutsDialog() {
  const show = useUIStore((s) => s.showLayoutsDialog)
  const setShow = useUIStore((s) => s.setShowLayoutsDialog)
  const canvasApi = useCanvasStoreApi()

  const [names, setNames] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await window.electronAPI.layoutList()
      setNames(list.sort((a, b) => a.localeCompare(b)))
    } catch (err) {
      log.warn('[SavedLayoutsDialog] list failed', err)
    }
  }, [])

  useEffect(() => {
    if (show) {
      refresh()
      setSaveName('')
      setSelected(null)
      setError(null)
    }
  }, [show, refresh])

  const close = useCallback(() => setShow(false), [setShow])

  const buildSnapshot = useCallback(() => {
    const state = canvasApi.getState()
    const appState = useAppStore.getState()
    const workspace = appState.workspaces.find((w) => w.id === appState.selectedWorkspaceId)
    return {
      nodes: Object.values(state.nodes).map((n) => {
        const panel = workspace?.panels[n.panelId]
        return {
          panelType: panel?.type ?? 'terminal',
          origin: n.origin,
          size: n.size,
          filePath: panel?.filePath,
          url: panel?.url,
        }
      }),
      regions: Object.values(state.regions).map((r) => ({
        origin: r.origin, size: r.size, label: r.label, color: r.color,
      })),
      zoomLevel: state.zoomLevel,
      viewportOffset: state.viewportOffset,
    }
  }, [canvasApi])

  const handleSave = useCallback(async () => {
    const name = saveName.trim()
    if (!name) { setError('Name is required'); return }
    setBusy(true); setError(null)
    try {
      await window.electronAPI.layoutSave(name, buildSnapshot())
      setSaveName('')
      await refresh()
      setSelected(name)
    } catch (err) {
      log.error('[SavedLayoutsDialog] save failed', err)
      setError('Save failed')
    } finally {
      setBusy(false)
    }
  }, [saveName, buildSnapshot, refresh])

  const handleLoad = useCallback(async (name: string) => {
    setBusy(true); setError(null)
    try {
      const snap = await window.electronAPI.layoutLoad(name) as
        | { nodes?: Array<{ panelType: string; origin: { x: number; y: number }; size: { width: number; height: number }; filePath?: string; url?: string }>; regions?: Array<{ label: string; origin: { x: number; y: number }; size: { width: number; height: number }; color?: string }> }
        | null
      if (!snap) { setError('Layout not found'); return }
      const wsId = useAppStore.getState().selectedWorkspaceId
      useAppStore.getState().closeAllPanels(wsId)
      for (const node of snap.nodes ?? []) {
        switch (node.panelType) {
          case 'terminal': useAppStore.getState().createTerminal(wsId, undefined, node.origin); break
          case 'editor':   useAppStore.getState().createEditor(wsId, node.filePath, node.origin); break
          case 'browser':  useAppStore.getState().createBrowser(wsId, node.url, node.origin); break
        }
      }
      for (const region of snap.regions ?? []) {
        canvasApi.getState().addRegion(region.label, region.origin, region.size, region.color)
      }
      canvasApi.getState().zoomToFit()
      close()
    } catch (err) {
      log.error('[SavedLayoutsDialog] load failed', err)
      setError('Load failed')
    } finally {
      setBusy(false)
    }
  }, [canvasApi, close])

  const handleDelete = useCallback(async (name: string) => {
    if (!window.confirm(`Delete layout "${name}"?`)) return
    setBusy(true); setError(null)
    try {
      await window.electronAPI.layoutDelete(name)
      if (selected === name) setSelected(null)
      await refresh()
    } catch (err) {
      log.error('[SavedLayoutsDialog] delete failed', err)
      setError('Delete failed')
    } finally {
      setBusy(false)
    }
  }, [selected, refresh])

  if (!show) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={close}
    >
      <div
        className="w-[520px] max-h-[600px] rounded-xl overflow-hidden flex flex-col bg-surface-4 border border-subtle shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <div className="text-primary text-sm font-medium">Saved Layouts</div>
          <button
            onClick={close}
            className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-hover"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-3 border-b border-subtle flex gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            className="flex-1 bg-surface-3 text-primary text-sm px-3 py-2 rounded-lg border border-subtle outline-none focus:border-blue-500/50"
            placeholder="Save current canvas as…"
            disabled={busy}
          />
          <button
            onClick={handleSave}
            disabled={busy || !saveName.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600/80 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FloppyDisk size={14} />
            Save
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-400 bg-red-600/10 border-b border-subtle">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {names.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              No saved layouts yet.
            </div>
          ) : (
            names.map((name) => (
              <div
                key={name}
                className={`group flex items-center justify-between gap-2 px-4 py-2 text-sm cursor-pointer ${
                  selected === name ? 'bg-blue-600/20' : 'hover:bg-hover'
                }`}
                onClick={() => setSelected(name)}
                onDoubleClick={() => handleLoad(name)}
              >
                <span className="text-primary truncate">{name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleLoad(name) }}
                    disabled={busy}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface-6 hover:bg-hover text-primary"
                    title="Load"
                  >
                    <FolderOpen size={12} />
                    Load
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(name) }}
                    disabled={busy}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded text-red-400 hover:bg-red-600/20"
                    title="Delete"
                  >
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
