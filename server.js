// server.js - v1.5 (Optimized Puppeteer Version)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const axios = require('axios');
const figlet = require('figlet');
const chalk = require('chalk'); // Ensure you are using v4
const pLimit = require('p-limit'); // For concurrency

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const downloadFolder = path.join(__dirname, 'Downloads');
const urlLogFile = path.join(__dirname, 'downloaded_urls.txt');

// Create download folder if it doesn't exist
if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder);
}

// --- Middleware ---
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
        const message = `📝 Saved URL to log: ${downloadUrl}`;
        socket.emit('status', { message, type: 'info' });
    } catch (e) {
        const message = `❌ Error saving URL: ${e.message}`;
        socket.emit('status', { message, type: 'error' });
    }
}

async function downloadImage(downloadUrl, originalUrl, socket) {
    const fileName = extractFileName(originalUrl, downloadUrl);
    let filePath = path.join(downloadFolder, fileName);
    filePath = getUniqueFileName(filePath);
    
    const downloadMessage = `📥 Downloading: ${path.basename(filePath)}...`;
    socket.emit('status', { message: downloadMessage, type: 'info', url: originalUrl });

    try {
        const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const successMessage = `✅ Image saved: ${filePath}`;
                socket.emit('status', { message: successMessage, type: 'success' });
                resolve();
            });
            writer.on('error', (err) => {
                 const errorMessage = `❌ Download failed: ${err.message}`;
                 socket.emit('status', { message: errorMessage, type: 'error' });
                 reject(err);
            });
        });
    } catch (e) {
        const errorMessage = `❌ Error downloading image: ${e.message}`;
        socket.emit('status', { message: errorMessage, type: 'error' });
    }
}

// --- OPTIMIZED SCRAPING FUNCTION ---
// Now accepts the shared browser instance
async function scrapeAndDownload(imageUrl, browser, socket) {
    const statusMessage = `🚀 Processing: ${imageUrl}`;
    socket.emit('status', { message: statusMessage, url: imageUrl, type: 'info' });

    let page = null;
    try {
        // Create a new page in the existing browser, much faster than launching
        page = await browser.newPage();

        // **OPTIMIZATION**: Block unnecessary resources like images and CSS
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['stylesheet', 'font', 'image'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(imageUrl, { waitUntil: 'domcontentloaded' }); // Faster wait condition

        const downloadSelector = 'a.btn.btn-download.default';
        await page.waitForSelector(downloadSelector, { timeout: 15000 });
        const downloadLink = await page.$eval(downloadSelector, (el) => el.href);

        if (downloadLink) {
            const foundMessage = `✅ Found link: ${downloadLink}`;
            socket.emit('status', { message: foundMessage, type: 'info' });
            saveUrlWithTime(downloadLink, socket);
            await downloadImage(downloadLink, imageUrl, socket);
        } else {
             const notFoundMessage = '❌ No download link found!';
             socket.emit('status', { message: notFoundMessage, type: 'error' });
        }
    } catch (e) {
        const errorMessage = `❌ Error scraping ${imageUrl}: ${e.message}`;
        socket.emit('status', { message: errorMessage, type: 'error' });
    } finally {
        // Close only the page, not the entire browser
        if (page) {
            await page.close();
        }
    }
}

// --- WebSocket and API Logic ---
io.on('connection', (socket) => {
    console.log(chalk.blue('A user connected via WebSocket'));

    socket.on('start-download', async ({ urls }) => {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return socket.emit('status', { message: 'No URLs provided.', type: 'error'});
        }

        // **OPTIMIZATION**: Launch one browser instance for all tasks
        const browser = await puppeteer.launch({ headless: true });
        
        // **OPTIMIZATION**: Limit concurrency to 5 browsers at a time
        const limit = pLimit(5);
        
        const tasks = urls.map(url => {
            const trimmedUrl = url.trim();
            if (trimmedUrl.startsWith('https://ibb.co/')) {
                // Pass the shared browser instance to the scraping function
                return limit(() => scrapeAndDownload(trimmedUrl, browser, socket));
            } else {
                const invalidMessage = `❌ Invalid URL skipped: ${trimmedUrl}`;
                socket.emit('status', { message: invalidMessage, type: 'error' });
                return Promise.resolve();
            }
        });

        // Wait for all concurrent tasks to finish
        await Promise.all(tasks);
        
        // Close the single browser instance after everything is done
        await browser.close();

        socket.emit('status', { message: '🎉 All tasks complete!', type: 'final' });
    });

    socket.on('disconnect', () => {
        console.log(chalk.yellow('User disconnected'));
    });
});


// --- Start Server ---
server.listen(PORT, () => {
    // console.log(chalk.blue(figlet.textSync('IMGbb DL Node', { font: 'Slant' })));
    console.log(chalk.yellow(`Server running at http://localhost:${PORT}`));
});