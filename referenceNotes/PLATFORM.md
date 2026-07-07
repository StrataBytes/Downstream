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
- `getYtDlpPath()` -- path to yt-dlp binary (same idea as ffmpeg)
- `getIconPath()` -- app icon (`.ico` on Windows, `.icns` on Mac)
- `detectRenderTier()` -- returns `{ profile: 'standard'|'lite', reason }`, used once on first launch to pick a sensible default rendering profile. Mac checks `process.arch` (with a Rosetta check via `sysctl.proc_translated` so an Apple Silicon Mac running an x64 build isn't mistaken for genuine Intel hardware); Windows runs a strict RAM/CPU-name/core-count cascade since architecture alone doesn't signal hardware tier there. See `MODERN_CPU_PATTERN` in `main.js` for the recognized CPU brand list.

## Build config

- `forge.config.js` uses `process.platform` at build time to pick the right binaries and icon
- Windows builds use Squirrel (installer), macOS uses DMG
- Both get ZIP as a fallback
- `ffmpeg-static` and `yt-dlp-exec` download the correct binary per OS automatically on `npm install`

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
