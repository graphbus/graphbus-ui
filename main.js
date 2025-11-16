// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PythonBridge = require('./python_bridge');
const ClaudeService = require('./claude_service');

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
