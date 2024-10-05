// Adding event listener for DOMContentLoaded to ensure the DOM is fully loaded before executing the script.
document.addEventListener('DOMContentLoaded', () => {
    // Retrieving form elements by their IDs to manage user interactions.
    const urlInput = document.getElementById('youtube-link');
    const qualitySelect = document.getElementById('quality');
    const formatSelect = document.getElementById('format');
    const queueList = document.getElementById('queue-list');
    const downloadAllButton = document.getElementById('download-all');
    const clearQueueButton = document.getElementById('clear-queue');

    // Adding click event listener to the 'Add to Queue' button to process and validate input data.
    document.getElementById('add-to-queue').addEventListener('click', async (e) => {
        e.preventDefault(); // Prevent default form submission behavior.
        const url = urlInput.value.trim();
        const quality = qualitySelect.value;
        const format = formatSelect.value;

        // Validate input fields to ensure they contain valid data before processing.
        if (url && quality !== 'Quality' && format !== 'Format') {
            // Create a queue item object and append it to the queue list.
            const queueItem = { url, title: 'Working...', quality, format, state: 'queued' };
            const row = createQueueRow(queueItem);
            queueList.appendChild(row);

            // Fetch the video title asynchronously from the backend using Electron's IPC.
            const title = await window.electronAPI.getVideoTitle(url);
            const progressId = encodeURIComponent(url);
            const titleElement = document.getElementById(`title-${progressId}`);
            titleElement.textContent = title;
            titleElement.classList.remove('skeleton-loader');

            // Reset input fields after adding the video to the queue.
            urlInput.value = '';
            qualitySelect.value = 'Quality';
            formatSelect.value = 'Format';
        }
    });

    // Function to create a table row element representing a queue item.
    function createQueueRow({ url, title, quality, format }) {
        const row = document.createElement('tr');
        row.dataset.url = url; // Storing the URL in the dataset for future reference.
        const progressId = encodeURIComponent(url);

        // Constructing inner HTML with placeholders and progress elements.
        row.innerHTML = `
            <td id="title-${progressId}" class="skeleton-loader">${title}</td>
            <td>${quality}</td>
            <td>${format}</td>
            <td>
                <span id="status-${progressId}">Queued</span>
                <progress id="progress-${progressId}" value="0" max="100"></progress>
            </td>
        `;
        return row;
    }

    // Listener for download progress updates from the backend.
    window.electronAPI.on('download-progress', (event, { url, progress }) => {
        const progressId = encodeURIComponent(url);
        const progressBar = document.getElementById(`progress-${progressId}`);
        const statusSpan = document.getElementById(`status-${progressId}`);
        if (progressBar && statusSpan) {
            progressBar.value = progress;
            statusSpan.innerText = `Downloading (${progress}%)`;
            statusSpan.classList.remove('skeleton-loader');
        }
    });

    // Listener for download completion events from the backend.
    window.electronAPI.on('download-complete', (event, { url, success }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`status-${progressId}`);
        if (statusSpan) {
            statusSpan.classList.remove('skeleton-loader');
            if (success) {
                statusSpan.innerText = 'Download Complete, Converting...';
            } else {
                statusSpan.innerText = 'Download Failed';
                statusSpan.style.color = 'red';
            }
        }
    });

    // Listener for conversion completion events.
    window.electronAPI.on('conversion-complete', (event, { url, success }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`status-${progressId}`);
        if (statusSpan) {
            statusSpan.classList.remove('skeleton-loader');
            if (success) {
                statusSpan.innerText = 'Completed';
            } else {
                statusSpan.innerText = 'Conversion Failed';
                statusSpan.style.color = 'red';
            }
        }
    });

    // Event listener for the 'Download All' button to initiate downloading of all queued videos.
    downloadAllButton.addEventListener('click', async () => {
        downloadAllButton.classList.add('button-disabled', 'skeleton-loader');
        clearQueueButton.classList.add('button-disabled', 'skeleton-loader');

        // Iterate over each row in the queue and initiate download.
        const rows = queueList.querySelectorAll('tr');
        for (let row of rows) {
            const url = row.dataset.url;
            const quality = row.cells[1].innerText;
            const format = row.cells[2].innerText;

            const progressId = encodeURIComponent(url);
            const statusSpan = document.getElementById(`status-${progressId}`);
            statusSpan.classList.add('skeleton-loader');
            statusSpan.innerText = 'Working...';

            // Call the downloadVideo function exposed by the preload script.
            await window.electronAPI.downloadVideo({ url, quality, format });
        }

        // After all downloads have been initiated, remove disabled and loading states from the buttons.
        downloadAllButton.classList.remove('button-disabled', 'skeleton-loader');
        clearQueueButton.classList.remove('button-disabled', 'skeleton-loader');
    });

    // Listener for download errors to handle and display errors appropriately.
    window.electronAPI.on('download-error', (event, { url, error }) => {
        const progressId = encodeURIComponent(url);
        const statusSpan = document.getElementById(`${progressId}-status`);
        statusSpan.innerText = `Error: ${error}`;
        statusSpan.style.color = 'red';
    });

    // Event listener for clearing the download queue.
    document.getElementById('clear-queue').addEventListener('click', () => {
        queueList.innerHTML = ''; // Clear the inner HTML of the queue list, effectively removing all queued items.
    });

});
