// =============================================================================
// Canvas Store Context — provides a canvas store instance via React context.
// Allows multiple canvas stores to coexist (e.g., dock zones, panel windows).
// =============================================================================

import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand'
import type { CanvasStore } from './canvasStore'
import { useCanvasStore as defaultCanvasStore } from './canvasStore'

export const CanvasStoreContext = createContext<StoreApi<CanvasStore>>(defaultCanvasStore)

export function CanvasStoreProvider({ store, children }: {
  store: StoreApi<CanvasStore>
  children: React.ReactNode
}) {
  return (
    <CanvasStoreContext.Provider value={store}>
      {children}
    </CanvasStoreContext.Provider>
  )
}

/** Returns the StoreApi for use in event handlers / callbacks (.getState()) */
export function useCanvasStoreApi(): StoreApi<CanvasStore> {
  return useContext(CanvasStoreContext)
}

/** Reactive selector hook — reads from the context-provided canvas store */
export function useCanvasStoreContext<T>(selector: (s: CanvasStore) => T): T {
  const store = useContext(CanvasStoreContext)
  return useStore(store, selector)
}
