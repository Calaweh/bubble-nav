# bubble-nav

> "The current File Explorer navigation is not intuitive, convenient for me. So I made this
> coooooooooooooool, funny(?) radial canvas overlay with a hold-to-navigate gesture wheel —
> tether, snap, and flow through directories like a spatial command center!!! (and I lazy
> to find alternative solution, maybe better existing, but just for fun haha)"

## Screenshots

<!-- Add screenshots here -->

Radial canvas overlay for Windows file explorer — navigate directories and launch tools via
hold-to-drag gestures on a spatial bubble wheel. Uses Tauri for the native overlay window
and IPC, with a pure TypeScript canvas renderer.

## Features

- **Spatial navigation** — drag outward from center to reveal satellites; slide over a folder
  to enter it, over a file to see tools, over ↩ to go up. The "just-exited" folder stays
  pinned in yellow at its screen position so you can instantly go back.
- **Hold-to-drag** — press and hold the center bubble, drag across targets, release on
  empty space to see folder tools. Discrete click shortcuts also work.
- **Bi-arc / full-circle layout** — browsing uses a parent-oriented bi-arc; tool menus
  use perfect full-circle spacing.
- **Autostart** — registers on Windows startup; Alt+Space toggles the overlay.
- **Editor launcher** — open files/folders in VS Code, Antigravity IDE, or Visual Studio
  (configured via `.env`).
- **WSL-aware** — opens WSL instances and resolves `\\wsl.localhost\` paths.

## Setup

1. Copy `.env.example` → `.env` and fill in your editor paths and start directory.
2. `npm install`
3. `cargo tauri dev` (requires Rust + GTK dev libs on Linux build host, or native
   Windows toolchain)

### Required `.env` values

| Variable | Description |
|---|---|
| `WSL_DISTRO` | WSL distro name (e.g. `Ubuntu`) |
| `VSCODE_BIN` | Path to VS Code binary (WSL path for WSL, Windows path for Windows) |
| `ANTIGRAVITY_PATH` | Absolute Windows path to Antigravity IDE (`D:\...`) |
| `VISUALSTUDIO_PATH` | Absolute Windows path to devenv.exe |
| `OPENCODE_BIN` | WSL path to opencode binary |
| `VITE_START_PATH` | Initial directory shown on launch |

## Commands

| Key / Gesture | Action |
|---|---|
| Hold center + drag | Navigate / preview tools |
| Release on empty space | Show folder tools |
| Click satellite | Direct navigation / action |
| Alt+Space | Toggle overlay |

## Architecture

```
src/          — TypeScript canvas app (main, layout, renderer, utils, types, config)
src-tauri/    — Rust backend (global shortcut, WSL resolution, editor launcher, IPC)
```

Built with [Tauri](https://tauri.app/) v2.
