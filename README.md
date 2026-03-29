<p align="center">
  <img src="assets/cate-logo.svg" alt="Cate" width="200" />
</p>

<h1 align="center">Cate</h1>

<p align="center">
  An infinite zoomable canvas IDE — like Figma, but for coding.
</p>

<p align="center">
  <a href="https://github.com/0-AI-UG/cate/releases"><img src="https://img.shields.io/github/v/release/0-AI-UG/cate?style=flat-square" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/0-AI-UG/cate?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/0-AI-UG/cate/actions"><img src="https://img.shields.io/github/actions/workflow/status/0-AI-UG/cate/ci.yml?style=flat-square" alt="CI" /></a>
</p>

---

Cate is a desktop application that gives you an infinite zoomable canvas where editor panels, terminal panels, and browser panels float spatially. Think Figma or Miro, but purpose-built for software development.

## Features

- **Infinite Canvas** — Pan, zoom, and arrange your workspace freely in 2D space
- **Code Editor** — Monaco Editor (the engine behind VS Code) with full syntax highlighting
- **Integrated Terminal** — xterm.js terminals backed by native PTY, right on the canvas
- **Browser Panels** — Embed live web previews alongside your code
- **File Explorer** — Git-aware file tree with status indicators
- **Source Control** — Built-in git integration with diff views and worktree support
- **AI Chat** — Claude integration for in-context coding assistance
- **Command Palette** — Quick access to all commands via keyboard
- **Keyboard-First** — Configurable shortcuts for everything
- **Dark Theme** — Easy on the eyes, built with Tailwind CSS

## Download

Grab the latest release for your platform:

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Cate-arm64.dmg](https://github.com/0-AI-UG/cate/releases/latest) |
| macOS (Intel) | [Cate-x64.dmg](https://github.com/0-AI-UG/cate/releases/latest) |
| Windows | [Cate-Setup.exe](https://github.com/0-AI-UG/cate/releases/latest) |
| Linux | [Cate.AppImage](https://github.com/0-AI-UG/cate/releases/latest) |

> **macOS note:** The app is not code-signed yet. After downloading, macOS may say the app is "damaged." To fix this, open Terminal and run:
> ```bash
> xattr -cr /Applications/Cate.app
> ```

## Build from Source

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- npm >= 9
- Python 3 and a C++ compiler (for `node-pty` native module)
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential` package
  - Windows: [windows-build-tools](https://github.com/nicedoc/windows-build-tools)

### Setup

```bash
git clone https://github.com/0-AI-UG/cate.git
cd cate
npm install
```

### Development

```bash
npm run dev
```

This starts the Electron app with hot reload via electron-vite.

### Production Build

```bash
npm run build
```

### Package for Distribution

```bash
# Install electron-builder globally or use npx
npx electron-builder --mac --win --linux
```

Packaged binaries will be in the `release/` directory.

## Architecture

```
src/
├── main/           # Electron main process — window management, IPC, native APIs
├── preload/        # Secure bridge exposing IPC to renderer
├── renderer/       # React app
│   ├── canvas/     # Infinite canvas rendering & interaction
│   ├── panels/     # EditorPanel, TerminalPanel, BrowserPanel
│   ├── stores/     # Zustand state management
│   ├── sidebar/    # File explorer, source control, AI config
│   └── hooks/      # Custom React hooks
└── shared/         # IPC channel definitions, shared types
```

- **Electron** for the desktop shell
- **React 18** for the UI
- **Zustand** for state management
- **Monaco Editor** for code editing
- **xterm.js + node-pty** for terminals
- **Tailwind CSS** for styling
- **electron-vite** for bundling

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
