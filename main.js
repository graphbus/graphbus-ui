// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PythonBridge = require('./python_bridge');
const ClaudeService = require('./claude_service');
const InternalWebSocketServer = require('./internal_server');

let mainWindow;
let pythonBridge;
let claudeService;
let internalServer;

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
                        const { shell } = require('electron');
                        await shell.openExternal('https://github.com/graphbus/graphbus-core');
                    }
                },
                {
                    label: 'Report Issue',
                    click: async () => {
                        const { shell } = require('electron');
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

/**
 * Handle negotiation via WebSocket
 */
async function handleWebSocketNegotiation(data) {
    const { intent, rounds = 5, artifactsDir = '.graphbus' } = data;

    console.log(`[Negotiation] Starting WebSocket-based negotiation with intent: ${intent}`);

    if (!internalServer) {
        console.error('[Negotiation] Internal server not available');
        internalServer.broadcast({
            type: 'error',
            data: { message: 'Internal server not available' }
        });
        return;
    }

    // Send start message
    internalServer.broadcast({
        type: 'progress',
        data: {
            message: `🤝 Starting negotiation with intent: ${intent}`,
            current: 0,
            total: 100,
            percent: 0
        }
    });

    try {
        const { spawn } = require('child_process');

        // Run negotiation command
        const command = `graphbus negotiate ${artifactsDir} --intent "${intent}" --rounds ${rounds}`;
        console.log(`[Negotiation] Running: ${command}`);

        const proc = spawn('sh', ['-c', command], {
            cwd: workingDirectory,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdoutBuffer = '';
        let stderrBuffer = '';
        let answerBuffer = {}; // Store pending answers
        let questionIdCounter = 0;

        // Handle stdout
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdoutBuffer += text;
            console.log(`[Negotiation Output] ${text}`);

            // Broadcast progress/output to clients
            internalServer.broadcast({
                type: 'agent_message',
                data: {
                    agent: 'GraphBus',
                    text: text.trim(),
                    timestamp: Date.now()
                }
            });

            // Check for question patterns (basic pattern matching)
            checkForQuestions(text, stdoutBuffer);
        });

        // Handle stderr
        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderrBuffer += text;
            console.error(`[Negotiation Error] ${text}`);

            internalServer.broadcast({
                type: 'progress',
                data: { message: text.trim() }
            });
        });

        // Handle completion
        proc.on('close', (code) => {
            console.log(`[Negotiation] Process exited with code ${code}`);

            if (code === 0) {
                internalServer.broadcast({
                    type: 'result',
                    data: {
                        message: 'Negotiation completed successfully',
                        stdout: stdoutBuffer
                    }
                });
            } else {
                internalServer.broadcast({
                    type: 'error',
                    data: {
                        message: `Negotiation failed with code ${code}`,
                        stderr: stderrBuffer
                    }
                });
            }
        });

        // Process stdin for answers
        proc.stdin.on('ready', () => {
            console.log('[Negotiation] Process stdin ready');
        });

    } catch (error) {
        console.error('[Negotiation] Error:', error);
        internalServer.broadcast({
            type: 'error',
            data: { message: `Negotiation error: ${error.message}` }
        });
    }
}

/**
 * Check for question patterns in output and send as WebSocket messages
 */
function checkForQuestions(text, buffer) {
    // Simple question detection - looks for common patterns
    const questionPatterns = [
        /^(.+?)\?(?:\s|$)/m,  // Ends with ?
        /^(Select|Choose|Enter|Pick|Answer)\s*:\s*(.+?)$/m,  // Selection prompts
        /^\s*(y\/n|yes\/no)\s*\?/im  // Y/N questions
    ];

    for (const pattern of questionPatterns) {
        const match = buffer.match(pattern);
        if (match) {
            const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const questionText = match[1] || match[0];

            console.log(`[Negotiation] Detected question: ${questionText}`);

            internalServer.broadcast({
                type: 'question',
                data: {
                    question_id: questionId,
                    question: questionText,
                    context: 'Agent negotiation',
                    options: []
                }
            });

            // Clear buffer after sending question
            buffer = buffer.substring(match.index + match[0].length);
        }
    }
}

/**
 * Start the internal WebSocket server
 */
async function startInternalServer() {
    return new Promise((resolve) => {
        try {
            console.log('Starting internal WebSocket server...');
            internalServer = new InternalWebSocketServer(8765);

            internalServer.start()
                .then(() => {
                    console.log('✓ Internal WebSocket server started successfully');
                    resolve();
                })
                .catch((error) => {
                    console.error('Failed to start internal WebSocket server:', error);
                    resolve(); // Continue anyway
                });
        } catch (error) {
            console.error('Error initializing internal WebSocket server:', error);
            resolve(); // Continue anyway
        }
    });
}

app.whenReady().then(async () => {
    // Start internal WebSocket server
    await startInternalServer();

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

    // Set up internal server message handling
    if (internalServer) {
        internalServer.on('message', ({ ws, message }) => {
            // Handle messages from connected clients
            console.log(`[Main] Received message from client:`, message.type);

            // Process message based on type
            if (message.type === 'user_message') {
                // Forward to Claude or CLI
                handleUserMessage(message.data);
            } else if (message.type === 'negotiate') {
                // Run negotiation via WebSocket
                handleWebSocketNegotiation(message.data);
            } else if (message.type === 'answer') {
                // Handle answer from user
                const { question_id, answer } = message.data;
                console.log(`[Main] Received answer to question ${question_id}: ${answer}`);
                // This will be handled by the negotiation process
            }
        });
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

app.on('before-quit', async () => {
    // Clean up internal WebSocket server
    if (internalServer) {
        try {
            console.log('Stopping internal WebSocket server...');
            await internalServer.stop();
        } catch (error) {
            console.error('Error stopping internal WebSocket server:', error);
        }
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
ipcMain.handle('system:run-command', async (event, command) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Execute command in working directory
        const { stdout, stderr } = await execAsync(command, {
            cwd: workingDirectory,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
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

// Store active streaming process for stdin interaction
let activeStreamingProcess = null;

// Streaming command execution for real-time output
ipcMain.handle('system:run-command-streaming', async (event, command) => {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');

        // Spawn process with unbuffered output and stdin enabled
        const proc = spawn(command, {
            cwd: workingDirectory,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin, stdout, stderr
        });

        // Store process reference for stdin interaction
        activeStreamingProcess = proc;

        let stdoutData = '';
        let stderrData = '';
        let lastOutput = '';

        // Stream stdout line by line
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdoutData += text;
            lastOutput += text;

            // Send each line immediately to renderer
            const lines = text.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                event.sender.send('command-output', { type: 'stdout', line });

                // Detect interactive prompts
                if (line.match(/\(Enter \d+, \d+, or \d+\)|Choose|What's your preference|Select an option/i)) {
                    event.sender.send('command-prompt', { question: lastOutput });
                    lastOutput = ''; // Reset after detecting prompt
                }
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
            activeStreamingProcess = null;

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
            activeStreamingProcess = null;
            event.sender.send('command-error', { error: error.message });

            resolve({
                success: false,
                error: error.message
            });
        });
    });
});

// Send input to active streaming process
ipcMain.handle('system:send-stdin', async (event, input) => {
    if (activeStreamingProcess && activeStreamingProcess.stdin) {
        try {
            activeStreamingProcess.stdin.write(input + '\n');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    return { success: false, error: 'No active process' };
});

ipcMain.handle('graphbus:build', async (event, config) => {
    try {
        console.log('Building agents with config:', config);

        // Add timeout to prevent hanging
        const buildPromise = pythonBridge.buildAgents(config);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Build timeout after 30 seconds')), 30000)
        );

        const result = await Promise.race([buildPromise, timeoutPromise]);
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

ipcMain.handle('graphbus:load-graph', async (event, artifactsDir) => {
    try {
        // Read graph.json directly - much simpler than Python bridge
        const graphJsonPath = path.join(artifactsDir, 'graph.json');

        if (!fs.existsSync(graphJsonPath)) {
            return { success: false, error: 'graph.json not found in artifacts directory' };
        }

        const graphData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));

        // Transform to expected format for UI
        const nodes = graphData.nodes.map(node => ({
            id: node.name,
            name: node.name,
            module: node.data.module,
            class_name: node.data.class_name,
            methods: node.data.methods || [],
            subscriptions: node.data.subscriptions || []
        }));

        const edges = graphData.edges.map(edge => ({
            source: edge.src,  // graph.json uses 'src', not 'source'
            target: edge.dst,  // graph.json uses 'dst', not 'target'
            type: edge.data?.edge_type || 'depends_on'
        }));

        return {
            success: true,
            result: {
                nodes,
                edges,
                topics: [] // Can be loaded from topics.json if needed
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

        const state = {
            hasGraphbus: true,
            graph: null,
            buildSummary: null,
            conversationHistory: null,
            negotiations: null,
            modifiedFiles: null,
            agents: null,
            topics: null
        };

        // Load graph.json
        const graphPath = path.join(graphbusDir, 'graph.json');
        if (fs.existsSync(graphPath)) {
            const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
            state.graph = {
                nodes: graphData.nodes.map(node => ({
                    id: node.name,
                    name: node.name,
                    module: node.data.module,
                    class_name: node.data.class_name,
                    methods: node.data.methods || [],
                    subscriptions: node.data.subscriptions || []
                })),
                edges: graphData.edges.map(edge => ({
                    source: edge.src,  // graph.json uses 'src', not 'source'
                    target: edge.dst,  // graph.json uses 'dst', not 'target'
                    type: edge.data?.edge_type || 'depends_on'
                }))
            };
        }

        // Load build_summary.json
        const buildSummaryPath = path.join(graphbusDir, 'build_summary.json');
        if (fs.existsSync(buildSummaryPath)) {
            state.buildSummary = JSON.parse(fs.readFileSync(buildSummaryPath, 'utf-8'));
        }

        // Load conversation_history.json
        const conversationPath = path.join(graphbusDir, 'conversation_history.json');
        if (fs.existsSync(conversationPath)) {
            state.conversationHistory = JSON.parse(fs.readFileSync(conversationPath, 'utf-8'));
        }

        // Load negotiations.json
        const negotiationsPath = path.join(graphbusDir, 'negotiations.json');
        if (fs.existsSync(negotiationsPath)) {
            state.negotiations = JSON.parse(fs.readFileSync(negotiationsPath, 'utf-8'));
        }

        // Load modified_files.json
        const modifiedFilesPath = path.join(graphbusDir, 'modified_files.json');
        if (fs.existsSync(modifiedFilesPath)) {
            state.modifiedFiles = JSON.parse(fs.readFileSync(modifiedFilesPath, 'utf-8'));
        }

        // Load agents.json
        const agentsPath = path.join(graphbusDir, 'agents.json');
        if (fs.existsSync(agentsPath)) {
            state.agents = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
        }

        // Load topics.json
        const topicsPath = path.join(graphbusDir, 'topics.json');
        if (fs.existsSync(topicsPath)) {
            state.topics = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));
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

        // Ensure .graphbus directory exists
        if (!fs.existsSync(conversationDir)) {
            fs.mkdirSync(conversationDir, { recursive: true });
        }

        // Save conversation with metadata
        const data = {
            timestamp: new Date().toISOString(),
            workingDirectory: workingDirectory,
            messages: conversationData
        };

        fs.writeFileSync(conversationFile, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        console.error('Error saving conversation:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('conversation:load', async (event) => {
    try {
        const conversationFile = path.join(workingDirectory, '.graphbus', 'conversation_history.json');

        if (!fs.existsSync(conversationFile)) {
            return { success: true, result: null };
        }

        const data = JSON.parse(fs.readFileSync(conversationFile, 'utf-8'));
        return { success: true, result: data };
    } catch (error) {
        console.error('Error loading conversation:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('conversation:clear', async (event) => {
    try {
        const conversationFile = path.join(workingDirectory, '.graphbus', 'conversation_history.json');

        if (fs.existsSync(conversationFile)) {
            fs.unlinkSync(conversationFile);
        }

        return { success: true };
    } catch (error) {
        console.error('Error clearing conversation:', error);
        return { success: false, error: error.message };
    }
});

// Git and GitHub integration
ipcMain.handle('git:create-branch', async (event, branchName) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Create and checkout new branch
        await execAsync(`git checkout -b ${branchName}`, { cwd: workingDirectory });

        return { success: true, branch: branchName };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('git:commit-and-push', async (event, message, branchName) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Add all changes
        await execAsync('git add .', { cwd: workingDirectory });

        // Commit
        await execAsync(`git commit -m "${message}"`, { cwd: workingDirectory });

        // Push to remote
        await execAsync(`git push -u origin ${branchName}`, { cwd: workingDirectory });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('github:create-pr', async (event, title, body, branchName) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Create PR using gh CLI
        const { stdout } = await execAsync(
            `gh pr create --title "${title}" --body "${body}" --head ${branchName}`,
            { cwd: workingDirectory }
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
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Get PR comments using gh CLI
        const { stdout } = await execAsync(
            `gh pr view ${prNumber} --json comments`,
            { cwd: workingDirectory }
        );

        const result = JSON.parse(stdout);
        const comments = result.comments || [];

        // Transform to expected format
        const formattedComments = comments.map(comment => ({
            user: {
                login: comment.author.login
            },
            body: comment.body,
            created_at: comment.createdAt
        }));

        return { success: true, comments: formattedComments };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pr:save-tracking', async (event, prData) => {
    try {
        const graphbusDir = path.join(workingDirectory, '.graphbus');
        const trackingFile = path.join(graphbusDir, 'pr_tracking.json');

        let tracking = { prs: [] };
        if (fs.existsSync(trackingFile)) {
            tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
        }

        // Add new PR data
        tracking.prs.push({
            ...prData,
            timestamp: Date.now()
        });

        fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('pr:load-tracking', async (event) => {
    try {
        const trackingFile = path.join(workingDirectory, '.graphbus', 'pr_tracking.json');

        if (!fs.existsSync(trackingFile)) {
            return { success: true, result: { prs: [] } };
        }

        const data = JSON.parse(fs.readFileSync(trackingFile, 'utf-8'));
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
