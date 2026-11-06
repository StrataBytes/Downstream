# Platform Support

Downstream is one app from one codebase and it runs on Windows, macOS (plus a separate build for older Macs) and Linux. Most of the code doesn't care what it's running on. This page is for the parts that do: where the platform code lives, how each installer gets built and the little quirks of each system that are worth knowing before something is changed.


## Where the Platform Code Lives

The top of `src/main.js` has a Platform block with three objects: `win32`, `darwin` and `linux`. They all have the same functions, and whichever one matches `process.platform` gets picked at startup. After that, the rest of `main.js` just calls `platform.something()` and doesn't have to care which system it's on.

There are a few spots where one system really is different, and those check `process.platform` directly. That's the `media:` scheme, the keychain and keyring switches and stopping a download's processes on Windows. The renderer does the same thing with `window.electronAPI.platform`, for wording like "Show in Finder" and for Mac-only extras like the Touch Bar.

Here's what each function in the Platform block is for:

| Function | What it does |
|----------|--------------|
| `handleSquirrelStartup()` | Handles the Windows installer's events. Does nothing on Mac and Linux. |
| `getFFmpegPath()` | Where ffmpeg is: `ffmpeg.exe` on Windows, plain `ffmpeg` on Mac and Linux. |
| `getFFmpegDir()` | The folder holding both ffmpeg and ffprobe, which yt-dlp gets as `--ffmpeg-location`. |
| `getYtDlpPath()` | The bundled yt-dlp: `yt-dlp.exe` on Windows, the program inside the unpacked `yt-dlp_macos` folder on Mac, and `yt-dlp_linux` on Linux. |
| `getPythonPath()` | Legacy Mac only. The Python that comes bundled with Downstream for legacy macOS. |
| `getIconPath()` | The window icon: `.ico` on Windows, `.icns` on Mac, a PNG on Linux. |
| `attachTouchBar(win)` | The Mac's Touch Bar. Does nothing on Windows and Linux. |
| `detectRenderTier()` | Runs once on first launch, to pick Standard or Lite rendering. |

### Standard or Lite on First Launch

`detectRenderTier()` returns `{ profile: 'standard'|'lite', reason }`, and it only runs the first time Downstream opens.
- **Mac**: Goes by `process.arch`. Apple Silicon gets Standard. An x64 build checks `sysctl.proc_translated` first, so an Apple Silicon Mac running the Intel build under Rosetta isn't mistaken for a real Intel Mac.
- **Windows and Linux**: These can be running on pretty much anything, so architecture alone doesn't say much. They go through a stricter check instead: enough RAM, a CPU name it recognizes, and enough cores. The CPU names it knows are in `MODERN_CPU_PATTERN` in `main.js`.


## Building

Every installer gets built on its own platform, since each one needs that system's own tools.

| Build | Script | What comes out |
|-------|--------|----------------|
| **Windows** | `build.bat` | the installer in `out/make/squirrel.windows/x64/` |
| **macOS** <sub>Catalina and above</sub> | `duild-mac.sh` | `out/make/Downstream.dmg` |
| **Legacy macOS** <sub>High Sierra & Mojave</sub> | `duild-mac-legacy.sh` | `out-legacy/make/Downstream for Legacy macOS.dmg` |
| **Linux** | `duild-linux.sh` | `out/make/deb/x64/downstream_<version>_amd64.deb` |

Windows and macOS also get a ZIP alongside their installer.

Each script runs `npm run setup` first. That's `scripts/postinstall.js`, and it grabs the binaries for whatever system it's running on: ffmpeg through `ffmpeg-static`, ffprobe from `ffprobe-static`, and a pinned yt-dlp (the Windows exe, the unpacked Mac build, or `yt-dlp_linux`). From there, `forge.config.js` checks `process.platform` to pick the right binaries and icon for the build.


## Windows

Windows is where Downstream started, so there's less special handling here than you might expect.
- **yt-dlp**: The installer carries a pinned `yt-dlp.exe`. On launch it gets copied to `userData/binaries/yt-dlp.exe`, and that copy updates itself to the latest nightly with `--update-to`. That way the installed app's own files never change.
- **Antivirus**: Windows Defender or SmartScreen can quarantine or delete yt-dlp or ffmpeg, since they're unsigned. If one goes missing, Downstream puts it back from its installed copy, or downloads the same pinned version again (`src/binaryRecovery.js`).
- **The installer animation**: See Icons, further down.


## macOS

The regular Mac build runs on macOS 10.15 Catalina and newer, since Electron 31 and the official yt-dlp Mac build both need 10.15.

### yt-dlp on Mac

The Mac uses yt-dlp's official *unpacked* build (`yt-dlp_macos.zip`), not the single-file `yt-dlp_macos`. The single-file one unpacks itself into a new temp folder every time it runs, and macOS's XProtect rescans those files every single time. That made every yt-dlp call take around 20 seconds (much longer on older Macs). The unpacked build only gets scanned once and after that it starts in about half a second.

`npm run setup` installs it to `node_modules/yt-dlp-exec/bin/yt-dlp_macos/`, and packaging ships that folder in the app's Resources.

The unpacked build can't update itself, so `src/ytDlpMacos.js` takes care of that. Each new version gets downloaded from GitHub, checked against the release's `SHA2-256SUMS`, unpacked into its own folder under `userData/binaries/yt-dlp_macos/`, and run once so macOS scans it, before it's made the current one. Updates install in the background, and old versions get cleared out at the next launch.

### The Touch Bar and Control Strip

`attachTouchBar(win)` sets up the Touch Bar (`src/touchBar.js`). The renderer sends it the player's state over `touchbar-state` (`src/renderer/hooks/useTouchBar.js`), and the bar's button presses come back as `touchbar-action`.

The player also puts a button in the Control Strip, so its controls are reachable over any app. Electron can't do that on its own, so a small native helper does it.
- **The helper**: `src/native/controlStrip.m`, compiled with clang by `scripts/buildControlStrip.js` into `build/control-strip/`, and shipped in Resources. The forge `generateAssets` and `packageAfterCopy` hooks are what run that build.
- **Talking to it**: `src/controlStrip.js` starts it once music loads, and talks to it over stdin and stdout.
- **If it breaks**: It leans on a private macOS API (DFRFoundation), so a missing API, a failed build or a crashing helper only costs you that one button. Nothing else goes down with it.


## Legacy macOS

Downstream for legacy macOS runs on 10.13 High Sierra and 10.14 Mojave. It's the same app from the same code, just built by `duild-mac-legacy.sh` with an older Electron.

The split slides forward over time. When an Electron upgrade drops a macOS version, that version moves over to the legacy build. Catalina is next in line, since Electron 32 is the last to support it (check the release notes when upgrading).

### What's Different About It

- **Electron**: It uses Electron 26.6.10, the last one to run on 10.13 and 10.14 (Chromium 116, Node 18). `duild-mac-legacy.sh` installs it with `--no-save` just for the build, then puts the project's own Electron back afterwards.
- **Intel only**: Every Mac that stops at 10.13 or 10.14 is Intel anyway.
- **yt-dlp and Python**: The official yt-dlp Mac build needs 10.15, so the legacy build brings its own Python 3.12 (python-build-standalone) and runs yt-dlp's platform-independent build with it. `scripts/prepareLegacy.js` grabs both into `build/legacy/`, pinned and checked against their release checksums.
- **Same yt-dlp handling**: Each yt-dlp version folder holds `yt-dlp.pyz` and a small launcher named `yt-dlp_macos`, so running, updating, pinning and repairing yt-dlp all work just like in the regular build. Main sets `DOWNSTREAM_PYTHON` so the launcher can find the bundled Python.
- **Video downloads**: They prefer H.264 with AAC, since YouTube's best 1080p is often AV1, which older Macs can't play smoothly.
- **Its own version list**: It reads `legacy-versionctrl.json`, so it can be marked current or outdated on its own schedule.
- **Labels**: It says it's for legacy macOS in the home screen's version label, the About panel and the DMG name (`Downstream for Legacy macOS.dmg`).

### The Legacy Switches in Code

- `DOWNSTREAM_LEGACY=1` at build time switches `forge.config.js` over to the legacy resources and DMG name.
- It also sets `__DOWNSTREAM_LEGACY__` for the app's code, defined in `vite.main.config.mjs` and `vite.renderer.config.mjs`.
- `src/renderer/main.jsx` adds a `legacy-macos` class to the body, for styles Chromium 116 needs done differently. So far that's just the EQ's upright sliders in `eq.css`, since `writing-mode` on sliders only showed up in Chromium 124.
- The Control Strip helper targets 10.13 in both builds, with newer APIs behind `@available` checks. Built for 10.15, it doesn't load on 10.13 at all (`objc_opt_respondsToSelector` is missing there).

### Moving the Legacy Window

When the legacy build moves up to a newer Electron and macOS range:
1. Change `LEGACY_ELECTRON` in `duild-mac-legacy.sh`
2. Update the macOS range in the version label tooltip (`HomeView.jsx`), the About panel credits (`main.js`) and the `duild-mac-legacy.sh` banner
3. Check the `legacy-macos` style workarounds are still needed, and that newer UI works on the legacy Chromium
4. Test on a real Mac running the oldest supported version, since missing system functions only show up there


## Linux

The Linux build is a `.deb` for 64-bit PCs, built and tested on Ubuntu 26.04 Resolute Raccoon. Nothing in the package sets a minimum version, so older releases back to 22.04 Jammy Jellyfish should work too, they just haven't been tested.

It's the same Electron as the regular Mac build, and nothing in the project gets compiled per machine, so one package covers every supported Ubuntu. Build it with `duild-linux.sh` on a Linux machine. A `.deb` needs Linux's own packaging tools, so it can't be built from a Mac.

A few things worth knowing:
- **yt-dlp**: Linux uses the official self-contained `yt-dlp_linux`, which brings its own Python. `npm run setup` grabs it pinned and checks it against the release's `SHA2-256SUMS` (`installFile` in `src/ytDlpMacos.js`). After that, it's handled just like the Windows exe: copied to `userData/binaries/yt-dlp`, then updated in place with `--update-to`.
- **ffmpeg and ffprobe**: These come from `ffmpeg-static` and `ffprobe-static`, same as everywhere else.
- **The `media:` scheme**: It's registered the way macOS does it (standard and secure, with `media://local/<path>` links). Linux paths start with `/` just like Mac ones, and Web Audio needs it set up this way to hear the music at all.
- **Where it installs**: The program is called `downstream` in lowercase and lives in `/usr/lib/downstream/`, with `/usr/bin/downstream` and a desktop entry pointing at it.
- **The sandbox**: Ubuntu 24.04 and newer only let a program use the user namespaces Electron's sandbox needs if an AppArmor profile allows it. `scripts/linux/postinst` writes a small profile for `/usr/lib/downstream/downstream` wherever AppArmor 4 is installed, and `scripts/linux/postrm` takes it away again. Older releases don't need one.
- **The keyring**: Chromium's keyring gets skipped with `--password-store=basic`. It's the Linux version of the Mac's mock keychain, since Downstream doesn't keep any secrets.
- **Wayland**: Electron 31 runs through XWayland on a Wayland desktop.
- **Version list**: It reads `versionctrl.json`, the same list as Windows and the regular Mac build.
- **Wording**: The file manager is called Files on Linux, in "Show in Files" (`REVEAL_LABEL` in `FolderMedia.jsx`) and in the Guide (`FILE_MANAGER` in `GuideModal.jsx`).


## Media Keys and System Controls

This one covers every platform. The system's own media controls get the song, its folder and its cover from `src/renderer/hooks/useMediaSession.js`. That's GNOME's top bar and media keys on Linux, Now Playing on macOS, and the media flyout on Windows. Their buttons run through the player, so it always stays in step with what's actually playing.


## Icons

- **Windows**: `assets/icons/win/icon.ico`
- **macOS**: `assets/icons/mac/icon.icns` (compiled from `icon.iconset/` using `iconutil` on a Mac)
- **Linux**: `assets/icons/png/512.png`, used by the `.deb` and shipped in Resources for the window icon
- **Everything else**: PNGs in other sizes live in `assets/icons/png/`

### The Windows Installer Animation

While the Windows installer works, it shows a small looping animation, `assets/icons/win/installing.gif`. It's drawn in Selawik, Microsoft's open stand-in for Segoe UI, so it matches the app. `forge.config.js` hands it to the Squirrel maker as `loadingGif`.

### The README Art

The README's banner, `assets/readme/banner.png`, is drawn at twice its size so it stays sharp, with see-through corners for GitHub's light and dark themes.

The two screenshots next to it, `home.jpg` and `player.jpg`, are taken from a made-up demo library rather than anyone's real music, so retake them the same way if the UI changes.


## Releasing Stuffs

### On Mac

1. Bump the version in `package.json` and `package-lock.json`, the README title and download links, and the banners in `build.bat`, `duild-mac.sh`, `duild-mac-legacy.sh` and `duild-linux.sh` (the home screen reads it from `package.json`)
2. Run `duild-mac.sh` for the regular DMG in `out/make/`, and `duild-mac-legacy.sh` for the legacy one in `out-legacy/make/`
3. If the UI changed, test the legacy build on a Mac running its oldest supported version
4. Add the new version to `versionctrl.json`, and to `legacy-versionctrl.json` when the legacy build ships too
5. If the legacy build breaks and can't be fixed quickly, skip it this release and leave `legacy-versionctrl.json` alone, so those Macs stay on the last good version

### On Linux

1. Bump the version as for Mac, including the banner in `duild-linux.sh`
2. Run `duild-linux.sh` on an Ubuntu machine for `out/make/deb/x64/downstream_<version>_amd64.deb`
3. Install it with `sudo apt install ./downstream_<version>_amd64.deb` on Ubuntu 26.04 and test it there
