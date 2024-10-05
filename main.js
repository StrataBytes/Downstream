const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = path.resolve(require('ffmpeg-static'));
const ytdl = require('ytdl-core');

// Check if the FFmpeg binary exists at the specified path.
if (fs.existsSync(ffmpegPath)) {
    console.log('FFmpeg binary exists at:', ffmpegPath);
} else {
    console.error('FFmpeg binary not found at:', ffmpegPath);
}

console.log('Resolved FFmpeg Path:', ffmpegPath);

// Append the FFmpeg path to the system PATH to ensure it can be accessed globally.
process.env.PATH += `;${path.dirname(ffmpegPath)}`;
ffmpeg.setFfmpegPath(ffmpegPath);

// Function to create and configure the main window of the Electron application.
function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),  // Specify the path to the preload script.
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
        },
        //package.json, specifiy icon
        icon: path.join(__dirname, 'epic.ico'),
    });
    
    win.loadFile('index.html');  // Load the main HTML file as the application's interface.

    win.setMenuBarVisibility(false);
}

// Event handling for when the application is ready to create windows.
app.whenReady().then(() => {
    createWindow();

    // Recreate the window if the app is reactivated and no windows are open.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Handle closing all windows (usually triggers application exit except on macOS).
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {  // On macOS, applications generally continue running even without open windows.
        app.quit();
    }
});

// Define an IPC handler for downloading videos.
ipcMain.handle('download-video', async (event, { url, quality, format }) => {
    // Get the user's Downloads folder path
    const outputDir = app.getPath('downloads');
    
    // Template for output file (replacing __dirname with outputDir)
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
    
    // yt-dlp command with the updated output directory
    const downloadCommand = `yt-dlp -o "${outputTemplate}" "${url}"`;

    try {
        // Execute the download command and handle the download completion event.
        await executeCommand(downloadCommand, url, event);
        event.sender.send('download-complete', { url, success: true });
        console.log(`Download command completed for ${url}`);

        // Conditionally handle video conversion based on the requested format.
        if (format === 'mp3') {
            const tempFile = `${outputDir}/temp.mkv`;  // Adjust the temp file to be inside the user's Downloads folder
            await convertVideoWithFFmpeg(tempFile, outputTemplate.replace('%(ext)s', 'mp3'), format);
            event.sender.send('conversion-complete', { url, success: true });
            console.log(`Conversion completed for ${url}`);
        } else {
            // Send conversion-complete event even if no conversion is necessary.
            event.sender.send('conversion-complete', { url, success: true });
        }
    } catch (error) {
        console.error(`Error in download/conversion for ${url}: ${error.message}`);
        event.sender.send('download-error', { url, error: error.message });
    }
});

// Define a function to execute shell commands for downloading videos.
function executeCommand(command, url, event) {
    return new Promise((resolve, reject) => {
        const process = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('Error executing command:', error);
                reject(error);
            } else {
                console.log('Command executed successfully:', stdout);
                resolve(stdout);
            }
        });

        // Capture stdout data and parse download progress.
        process.stdout.on('data', (data) => {
            console.log(`Output: ${data}`);
            const progressMatch = data.match(/(\d+\.\d+)%/);
            if (progressMatch) {
                const progress = Math.floor(parseFloat(progressMatch[1]));
                console.log(`Progress: ${progress}% for ${url}`);
                event.sender.send('download-progress', { url, progress });
            }
        });

        process.stderr.on('data', (data) => {
            console.error(`Error: ${data}`);
        });
    });
}

// Define a function to convert video files using FFmpeg.
function convertVideoWithFFmpeg(inputFile, outputFile, format) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .output(outputFile)
            .on('end', () => {
                console.log('Conversion done');
                resolve();
            })
            .on('error', (err) => {
                console.error(`Conversion error: ${err.message}`);
                reject(err);
            })
            .run();
    });
}

// Define an IPC handler to fetch video titles using youtube-dl.
ipcMain.handle('get-video-title', async (event, url) => {
    try {
        const info = await ytdl.getBasicInfo(url);
        const title = info.videoDetails.title;
        return title;
    } catch (error) {
        console.error(`Error fetching video title for ${url}: ${error.message}`);
        return 'Unknown Title - Check URL';
    }
});

// Handle uncaught exceptions to avoid application crashes.
process.on('uncaughtException', (error) => {
    if (error.message.includes('spawn UNKNOWN')) {
        console.warn('Suppressed "spawn UNKNOWN" error:', error.message);
    } else {
        console.error('Uncaught Exception:', error);
    }
});
