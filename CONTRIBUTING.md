# Contributing to Cate

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`

### Prerequisites

- Node.js >= 18
- npm >= 9
- Python 3 + C++ compiler (for `node-pty` native module)

## Making Changes

1. Create a branch from `main`:
   ```bash
   git checkout -b my-feature
   ```
2. Make your changes
3. Test that the app builds and runs:
   ```bash
   npm run build
   ```
4. Commit with a clear message following [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add panel snapping to grid
   fix: terminal resize not updating PTY dimensions
   ```

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Describe what changed and why in the PR description
- Include screenshots for UI changes
- Make sure `npm run build` passes

## Project Structure

See the [Architecture section](README.md#architecture) in the README and [`CLAUDE.md`](CLAUDE.md) for detailed guidance on the codebase.

## Code Style

- TypeScript with strict mode
- Functional React with hooks
- Zustand for state (no Redux/Context)
- Tailwind CSS for styling
- No unnecessary abstractions — keep it simple

## Reporting Bugs

Open an [issue](https://github.com/0-AI-UG/cate/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- OS and version
- Screenshots if applicable

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
