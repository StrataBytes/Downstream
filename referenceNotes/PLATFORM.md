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
- `getPythonPath()` -- Mac only, the Python bundled with Downstream for legacy macOS (see below)
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

## macOS versions

- The regular Mac build runs on macOS 10.15 Catalina and newer, since Electron 31 and the official yt-dlp build both need 10.15.
- Downstream for legacy macOS runs on macOS 10.13 High Sierra and 10.14 Mojave.
- It's the same app from the same code, built by `duild-legacy.sh` with an older Electron.
- The split slides forward: when an Electron upgrade drops a macOS version, that version moves to the legacy build.
- Catalina is next, as Electron 32 is the last to support it (check the release notes when upgrading).

## Downstream for legacy macOS

- It uses Electron 26.6.10, the last to run on 10.13 and 10.14 (Chromium 116, Node 18).
- `duild-legacy.sh` installs it with `--no-save` for the build only, then puts the project's own Electron back.
- It's Intel only, since every Mac that stops at 10.13 or 10.14 is Intel.
- The official yt-dlp Mac build needs 10.15, so it bundles a standalone Python 3.12 (python-build-standalone) and runs yt-dlp's platform-independent build with it.
- `scripts/prepareLegacy.js` fetches both into `build/legacy/`, pinned and checked against their release checksums.
- Each yt-dlp version folder holds `yt-dlp.pyz` and a small launcher named `yt-dlp_macos`, so running, updating, pinning and repairing yt-dlp work just as in the regular build.
- Main sets `DOWNSTREAM_PYTHON` so the launcher finds the bundled Python.
- Video downloads prefer H.264 with AAC, since YouTube's best 1080p is often AV1, which older Macs can't play smoothly.
- It reads its own version list, `legacy-versionctrl.json`, so it's marked current or outdated on its own schedule.
- It's marked as legacy macOS in the home screen's version label, the About panel and the DMG name (`Downstream for Legacy macOS.dmg`).

## Legacy switches in code

- `DOWNSTREAM_LEGACY=1` at build time switches `forge.config.js` to the legacy resources and DMG name.
- It also sets `__DOWNSTREAM_LEGACY__` for the app code, defined in `vite.main.config.mjs` and `vite.renderer.config.mjs`.
- `src/renderer/main.jsx` adds a `legacy-macos` class to the body, for styles Chromium 116 needs done differently.
- So far that's the EQ's upright sliders in `eq.css`, since `writing-mode` on sliders arrived in Chromium 124.
- The Control Strip helper targets 10.13 in both builds, with newer APIs behind `@available` checks.
- Built for 10.15, it doesn't load on 10.13 at all (`objc_opt_respondsToSelector` is missing there).

## Moving the legacy window

1. Change `LEGACY_ELECTRON` in `duild-legacy.sh`
2. Update the macOS range in the version label tooltip (`HomeView.jsx`), the About panel credits (`main.js`) and the `duild-legacy.sh` banner
3. Check the `legacy-macos` style workarounds are still needed, and that newer UI works on the legacy Chromium
4. Test on a real Mac running the oldest supported version, since missing system functions only show up there

## Releasing on Mac

1. Bump the version in `package.json` and `package-lock.json`, the README title and the banners in `build.bat`, `duild.sh` and `duild-legacy.sh` (the home screen reads it from `package.json`)
2. Run `duild.sh` for the regular DMG in `out/make/`, and `duild-legacy.sh` for the legacy one in `out-legacy/make/`
3. If the UI changed, test the legacy build on a Mac running its oldest supported version
4. Add the new version to `versionctrl.json`, and to `legacy-versionctrl.json` when the legacy build ships too
5. If the legacy build breaks and can't be fixed quickly, skip it this release and leave `legacy-versionctrl.json` alone, so those Macs stay on the last good version

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
