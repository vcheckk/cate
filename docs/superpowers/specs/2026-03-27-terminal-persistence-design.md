# Terminal Persistence Design Spec

## Problem

Two issues with terminal stability in CanvasIDE:

1. **Workspace switching:** All terminals go blank (lose all content) when switching between projects and switching back. `MainWindowView` uses `if let workspace = appState.selectedWorkspace` which causes SwiftUI to tear down the entire view subtree on workspace switch, destroying `TerminalView` instances and their Ghostty surfaces.

2. **App restart:** Terminals are recreated as empty shells. No scrollback history, working directory, or position context is restored beyond basic canvas layout.

## Goals

- Terminals retain full content across workspace switches (no blanking)
- On app restart, terminals restore at their saved canvas positions with full scrollback history and correct working directory
- Storage is bounded and efficient even with many terminals across many workspaces
- Graceful handling of app crashes (logs survive on disk)

## Non-Goals

- Restoring live running processes (e.g. a running `npm start` — only scrollback + cwd)
- Restoring shell state like environment variables, aliases, or shell functions
- Syncing terminal state across devices

---

## Design

### Part 1: Fix terminals blanking on workspace switch

**Root cause:** `MainWindowView` conditionally renders workspaces with `if let workspace = appState.selectedWorkspace`, causing SwiftUI to fully tear down the previous workspace's view subtree. Additionally, `TerminalView.viewDidMoveToWindow()` calls `detachSurface()` when `window` becomes nil, destroying the Ghostty surface even if the view could be reused.

**Fix: AppKit-managed view dictionary** (primary approach, not fallback — SwiftUI identity tricks won't help with conditional rendering):
- Maintain a `[UUID: CanvasView]` dictionary in an AppKit container view controller
- On workspace switch, hide the current `CanvasView` and show the target one (or create it if first visit)
- This bypasses SwiftUI's lifecycle entirely for the canvas layer
- Remove the `detachSurface()` call from `viewDidMoveToWindow()` when `window` is nil — surfaces should only be destroyed on explicit terminal close, not on window detachment. Ghostty handles a missing window gracefully (skips frames).

**Validation:** Switch workspaces back and forth — terminals must retain their full output.

### Part 2: PTY output logging

#### TerminalOutputLogger (new file)

A class that captures all terminal output to per-terminal log files on disk.

**Storage location:** `~/Library/Application Support/CanvasIDE/TerminalLogs/{workspaceId}/{terminalId}.log`

**Capture mechanism:**
- Use the `io_write_cb` callback on `ghostty_surface_config_s`. This is a Ghostty-provided callback invoked whenever PTY output arrives — the clean, supported way to tee terminal output.
- Set `io_write_cb` and `io_write_userdata` when creating the surface in `GhosttyAppManager.createSurface()`
- The callback forwards bytes to `TerminalOutputLogger.append(bytes:length:)` and also parses for OSC escape sequences

**Buffered I/O:**
- Buffer writes, flush every ~1 second or every 4KB, whichever comes first
- Prevents disk thrash with many active terminals

**Log rotation (two-file scheme):**
- Two files per terminal: `{terminalId}.log` (current) and `{terminalId}.prev.log` (previous)
- When current exceeds 1MB, delete previous and rotate current → previous
- On restore, read previous + current (up to 2MB total)
- This avoids landing in the middle of multi-byte UTF-8 characters or escape sequences (which byte-level truncation would cause)

**Lifecycle:**
- Logger created when terminal surface attaches
- Logger destroyed when terminal is explicitly closed by the user (log files deleted)
- Logger flushes on workspace save and app termination

#### Working directory tracking

**Primary method:** Parse OSC 7 escape sequences from the PTY output stream. Modern shells (bash, zsh, fish) emit these to report the current working directory. The `io_write_cb` already sees all output bytes, so this adds minimal overhead.

**Fallback method:** Periodically poll the shell process's cwd via `proc_pidinfo` (Darwin API). `ProcessMonitor` already detects shell PIDs.

**Storage:** Latest cwd stored on `TerminalPanel` and included in `SessionSnapshot`.

#### Terminal title tracking

Parse OSC 0/2 escape sequences from the same output stream to capture the terminal title. This ensures restored terminals show their correct title (e.g. "vim", "ssh user@host") instead of generic "Terminal".

### Part 3: Enhanced session snapshot

Extend `NodeSnapshot` for terminal panels:

```
NodeSnapshot {
  // existing fields
  panelId: String
  panelType: String
  origin: { x, y }
  size: { width, height }
  title: String

  // new terminal-specific fields
  workingDirectory: String?     // shell's current working directory
  terminalLogFile: String?      // relative path to scrollback log
}
```

**Note:** The app supports multiple workspaces. Session persistence should save all workspace states, not just the active one. If this is a pre-existing limitation, it should be addressed as part of this work to avoid losing terminal logs for inactive workspaces.

### Part 4: Restore flow on app restart

1. Load `SessionSnapshot` — positions, sizes, working directories, log file paths
2. For each terminal node:
   a. Create `TerminalView` at saved position/size
   b. Set `working_directory` on `ghostty_surface_config_s` so the new shell starts in the correct location (the surface config already supports this field)
   c. Once surface attaches, replay the log file contents into the terminal via `ghostty_surface_process_output(surface, bytes, len)` — this is the Ghostty C API function for injecting PTY output (display data) into the terminal parser
   d. **Chunked replay:** Split replay into ~64KB blocks dispatched via `DispatchQueue.main.async` to avoid blocking the main thread. Show a "Restoring..." overlay on the terminal node during replay.
   e. Terminal shows full scrollback with a live shell prompt at the bottom
3. Start fresh logging for the new session (new log file, old one can be deleted after successful replay)

### Part 5: Cleanup and lifecycle

| Event | Action |
|-------|--------|
| Terminal closed by user | Delete log files, remove from snapshot |
| Workspace deleted | Delete entire `TerminalLogs/{workspaceId}/` directory |
| App crash | Logs survive on disk; next launch restores from session + logs |
| App launch | Prune orphaned log files not referenced by any saved session |

---

## File Changes

| File | Change |
|------|--------|
| **New: `Terminal/TerminalOutputLogger.swift`** | PTY output capture via `io_write_cb`, buffered file writing, two-file log rotation, OSC 7/0/2 parsing |
| `Persistence/SessionSnapshot.swift` | Add `workingDirectory`, `terminalLogFile` to `NodeSnapshot` |
| `Persistence/SessionStore.swift` | Include terminal log paths in save/restore; save all workspaces |
| `Terminal/TerminalView.swift` | Remove `detachSurface()` on window-nil; add replay support with chunked `ghostty_surface_process_output`; "Restoring..." overlay |
| `Workspace/WorkspaceContentView.swift` | Pass restore data to terminal creation |
| `Workspace/Workspace.swift` | Store working directories per terminal; enhanced `createTerminal` for restore mode |
| `Terminal/GhosttyAppManager.swift` | Wire `io_write_cb` + `io_write_userdata` on surface config; expose `ghostty_surface_process_output` wrapper |
| `MainWindowView.swift` | Replace conditional SwiftUI rendering with AppKit-managed `[UUID: CanvasView]` dictionary for workspace switching |
| `Panels/TerminalPanel.swift` | Add `workingDirectory`, `loggerRef`, `title` tracking fields |

## Technical Risks

1. **Large scrollback replay:** Writing up to 2MB of terminal escape sequences via chunked `ghostty_surface_process_output` calls. Mitigated by 64KB chunks + async dispatch + "Restoring..." overlay.
2. **OSC 7 availability:** Not all shell configurations emit OSC 7. The `proc_pidinfo` fallback covers this but is less responsive.
3. **AppKit/SwiftUI boundary:** Moving workspace switching to AppKit-managed hosting adds complexity at the SwiftUI/AppKit boundary. The existing `CanvasViewRepresentable` pattern provides a model for this.
4. **Crash recovery window:** ~1 second of terminal output may be lost on crash due to write buffering. Acceptable tradeoff for performance.
