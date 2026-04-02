// =============================================================================
// useDockDrag — global drag state for dock-aware panel dragging.
// Tracks what's being dragged, cursor position, and the active drop target.
// Uses a Zustand store so multiple components can read drag state reactively.
// =============================================================================

import { create } from 'zustand'
import type { DockZonePosition, DockDropTarget, Point, PanelType } from '../../shared/types'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DragSource =
  | { type: 'canvas'; nodeId: string }
  | { type: 'dock'; zone: DockZonePosition; stackId: string }

export interface DockDragState {
  /** Whether a dock-aware drag is currently active */
  isDragging: boolean
  /** The panel being dragged */
  draggedPanelId: string | null
  /** The panel type (for visual feedback) */
  draggedPanelType: PanelType | null
  /** The panel title (for visual feedback) */
  draggedPanelTitle: string | null
  /** Where the drag originated */
  dragSource: DragSource | null
  /** Current cursor position in window coordinates */
  cursorPosition: Point | null
  /** The currently resolved drop target (null if cursor isn't over a valid target) */
  activeDropTarget: DockDropTarget | null
}

interface DockDragActions {
  /** Start a dock-aware drag */
  startDrag: (
    panelId: string,
    panelType: PanelType,
    panelTitle: string,
    source: DragSource,
  ) => void
  /** Update cursor position during drag */
  updateCursor: (position: Point) => void
  /** Set the currently hovered drop target */
  setDropTarget: (target: DockDropTarget | null) => void
  /** End the drag (drop or cancel) */
  endDrag: () => void
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

export const useDockDragStore = create<DockDragState & DockDragActions>((set) => ({
  isDragging: false,
  draggedPanelId: null,
  draggedPanelType: null,
  draggedPanelTitle: null,
  dragSource: null,
  cursorPosition: null,
  activeDropTarget: null,

  startDrag(panelId, panelType, panelTitle, source) {
    set({
      isDragging: true,
      draggedPanelId: panelId,
      draggedPanelType: panelType,
      draggedPanelTitle: panelTitle,
      dragSource: source,
      cursorPosition: null,
      activeDropTarget: null,
    })
  },

  updateCursor(position) {
    set({ cursorPosition: position })
  },

  setDropTarget(target) {
    set({ activeDropTarget: target })
  },

  endDrag() {
    set({
      isDragging: false,
      draggedPanelId: null,
      draggedPanelType: null,
      draggedPanelTitle: null,
      dragSource: null,
      cursorPosition: null,
      activeDropTarget: null,
    })
  },
}))

// -----------------------------------------------------------------------------
// Drop zone registry — components register their bounding rects
// -----------------------------------------------------------------------------

export interface DropZoneEntry {
  id: string
  zone: DockZonePosition
  stackId?: string
  getRect: () => DOMRect | null
}

const dropZoneRegistry: DropZoneEntry[] = []

export function registerDropZone(entry: DropZoneEntry): () => void {
  dropZoneRegistry.push(entry)
  return () => {
    const idx = dropZoneRegistry.indexOf(entry)
    if (idx >= 0) dropZoneRegistry.splice(idx, 1)
  }
}

export function getDropZoneEntries(): readonly DropZoneEntry[] {
  return dropZoneRegistry
}

// -----------------------------------------------------------------------------
// Hit testing — resolve cursor position to a drop target
// -----------------------------------------------------------------------------

/** Resolve which of the 5 drop zones (top/bottom/left/right/center) the cursor
 *  is in relative to a container rect. Returns the edge or 'center'. */
export function resolveDropEdge(
  cursorX: number,
  cursorY: number,
  rect: DOMRect,
): 'top' | 'bottom' | 'left' | 'right' | 'center' {
  const relX = cursorX - rect.left
  const relY = cursorY - rect.top
  const w = rect.width
  const h = rect.height

  // Edge zones: 25% strip along each edge
  const edgeFraction = 0.25
  const leftEdge = w * edgeFraction
  const rightEdge = w * (1 - edgeFraction)
  const topEdge = h * edgeFraction
  const bottomEdge = h * (1 - edgeFraction)

  // Check edges in priority order
  if (relY < topEdge && relY < relX && relY < (w - relX)) return 'top'
  if (relY > bottomEdge && (h - relY) < relX && (h - relY) < (w - relX)) return 'bottom'
  if (relX < leftEdge) return 'left'
  if (relX > rightEdge) return 'right'
  return 'center'
}

/** Full hit test: given cursor in window coordinates, find the best drop target.
 *  Collects all matching entries and picks the most specific one:
 *  stack (with stackId) > zone (without stackId).
 *  Among same-priority entries, the smallest area wins. */
export function hitTestDropTarget(
  cursorX: number,
  cursorY: number,
): DockDropTarget | null {
  // Collect all entries whose rect contains the cursor
  const hits: { entry: DropZoneEntry; rect: DOMRect; area: number }[] = []

  for (const entry of dropZoneRegistry) {
    const rect = entry.getRect()
    if (!rect) continue
    if (
      cursorX >= rect.left &&
      cursorX <= rect.right &&
      cursorY >= rect.top &&
      cursorY <= rect.bottom
    ) {
      hits.push({ entry, rect, area: rect.width * rect.height })
    }
  }

  if (hits.length === 0) return null

  // Sort by specificity: stackId entries first, then zone-level
  // Within same specificity, prefer smallest area (tightest fit)
  hits.sort((a, b) => {
    const specA = a.entry.stackId ? 0 : 1
    const specB = b.entry.stackId ? 0 : 1
    if (specA !== specB) return specA - specB
    return a.area - b.area
  })

  const best = hits[0]

  if (best.entry.stackId) {
    const edge = resolveDropEdge(cursorX, cursorY, best.rect)
    if (edge === 'center') {
      return { type: 'tab', stackId: best.entry.stackId }
    }
    return { type: 'split', stackId: best.entry.stackId, edge }
  }
  // Zone-level drop (no specific stack)
  return { type: 'zone', zone: best.entry.zone }
}

// -----------------------------------------------------------------------------
// Cross-window drag support — hook to listen for drags from other windows
// -----------------------------------------------------------------------------

import type { PanelTransferSnapshot } from '../../shared/types'

/** Active cross-window drag state */
let crossWindowSnapshot: PanelTransferSnapshot | null = null

export function getCrossWindowSnapshot(): PanelTransferSnapshot | null {
  return crossWindowSnapshot
}

/**
 * Set up listeners for cross-window drag events from the main process.
 * Call this once per window. Returns a cleanup function.
 */
export function setupCrossWindowDragListeners(
  onDrop?: (snapshot: PanelTransferSnapshot, target: DockDropTarget) => void,
): () => void {
  const cleanups: (() => void)[] = []

  // Listen for cursor updates from other windows
  cleanups.push(
    window.electronAPI.onCrossWindowDragUpdate((screenPos: Point, snapshot: PanelTransferSnapshot) => {
      crossWindowSnapshot = snapshot

      // Convert screen coords to local window coords
      // (screenPos is in screen space, we need window-local)
      const localX = screenPos.x - window.screenX
      const localY = screenPos.y - window.screenY

      // Check if cursor is inside this window
      if (localX >= 0 && localY >= 0 && localX < window.innerWidth && localY < window.innerHeight) {
        // Start drag display if not already dragging
        const dragState = useDockDragStore.getState()
        if (!dragState.isDragging) {
          useDockDragStore.getState().startDrag(
            snapshot.panel.id,
            snapshot.panel.type,
            snapshot.panel.title,
            { type: 'dock', zone: 'center', stackId: '' },
          )
        }
        // Update cursor and hit test
        useDockDragStore.getState().updateCursor({ x: localX, y: localY })
        const target = hitTestDropTarget(localX, localY)
        useDockDragStore.getState().setDropTarget(target)
      } else {
        // Cursor left this window — end local drag display
        const dragState = useDockDragStore.getState()
        if (dragState.isDragging && dragState.draggedPanelId === snapshot.panel.id) {
          useDockDragStore.getState().endDrag()
        }
      }
    }),
  )

  // Listen for drag end
  cleanups.push(
    window.electronAPI.onDragEnd(() => {
      // If we had an active cross-window drag with a resolved target, execute the drop
      const dragState = useDockDragStore.getState()
      if (dragState.isDragging && crossWindowSnapshot && dragState.activeDropTarget) {
        onDrop?.(crossWindowSnapshot, dragState.activeDropTarget)
        window.electronAPI.crossWindowDragDrop(crossWindowSnapshot.panel.id)
      }
      useDockDragStore.getState().endDrag()
      crossWindowSnapshot = null
    }),
  )

  return () => {
    cleanups.forEach((fn) => fn())
    crossWindowSnapshot = null
  }
}
