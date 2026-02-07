document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('youtube-link');
    const qualitySelect = document.getElementById('quality');
    const formatSelect = document.getElementById('format');
    const queueList = document.getElementById('queue-list');
    const downloadAllButton = document.getElementById('download-all');
    const clearQueueButton = document.getElementById('clear-queue');
    const cancelDownloadButton = document.getElementById('cancel-download');
    const openDownloadsButton = document.getElementById('open-downloads');

    const RATE_LIMIT = {
        API_CALL_DELAY: 1500,
        DOWNLOAD_DELAY: 3000,
        BATCH_PAUSE: 5000,
        BATCH_SIZE: 5,
    };

    let lastApiCall = 0;
    let downloadCount = 0;
    let downloadCancelled = false;
    let isDownloading = false;

    async function rateLimitedDelay() {
        const now = Date.now();
        const timeSinceLastCall = now - lastApiCall;
        if (timeSinceLastCall < RATE_LIMIT.API_CALL_DELAY) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.API_CALL_DELAY - timeSinceLastCall));
        }
        lastApiCall = Date.now();
    }

    async function downloadRateLimitDelay() {
        downloadCount++;
        if (downloadCount > 0 && downloadCount % RATE_LIMIT.BATCH_SIZE === 0) {
            console.log(`Batch pause after ${downloadCount} downloads...`);
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.BATCH_PAUSE));
        } else {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.DOWNLOAD_DELAY));
        }
    }

    function resetDownloadCounter() {
        downloadCount = 0;
    }

    document.getElementById('add-to-queue').addEventListener('click', async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();
        const quality = qualitySelect.value;
        const format = formatSelect.value;

        if (url && quality !== 'Quality' && format !== 'Format') {
            const loadingOverlay = document.getElementById('loading-overlay');
            loadingOverlay.style.display = 'flex';
            try {
                const playlistInfo = await window.electronAPI.getPlaylistInfo(url);
                loadingOverlay.style.display = 'none';
                if (playlistInfo && playlistInfo.videos && playlistInfo.videos.length > 1) {
                    showPlaylistModal(playlistInfo, quality, format);
                } else {
                    addVideoToQueue(url, quality, format);
                }
            } catch (error) {
                loadingOverlay.style.display = 'none';
                console.error('Error checking playlist:', error);
                addVideoToQueue(url, quality, format);
            }
            urlInput.value = '';
        }
    });

    async function addVideoToQueue(url, quality, format) {
        const queueItem = { url, title: 'Working...', quality, format, state: 'queued' };
        const row = createQueueRow(queueItem);
        queueList.appendChild(row);
        await rateLimitedDelay();
        const title = await window.electronAPI.getVideoTitle(url);
        const progressId = encodeURIComponent(url);
        const titleElement = document.getElementById(`title-${progressId}`);
        titleElement.textContent = title;
        titleElement.classList.remove('skeleton-loader');
    }

    function showPlaylistModal(playlistInfo, quality, format) {
        const modal = document.getElementById('playlist-modal');
        const playlistItemsContainer = document.getElementById('playlist-items');
        playlistItemsContainer.innerHTML = '';
        if (playlistInfo.truncated) {
            const warningDiv = document.createElement('div');
            warningDiv.style.cssText = 'background-color: rgba(255, 165, 0, 0.2); border: 1px solid orange; border-radius: 5px; padding: 10px; margin-bottom: 10px; color: orange;';
            warningDiv.textContent = playlistInfo.isRadio 
                ? `⚠️ Radio limited to first ${playlistInfo.videos.length} videos to prevent rate limiting`
                : `⚠️ Playlist limited to first ${playlistInfo.videos.length} videos`;
            playlistItemsContainer.appendChild(warningDiv);
        }
        playlistInfo.videos.forEach((video, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'playlist-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `playlist-video-${index}`;
            checkbox.value = video.url;
            checkbox.checked = true;
            const label = document.createElement('label');
            label.htmlFor = `playlist-video-${index}`;
            label.textContent = video.title;
            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            playlistItemsContainer.appendChild(itemDiv);
        });
        modal.style.display = 'block';
        document.getElementById('add-selected-btn').onclick = async () => {
            const checkboxes = playlistItemsContainer.querySelectorAll('input[type="checkbox"]:checked');
            const selectedUrls = Array.from(checkboxes).map(cb => cb.value);
            modal.style.display = 'none';
            for (let url of selectedUrls) {
                await addVideoToQueue(url, quality, format);
            }
        };
        document.getElementById('cancel-modal-btn').onclick = () => {
            modal.style.display = 'none';
        };
        document.getElementById('select-all-btn').onclick = () => {
            playlistItemsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        };
        document.getElementById('deselect-all-btn').onclick = () => {
            playlistItemsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        };
    }

    function createQueueRow({ url, title, quality, format }) {
        const row = document.createElement('tr');
        row.dataset.url = url;
        const progressId = encodeURIComponent(url);
        row.innerHTML = `
            <td id="title-${progressId}" class="skeleton-loader">${title}</td>
            <td>${quality}</td>
            <td>${format}</td>
            <td id="progress-cell-${progressId}">
                <span id="status-${progressId}">Queued</span>
                <progress id="progress-${progressId}" value="0" max="100"></progress>
            </td>
        `;
        return row;
    }

    window.electronAPI.on('download-progress', (event, { url, progress }) => {
        const progressId = encodeURIComponent(url);
        const progressBar = document.getElementById(`progress-${progressId}`);
        const statusSpan = document.getElementById(`status-${progressId}`);
        const progressCell = document.getElementById(`progress-cell-${progressId}`);
        if (progressBar && statusSpan) {
            progressBar.value = progress;
            statusSpan.innerText = `Downloading (${progress}%)`;
            if (progressCell) {
                progressCell.classList.remove('skeleton-loader');
            }
        }
    });

    window.electronAPI.on('download-complete', (event, { url, success }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`status-${progressId}`);
        const progressCell = document.getElementById(`progress-cell-${progressId}`);
        if (statusSpan) {
            if (progressCell) {
                progressCell.classList.remove('skeleton-loader');
            }
            if (success) {
                statusSpan.innerText = 'Download Complete, Converting...';
            } else {
                statusSpan.innerText = 'Download Failed';
                statusSpan.style.color = 'red';
            }
        }
    });

    window.electronAPI.on('conversion-complete', (event, { url, success }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`status-${progressId}`);
        const progressCell = document.getElementById(`progress-cell-${progressId}`);
        if (statusSpan) {
            if (progressCell) {
                progressCell.classList.remove('skeleton-loader');
            }
            if (success) {
                statusSpan.innerText = 'Completed';
            } else {
                statusSpan.innerText = 'Conversion Failed';
                statusSpan.style.color = 'red';
            }
        }
    });

    downloadAllButton.addEventListener('click', async () => {
        downloadAllButton.classList.add('button-disabled');
        clearQueueButton.classList.add('button-disabled');
        downloadCancelled = false;
        isDownloading = true;

        const progressContainer = document.getElementById('total-progress-container');
        progressContainer.style.display = 'block';

        const rows = queueList.querySelectorAll('tr');
        const totalVideos = rows.length;
        let completedVideos = 0;

        document.getElementById('progress-text').innerText = 'Downloading...';
        document.getElementById('progress-count').innerText = `0/${totalVideos}`;
        document.getElementById('total-progress').value = 0;

        resetDownloadCounter();

        for (let i = 0; i < rows.length; i++) {
            if (downloadCancelled) {
                document.getElementById('progress-text').innerText = 'Cancelled';
                break;
            }

            const row = rows[i];
            const url = row.dataset.url;
            const quality = row.cells[1].innerText;
            const format = row.cells[2].innerText;

            const progressId = encodeURIComponent(url);
            const statusSpan = document.getElementById(`status-${progressId}`);
            const progressCell = document.getElementById(`progress-cell-${progressId}`);
            if (progressCell) {
                progressCell.classList.add('skeleton-loader');
            }
            statusSpan.innerText = 'Working...';

            await rateLimitedDelay();
            const thumbnail = await window.electronAPI.getVideoThumbnail(url);
            if (thumbnail) {
                setBackgroundThumbnail(thumbnail);
            }

            await downloadRateLimitDelay();

            if (downloadCancelled) {
                statusSpan.innerText = 'Cancelled';
                break;
            }

            await window.electronAPI.downloadVideo({ url, quality, format });

            completedVideos++;
            const totalProgressPercent = Math.floor((completedVideos / totalVideos) * 100);
            document.getElementById('total-progress').value = totalProgressPercent;
            document.getElementById('progress-count').innerText = `${completedVideos}/${totalVideos}`;

            if (i === rows.length - 1 && !downloadCancelled) {
                document.getElementById('progress-text').innerText = 'Complete!';
                await new Promise(resolve => setTimeout(resolve, 10000));
                clearBackgroundThumbnail();
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    document.getElementById('progress-text').innerText = 'Ready';
                    document.getElementById('progress-count').innerText = '0/0';
                    document.getElementById('total-progress').value = 0;
                }, 1000);
            }
        }

        if (downloadCancelled) {
            clearBackgroundThumbnail();
            setTimeout(() => {
                progressContainer.style.display = 'none';
                document.getElementById('progress-text').innerText = 'Ready';
                document.getElementById('progress-count').innerText = '0/0';
                document.getElementById('total-progress').value = 0;
            }, 2000);
        }

        downloadAllButton.classList.remove('button-disabled');
        clearQueueButton.classList.remove('button-disabled');
        isDownloading = false;
    });

    window.electronAPI.on('download-error', (event, { url, error }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`status-${progressId}`);
        if (statusSpan) {
            statusSpan.innerText = `Error: ${error}`;
            statusSpan.style.color = 'red';
        }
    });

    document.getElementById('clear-queue').addEventListener('click', () => {
        queueList.innerHTML = '';
    });

    cancelDownloadButton.addEventListener('click', () => {
        if (!isDownloading) return;

        const rows = queueList.querySelectorAll('tr');
        let remainingCount = 0;
        rows.forEach(row => {
            const url = row.dataset.url;
            const progressId = encodeURIComponent(url);
            const statusSpan = document.getElementById(`status-${progressId}`);
            if (statusSpan && !statusSpan.innerText.includes('Completed') && !statusSpan.innerText.includes('Complete')) {
                remainingCount++;
            }
        });

        if (remainingCount <= 5) {
            downloadCancelled = true;
            document.getElementById('progress-text').innerText = 'Cancelling...';
        } else {
            document.getElementById('cancel-remaining-count').innerText = remainingCount;
            document.getElementById('cancel-modal').style.display = 'block';
        }
    });

    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        downloadCancelled = true;
        document.getElementById('progress-text').innerText = 'Cancelling...';
        document.getElementById('cancel-modal').style.display = 'none';
    });

    document.getElementById('dismiss-cancel-btn').addEventListener('click', () => {
        document.getElementById('cancel-modal').style.display = 'none';
    });

    openDownloadsButton.addEventListener('click', () => {
        window.electronAPI.openDownloadsFolder();
    });

    function setBackgroundThumbnail(thumbnailUrl) {
        const backgroundLayer = document.getElementById('background-layer');
        
        backgroundLayer.classList.remove('active');
        
        setTimeout(() => {
            backgroundLayer.style.backgroundImage = `url('${thumbnailUrl}')`;
            
            backgroundLayer.classList.add('active');
        }, 500);
    }

    function clearBackgroundThumbnail() {
        const backgroundLayer = document.getElementById('background-layer');
        
        backgroundLayer.classList.remove('active');
        
        setTimeout(() => {
            backgroundLayer.style.backgroundImage = '';
        }, 500);
    }

});
