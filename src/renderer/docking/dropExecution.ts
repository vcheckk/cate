// =============================================================================
// Drop execution — handles all source→target combinations for dock drag-and-drop.
// Pure functions, no hooks — used by both useNodeDrag and DockTabStack.
// =============================================================================

import type { StoreApi } from 'zustand'
import type { CanvasStore } from '../stores/canvasStore'
import type { DockStore } from '../stores/dockStore'
import type { DockDropTarget } from '../../shared/types'
import type { DragSource } from '../hooks/useDockDrag'
import { useDockStore } from '../stores/dockStore'
import { findTabStackAcrossZones, findZoneForStack } from '../stores/dockTreeUtils'

export function executeDrop(
  panelId: string,
  source: DragSource,
  target: DockDropTarget,
  canvasStoreApi?: StoreApi<CanvasStore>,
  dockStoreApi?: StoreApi<DockStore>,
) {
  const dockState = (dockStoreApi ?? useDockStore).getState()

  // --- Self-drop guard: don't remove+re-add to the same stack ---
  if (source.type === 'dock' && target.type === 'tab' && target.stackId === source.stackId) {
    return // no-op: dropped onto the same tab stack
  }
  if (source.type === 'dock' && target.type === 'split' && target.stackId === source.stackId) {
    const stack = findTabStackAcrossZones(dockState.zones, source.stackId)
    if (stack && stack.panelIds.length <= 1) return // no-op
  }

  // --- Validate target BEFORE removing from source ---
  if (target.type === 'zone') {
    removeFromSource(source, panelId, canvasStoreApi, dockStoreApi)
    dockState.dockPanel(panelId, target.zone)
  } else if (target.type === 'tab') {
    const zone = findZoneForStack(dockState.zones, target.stackId)
    if (!zone) return // abort — don't remove from source
    removeFromSource(source, panelId, canvasStoreApi, dockStoreApi)
    dockState.dockPanel(panelId, zone, target)
  } else if (target.type === 'split') {
    const zone = findZoneForStack(dockState.zones, target.stackId)
    if (!zone) return // abort — don't remove from source
    removeFromSource(source, panelId, canvasStoreApi, dockStoreApi)
    dockState.dockPanel(panelId, zone, target)
  }
}

/** Remove panel from its current source location */
function removeFromSource(
  source: DragSource,
  panelId: string,
  canvasStoreApi?: StoreApi<CanvasStore>,
  dockStoreApi?: StoreApi<DockStore>,
) {
  if (source.type === 'dock') {
    (dockStoreApi ?? useDockStore).getState().undockPanel(panelId)
  }
  if (source.type === 'canvas' && canvasStoreApi) {
    canvasStoreApi.getState().finalizeRemoveNode(source.nodeId)
  }
}
