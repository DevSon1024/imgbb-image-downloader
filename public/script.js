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

        // Use socket to start download
        socket.emit('start-download', { urls });
    });

    socket.on('status', (data) => {
        const { message, type, url } = data;

        if (message.startsWith('🚀 Navigating')) {
            addLog(message, type, url);
            const progressContainer = document.createElement('div');
            progressContainer.classList.add('progress-bar-container');
            progressContainer.dataset.url = url;

            const progressBar = document.createElement('div');
            progressBar.classList.add('progress-bar');
            progressBar.textContent = '0%';

            progressContainer.appendChild(progressBar);
            progressLog.appendChild(progressContainer);
        } else {
            addLog(message, type);
        }

        if (type === 'final') {
            isProcessing = false;
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Start Download';
        }
    });

    socket.on('download_progress', (data) => {
        const { url, progress } = data;
        const progressBarContainer = document.querySelector(`.progress-bar-container[data-url="${url}"]`);
        if (progressBarContainer) {
            const bar = progressBarContainer.querySelector('.progress-bar');
            bar.style.width = `${progress}%`;
            bar.textContent = `${progress}%`;
        }
    });
});