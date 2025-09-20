document.addEventListener('DOMContentLoaded', () => {
    const historyLog = document.getElementById('historyLog');

    fetch('/history')
        .then(response => response.json())
        .then(data => {
            historyLog.innerHTML = '';
            if (data.history.length === 0) {
                historyLog.innerHTML = '<p>No download history found.</p>';
                return;
            }

            data.history.forEach(entry => {
                const logEntry = document.createElement('div');
                logEntry.classList.add('log-entry', 'success');
                logEntry.textContent = `Downloaded successfully: ${entry}`;
                historyLog.appendChild(logEntry);
            });
        })
        .catch(error => {
            historyLog.innerHTML = `<p class="log-entry error">Error loading history: ${error.message}</p>`;
        });
});