// server.js - v3.0 (High-Speed Scraper)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const axios = require('axios');
const figlet = require('figlet');
const chalk = require('chalk');
const cheerio = require('cheerio'); // Added cheerio for HTML parsing

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const downloadFolder = path.join(__dirname, 'Downloads');
const urlLogFile = path.join(__dirname, '/Downloads/downloaded_urls.txt');

if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory store for active downloads
const activeDownloads = new Map();

// --- Helper Functions ---

function extractFileName(imagePageUrl, downloadUrl) {
    try {
        const pageUrl = new URL(imagePageUrl);
        const uniqueCode = pageUrl.pathname.replace('/', '');
        const downloadPath = new URL(downloadUrl).pathname;
        const baseName = path.basename(downloadPath);
        const { name, ext } = path.parse(baseName);
        return `${name}_${uniqueCode}${ext}`;
    } catch (e) {
        return path.basename(new URL(downloadUrl).pathname);
    }
}

function getUniqueFileName(filePath) {
    let counter = 1;
    const { dir, name, ext } = path.parse(filePath);
    let newFilePath = filePath;
    while (fs.existsSync(newFilePath)) {
        newFilePath = path.join(dir, `${name}_${counter}${ext}`);
        counter++;
    }
    return newFilePath;
}

function saveUrlWithTime(downloadUrl, socket) {
    try {
        const timestamp = new Date().toLocaleString('en-GB', { hour12: false }).replace(',', '_');
        const entry = `${downloadUrl} - ${timestamp}\n`;
        fs.appendFileSync(urlLogFile, entry, 'utf-8');
        socket.emit('status', { message: `📝 Saved URL to log: ${downloadUrl}`, type: 'info' });
    } catch (e) {
        socket.emit('status', { message: `❌ Error saving URL: ${e.message}`, type: 'error' });
    }
}

async function downloadImage(downloadUrl, originalUrl, socket) {
    const fileName = extractFileName(originalUrl, downloadUrl);
    let filePath = path.join(downloadFolder, fileName);
    filePath = getUniqueFileName(filePath);

    socket.emit('status', { message: `📥 Downloading: ${path.basename(filePath)}...`, type: 'info', url: originalUrl });

    try {
        const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream' });
        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        const writer = fs.createWriteStream(filePath);
        activeDownloads.set(originalUrl, { writer, response });

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            const progress = Math.round((downloadedLength / totalLength) * 100);
            socket.emit('download_progress', { url: originalUrl, progress });
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                socket.emit('status', { message: `✅ Image saved: ${filePath}`, type: 'success', url: originalUrl });
                activeDownloads.delete(originalUrl);
                resolve();
            });
            writer.on('error', (err) => {
                socket.emit('status', { message: `❌ Download failed: ${err.message}`, type: 'error', url: originalUrl });
                activeDownloads.delete(originalUrl);
                reject(err);
            });
        });
    } catch (e) {
        socket.emit('status', { message: `❌ Error downloading image: ${e.message}`, type: 'error', url: originalUrl });
        activeDownloads.delete(originalUrl);
    }
}

// --- High-Speed Scrape and Download Function ---
async function scrapeAndDownload(imageUrl, socket) {
    socket.emit('status', { message: `🚀 Fetching HTML for: ${imageUrl}`, url: imageUrl, type: 'info' });

    try {
        const { data: html } = await axios.get(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(html);
        const downloadLink = $('a.btn.btn-download.default').attr('href');

        if (downloadLink) {
            socket.emit('status', { message: `✅ Found link: ${downloadLink}`, type: 'info', url: imageUrl });
            saveUrlWithTime(downloadLink, socket);
            await downloadImage(downloadLink, imageUrl, socket);
        } else {
            socket.emit('status', { message: `❌ No download link found for ${imageUrl}!`, type: 'error', url: imageUrl });
        }
    } catch (e) {
        socket.emit('status', { message: `❌ Error scraping ${imageUrl}: ${e.message}`, type: 'error', url: imageUrl });
    }
}

// --- WebSocket and Server Logic ---
(async () => {
    const pLimit = (await import('p-limit')).default;

    io.on('connection', (socket) => {
        console.log(chalk.blue('A user connected via WebSocket'));

        socket.on('start-download', async ({ urls }) => {
            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return socket.emit('status', { message: 'No URLs provided.', type: 'error' });
            }

            const limit = pLimit(20);

            const tasks = urls.map(url => {
                const trimmedUrl = url.trim();
                if (trimmedUrl.startsWith('https://ibb.co/')) {
                    return limit(() => scrapeAndDownload(trimmedUrl, socket));
                } else {
                    socket.emit('status', { message: `❌ Invalid URL skipped: ${trimmedUrl}`, type: 'error' });
                    return Promise.resolve();
                }
            });

            await Promise.all(tasks);
            socket.emit('status', { message: '🎉 All tasks complete!', type: 'final' });
        });

        socket.on('pause-download', ({ url }) => {
            const download = activeDownloads.get(url);
            if (download && download.response.data.isPaused()) {
                download.response.data.resume();
                socket.emit('status', { message: '▶️ Resumed', type: 'info', url });
            } else if (download) {
                download.response.data.pause();
                socket.emit('status', { message: '⏸️ Paused', type: 'info', url });
            }
        });

        socket.on('cancel-download', ({ url }) => {
            const download = activeDownloads.get(url);
            if (download) {
                download.response.data.destroy();
                activeDownloads.delete(url);
                socket.emit('status', { message: '❌ Canceled', type: 'error', url });
            }
        });

        socket.on('restart-download', async ({ url }) => {
            console.log(chalk.cyan(`Restarting download for: ${url}`));
            await scrapeAndDownload(url, socket);
        });

        socket.on('disconnect', () => {
            console.log(chalk.yellow('User disconnected'));
        });
    });

    app.get('/history', (req, res) => {
        if (fs.existsSync(urlLogFile)) {
            const history = fs.readFileSync(urlLogFile, 'utf-8').split('\n').filter(Boolean);
            res.json({ history });
        } else {
            res.json({ history: [] });
        }
    });

    server.listen(PORT, () => {
        console.log(chalk.yellow(`Server running at http://localhost:${PORT}`));
        const text = figlet.textSync('ImgBB Downloader', { horizontalLayout: 'full' });
        console.log(chalk.green(text));
    });
})();