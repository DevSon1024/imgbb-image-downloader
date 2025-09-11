// server.js - v2.3 (Reduced Concurrency Limit)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const axios = require('axios');
const figlet = require('figlet');
const chalk = require('chalk');
// We will import p-limit dynamically below

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const downloadFolder = path.join(__dirname, 'Downloads');
const urlLogFile = path.join(__dirname, 'downloaded_urls.txt');

if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Helper Functions (Unchanged) ---

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
        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            const progress = Math.round((downloadedLength / totalLength) * 100);
            socket.emit('download_progress', { url: originalUrl, progress });
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                socket.emit('status', { message: `✅ Image saved: ${filePath}`, type: 'success' });
                resolve();
            });
            writer.on('error', (err) => {
                socket.emit('status', { message: `❌ Download failed: ${err.message}`, type: 'error' });
                reject(err);
            });
        });
    } catch (e) {
        socket.emit('status', { message: `❌ Error downloading image: ${e.message}`, type: 'error' });
    }
}

async function scrapeAndDownload(imageUrl, browser, socket) {
    socket.emit('status', { message: `🚀 Navigating to: ${imageUrl}`, url: imageUrl, type: 'info' });

    let page = null;
    try {
        page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['stylesheet', 'font', 'image'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(imageUrl, { waitUntil: 'domcontentloaded' });

        const downloadSelector = 'a.btn.btn-download.default';
        await page.waitForSelector(downloadSelector, { timeout: 15000 });
        const downloadLink = await page.$eval(downloadSelector, (el) => el.href);

        if (downloadLink) {
            socket.emit('status', { message: `✅ Found link: ${downloadLink}`, type: 'info' });
            saveUrlWithTime(downloadLink, socket);
            await downloadImage(downloadLink, imageUrl, socket);
        } else {
            socket.emit('status', { message: '❌ No download link found!', type: 'error' });
        }
    } catch (e) {
        socket.emit('status', { message: `❌ Error scraping ${imageUrl}: ${e.message}`, type: 'error' });
    } finally {
        if (page) {
            await page.close();
        }
    }
}

// --- WebSocket and Server Logic ---
(async () => {
    // Dynamically import p-limit
    const pLimit = (await import('p-limit')).default;

    const browser = await puppeteer.launch({ headless: true });

    io.on('connection', (socket) => {
        console.log(chalk.blue('A user connected via WebSocket'));

        socket.on('start-download', async ({ urls }) => {
            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return socket.emit('status', { message: 'No URLs provided.', type: 'error' });
            }

            // **FIX**: Reduced concurrency from 5 to 2 to prevent network errors
            const limit = pLimit(2); 

            const tasks = urls.map(url => {
                const trimmedUrl = url.trim();
                if (trimmedUrl.startsWith('https://ibb.co/')) {
                    return limit(() => scrapeAndDownload(trimmedUrl, browser, socket));
                } else {
                    socket.emit('status', { message: `❌ Invalid URL skipped: ${trimmedUrl}`, type: 'error' });
                    return Promise.resolve();
                }
            });

            await Promise.all(tasks);
            socket.emit('status', { message: '🎉 All tasks complete!', type: 'final' });
        });

        socket.on('disconnect', () => {
            console.log(chalk.yellow('User disconnected'));
        });
    });

    server.listen(PORT, () => {
        console.log(chalk.yellow(`Server running at http://localhost:${PORT}`));
    });

    process.on('SIGINT', async () => {
        await browser.close();
        process.exit();
    });
})();