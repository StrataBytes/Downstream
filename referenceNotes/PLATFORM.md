# Platform Support

Downstream runs on Windows and macOS. Here's how multi-OS works.

## How it's set up

- Platform-specific code lives in the `Platform` block at the top of `src/main.js`
- It defines a `win32` and `darwin` object, each with the same interface
- The active one is selected based on `process.platform`
- The rest of `main.js` only ever calls `platform.*`, so no platform checks elsewhere

## What the platform block provides

- `handleSquirrelStartup()` -- installer lifecycle (Windows only, no-op on Mac)
- `getFFmpegPath()` -- path to ffmpeg binary (`.exe` on Windows, extensionless on Mac)
- `getFFmpegDir()` -- directory containing both ffmpeg and ffprobe (passed to yt-dlp's `--ffmpeg-location`)
- `getYtDlpPath()` -- path to yt-dlp binary (same idea as ffmpeg). On Mac this is the executable inside the unpacked `yt-dlp_macos` folder (see below)
- `getIconPath()` -- app icon (`.ico` on Windows, `.icns` on Mac)
- `attachTouchBar(win)` -- macOS Touch Bar (see `src/touchBar.js`), no-op on Windows. The renderer pushes a state snapshot over `touchbar-state` (`src/renderer/hooks/useTouchBar.js`) and the bar's buttons come back as `touchbar-action`
  - The player also gets a button in the Control Strip that opens its controls over any app. Electron can't do this, so a small native helper does (`src/native/controlStrip.m`, compiled with clang by `scripts/buildControlStrip.js` from the forge `generateAssets` and `packageAfterCopy` hooks into `build/control-strip/`, and shipped in Resources). `src/controlStrip.js` starts it once music loads and talks to it over stdin/stdout. It relies on private macOS API (DFRFoundation), so a missing API, a failed build or a crashing helper only removes this button
- `detectRenderTier()` -- returns `{ profile: 'standard'|'lite', reason }`, used once on first launch to pick a sensible default rendering profile. Mac checks `process.arch` (with a Rosetta check via `sysctl.proc_translated` so an Apple Silicon Mac running an x64 build isn't mistaken for genuine Intel hardware); Windows runs a strict RAM/CPU-name/core-count cascade since architecture alone doesn't signal hardware tier there. See `MODERN_CPU_PATTERN` in `main.js` for the recognized CPU brand list.

## Build config

- `forge.config.js` uses `process.platform` at build time to pick the right binaries and icon
- Windows builds use Squirrel (installer), macOS uses DMG
- Both get ZIP as a fallback
- `ffmpeg-static` and `yt-dlp-exec` download the correct binary per OS automatically on `npm install`

## yt-dlp on Mac

- Mac uses yt-dlp's official unpacked build (`yt-dlp_macos.zip`), not the single-file `yt-dlp_macos`.
- The single-file build unpacks itself into a new temp folder on every run, and macOS XProtect rescans those files each time, which made every yt-dlp call take around 20 seconds (much longer on older Macs).
- The unpacked build is scanned once and then starts in about half a second.
- `npm run setup` installs it to `node_modules/yt-dlp-exec/bin/yt-dlp_macos/`, and packaging ships that folder in the app's Resources.
- The unpacked build can't update itself, so `src/ytDlpMacos.js` does it: each version is downloaded from GitHub, checked against the release's `SHA2-256SUMS`, unpacked into its own folder under `userData/binaries/yt-dlp_macos/`, run once so macOS scans it, then made current.
- Updates install in the background, and old versions are removed at the next launch.

## Icons

- Windows: `assets/icons/win/icon.ico`
- macOS: `assets/icons/mac/icon.icns` (compiled from `icon.iconset/` using `iconutil` on a Mac)
- PNGs for other uses: `assets/icons/png/`

## Plans for adding linux

1. Add `linux` object in the Platform block of `src/main.js` with the same functions as above
2. Extend the selector line to route `'linux'` to it
3. Add any Linux-specific maker config to `forge.config.js`
4. Add a Linux icon if needed to `assets/icons/linux/`
5. That's it -- everything else is cross-platform already
