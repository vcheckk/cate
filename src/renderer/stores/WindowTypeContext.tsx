// =============================================================================
// Window Type Context — provides the current window type ('main' | 'dock')
// to child components so they can gate behavior (e.g., drag-out-of-window).
// =============================================================================

import { createContext, useContext } from 'react'
import type { CateWindowType } from '../../shared/types'

export const WindowTypeContext = createContext<CateWindowType>('main')

export function useWindowType(): CateWindowType {
  return useContext(WindowTypeContext)
}
