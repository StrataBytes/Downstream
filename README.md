# DownStream v1.1 (Early 2026)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)  
**Author:** Stratabytes

## Introduction

**DownStream** is a youtube downloader built with Electron. It allows users to download videos and audio (coming soon). It uses libraries like `FFmpeg` and `YouTube-dl` for fast and reliable downloads.
> **Note:** The app is designed for legal use cases. Please respect copyright laws and platform terms of service when downloading media.


## Features

- **High-Speed Downloads**: Downloads from YouTube, with planned support for both video and audio formats.
- **User-Friendly Interface**: Simple and intuitive UI.
- **Straight to Folder**: Downloads videos straight to your downloads folder.

## Download

Simply click on the latest release and download the EXE installer, or scroll down to see manual building steps.

## Future Plans

- **Playlist Support**: Add batch download options for playlists.
- **MP3 Conversion**: Add MP3 format for videos.


## Building Manually

### Prerequisites

To get started with DownStream, you'll need the following installed:

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
    npm install
    ```

3. Run the app in development mode:
    ```bash
    npm start
    ```

4. To build the app as EXE:
    ```bash
    npm run build:win
    ```
   The installer files will be available in the `/dist` folder.
   

## Acknowledgements
**Thanks to:** davidhurtado2000 for helping in initial Ver-1.0 development.

## License

This project is licensed under the **GPLv3**. See the [LICENSE](LICENSE) file for more details.
