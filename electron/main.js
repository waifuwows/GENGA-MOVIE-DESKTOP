const { app, BrowserWindow, screen, session, utilityProcess } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess;
let nodeBridgeProcess;

function startNodeBridge() {
    if (nodeBridgeProcess && !nodeBridgeProcess.killed) {
        return;
    }

    const isPackaged = app.isPackaged;
    const logPath = path.join(require('os').homedir(), 'genga_electron_bridge.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    
    function bridgeLog(m) {
        const entry = `[${new Date().toISOString()}] ${m}\n`;
        console.log(entry.trim());
        logStream.write(entry);
    }

    bridgeLog(`--- Starting Node Bridge (Packaged: ${isPackaged}) ---`);

    // Path resolution
    let bridgePath;
    if (isPackaged) {
        bridgePath = path.join(process.resourcesPath, 'app.asar', 'node-bridge.js');
        if (!fs.existsSync(bridgePath)) {
            bridgePath = path.join(app.getAppPath(), 'node-bridge.js');
        }
    } else {
        bridgePath = path.join(__dirname, '..', 'node-bridge.js');
    }

    bridgeLog(`Selected Bridge Path: ${bridgePath}`);

    if (!fs.existsSync(bridgePath)) {
        bridgeLog(`CRITICAL ERROR: Node bridge script NOT FOUND at ${bridgePath}`);
        return;
    }

    try {
        if (!isPackaged) {
            bridgeLog(`Starting bridge via spawn for development: ${bridgePath}`);
            nodeBridgeProcess = spawn('node', [bridgePath], {
                cwd: path.dirname(bridgePath),
                stdio: 'pipe',
                env: { ...process.env, NODE_ENV: 'development' }
            });

            nodeBridgeProcess.stdout.on('data', (data) => bridgeLog(`[BRIDGE] ${data.toString()}`));
            nodeBridgeProcess.stderr.on('data', (data) => bridgeLog(`[BRIDGE ERROR] ${data.toString()}`));
            nodeBridgeProcess.on('exit', (code) => {
                bridgeLog(`Bridge spawned process exited with code ${code}.`);
                if (code !== 0 && code !== null) setTimeout(startNodeBridge, 5000);
            });
            return;
        }

        bridgeLog(`Forking utilityProcess: ${bridgePath}`);
        nodeBridgeProcess = utilityProcess.fork(bridgePath, [], {
            cwd: process.resourcesPath,
            stdio: 'pipe',
            env: { 
                ...process.env,
                NODE_ENV: 'production'
            }
        });

        nodeBridgeProcess.on('spawn', () => {
            bridgeLog(`SUCCESS: Bridge utilityProcess spawned.`);
        });

        nodeBridgeProcess.stdout.on('data', (data) => {
            bridgeLog(`[BRIDGE] ${data.toString()}`);
        });

        nodeBridgeProcess.stderr.on('data', (data) => {
            bridgeLog(`[BRIDGE ERROR] ${data.toString()}`);
        });

        nodeBridgeProcess.on('message', (msg) => {
            bridgeLog(`[BRIDGE MSG] ${JSON.stringify(msg)}`);
        });

        nodeBridgeProcess.on('exit', (code) => {
            bridgeLog(`Bridge exited with code ${code}.`);
            if (code !== 0 && code !== null) {
                bridgeLog('Restarting in 5s...');
                setTimeout(startNodeBridge, 5000);
            }
        });

        nodeBridgeProcess.on('error', (err) => {
            bridgeLog(`CRITICAL Bridge error: ${err.message}`);
        });

    } catch (err) {
        bridgeLog(`CRITICAL: Failed to start bridge: ${err.message}`);
    }
}

function startBackend() {
    console.log('Starting Genga Movie backend...');

    const isPackaged = app.isPackaged;
    const backendDir = isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(__dirname, '..');
    const executablePath = isPackaged ? path.join(backendDir, 'backend.exe') : 'python';
    const finalArgs = isPackaged ? [] : ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'];

    const fs = require('fs');
    if (isPackaged && !fs.existsSync(executablePath)) {
        console.error(`CRITICAL: Backend NOT FOUND at ${executablePath}`);
        return;
    }

    console.log(`Executable: ${executablePath}`);
    console.log(`CWD: ${backendDir}`);

    // Use a more robust spawn configuration for Windows
    const spawnOptions = {
        cwd: backendDir,
        shell: false, // Shell: true with CMD causes ENOENT if path is weird
        windowsHide: true,
        env: { ...process.env, PYTHONNOUSERSITE: '1' }
    };

    backendProcess = spawn(executablePath, finalArgs, spawnOptions);

    const logPath = path.join(require('os').homedir(), 'genga_electron_backend.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    backendProcess.stdout.on('data', (data) => {
        const msg = `Backend: ${data}`;
        console.log(msg);
        logStream.write(msg + '\n');
    });

    backendProcess.stderr.on('data', (data) => {
        const msg = `Backend Error: ${data}`;
        console.error(msg);
        logStream.write(msg + '\n');
    });

    backendProcess.on('close', (code) => {
        const msg = `Backend process exited with code ${code}`;
        console.log(msg);
        logStream.write(msg + '\n');
    });
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: Math.min(1400, width),
        height: Math.min(900, height),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // Required for YouTube IFrame API to work with file:// origin
            allowRunningInsecureContent: true
        },
        title: "Genga Movie",
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        icon: path.join(__dirname, '..', 'frontend', 'public', 'favicon.png')
    });

    // In development, we point to the Vite dev server
    // In production, we load the built index.html from dist-frontend
    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist-frontend', 'index.html')).catch((err) => {
            console.error('Failed to load production index.html:', err);
        });
    } else {
        const devUrl = 'http://localhost:5173';
        mainWindow.loadURL(devUrl).catch(() => {
            console.log('Vite dev server not ready, retrying in 2s...');
            setTimeout(() => mainWindow.loadURL(devUrl), 2000);
        });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // FIX for YouTube Errors (150, 152, 153): Standard Mirror Interceptor (v1.1.0)
    // Set a global high-quality User-Agent for the entire session
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    session.defaultSession.setUserAgent(userAgent);

    const filter = {
        urls: [
            '*://*.youtube.com/*',
            '*://*.youtube-nocookie.com/*',
            '*://*.googlevideo.com/*',
            '*://*.ytimg.com/*',
            '*://*.google.com/*',
            '*://*.gstatic.com/*',
            '*://*.doubleclick.net/*',
            '*://*.googleusercontent.com/*',
            '*://*.ggpht.com/*'
        ]
    };

    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        const url = details.url.toLowerCase();
        const isYT = url.includes('youtube') || url.includes('googlevideo') || url.includes('ytimg');

        if (isYT) {
            // WHITESPACE AND REFERER REFINEMENT
            // Using a high-trust Referer/Origin pair for broad embed support
            details.requestHeaders['Referer'] = 'https://fmoviesunblocked.net/';
            details.requestHeaders['Origin'] = 'https://h5.aoneroom.com';

            if (details.resourceType === 'subFrame') {
                details.requestHeaders['Sec-Fetch-Site'] = 'cross-site';
                details.requestHeaders['Sec-Fetch-Mode'] = 'navigate';
                details.requestHeaders['Sec-Fetch-Dest'] = 'iframe';
                details.requestHeaders['Sec-Fetch-User'] = '?1';
            }
        }
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };

        // Strip all embedding and security restrictions
        const headersToStrip = [
            'x-frame-options',
            'content-security-policy',
            'frame-options',
            'x-content-security-policy',
            'cross-origin-embedder-policy',
            'cross-origin-opener-policy',
            'cross-origin-resource-policy'
        ];

        Object.keys(responseHeaders).forEach(header => {
            if (headersToStrip.includes(header.toLowerCase())) {
                delete responseHeaders[header];
            }
        });

        // Add Allow-Origin/CORS for wide compatibility (Crucial for YouTube scripts)
        // Clear existing ones to avoid "multiple values" errors
        delete responseHeaders['access-control-allow-origin'];
        delete responseHeaders['Access-Control-Allow-Origin'];
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        
        delete responseHeaders['access-control-allow-methods'];
        delete responseHeaders['Access-Control-Allow-Methods'];
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS, HEAD'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];

        callback({ cancel: false, responseHeaders });
    });

    startBackend();
    startNodeBridge();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (backendProcess) {
        console.log('Stopping Python backend...');
        if (process.platform === 'win32') {
            // Use absolute path for taskkill to avoid ENOENT
            const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
            try {
                spawn(taskkill, ['/pid', backendProcess.pid, '/f', '/t'], { shell: false });
            } catch (e) {
                backendProcess.kill();
            }
        } else {
            backendProcess.kill();
        }
    }
    if (nodeBridgeProcess) {
        console.log('Stopping Node Bridge...');
        nodeBridgeProcess.kill();
    }
});
