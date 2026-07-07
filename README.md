# Downstream v2.2.8 (Mid 2026)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)  
**Author:** Stratabytes

## Introduction

**Downstream** is a cross-platform media toolkit built with Electron. It combines a YouTube downloader with a local music player, all in one desktop app while being very robust and customizable. It uses libraries like `FFmpeg` and `yt-dlp` for fast and reliable downloads.
> **note:** Downstream is a tool and the app is designed for legal use cases. Please respect copyright laws and platform terms of service when downloading media. You are solely responsible for appropriate usage (;

## Features

- **Multi-Platform Support**: Downstream supports Windows and macOS. Linux is planned for a future build!
- **High-Speed Downloads**: Download from YouTube as MP4 or MP3, including full playlists.
- **Music Player**: Built-in local music player with an EQ mixer, per-preset band customization, audio visualizer and volume normalization. A perfect background player.
- **Lite Rendering Mode**: Automatically detected on first launch based on your hardware. If your pc or mac is not up to spec, Downstream reduces blur, animations and background effects for smoother performance on older machines.
- **User-Friendly Interface**: Clean UI with smooth transitions, album art backgrounds and a scrolling track display.
- **Straight to Folder**: Downloads go directly to your system Downloads folder, or can be changed to be elsewhere.
- **Playlist / Radio Support**: Compatible with public YouTube playlist and radio links.
- **Saved Folders**: Save and switch between multiple local music library folders.
- **Auto-Update Checks**: Notifies you on the home screen when a new version is available.

## Download

Head to the [latest release](https://github.com/StrataBytes/Downstream/releases/latest)!

...If your not sure what to click, look for the ending file extension, based on the table below:

| Platform | File to download |
|----------|-----------------|
| **Windows** | `Downstream-X.X.X Setup`**.exe** |
| **macOS** | `Downstream-X.X.X`**.dmg** |

### OS Compatibility Note...
- Windows 10 & 11 is Downstream's 'native' operating system. 
- MacOS compatibility has been only tested and developed on what I have available, being Ventura. 
- When Linux support is added, you can expect greater support, because linux tends to 'just be able to run things' across multiple distros.


...You can also follow the manual build steps below, if you wish to do so.



## Building Manually

### Prerequisites

To get started with Downstream, you'll need the following installed:

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [Git](https://git-scm.com/)

### Installation Steps

1. Clone the repository and navigate to the project directory:
    ```bash
    git clone https://github.com/stratabytes/downstream.git
    cd downstream
    ```

2. Install dependencies:
    ```bash
    npm run setup
    ```
   This installs packages and downloads the required binaries (ffmpeg, yt-dlp, Electron). Use this instead of plain `npm install`.

3. Run the app in development mode:
    ```bash
    npm start
    ```

4. To build the installer:
    ```bash
    npm run make
    ```
   You can also use the provided scripts in the root, `duild.sh` on macOS, `build.bat` on Windows. Output will be in `out/make/`.







## Misc. Info
#### Development Cycle
Why does Downstream seem to skip version numbers? 
> Well, whenever I am working on a new build for Downstream which adds features, I tend to slowly build, test and daily drive the new version until all of the glaring issues are worked out. At the end of it all, I've already bumped the version number serveral times before it was even public! 
Patches and hotfixes are usually always insta-pushed as the latest version, as stability is the main goal of Downstream.
#### Stance of Patching & Hotfixes
> Youtube loves to break apps like these by making goofy changes to their platform! Im not 24/7 working on Downstream, so fixes might be a little slow if its not app-breakingly bad. 
#### Broken Downloads Due to YT?
> When youtube breaks downloads, this usually takes a while to get fixed, but is high priority. While I might not be right away fixing it, you can probably expect the app to be running once yt-dlp pushes a new, working version for me to swap out downstream with. I am also planning to have this be user-modular, within UI, so users can easily get Downstream working again, instead of waiting around.  (thanks a ton for the contributors of yt-dlp!)
#### General Issues, App Bugs and Glitches?
> Because this is a passion project, most minor issues will not be quickly resolved. Only high severity problems will be patched with relative haste.
> Additionally, cutting-edge hardware or OS changes are not included in stability priority. I dont plan on buying a new mac every 3 years, or upgrading to windows 12 right away.

## License

This project is licensed under the **GPLv3**. See the [LICENSE](LICENSE) file for more details.
