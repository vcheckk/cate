import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  addAllowedRoot,
  clearScopedWriteAllowancesForWindow,
  consumeScopedWriteAllowance,
  getAllowedRoots,
  registerScopedWriteAllowance,
  removeAllowedRoot,
  validatePathForCreation,
} from './pathValidation'

describe('pathValidation', () => {
  let rootDir: string
  let outsideDir: string

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(process.cwd(), 'cate-root-'))
    outsideDir = await fs.mkdtemp(path.join(process.cwd(), 'cate-outside-'))
    addAllowedRoot(rootDir)
  })

  afterEach(async () => {
    for (const root of Array.from(getAllowedRoots())) removeAllowedRoot(root)
    clearScopedWriteAllowancesForWindow(1)
    clearScopedWriteAllowancesForWindow(2)
    await fs.rm(rootDir, { recursive: true, force: true })
    await fs.rm(outsideDir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  test('allows creation inside trusted roots', async () => {
    const safePath = await validatePathForCreation(path.join(rootDir, 'file.txt'))
    expect(safePath).toContain(path.join(rootDir, 'file.txt'))
  })

  test('allows exactly one scoped write outside trusted roots', async () => {
    const targetPath = path.join(outsideDir, 'export.json')
    const registeredPath = await registerScopedWriteAllowance(1, targetPath)

    await expect(validatePathForCreation(targetPath, 1)).resolves.toBe(registeredPath)

    consumeScopedWriteAllowance(1, registeredPath)

    await expect(validatePathForCreation(targetPath, 1)).rejects.toThrow(/outside allowed directories/)
  })

  test('expires scoped write allowances and clears them on window close', async () => {
    vi.useFakeTimers()
    const targetPath = path.join(outsideDir, 'late.json')
    await registerScopedWriteAllowance(2, targetPath, 10)

    await expect(validatePathForCreation(targetPath, 2)).resolves.toContain('late.json')

    vi.advanceTimersByTime(11)
    await expect(validatePathForCreation(targetPath, 2)).rejects.toThrow(/outside allowed directories/)

    await registerScopedWriteAllowance(2, targetPath, 1_000)
    clearScopedWriteAllowancesForWindow(2)
    await expect(validatePathForCreation(targetPath, 2)).rejects.toThrow(/outside allowed directories/)
  })
})
