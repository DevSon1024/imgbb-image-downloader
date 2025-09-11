// server.js - v2.4 (Added Proxy Support for Downloads)
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

// --- 1. ADD YOUR PROXIES HERE ---
// Format: 'username:password@host:port' or 'host:port'
const proxies = [
    'user1:pass1@proxy.example.com:8080',
    'user2:pass2@proxy.example.com:8081',
    // Add as many proxies as you have
];

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


// --- Helper Functions ---

/**
 * Parses a proxy string into an object axios can use.
 * @param {string} proxyString - The proxy string (e.g., 'user:pass@host:port').
 * @returns {object} An axios-compatible proxy object.
 */
function parseProxy(proxyString) {
    if (!proxyString) return null;
    const parts = proxyString.split('@');
    const credentials = parts.length > 1 ? parts[0].split(':') : null;
    const server = (parts.length > 1 ? parts[1] : parts[0]).split(':');

    const proxyConfig = {
        protocol: 'http', // Change to 'https' if your proxy requires it
        host: server[0],
        port: parseInt(server[1], 10),
    };

    if (credentials) {
        proxyConfig.auth = {
            username: credentials[0],
            password: credentials[1],
        };
    }
    return proxyConfig;
}


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

    // --- 2. RANDOMLY SELECT A PROXY ---
    const randomProxyString = proxies[Math.floor(Math.random() * proxies.length)];
    const proxy = parseProxy(randomProxyString);
    
    const proxyMessage = proxy ? `via ${proxy.host}` : 'directly';
    socket.emit('status', { message: `📥 Downloading ${path.basename(filePath)} ${proxyMessage}...`, type: 'info', url: originalUrl });

    try {
        // --- 3. CONFIGURE AXIOS TO USE THE PROXY ---
        const axiosConfig = {
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            proxy: proxy, // Use the selected proxy
        };

        const response = await axios(axiosConfig);
        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        const writer = fs.createWriteStream(filePath);
        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (totalLength) {
                const progress = Math.round((downloadedLength / totalLength) * 100);
                socket.emit('download_progress', { url: originalUrl, progress });
            }
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
        const errorMessage = `❌ Error downloading image: ${e.message}. ` + (proxy ? `(Proxy: ${proxy.host})` : '');
        socket.emit('status', { message: errorMessage, type: 'error' });
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
            // downloadImage will now handle the proxy logic internally
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

            if (proxies.length === 0) {
                socket.emit('status', { message: '⚠️ Warning: No proxies configured. Downloads may fail.', type: 'error' });
            }

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