import { describe, expect, test } from 'vitest'
import { hydrateSessionTrust } from './sessionTrust'
import type { MultiWorkspaceSession } from '../shared/types'

describe('hydrateSessionTrust', () => {
  test('sanitizes invalid workspace roots and returns accepted roots', async () => {
    const session: MultiWorkspaceSession = {
      version: 2,
      selectedWorkspaceIndex: 0,
      workspaces: [
        {
          workspaceName: 'Good',
          rootPath: '/good',
          viewportOffset: { x: 0, y: 0 },
          zoomLevel: 1,
          nodes: [],
        },
        {
          workspaceName: 'Bad',
          rootPath: '/bad',
          viewportOffset: { x: 0, y: 0 },
          zoomLevel: 1,
          nodes: [],
        },
      ],
    }

    const hydrated = await hydrateSessionTrust(session, async (rootPath) => (
      rootPath === '/good' ? '/private/good' : null
    ))

    expect(hydrated.acceptedRoots).toEqual(['/private/good'])
    expect(hydrated.sanitizedSession.workspaces[0].rootPath).toBe('/private/good')
    expect(hydrated.sanitizedSession.workspaces[1].rootPath).toBeNull()
  })
})
