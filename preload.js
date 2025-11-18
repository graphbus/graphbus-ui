// preload.js - Secure bridge between renderer and main process
const { contextBridge, ipcRenderer } = require('electron');

// Expose menu event listener
contextBridge.exposeInMainWorld('menu', {
    onNewProject: (callback) => ipcRenderer.on('menu:new-project', callback),
    onOpenProject: (callback) => ipcRenderer.on('menu:open-project', callback),
    onChangeDirectory: (callback) => ipcRenderer.on('menu:change-directory', callback),
    onSwitchView: (callback) => ipcRenderer.on('menu:switch-view', (event, view) => callback(view)),
    onBuildAgents: (callback) => ipcRenderer.on('menu:build-agents', callback),
    onNegotiate: (callback) => ipcRenderer.on('menu:negotiate', callback),
    onStartRuntime: (callback) => ipcRenderer.on('menu:start-runtime', callback),
    onStopRuntime: (callback) => ipcRenderer.on('menu:stop-runtime', callback)
});

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('graphbus', {
    // Python execution
    executePython: (code) => ipcRenderer.invoke('python:execute', code),

    // GraphBus operations
    build: (config) => ipcRenderer.invoke('graphbus:build', config),
    startRuntime: (config) => ipcRenderer.invoke('graphbus:start-runtime', config),
    stopRuntime: () => ipcRenderer.invoke('graphbus:stop-runtime'),
    callMethod: (agent, method, args) => ipcRenderer.invoke('graphbus:call-method', agent, method, args),
    publishEvent: (topic, payload) => ipcRenderer.invoke('graphbus:publish-event', topic, payload),
    getStats: () => ipcRenderer.invoke('graphbus:get-stats'),
    loadGraph: (artifactsDir) => ipcRenderer.invoke('graphbus:load-graph', artifactsDir),
    listAgents: () => ipcRenderer.invoke('graphbus:list-agents'),
    rehydrateState: (workingDirectory) => ipcRenderer.invoke('graphbus:rehydrate-state', workingDirectory),

    // Working directory operations
    getWorkingDirectory: () => ipcRenderer.invoke('system:get-cwd'),
    setWorkingDirectory: (path) => ipcRenderer.invoke('system:set-cwd', path),
    browseDirectory: () => ipcRenderer.invoke('system:browse-directory'),
    runCommand: (command) => ipcRenderer.invoke('system:run-command', command),
    runCommandStreaming: (command) => ipcRenderer.invoke('system:run-command-streaming', command),

    // Event listeners for streaming command output
    onCommandOutput: (callback) => ipcRenderer.on('command-output', (event, data) => callback(data)),
    onCommandComplete: (callback) => ipcRenderer.on('command-complete', (event, data) => callback(data)),
    onCommandError: (callback) => ipcRenderer.on('command-error', (event, data) => callback(data)),
    onCommandPrompt: (callback) => ipcRenderer.on('command-prompt', (event, data) => callback(data)),
    sendStdin: (input) => ipcRenderer.invoke('system:send-stdin', input),

    // WebSocket communication
    wsSendMessage: (text, metadata) => ipcRenderer.invoke('ws:send-message', text, metadata),
    wsSendAnswer: (questionId, answer) => ipcRenderer.invoke('ws:send-answer', questionId, answer),
    wsIsConnected: () => ipcRenderer.invoke('ws:is-connected'),
    wsReconnect: () => ipcRenderer.invoke('ws:reconnect'),
    onWsConnected: (callback) => ipcRenderer.on('ws-connected', callback),
    onWsDisconnected: (callback) => ipcRenderer.on('ws-disconnected', callback),
    onWsAgentMessage: (callback) => ipcRenderer.on('ws-agent-message', (event, data) => callback(data)),
    onWsProgress: (callback) => ipcRenderer.on('ws-progress', (event, data) => callback(data)),
    onWsQuestion: (callback) => ipcRenderer.on('ws-question', (event, data) => callback(data)),
    onWsError: (callback) => ipcRenderer.on('ws-error', (event, data) => callback(data)),
    onWsResult: (callback) => ipcRenderer.on('ws-result', (event, data) => callback(data)),

    // Claude AI operations
    claudeInitialize: (apiKey, shouldSave = true) => ipcRenderer.invoke('claude:initialize', apiKey, shouldSave),
    claudeChat: (message, systemState) => ipcRenderer.invoke('claude:chat', message, systemState),
    claudeAddSystemMessage: (message) => ipcRenderer.invoke('claude:add-system-message', message),
    claudeIsInitialized: () => ipcRenderer.invoke('claude:is-initialized'),
    claudeUpdateDirectory: (directory) => ipcRenderer.invoke('claude:update-directory', directory),
    claudeDeleteConfig: () => ipcRenderer.invoke('claude:delete-config'),

    // Conversation persistence
    conversationSave: (messages) => ipcRenderer.invoke('conversation:save', messages),
    conversationLoad: () => ipcRenderer.invoke('conversation:load'),
    conversationClear: () => ipcRenderer.invoke('conversation:clear'),

    // Git and GitHub integration
    gitCreateBranch: (branchName) => ipcRenderer.invoke('git:create-branch', branchName),
    gitCommitAndPush: (message, branchName) => ipcRenderer.invoke('git:commit-and-push', message, branchName),
    githubCreatePR: (title, body, branchName) => ipcRenderer.invoke('github:create-pr', title, body, branchName),
    githubGetPRComments: (prNumber) => ipcRenderer.invoke('github:get-pr-comments', prNumber),
    prSaveTracking: (prData) => ipcRenderer.invoke('pr:save-tracking', prData),
    prLoadTracking: () => ipcRenderer.invoke('pr:load-tracking')
});

console.log('Preload script loaded - graphbus API exposed to renderer');
