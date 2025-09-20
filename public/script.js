document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const urlInput = document.getElementById('urlInput');
    const downloadBtn = document.getElementById('downloadBtn');
    const progressLog = document.getElementById('progressLog');

    let isProcessing = false;

    function addLog(message, type = 'info', url = null) {
        const entry = document.createElement('div');
        entry.textContent = message;
        entry.classList.add('log-entry', type);
        if (url) {
            entry.dataset.url = url;
        }
        progressLog.appendChild(entry);
        progressLog.scrollTop = progressLog.scrollHeight;
    }

    function addDownloadEntry(url) {
        const entry = document.createElement('div');
        entry.classList.add('download-entry');
        entry.dataset.url = url;

        const info = document.createElement('div');
        info.classList.add('download-info');
        info.textContent = `Starting: ${url}`;

        const progressBarContainer = document.createElement('div');
        progressBarContainer.classList.add('progress-bar-container');

        const progressBar = document.createElement('div');
        progressBar.classList.add('progress-bar');
        progressBar.textContent = '0%';

        const controls = document.createElement('div');
        controls.classList.add('download-controls');

        const pauseBtn = document.createElement('button');
        pauseBtn.textContent = 'Pause';
        pauseBtn.classList.add('pause-btn');
        pauseBtn.addEventListener('click', () => {
            socket.emit('pause-download', { url });
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.classList.add('cancel-btn');
        cancelBtn.addEventListener('click', () => {
            socket.emit('cancel-download', { url });
        });

        const restartBtn = document.createElement('button');
        restartBtn.textContent = 'Restart';
        restartBtn.classList.add('restart-btn');
        restartBtn.style.display = 'none'; // Hidden by default
        restartBtn.addEventListener('click', () => {
            socket.emit('restart-download', { url });
            // Reset the entry for the new download attempt
            info.textContent = `Restarting: ${url}`;
            info.className = 'download-info log-entry info';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            restartBtn.style.display = 'none';
        });

        progressBarContainer.appendChild(progressBar);
        controls.appendChild(pauseBtn);
        controls.appendChild(cancelBtn);
        controls.appendChild(restartBtn);
        entry.appendChild(info);
        entry.appendChild(progressBarContainer);
        entry.appendChild(controls);
        progressLog.appendChild(entry);
    }

    downloadBtn.addEventListener('click', () => {
        if (isProcessing) return;

        const urls = urlInput.value.split(/[\s,]+/).filter(url => url.length > 0);
        if (urls.length === 0) {
            addLog('Please enter at least one URL.', 'error');
            return;
        }

        isProcessing = true;
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Processing...';
        progressLog.innerHTML = '';

        urls.forEach(url => {
            addDownloadEntry(url);
        });

        socket.emit('start-download', { urls });
    });

    socket.on('status', (data) => {
        const { message, type, url } = data;
        const entryContainer = document.querySelector(`.download-entry[data-url="${url}"]`);
        const entry = entryContainer ? entryContainer.querySelector('.download-info') : null;

        if (entry) {
            entry.textContent = message;
            entry.className = `download-info log-entry ${type}`;
            if (type === 'error') {
                const restartBtn = entryContainer.querySelector('.restart-btn');
                restartBtn.style.display = 'inline-block';
            }
        } else if (type !== 'final' && url) {
             // It's a status for a restarted download, find its entry
            const restartedEntry = document.querySelector(`.download-entry[data-url="${url}"] .download-info`);
            if(restartedEntry) {
                restartedEntry.textContent = message;
                restartedEntry.className = `download-info log-entry ${type}`;
            }
        } else {
             addLog(message, type, url);
        }

        if (type === 'final') {
            isProcessing = false;
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Start Download';
        }
    });

    socket.on('download_progress', (data) => {
        const { url, progress } = data;
        const progressBar = document.querySelector(`.download-entry[data-url="${url}"] .progress-bar`);
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
            progressBar.textContent = `${progress}%`;
        }
    });
});