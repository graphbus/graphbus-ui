// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises; // async file I/O — never blocks the Electron main-process event loop
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const PythonBridge = require('./python_bridge');
const ClaudeService = require('./claude_service');

// Timeout for git and GitHub CLI operations.
// git push and gh pr create are network calls and can hang indefinitely if:
//   - The remote is unreachable or slow (TCP timeout is OS-level, often 2+ min)
//   - SSH auth requires an interactive passphrase prompt
//   - GitHub rate-limiting holds the connection open
// Without a timeout, a stuck IPC handler blocks the entire Electron main-process
// event loop, freezing the UI with no recovery path short of killing the app.
// 60 s is generous for a push/PR creation on a reasonable connection; local-only
// operations (git add, git checkout -b) complete in well under a second but
// share the same constant for simplicity.
const GIT_TIMEOUT_MS = 60_000;

let mainWindow;
let pythonBridge;
let claudeService;

// Parse working directory from command line arguments
// Supports: npm start -- /path/to/dir  OR  npm start -- --dir=/path/to/dir
function parseWorkingDirectory() {
    const args = process.argv.slice(2); // Skip electron and main.js paths

    for (const arg of args) {
        // Check for --dir=/path/to/dir format
        if (arg.startsWith('--dir=')) {
            const dir = arg.substring(6);
            if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                return path.resolve(dir);
            } else {
                console.error(`Warning: Directory does not exist: ${dir}`);
            }
        }
        // Check for positional argument (path without --)
        else if (!arg.startsWith('-')) {
            if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
                return path.resolve(arg);
            } else {
                console.error(`Warning: Directory does not exist: ${arg}`);
            }
        }
    }

    // Default to current working directory
    return process.cwd();
}

let workingDirectory = parseWorkingDirectory();

// Config file path
const configDir = path.join(os.homedir(), '.graphbus');
const configFile = path.join(configDir, 'claude_config.json');

// Ensure config directory exists
function ensureConfigDir() {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
}

// Load API key from config file or environment variable
function loadApiKey() {
    // First, check environment variable
    if (process.env.ANTHROPIC_API_KEY) {
        console.log('Loaded API key from ANTHROPIC_API_KEY environment variable');
        return process.env.ANTHROPIC_API_KEY;
    }

    // Second, check config file
    try {
        if (fs.existsSync(configFile)) {
            const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            if (config.apiKey) {
                console.log('Loaded API key from', configFile);
                return config.apiKey;
            }
        }
    } catch (error) {
        console.error('Error loading config file:', error);
    }

    return null;
}

// Save API key to config file
function saveApiKey(apiKey) {
    try {
        ensureConfigDir();
        const config = { apiKey };
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
        console.log('API key saved to', configFile);
        return true;
    } catch (error) {
        console.error('Error saving API key:', error);
        return false;
    }
}

// Delete API key from config file
function deleteApiKey() {
    try {
        if (fs.existsSync(configFile)) {
            fs.unlinkSync(configFile);
            console.log('API key deleted from', configFile);
        }
        return true;
    } catch (error) {
        console.error('Error deleting API key:', error);
        return false;
    }
}

function createApplicationMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        // App menu (macOS only)
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),

        // File menu
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Project...',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu:new-project');
                    }
                },
                {
                    label: 'Open Project...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        mainWindow.webContents.send('menu:open-project');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Change Working Directory...',
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: () => {
                        mainWindow.webContents.send('menu:change-directory');
                    }
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },

        // Edit menu
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(isMac ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                ] : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
            ]
        },

        // View menu
        {
            label: 'View',
            submenu: [
                {
                    label: 'Agent Graph',
                    accelerator: 'CmdOrCtrl+1',
                    click: () => {
                        mainWindow.webContents.send('menu:switch-view', 'graph');
                    }
                },
                {
                    label: 'Conversation',
                    accelerator: 'CmdOrCtrl+2',
                    click: () => {
                        mainWindow.webContents.send('menu:switch-view', 'conversation');
                    }
                },
                {
                    label: 'System State',
                    accelerator: 'CmdOrCtrl+3',
                    click: () => {
                        mainWindow.webContents.send('menu:switch-view', 'state');
                    }
                },
                {
                    label: 'Settings',
                    accelerator: 'CmdOrCtrl+4',
                    click: () => {
                        mainWindow.webContents.send('menu:switch-view', 'settings');
                    }
                },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },

        // GraphBus menu
        {
            label: 'GraphBus',
            submenu: [
                {
                    label: 'Build Agents',
                    accelerator: 'CmdOrCtrl+B',
                    click: () => {
                        mainWindow.webContents.send('menu:build-agents');
                    }
                },
                {
                    label: 'Run Negotiation...',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        mainWindow.webContents.send('menu:negotiate');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Start Runtime',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.webContents.send('menu:start-runtime');
                    }
                },
                {
                    label: 'Stop Runtime',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        mainWindow.webContents.send('menu:stop-runtime');
                    }
                }
            ]
        },

        // Window menu
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close' }
                ])
            ]
        },

        // Help menu
        {
            role: 'help',
            submenu: [
                {
                    label: 'GraphBus Documentation',
                    click: async () => {
                        await shell.openExternal('https://github.com/graphbus/graphbus-core');
                    }
                },
                {
                    label: 'Report Issue',
                    click: async () => {
                        await shell.openExternal('https://github.com/graphbus/graphbus-ui/issues');
                    }
                },
                { type: 'separator' },
                {
                    label: 'About GraphBus UI',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About GraphBus UI',
                            message: 'GraphBus UI',
                            detail: `Version: 1.0.0\n\nAgent orchestration and development platform\n\n© 2024 GraphBus`
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 800,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#1a1a1a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Create application menu
    createApplicationMenu();

    mainWindow.loadFile('index.html');

    // Open DevTools in development
    if (process.argv.includes('--enable-logging')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (pythonBridge) {
            pythonBridge.cleanup();
        }
    });
}

app.whenReady().then(() => {
    // Initialize Python bridge
    pythonBridge = new PythonBridge();

    // Initialize Claude service
    claudeService = new ClaudeService();

    // Try to auto-load API key
    const apiKey = loadApiKey();
    if (apiKey) {
        try {
            claudeService.initialize(apiKey, workingDirectory);
            console.log('Claude initialized automatically with saved API key');
        } catch (error) {
            console.error('Failed to initialize Claude with saved API key:', error);
        }
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC handlers for Python bridge

ipcMain.handle('python:execute', async (event, code) => {
    try {
        const result = await pythonBridge.execute(code);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Shell command execution
//
// Two limits added here that the original lacked:
//
//   timeout: 300_000 (5 min) — Without this, a hung graphbus command
//     (e.g. 'graphbus negotiate' with a bad API key that never returns, or
//     'graphbus run' waiting for stdin) blocks the Electron main process
//     forever, freezing the entire UI.  Five minutes is generous for any
//     finite CLI operation; use the streaming variant for long-running daemons.
//     Note: graphbus:build already worked around this with a manual
//     Promise.race timeout — this replaces that pattern with the exec-native
//     option so the subprocess is actually killed rather than just abandoned.
//
//   maxBuffer: 10 * 1024 * 1024 (10 MB) — The default is 1 MB. graphbus
//     negotiate can emit full LLM agent responses for every round, easily
//     overflowing 1 MB and throwing 'stdout maxBuffer exceeded', which looks
//     like a crash rather than an output-size issue.
ipcMain.handle('system:run-command', async (event, command) => {
    try {
        // Execute command in working directory
        const { stdout, stderr } = await execAsync(command, {
            cwd: workingDirectory,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            timeout: 300_000,          // 5-minute hard cap; kills the subprocess on expiry
            maxBuffer: 10 * 1024 * 1024, // 10 MB — negotiation output can be large
        });

        return {
            success: true,
            result: { stdout, stderr }
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            stderr: error.stderr,
            stdout: error.stdout
        };
    }
});

// Streaming command execution for real-time output
ipcMain.handle('system:run-command-streaming', async (event, command) => {
    return new Promise((resolve) => {
        // Spawn process with unbuffered output
        const proc = spawn(command, {
            cwd: workingDirectory,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            shell: true
        });

        let stdoutData = '';
        let stderrData = '';

        // Stream stdout line by line
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdoutData += text;

            // Send each line immediately to renderer
            const lines = text.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                event.sender.send('command-output', { type: 'stdout', line });
            });
        });

        // Stream stderr line by line
        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderrData += text;

            // Send each line immediately to renderer
            const lines = text.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                event.sender.send('command-output', { type: 'stderr', line });
            });
        });

        // Handle process completion
        proc.on('close', (code) => {
            // Send completion event
            event.sender.send('command-complete', { code });

            resolve({
                success: code === 0,
                result: { stdout: stdoutData, stderr: stderrData },
                error: code !== 0 ? `Command exited with code ${code}` : null
            });
        });

        // Handle errors
        proc.on('error', (error) => {
            event.sender.send('command-error', { error: error.message });

            resolve({
                success: false,
                error: error.message
            });
        });
    });
});

ipcMain.handle('graphbus:build', async (event, config) => {
    try {
        console.log('Building agents with config:', config);

        // Race the build against a 30 s deadline.
        //
        // The timer reference is saved so we can cancel it the moment the build
        // finishes (success or non-timeout error) — without clearTimeout(), the
        // 30 s countdown kept ticking as a leaked timer after every successful
        // build, holding a Node.js handle unnecessarily.  .unref() is a safety
        // net: if the timer somehow survives until Electron tries to quit, it
        // won't block the process from exiting.
        //
        // Note: the timeout only rejects the outer Promise — the underlying
        // PythonShell subprocess is NOT killed when it fires (python-shell's
        // runString() static API provides no cancellation handle).  A timed-out
        // build will continue in the background until Python finishes or the
        // Electron window is closed.
        let timeoutId;
        const buildPromise = pythonBridge.buildAgents(config);
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error('Build timeout after 30 seconds')),
                30_000
            ).unref();
        });

        let result;
        try {
            result = await Promise.race([buildPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId); // cancel timer whether build succeeded, failed, or timed out
        }

        console.log('Build result:', result);
        return { success: true, result };
    } catch (error) {
        console.error('Build error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:start-runtime', async (event, config) => {
    try {
        const result = await pythonBridge.startRuntime(config);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:stop-runtime', async (event) => {
    try {
        const result = await pythonBridge.stopRuntime();
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:call-method', async (event, agent, method, args) => {
    try {
        const result = await pythonBridge.callMethod(agent, method, args);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:publish-event', async (event, topic, payload) => {
    try {
        const result = await pythonBridge.publishEvent(topic, payload);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:get-stats', async (event) => {
    try {
        const result = await pythonBridge.getStats();
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Transform the raw graph.json structure into the shape the UI expects.
//
// graph.json stores edges as { src, dst } and nests agent metadata under
// node.data, but the renderer expects { source, target } and a flat node
// object.  This conversion was previously duplicated verbatim in both the
// graphbus:load-graph and graphbus:rehydrate-state handlers — a single
// schema change (e.g. adding a 'dependencies' field) would have required
// two independent edits.  Centralising it here means both handlers stay
// in sync automatically.
function transformGraphData(graphData) {
    return {
        nodes: graphData.nodes.map(node => ({
            id: node.name,
            name: node.name,
            module: node.data.module,
            class_name: node.data.class_name,
            methods: node.data.methods || [],
            subscriptions: node.data.subscriptions || [],
        })),
        edges: graphData.edges.map(edge => ({
            source: edge.src,  // graph.json uses 'src', not 'source'
            target: edge.dst,  // graph.json uses 'dst', not 'target'
            type: edge.data?.edge_type || 'depends_on',
        })),
    };
}

ipcMain.handle('graphbus:load-graph', async (event, artifactsDir) => {
    try {
        // Read graph.json directly - much simpler than Python bridge
        const graphJsonPath = path.join(artifactsDir, 'graph.json');

        if (!fs.existsSync(graphJsonPath)) {
            return { success: false, error: 'graph.json not found in artifacts directory' };
        }

        const graphData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));

        return {
            success: true,
            result: {
                ...transformGraphData(graphData),
                topics: [] // topics.json is loaded separately in rehydrate-state
            }
        };
    } catch (error) {
        console.error('Error loading graph.json:', error);
        return { success: false, error: error.message };
    }
});

// Rehydrate full state from .graphbus folder
ipcMain.handle('graphbus:rehydrate-state', async (event, workingDirectory) => {
    try {
        const graphbusDir = path.join(workingDirectory, '.graphbus');

        if (!fs.existsSync(graphbusDir)) {
            return { success: false, error: '.graphbus directory not found' };
        }

        // Helper: return parsed JSON for <dir>/<filename>, or null if absent.
        // Centralises the exists-read-parse triple that was previously repeated
        // verbatim for every artifact file, making it easy to add new files later.
        const loadJson = (filename) => {
            const filePath = path.join(graphbusDir, filename);
            return fs.existsSync(filePath)
                ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
                : null;
        };

        const state = {
            hasGraphbus: true,
            graph: null,
            buildSummary:        loadJson('build_summary.json'),
            conversationHistory: loadJson('conversation_history.json'),
            negotiations:        loadJson('negotiations.json'),
            modifiedFiles:       loadJson('modified_files.json'),
            agents:              loadJson('agents.json'),
            topics:              loadJson('topics.json'),
        };

        // graph.json needs an additional shape transform — see transformGraphData().
        const graphData = loadJson('graph.json');
        if (graphData) {
            state.graph = transformGraphData(graphData);
        }

        return { success: true, result: state };
    } catch (error) {
        console.error('Error rehydrating state:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('graphbus:list-agents', async (event) => {
    try {
        const result = await pythonBridge.listAgents();
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// System directory operations
ipcMain.handle('system:get-cwd', async (event) => {
    return { success: true, result: workingDirectory };
});

// Conversation persistence
ipcMain.handle('conversation:save', async (event, conversationData) => {
    try {
        const conversationDir = path.join(workingDirectory, '.graphbus');
        const conversationFile = path.join(conversationDir, 'conversation_history.json');

        // mkdir({ recursive: true }) is idempotent — no existsSync needed, and
        // the await ensures the directory is present before we write.
        await fsp.mkdir(conversationDir, { recursive: true });

        const data = {
            timestamp: new Date().toISOString(),
            workingDirectory: workingDirectory,
            messages: conversationData
        };

        // Async write: never blocks the Electron main-process event loop.
        // Conversation files can exceed 100 KB after a long session; writeFileSync
        // on a file that size would freeze the UI for a perceptible moment.
        await fsp.writeFile(conversationFile, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error saving conversation:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('conversation:load', async (event) => {
    try {
        const conversationFile = path.join(workingDirectory, '.graphbus', 'conversation_history.json');

        // Try to read directly; catch ENOENT instead of existsSync + readFileSync.
        // existsSync + readFileSync is a TOCTOU race: the file could be deleted
        // between the check and the read.  The try/catch approach is atomic.
        let raw;
        try {
            raw = await fsp.readFile(conversationFile, 'utf-8');
        } catch (e) {
            if (e.code === 'ENOENT') return { success: true, result: null };
            throw e; // unexpected error — re-throw to the outer catch
        }
        const data = JSON.parse(raw);
        return { success: true, result: data };
    } catch (error) {
        console.error('Error loading conversation:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('conversation:clear', async (event) => {
    try {
        const conversationFile = path.join(workingDirectory, '.graphbus', 'conversation_history.json');

        // Attempt unlink; silently ignore ENOENT (nothing to delete is fine).
        try {
            await fsp.unlink(conversationFile);
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        return { success: true };
    } catch (error) {
        console.error('Error clearing conversation:', error);
        return { success: false, error: error.message };
    }
});

// Git and GitHub integration
//
// All three handlers below use execFile (not exec) so arguments are passed as
// an array rather than interpolated into a shell command string.  exec() runs
// the command through /bin/sh, so a branch name like "feat/$(rm -rf ~)" or a
// commit message containing a double-quote would break the command or run
// arbitrary code in the Electron main process.  execFile() bypasses the shell
// entirely — the argument array is handed directly to the OS, so no shell
// metacharacters are interpreted.
ipcMain.handle('git:create-branch', async (event, branchName) => {
    try {
        // execFile (not exec) so branchName is never interpolated into a shell
        // command string — a name containing shell metacharacters can't inject.
        await execFileAsync('git', ['checkout', '-b', branchName], {
            cwd: workingDirectory,
            timeout: GIT_TIMEOUT_MS,
        });

        return { success: true, branch: branchName };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('git:commit-and-push', async (event, message, branchName) => {
    try {
        await execFileAsync('git', ['add', '.'], {
            cwd: workingDirectory,
            timeout: GIT_TIMEOUT_MS,
        });
        await execFileAsync('git', ['commit', '-m', message], {
            cwd: workingDirectory,
            timeout: GIT_TIMEOUT_MS,
        });
        // push is a network call — the timeout here is the primary safety net
        // against a hung connection freezing the Electron main-process event loop.
        await execFileAsync('git', ['push', '-u', 'origin', branchName], {
            cwd: workingDirectory,
            timeout: GIT_TIMEOUT_MS,
        });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('github:create-pr', async (event, title, body, branchName) => {
    try {
        const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'create', '--title', title, '--body', body, '--head', branchName],
            { cwd: workingDirectory, timeout: GIT_TIMEOUT_MS }
        );

        // Extract PR URL from output
        const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
        const prUrl = urlMatch ? urlMatch[0] : null;

        // Extract PR number
        const prNumberMatch = prUrl ? prUrl.match(/\/pull\/(\d+)/) : null;
        const prNumber = prNumberMatch ? parseInt(prNumberMatch[1]) : null;

        return { success: true, url: prUrl, number: prNumber };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('github:get-pr-comments', async (event, prNumber) => {
    try {
        // Use execFile (not exec) for the same reason documented on git:create-branch
        // above: prNumber comes from the renderer process, so interpolating it into a
        // shell command string would allow arbitrary command injection
        // (e.g. prNumber = "1; rm -rf ~").  execFile passes arguments directly to the
        // OS without a shell, so metacharacters in prNumber are never interpreted.
        const { stdout } = await execFileAsync(
            'gh',
            [
                'pr', 'view', String(prNumber),
                '--json', 'comments',
                '--jq', '.comments[] | {author: .author.login, body: .body, createdAt: .createdAt}',
            ],
            { cwd: workingDirectory, timeout: GIT_TIMEOUT_MS }
        );

        const comments = stdout.trim().split('\n').filter(line => line).map(line => JSON.parse(line));

        return { success: true, comments };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pr:save-tracking', async (event, prData) => {
    try {
        const graphbusDir = path.join(workingDirectory, '.graphbus');
        const trackingFile = path.join(graphbusDir, 'pr_tracking.json');

        // Read existing tracking data asynchronously.  Fall back to empty list
        // on ENOENT (first PR tracked in this directory).
        let tracking = { prs: [] };
        try {
            const raw = await fsp.readFile(trackingFile, 'utf-8');
            tracking = JSON.parse(raw);
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }

        tracking.prs.push({ ...prData, timestamp: Date.now() });

        await fsp.mkdir(graphbusDir, { recursive: true });
        await fsp.writeFile(trackingFile, JSON.stringify(tracking, null, 2));

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pr:load-tracking', async (event) => {
    try {
        const trackingFile = path.join(workingDirectory, '.graphbus', 'pr_tracking.json');

        let raw;
        try {
            raw = await fsp.readFile(trackingFile, 'utf-8');
        } catch (e) {
            if (e.code === 'ENOENT') return { success: true, result: { prs: [] } };
            throw e;
        }
        const data = JSON.parse(raw);
        return { success: true, result: data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('system:set-cwd', async (event, newPath) => {
    try {
        // Validate path exists
        if (!fs.existsSync(newPath)) {
            return { success: false, error: 'Directory does not exist' };
        }

        const stats = fs.statSync(newPath);
        if (!stats.isDirectory()) {
            return { success: false, error: 'Path is not a directory' };
        }

        workingDirectory = newPath;
        return { success: true, result: workingDirectory };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('system:browse-directory', async (event) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            defaultPath: workingDirectory,
            title: 'Select Working Directory'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Cancelled' };
        }

        workingDirectory = result.filePaths[0];
        return { success: true, result: workingDirectory };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Claude AI operations
ipcMain.handle('claude:initialize', async (event, apiKey, shouldSave = true) => {
    try {
        claudeService.initialize(apiKey, workingDirectory);

        // Save API key to config file if requested (don't validate yet, will fail on first actual use)
        if (shouldSave) {
            const saved = saveApiKey(apiKey);
            if (saved) {
                console.log('API key saved to config file');
            }
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('claude:chat', async (event, message, systemState) => {
    try {
        if (!claudeService.isInitialized()) {
            return { success: false, error: 'Claude not initialized' };
        }

        const response = await claudeService.chat(message, systemState);
        return { success: true, result: response };
    } catch (error) {
        console.error('Claude chat error:', error);

        // Check if it's an authentication error
        if (error.message && (error.message.includes('401') || error.message.includes('authentication') || error.message.includes('API key'))) {
            // Delete the invalid config
            deleteApiKey();
            return { success: false, error: 'Invalid API key - please reconfigure in Settings', needsReconfigure: true };
        }

        return { success: false, error: error.message };
    }
});

ipcMain.handle('claude:add-system-message', async (event, message) => {
    try {
        if (claudeService.isInitialized()) {
            claudeService.addSystemMessage(message);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('claude:is-initialized', async (event) => {
    return { success: true, result: claudeService.isInitialized() };
});

ipcMain.handle('claude:update-directory', async (event, directory) => {
    try {
        if (claudeService.isInitialized()) {
            claudeService.updateWorkingDirectory(directory);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('claude:delete-config', async (event) => {
    try {
        const deleted = deleteApiKey();
        return { success: deleted };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

console.log('GraphBus UI - Electron main process started');
console.log('Working directory:', workingDirectory);
