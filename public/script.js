document.addEventListener('DOMContentLoaded', () => {
    // --- Shared: Apply Theme on Load ---
    const savedTheme = localStorage.getItem('imgbb_theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);

    // Only run the downloader logic if we are on the main page
    const downloadBtn = document.getElementById('downloadBtn');
    if (!downloadBtn) return; 

    const socket = io();
    const urlInput = document.getElementById('urlInput');
    const progressLog = document.getElementById('progressLog');

    let isProcessing = false;

    function addLog(message, type = 'info', url = null) {
        // Prevent clearing the 'Waiting' message if we are just adding a log
        if (progressLog.children.length === 1 && progressLog.firstElementChild.tagName === 'P') {
            progressLog.innerHTML = '';
        }

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
        if (progressLog.children.length === 1 && progressLog.firstElementChild.tagName === 'P') {
            progressLog.innerHTML = '';
        }

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
        progressBar.style.width = '0%';

        const controls = document.createElement('div');
        controls.classList.add('download-controls');

        const pauseBtn = document.createElement('button');
        pauseBtn.textContent = 'Pause';
        pauseBtn.classList.add('mini-btn', 'pause-btn');
        pauseBtn.addEventListener('click', () => {
            socket.emit('pause-download', { url });
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.classList.add('mini-btn', 'cancel-btn');
        cancelBtn.addEventListener('click', () => {
            socket.emit('cancel-download', { url });
        });

        const restartBtn = document.createElement('button');
        restartBtn.textContent = 'Restart';
        restartBtn.classList.add('mini-btn', 'restart-btn');
        restartBtn.style.display = 'none'; // Hidden by default
        restartBtn.addEventListener('click', () => {
            socket.emit('restart-download', { url });
            // Reset UI for restart
            info.textContent = `Restarting: ${url}`;
            info.className = 'download-info log-entry info';
            progressBar.style.width = '0%';
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

    function showNotification(fileName) {
        const area = document.getElementById('notification-area');
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <div class="icon">✔</div>
            <div>
                <div style="font-weight: bold; margin-bottom: 2px;">Downloaded and Saved</div>
                <div style="font-size: 13px; opacity: 0.9;">'${fileName}'</div>
            </div>
        `;

        area.appendChild(toast);

        // Remove after 4 seconds
        setTimeout(() => {
            toast.classList.add('hide');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 4000);
    }

    downloadBtn.addEventListener('click', () => {
        if (isProcessing) return;

        const urls = urlInput.value.split(/[\s,]+/).filter(url => url.length > 0);
        if (urls.length === 0) {
            addLog('Please enter at least one URL.', 'error');
            return;
        }

        const concurrency = localStorage.getItem('imgbb_concurrency') || 5;

        isProcessing = true;
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Processing...';
        
        // Don't clear immediately, allows for cumulative adding
        if (progressLog.children.length > 0 && progressLog.firstElementChild.tagName === 'P') {
             progressLog.innerHTML = '';
        }

        urls.forEach(url => {
            // Check if already in list to avoid duplicates visually
            if (!document.querySelector(`.download-entry[data-url="${url}"]`)) {
                addDownloadEntry(url);
            }
        });

        socket.emit('start-download', { urls, concurrency });
    });

    socket.on('status', (data) => {
        const { message, type, url, fileName } = data;
        const entryContainer = document.querySelector(`.download-entry[data-url="${url}"]`);
        
        if (type === 'success') {
            // 1. Show dynamic notification
            if (fileName) {
                showNotification(fileName);
            }

            // 2. Remove from progress log
            if (entryContainer) {
                // Animate removal slightly for smoothness (optional, but nice)
                entryContainer.style.opacity = '0';
                setTimeout(() => {
                    entryContainer.remove();
                    // If log is empty, show default message
                    if (progressLog.children.length === 0) {
                        progressLog.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin-top: 20px;">Waiting for tasks...</p>';
                    }
                }, 300);
            }
        } else {
            // Handle other statuses
            const entry = entryContainer ? entryContainer.querySelector('.download-info') : null;

            if (entry) {
                entry.textContent = message;
                entry.className = `download-info log-entry ${type}`;
                if (type === 'error') {
                    const restartBtn = entryContainer.querySelector('.restart-btn');
                    if(restartBtn) restartBtn.style.display = 'inline-block';
                }
            } else if (type !== 'final' && url) {
                // If it was previously removed or restarted, find entry again
                 const restartedEntry = document.querySelector(`.download-entry[data-url="${url}"] .download-info`);
                 if(restartedEntry) {
                     restartedEntry.textContent = message;
                     restartedEntry.className = `download-info log-entry ${type}`;
                 }
            } else if (type !== 'success') {
                 // General log for non-download specific messages (or errors without URL)
                 addLog(message, type, url);
            }
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
        }
    });
});