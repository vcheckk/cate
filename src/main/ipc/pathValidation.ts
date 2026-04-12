// =============================================================================
// Path validation — prevent path traversal and restrict filesystem access
// to registered workspace roots and the system temp directory.
// =============================================================================

import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const allowedRoots = new Set<string>()

export function addAllowedRoot(root: string): void {
  allowedRoots.add(path.resolve(root))
}

export function removeAllowedRoot(root: string): void {
  allowedRoots.delete(path.resolve(root))
}

export function getAllowedRoots(): ReadonlySet<string> {
  return allowedRoots
}

/**
 * Validates that a file path is within an allowed root directory.
 * Returns the normalized absolute path if valid, throws if not.
 */
export function validatePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Access denied: invalid path')
  }

  const normalized = path.resolve(filePath)

  // Always allow temp directory access
  const tmpDir = path.resolve(os.tmpdir())
  if (normalized === tmpDir || normalized.startsWith(tmpDir + path.sep)) {
    return normalized
  }

  for (const root of allowedRoots) {
    if (normalized.startsWith(root + path.sep) || normalized === root) {
      return normalized
    }
  }

  throw new Error(`Access denied: path "${filePath}" is outside allowed directories`)
}

/**
 * Validates that a file path is within an allowed root directory AND that its
 * fully-resolved (symlink-free) real path is also within an allowed root.
 * This prevents TOCTOU attacks where a symlink inside a workspace root points
 * to a sensitive path outside it (e.g. /etc/passwd).
 *
 * Returns the real absolute path if valid, throws if not.
 */
export async function validatePathStrict(filePath: string): Promise<string> {
  // First do the cheap lexical check so we fail fast on obviously bad input.
  validatePath(filePath)

  let real: string
  try {
    real = await fs.realpath(filePath)
  } catch (err) {
    throw new Error(`Access denied: cannot resolve real path for "${filePath}": ${err}`)
  }

  // Always allow temp directory access
  const tmpDir = path.resolve(os.tmpdir())
  if (real === tmpDir || real.startsWith(tmpDir + path.sep)) {
    return real
  }

  for (const root of allowedRoots) {
    if (real.startsWith(root + path.sep) || real === root) {
      return real
    }
  }

  throw new Error(`Access denied: resolved path "${real}" is outside allowed directories`)
}

/**
 * Validates a path for file/directory creation.  The target itself need not
 * exist yet, but its parent directory must exist and resolve (symlink-free)
 * to a location within an allowed root.  The basename is checked for
 * obviously dangerous values (.., null bytes, etc.).
 *
 * Returns the safe absolute path (`realParent + baseName`).
 */
export async function validatePathForCreation(filePath: string): Promise<string> {
  // Cheap lexical check on the full intended path.
  validatePath(filePath)

  const parentDir = path.dirname(path.resolve(filePath))
  const baseName = path.basename(filePath)

  if (!baseName || baseName === '.' || baseName === '..' || baseName.includes('\0')) {
    throw new Error(`Access denied: invalid entry name "${baseName}"`)
  }

  let realParent: string
  try {
    realParent = await fs.realpath(parentDir)
  } catch (err) {
    throw new Error(`Access denied: cannot resolve real path for parent "${parentDir}": ${err}`)
  }

  const tmpDir = path.resolve(os.tmpdir())
  if (realParent === tmpDir || realParent.startsWith(tmpDir + path.sep)) {
    return path.join(realParent, baseName)
  }

  for (const root of allowedRoots) {
    if (realParent.startsWith(root + path.sep) || realParent === root) {
      return path.join(realParent, baseName)
    }
  }

  throw new Error(`Access denied: resolved parent "${realParent}" is outside allowed directories`)
}

/**
 * Validates a directory path for git/shell operations.
 * Same as validatePath but specifically for cwd parameters.
 */
export function validateCwd(cwd: string): string {
  return validatePath(cwd)
}
