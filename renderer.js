// renderer.js - UI logic and GraphBus API calls

let statusInterval;
let workingDirectory = null; // Will be set from main process
let currentArtifactsDir = null; // Will be calculated from working directory

// Workflow orchestration state
let workflowState = {
    phase: 'initial', // initial, built, running, ready
    hasBuilt: false,
    isRunning: false,
    agentsLoaded: false,
    lastSuggestionTime: 0,
    conversationHistory: [],
    claudeInitialized: false,
    isProcessingCompoundRequest: false // Track if Claude is handling multi-step request
};

// Update system state display
function updateSystemStateDisplay() {
    const phaseLabel = document.getElementById('workflowPhase');
    const phaseStatus = document.getElementById('phaseStatus');
    const builtStatus = document.getElementById('builtStatus');
    const runtimeStatus = document.getElementById('runtimeStatus');

    if (!phaseLabel) return;

    // Update phase label
    const phaseMap = {
        'initial': 'Getting Started',
        'awaiting_build_confirmation': 'Awaiting Build',
        'built': 'Ready to Start',
        'awaiting_runtime_confirmation': 'Ready to Launch',
        'running': 'Starting Up',
        'ready': 'Operational'
    };

    phaseLabel.textContent = phaseMap[workflowState.phase] || 'Unknown';

    // Update phase description
    const descriptionMap = {
        'initial': 'Initializing system...',
        'awaiting_build_confirmation': 'Waiting for your confirmation',
        'built': 'Agents built successfully',
        'awaiting_runtime_confirmation': 'Ready to start runtime',
        'running': 'Runtime is starting...',
        'ready': 'System fully operational ✓'
    };

    phaseStatus.textContent = descriptionMap[workflowState.phase] || 'Unknown';

    // Update built status
    builtStatus.textContent = workflowState.hasBuilt ? '✓ Yes' : '✗ No';
    builtStatus.style.color = workflowState.hasBuilt ? '#4ade80' : '#888';

    // Update runtime status
    runtimeStatus.textContent = workflowState.isRunning ? '✓ Running' : '✗ Stopped';
    runtimeStatus.style.color = workflowState.isRunning ? '#4ade80' : '#888';

    // Update workflow status and next action in bottom stats bar
    const workflowStatus = document.getElementById('workflowStatus');
    const nextAction = document.getElementById('nextAction');

    if (workflowStatus && nextAction) {
        // Determine intuitive status and next action based on workflow state
        let status = '';
        let action = '';
        let statusColor = '#888';
        let actionColor = '#888';

        if (workflowState.isRunning) {
            // Runtime is active - ready to use
            status = '✓ Runtime Active';
            action = 'Invoke agent methods';
            statusColor = '#4ade80';
            actionColor = '#4ade80';
        } else if (workflowState.hasBuilt) {
            // Built but not running
            const agentCount = parseInt(document.getElementById('nodesCount').textContent) || 0;
            if (agentCount > 0) {
                status = '✓ DAG Built';
                action = 'Start runtime';
                statusColor = '#f59e0b';
                actionColor = '#f59e0b';
            } else {
                // Built but no agents found (shouldn't happen normally)
                status = '⚠ No agents found';
                action = 'Create agents';
                statusColor = '#ef4444';
                actionColor = '#888';
            }
        } else {
            // Not built yet
            status = 'Not Built';
            action = 'Create & build agents';
            statusColor = '#888';
            actionColor = '#888';
        }

        workflowStatus.textContent = status;
        workflowStatus.style.color = statusColor;
        nextAction.textContent = action;
        nextAction.style.color = actionColor;
    }
}

// Tab switching
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });

    // Remove active state from all tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected view
    const viewId = viewName + 'View';
    const viewElement = document.getElementById(viewId);
    if (viewElement) {
        viewElement.classList.add('active');
    }

    // Activate selected tab button
    const tabBtn = document.querySelector(`.tab-btn[data-view="${viewName}"]`);
    if (tabBtn) {
        tabBtn.classList.add('active');
    }

    // If switching to graph view, ensure graph is properly rendered
    if (viewName === 'graph' && graphNetwork) {
        setTimeout(() => {
            graphNetwork.fit();
        }, 300);
    }
}

// Update Claude status badge and settings view
function updateClaudeStatusBadge() {
    const connectedView = document.getElementById('apiKeyConnectedView');
    const setupView = document.getElementById('apiKeySetupView');

    if (workflowState.claudeInitialized) {
        // Show connected view, hide setup view
        if (connectedView) connectedView.style.display = 'block';
        if (setupView) setupView.style.display = 'none';
    } else {
        // Show setup view, hide connected view
        if (connectedView) connectedView.style.display = 'none';
        if (setupView) setupView.style.display = 'block';
    }
}

// Show API key configuration (when user clicks "Change Key")
function showApiKeyConfig() {
    const setupView = document.getElementById('apiKeySetupView');
    if (setupView) setupView.style.display = 'block';

    const connectedView = document.getElementById('apiKeyConnectedView');
    if (connectedView) connectedView.style.display = 'none';
}

// Hide API key configuration (when user clicks "Cancel")
function hideApiKeyConfig() {
    updateClaudeStatusBadge();
}

// Save API key from settings panel
async function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const apiKey = input.value.trim();

    if (!apiKey) {
        addMessage('⚠️ Please enter an API key', 'system');
        return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
        addMessage('⚠️ API key should start with "sk-ant-"', 'system');
        return;
    }

    addMessage('🔄 Connecting to Claude...', 'system');

    const result = await window.graphbus.claudeInitialize(apiKey, true); // true = save to config

    if (result.success) {
        workflowState.claudeInitialized = true;
        updateClaudeStatusBadge(); // This will hide setup view and show connected view
        addMessage('✅ Claude AI connected successfully!', 'system');
        addMessage('💾 API key saved to ~/.graphbus/claude_config.json', 'system');

        // Clear the input for security
        input.value = '';

        // Start orchestration if in initial or awaiting phase
        if (workflowState.phase === 'awaiting_api_key') {
            workflowState.phase = 'initial';
            setTimeout(() => orchestrateWorkflow(), 500);
        }
    } else {
        addMessage(`❌ Failed to connect: ${result.error}`, 'system');
        addMessage('⚠️ Please check your API key and try again.', 'system');
        updateClaudeStatusBadge();

        // Delete invalid config if it was saved
        await window.graphbus.claudeDeleteConfig();
    }
}

// Toggle API key visibility
function toggleApiKeyVisibility() {
    const input = document.getElementById('apiKeyInput');
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
}

// Clear API key
async function clearApiKey() {
    const input = document.getElementById('apiKeyInput');
    input.value = '';
    workflowState.claudeInitialized = false;
    updateClaudeStatusBadge();

    // Delete the saved config file
    const result = await window.graphbus.claudeDeleteConfig();

    if (result.success) {
        addMessage('🗑️ API key deleted from ~/.graphbus/claude_config.json', 'system');
    }

    addMessage('🔄 Claude AI disconnected. You can reconnect anytime from the Settings panel.', 'system');
}

// Initialize Claude with API key
async function initializeClaude() {
    // Check if already initialized
    const checkResult = await window.graphbus.claudeIsInitialized();
    console.log('Claude initialization check:', checkResult);

    if (checkResult.result) {
        workflowState.claudeInitialized = true;
        updateClaudeStatusBadge();
        console.log('Claude already initialized - skipping setup prompt');
        // Don't show message, just silently initialize
        return true;
    }

    console.log('Claude not initialized - will show setup prompt');
    // API key not available - update badge and return false
    updateClaudeStatusBadge();
    return false;
}

// Handle API key input
async function handleApiKeyInput(input) {
    if (input.toLowerCase() === 'skip') {
        addMessage(`Okay! I'll use basic pattern matching. Commands I understand:
• "build" - Build agents
• "start runtime" - Start GraphBus
• "list agents" - Show agents
• "call Agent.method" - Call methods
• "help" - Show help`, 'assistant');
        workflowState.phase = 'initial';
        setTimeout(() => orchestrateWorkflow(), 500);
        return;
    }

    // Assume it's an API key (starts with sk-)
    if (input.startsWith('sk-')) {
        addMessage('Initializing Claude...', 'system');

        const result = await window.graphbus.claudeInitialize(input);

        if (result.success) {
            workflowState.claudeInitialized = true;
            addMessage('✓ Claude initialized! I can now have natural conversations with you.', 'system');

            // Start the workflow
            setTimeout(() => orchestrateWorkflow(), 500);
        } else {
            addMessage(`✗ Failed to initialize Claude: ${result.error}`, 'system');
            addMessage('You can try again with a different key, or type "skip" for basic mode.', 'system');
        }
    } else {
        addMessage('That doesn\'t look like an API key. It should start with "sk-". Try again or type "skip".', 'system');
    }
}

// Orchestration engine - guides users through workflow
async function orchestrateWorkflow() {
    const now = Date.now();

    // Don't spam suggestions (wait at least 3 seconds between)
    if (now - workflowState.lastSuggestionTime < 3000) return;

    workflowState.lastSuggestionTime = now;

    if (workflowState.phase === 'initial') {
        // Use Claude if initialized, otherwise show setup message
        console.log('Orchestration: phase=initial, claudeInitialized=', workflowState.claudeInitialized);

        if (workflowState.claudeInitialized) {
            // Let Claude drive the conversation
            console.log('Using Claude to drive conversation');

            let welcomePrompt = 'User just started the application. Welcome them and explain what GraphBus is.';
            if (workflowState.hasBuilt) {
                welcomePrompt += ' Note: They already have agents built in this project - mention that and ask what they want to do next.';
            } else {
                welcomePrompt += ' They don\'t have any agents built yet. Ask them what they would like to do.';
            }
            welcomePrompt += ' Do NOT include any action - just welcome them and set context.';

            const response = await window.graphbus.claudeChat(
                welcomePrompt,
                {
                    hasBuilt: workflowState.hasBuilt,
                    isRunning: workflowState.isRunning,
                    phase: workflowState.phase,
                    workingDirectory: workingDirectory
                }
            );

            if (response.success) {
                const { message, action, params } = response.result;
                addMessage(message, 'assistant');

                // Don't execute actions on initial welcome
                if (action && workflowState.conversationHistory.length > 2) {
                    await executeClaudeAction(action, params);
                }

                workflowState.phase = 'awaiting_build_confirmation';
                updateSystemStateDisplay();
            } else {
                // Claude API call failed - might be invalid key
                addMessage(`❌ Failed to connect to Claude: ${response.error}`, 'system');

                if (response.needsReconfigure) {
                    workflowState.claudeInitialized = false;
                    updateClaudeStatusBadge();
                    addMessage(`🔧 Please enter a valid API key in the Settings panel.`, 'system');
                    workflowState.phase = 'awaiting_api_key';
                } else {
                    // Some other error, but Claude might work later
                    addMessage(`You can still try using the Settings panel or type "skip" for basic mode.`, 'system');
                    workflowState.phase = 'awaiting_api_key';
                }
            }
        } else {
            // Claude not initialized - show setup instructions
            addMessage(`👋 Welcome to GraphBus UI!

I'm powered by Claude AI for natural conversational assistance.

🔧 **Setup Required:**
Enter your Anthropic API key in the ⚙️ Settings panel (bottom-right) to get started.

Get your API key from: https://console.anthropic.com/
💾 It will be saved to ~/.graphbus/claude_config.json
💡 Or set the ANTHROPIC_API_KEY environment variable

**Alternative:** Type "skip" to use basic pattern matching mode.`, 'system');

            // Wait for API key configuration
            workflowState.phase = 'awaiting_api_key';
        }

    } else if (workflowState.phase === 'built') {
        // Agents built, suggest starting runtime
        addMessage(`Great! Your agents are built. Next, I'll start the GraphBus runtime so your agents can communicate.

Ready to start the runtime?`, 'assistant');
        workflowState.phase = 'awaiting_runtime_confirmation';
        updateSystemStateDisplay();

    } else if (workflowState.phase === 'running') {
        // Runtime is running, show what they can do
        addMessage(`✓ Your GraphBus system is running!

Here's what you can do now:
• Ask me to list available agents and their methods
• Call any agent method (I'll help you format it)
• Ask questions about your agents
• Publish events to the message bus

What would you like to do?`, 'assistant');
        workflowState.phase = 'ready';
        updateSystemStateDisplay();
    }
}

// Smart command interpreter - understands intent
async function interpretCommand(command) {
    const lower = command.toLowerCase();

    // Affirmative responses
    if (lower.match(/^(yes|yeah|sure|ok|okay|yep|go|do it|please|start|build)/)) {
        if (workflowState.phase === 'awaiting_build_confirmation') {
            await autoBuildAgents();
            return true;
        } else if (workflowState.phase === 'awaiting_runtime_confirmation') {
            await autoStartRuntime();
            return true;
        }
    }

    // Negative responses
    if (lower.match(/^(no|nope|not yet|wait|skip)/)) {
        addMessage("No problem! Let me know when you're ready.", 'assistant');
        return true;
    }

    // Help requests
    if (lower.includes('help') || lower.includes('what') || lower.includes('how')) {
        await provideContextualHelp();
        return true;
    }

    // List/show agents
    if (lower.match(/(list|show|what).*(agent|method)/)) {
        await listAgentsCommand();
        return true;
    }

    // Runtime control
    if (lower.includes('start') && lower.includes('runtime')) {
        await autoStartRuntime();
        return true;
    }

    if (lower.includes('stop') && lower.includes('runtime')) {
        await stopRuntime();
        return true;
    }

    // Build
    if (lower.includes('build')) {
        await autoBuildAgents();
        return true;
    }

    // Method calls - flexible parsing
    if (lower.includes('call') || lower.match(/\w+\.\w+/)) {
        await intelligentMethodCall(command);
        return true;
    }

    return false;
}

// Contextual help based on current state
async function provideContextualHelp() {
    if (!workflowState.hasBuilt) {
        addMessage(`You're at the beginning! Here's what needs to happen:

1. **Build agents** - I'll compile your agent code
2. **Start runtime** - I'll launch the GraphBus system
3. **Use agents** - Then you can call methods and interact

Just say "yes" or "build" to get started!`, 'assistant');

    } else if (!workflowState.isRunning) {
        addMessage(`Your agents are built but the runtime isn't running yet.

Say "yes" or "start" to launch the runtime, then you can use your agents!`, 'assistant');

    } else {
        addMessage(`Your system is fully operational! You can:

• **"list agents"** - See all available agents and methods
• **"call AgentName.methodName"** - Invoke any agent method
• **"what can X do?"** - Ask about specific agent capabilities
• **"stop runtime"** - Shut down the system

What would you like to do?`, 'assistant');
    }
}

// Auto-build with intelligent defaults
async function autoBuildAgents() {
    // Use CLI command instead of IPC - this ensures API key is passed correctly
    const agentsDir = 'agents';
    const buildCommand = workflowState.claudeInitialized
        ? `graphbus build ${agentsDir} --enable-agents`
        : `graphbus build ${agentsDir}`;

    currentArtifactsDir = `${workingDirectory}/.graphbus`;

    try {
        addMessage(`Building agents in ${workingDirectory}/${agentsDir}...`, 'assistant');

        // Use the CLI command which will automatically use ANTHROPIC_API_KEY from environment
        await runShellCommand(buildCommand);

        // The rest is handled by runShellCommand's build detection
        // which auto-loads the graph and updates state
    } catch (error) {
        addMessage(`✗ Error: ${error.message}`, 'assistant');
        addMessage(`I looked for agents in ${workingDirectory}/${agentsDir} but couldn't find them. You can:
• Click the working directory to change to your GraphBus project folder
• Tell me where your agents are located`, 'assistant');
    }
}

// Auto-start runtime
async function autoStartRuntime() {
    try {
        addMessage('Starting the GraphBus runtime...', 'assistant');

        const result = await window.graphbus.startRuntime({
            artifactsDir: currentArtifactsDir
        });

        if (result.success) {
            workflowState.isRunning = true;
            workflowState.phase = 'running';
            addMessage(`✓ Runtime started!`, 'assistant');
            updateSystemStateDisplay();
            startStatusPolling();

            // Auto-load graph
            setTimeout(async () => {
                await autoLoadGraph();
                // Prompt for next steps
                setTimeout(() => orchestrateWorkflow(), 1000);
            }, 500);
        } else {
            addMessage(`✗ Failed to start: ${result.error}`, 'assistant');
            addMessage(`This might mean the agents weren't built. Want me to build them first?`, 'assistant');
            workflowState.phase = 'awaiting_build_confirmation';
            updateSystemStateDisplay();
        }
    } catch (error) {
        addMessage(`✗ Error: ${error.message}`, 'assistant');
    }
}

// Auto-load graph when runtime starts
async function autoLoadGraph() {
    try {
        console.log('Loading graph from:', currentArtifactsDir);
        const result = await window.graphbus.loadGraph(currentArtifactsDir);

        console.log('Graph load result:', result);

        if (result.success && result.result) {
            const graphData = result.result;

            if (graphData.nodes && graphData.nodes.length > 0) {
                displayAgents(graphData.nodes, graphData.edges || []);

                // Update graph panel header with working directory
                updateGraphPanelHeader();

                addMessage(`📊 Loaded ${graphData.nodes.length} agent(s)`, 'system');
            } else {
                console.warn('No nodes in graph data');
                addMessage('⚠️ Graph loaded but no agents found', 'system');
            }
        } else {
            console.error('Failed to load graph:', result.error);
            addMessage(`⚠️ Could not load graph: ${result.error || 'Unknown error'}`, 'system');
        }
    } catch (error) {
        console.error('Auto-load graph failed:', error);
        addMessage(`⚠️ Error loading graph: ${error.message}`, 'system');
    }
}

// Update graph panel header with working directory
function updateGraphPanelHeader() {
    const graphStatus = document.getElementById('graphStatus');
    if (graphStatus && workingDirectory) {
        // Show last 2 segments of path
        const segments = workingDirectory.split('/').filter(s => s);
        const shortPath = segments.length > 2
            ? '.../' + segments.slice(-2).join('/')
            : workingDirectory;
        graphStatus.textContent = shortPath;
        graphStatus.title = `Working directory: ${workingDirectory}`;
    }
}

// Intelligent method calling with flexible parsing
async function intelligentMethodCall(command) {
    // Extract agent.method pattern
    const match = command.match(/(\w+)\.(\w+)/);

    if (!match) {
        addMessage(`I couldn't parse that method call. Try: "call HelloService.generate_message" or just "HelloService.generate_message"`, 'assistant');
        return;
    }

    const [_, agent, method] = match;

    try {
        addMessage(`Calling ${agent}.${method}...`, 'assistant');
        const result = await window.graphbus.callMethod(agent, method, {});

        if (result.success) {
            addMessage(`✓ Result: ${result.result.message}`, 'assistant');
            addMessage(`Want to call another method? Just tell me!`, 'system');
        } else {
            addMessage(`✗ ${result.error}`, 'assistant');

            // Helpful suggestions
            if (result.error.includes('not found')) {
                addMessage(`That agent or method doesn't exist. Try "list agents" to see what's available.`, 'system');
            }
        }
    } catch (error) {
        addMessage(`✗ ${error.message}`, 'assistant');
    }
}

// Chat functions
function addMessage(text, type = 'assistant') {
    const messages = document.getElementById('messages');

    // Create message wrapper
    const msgWrapper = document.createElement('div');
    msgWrapper.className = `message-wrapper ${type}`;

    // Create message content
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.style.whiteSpace = 'pre-wrap';
    msg.textContent = text;

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(text).then(() => {
            // Show feedback
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            copyBtn.innerHTML = '✗';
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
            }, 2000);
        });
    };

    msgWrapper.appendChild(msg);
    msgWrapper.appendChild(copyBtn);
    messages.appendChild(msgWrapper);
    messages.scrollTop = messages.scrollHeight;

    // Track conversation history
    workflowState.conversationHistory.push({ text, type, timestamp: Date.now() });

    // Auto-save conversation after each message
    saveConversation();
}

// Save conversation to .graphbus directory
async function saveConversation() {
    try {
        await window.graphbus.conversationSave(workflowState.conversationHistory);
    } catch (error) {
        console.error('Failed to save conversation:', error);
    }
}

// Load conversation from .graphbus directory
async function loadConversation() {
    try {
        const result = await window.graphbus.conversationLoad();

        if (result.success && result.result && result.result.messages) {
            const savedMessages = result.result.messages;

            // Restore messages to UI
            savedMessages.forEach(msg => {
                const messages = document.getElementById('messages');
                const msgElement = document.createElement('div');
                msgElement.className = `message ${msg.type}`;
                msgElement.style.whiteSpace = 'pre-wrap';
                msgElement.textContent = msg.text;
                messages.appendChild(msgElement);
            });

            // Restore to history
            workflowState.conversationHistory = savedMessages;

            addMessage('✓ Previous conversation restored', 'system');
            messages.scrollTop = messages.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load conversation:', error);
    }
}

async function sendCommand() {
    const input = document.getElementById('chatInput');
    const command = input.value.trim();
    if (!command) return;

    addMessage(command, 'user');
    input.value = '';

    try {
        // Handle API key setup if not initialized
        if (workflowState.phase === 'awaiting_api_key') {
            await handleApiKeyInput(command);
            return;
        }

        // Check if Claude is initialized
        if (!workflowState.claudeInitialized) {
            // Fallback to pattern matching
            const handled = await interpretCommand(command);
            if (!handled) {
                addMessage(`I'm not sure what you mean. Try asking "help" to see what you can do!`, 'assistant');
            }
            return;
        }

        // Use Claude for conversational response
        addMessage('...', 'assistant'); // Show thinking indicator

        const response = await window.graphbus.claudeChat(command, {
            hasBuilt: workflowState.hasBuilt,
            isRunning: workflowState.isRunning,
            phase: workflowState.phase,
            workingDirectory: workingDirectory
        });

        // Remove thinking indicator
        const messages = document.getElementById('messages');
        if (messages.lastChild && messages.lastChild.textContent === '...') {
            messages.removeChild(messages.lastChild);
        }

        if (response.success) {
            const { message, action, params } = response.result;

            // Show Claude's message
            if (message) {
                addMessage(message, 'assistant');
            }

            // Execute action if requested
            if (action) {
                await executeClaudeAction(action, params);
            }
        } else {
            // Show user-friendly error message
            addMessage(`I encountered an error: ${response.error}`, 'assistant');

            // Check if we need to reconfigure
            if (response.needsReconfigure) {
                workflowState.claudeInitialized = false;
                updateClaudeStatusBadge();
                addMessage(`🔧 Please enter a valid API key in the Settings panel.`, 'system');
                workflowState.phase = 'awaiting_api_key';
            }
        }
    } catch (error) {
        addMessage(`Error: ${error.message}`, 'assistant');
    }
}

// Execute actions requested by Claude
async function executeClaudeAction(action, params) {
    try {
        // Show action being executed (but not for execute_python - it shows its own message)
        const actionMessages = {
            'run_command': `→ Running: ${params.command}`,
            'build_agents': '→ Building agents and analyzing dependencies...',
            'start_runtime': '→ Starting GraphBus runtime...',
            'stop_runtime': '→ Stopping runtime...',
            'list_agents': '→ Listing available agents...',
            'call_method': `→ Calling ${params.agent}.${params.method}...`,
            'publish_event': `→ Publishing event to ${params.topic}...`,
            'change_directory': '→ Changing working directory...'
        };

        if (actionMessages[action]) {
            addMessage(actionMessages[action], 'system');
        }

        switch (action) {
            case 'run_command':
                if (params.command) {
                    await runShellCommand(params.command);
                }
                break;

            case 'start_runtime':
                await autoStartRuntime();
                await window.graphbus.claudeAddSystemMessage('Runtime started - DAG orchestrator active');
                break;

            case 'stop_runtime':
                await stopRuntime();
                await window.graphbus.claudeAddSystemMessage('Runtime stopped');
                break;

            case 'list_agents':
                await listAgentsCommand();
                break;

            case 'call_method':
                if (params.agent && params.method) {
                    await callMethodWithParams(params.agent, params.method, params.args || {});
                }
                break;

            case 'publish_event':
                if (params.topic && params.payload) {
                    await publishEvent(params.topic, params.payload);
                }
                break;

            case 'change_directory':
                await changeWorkingDirectory();
                break;

            case 'execute_python':
                if (params.code) {
                    await executePythonCode(params.code);
                }
                break;

            default:
                console.log('Unknown action:', action);
        }
    } catch (error) {
        addMessage(`✗ Action failed: ${error.message}`, 'system');
        await window.graphbus.claudeAddSystemMessage(`Action failed: ${error.message}`);
    }
}

// Call method with parameters
async function callMethodWithParams(agent, method, args) {
    try {
        const result = await window.graphbus.callMethod(agent, method, args);

        if (result.success) {
            addMessage(`✓ ${agent}.${method} executed`, 'system');
            addMessage(`Result: ${JSON.stringify(result.result, null, 2)}`, 'assistant');
            await window.graphbus.claudeAddSystemMessage(`Method executed successfully: ${JSON.stringify(result.result)}`);
        } else {
            addMessage(`✗ ${result.error}`, 'assistant');
            await window.graphbus.claudeAddSystemMessage(`Method failed: ${result.error}`);
        }
    } catch (error) {
        addMessage(`✗ ${error.message}`, 'assistant');
    }
}

// Publish event to message bus
async function publishEvent(topic, payload) {
    try {
        const result = await window.graphbus.publishEvent(topic, payload);

        if (result.success) {
            addMessage(`✓ Event published to ${topic}`, 'system');
            await window.graphbus.claudeAddSystemMessage(`Event published to ${topic}`);
        } else {
            addMessage(`✗ ${result.error}`, 'assistant');
            await window.graphbus.claudeAddSystemMessage(`Event publish failed: ${result.error}`);
        }
    } catch (error) {
        addMessage(`✗ ${error.message}`, 'assistant');
    }
}

// Execute Python code
async function executePythonCode(code) {
    try {
        // Show the actual code being executed
        addMessage(`📝 Executing Python:\n${code}`, 'system');

        const result = await window.graphbus.executePython(code);

        if (result.success) {
            const output = Array.isArray(result.result) ? result.result.join('\n') : result.result;

            if (output && output.trim()) {
                addMessage(`✓ Result:\n${output}`, 'assistant');
                await window.graphbus.claudeAddSystemMessage(`Python execution completed. Output: ${output}`);
            } else {
                addMessage('✓ Completed (no output)', 'system');
                await window.graphbus.claudeAddSystemMessage('Python execution completed successfully');
            }
        } else {
            addMessage(`✗ Error:\n${result.error}`, 'assistant');
            await window.graphbus.claudeAddSystemMessage(`Python execution failed: ${result.error}`);
        }
    } catch (error) {
        addMessage(`✗ Exception:\n${error.message}`, 'assistant');
        await window.graphbus.claudeAddSystemMessage(`Python execution error: ${error.message}`);
    }
}

// Check if Claude needs to continue with compound request
async function checkForCompoundRequestContinuation() {
    if (!workflowState.claudeInitialized) return;

    try {
        // Invoke Claude with empty prompt - it will check its history for pending actions
        const response = await window.graphbus.claudeChat('', {
            hasBuilt: workflowState.hasBuilt,
            isRunning: workflowState.isRunning,
            phase: workflowState.phase,
            workingDirectory: workingDirectory
        });

        if (response.success) {
            const { message, action, params } = response.result;

            // Only show message if Claude has something to say (continuation of compound request)
            if (message && message.trim()) {
                addMessage(message, 'assistant');
            }

            // Execute next action if Claude determined there's more to do
            if (action) {
                await executeClaudeAction(action, params);
            }
        }
    } catch (error) {
        // Silent fail - this is auto-continuation, not user-initiated
        console.log('Auto-continuation check:', error);
    }
}

// Execute shell command
async function runShellCommand(command) {
    // Use streaming for negotiation commands
    if (command.includes('graphbus negotiate')) {
        return runStreamingCommand(command);
    }

    try {
        const result = await window.graphbus.runCommand(command);

        if (result.success) {
            const { stdout, stderr } = result.result;

            if (stdout && stdout.trim()) {
                addMessage(`✓ Output:\n${stdout}`, 'assistant');
            }

            if (stderr && stderr.trim()) {
                addMessage(`⚠️ Stderr:\n${stderr}`, 'system');
            }

            if (!stdout && !stderr) {
                addMessage('✓ Completed', 'system');
            }

            const combinedOutput = [stdout, stderr].filter(x => x && x.trim()).join('\n');

            // Auto-load graph if this was a build command
            if (command.includes('graphbus build') && stdout && stdout.includes('Build completed')) {
                addMessage('📊 Loading graph...', 'system');

                // Update state
                workflowState.hasBuilt = true;
                workflowState.phase = 'built';

                // Give build a moment to finish writing files
                setTimeout(async () => {
                    await autoLoadGraph();

                    // Update system state display after graph loads
                    updateSystemStateDisplay();

                    await window.graphbus.claudeAddSystemMessage(`Build completed successfully. Graph loaded with agents visible in UI. If this was part of a compound request, continue with the next action now.`);

                    // Auto-trigger Claude to continue compound requests
                    setTimeout(() => checkForCompoundRequestContinuation(), 1000);
                }, 500);
            } else {
                await window.graphbus.claudeAddSystemMessage(`Command completed. Output: ${combinedOutput || '(no output)'}. Check if there are more actions to complete from the user's request.`);

                // Auto-trigger Claude to continue compound requests
                setTimeout(() => checkForCompoundRequestContinuation(), 500);
            }
        } else {
            let errorMsg = result.error || 'Command failed';

            addMessage(`✗ Command failed:\n${errorMsg}`, 'assistant');

            if (result.stderr) {
                addMessage(`Stderr:\n${result.stderr}`, 'system');
            }
            if (result.stdout) {
                addMessage(`Stdout:\n${result.stdout}`, 'system');
            }

            await window.graphbus.claudeAddSystemMessage(`Command failed: ${errorMsg}`);
        }
    } catch (error) {
        addMessage(`✗ Exception:\n${error.message}`, 'assistant');
        await window.graphbus.claudeAddSystemMessage(`Command error: ${error.message}`);
    }
}

// Execute command with streaming output
async function runStreamingCommand(command) {
    let streamingMessageElement = null;
    let streamingMessageWrapper = null;
    let streamingCopyBtn = null;
    let fullOutput = '';
    let currentRound = 0;
    let currentPhase = '';

    // Create initial message with wrapper and copy button
    const messagesContainer = document.getElementById('messages');

    // Create wrapper
    const msgWrapper = document.createElement('div');
    msgWrapper.className = 'message-wrapper assistant';

    // Create message content
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.style.whiteSpace = 'pre-wrap';
    messageDiv.textContent = '🔄 Starting negotiation...\n';

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = () => {
        const textToCopy = messageDiv.textContent;
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            copyBtn.innerHTML = '✗';
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
            }, 2000);
        });
    };

    msgWrapper.appendChild(messageDiv);
    msgWrapper.appendChild(copyBtn);
    messagesContainer.appendChild(msgWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    streamingMessageElement = messageDiv;
    streamingMessageWrapper = msgWrapper;
    streamingCopyBtn = copyBtn;

    // Set up event listeners
    const outputHandler = (data) => {
        const { type, line } = data;
        fullOutput += line + '\n';

        // Skip verbose log lines that clutter the output
        if (line.includes('[Orchestrator]') ||
            line.includes('[CodeWriter]') ||
            line.includes('[Negotiation] Proposal prop_') ||
            line.includes('[Negotiation] Agents evaluating') ||
            line.includes('GraphBus Agent Negotiation') ||
            line.includes('ℹ ') ||
            line.includes('Safety: max_rounds') ||
            line.includes('AGENT ORCHESTRATION') ||
            line.includes('Activating agents') ||
            line.includes('✓ Activated') ||
            line.includes('agents activated') ||
            line.includes('Running analysis phase') ||
            line.includes('Analyzing ') ||
            line.includes('Found ') ||
            line.includes('potential improvements') ||
            line.includes('Running proposal phase') ||
            line.includes('Running reconciliation phase') ||
            line.includes('No arbiter configured') ||
            line.includes('Running negotiation round') ||
            line.includes('commits created') ||
            line.includes('Applying ') ||
            line.includes('Reloading source code') ||
            line.includes('Running refactoring validation') ||
            line.includes('Saved graph to') ||
            line.includes('Saved ') ||
            line.includes('to /Users') ||
            line.match(/^={60,}$/) ||
            line.match(/^-{60,}$/) ||
            line.trim() === '') {
            return; // Skip these lines
        }

        let displayLine = null;

        // Extract user intent
        if (line.includes('User intent:')) {
            displayLine = `\n┌─────────────────────────────────────────┐
│  🎯 INTENT                              │
└─────────────────────────────────────────┘
  ${line.replace(/.*User intent:\s*/, '')}
`;
        }
        // Extract round number
        else if (line.match(/ROUND (\d+)\/(\d+)/)) {
            const match = line.match(/ROUND (\d+)\/(\d+)/);
            currentRound = match[1];
            displayLine = `
═══════════════════════════════════════════
        📊 ROUND ${match[1]}/${match[2]}
═══════════════════════════════════════════
`;
            currentPhase = '';
        }
        // Extract proposals
        else if (line.match(/(\w+): Proposing '(.+?)'\.\.\./)) {
            const match = line.match(/(\w+): Proposing '(.+?)'\.\.\./);
            if (currentPhase !== 'proposing') {
                displayLine = `
┌─────────────────────────────────────────┐
│  💡 STEP 1: Proposal Generation         │
└─────────────────────────────────────────┘
  🤖 ${match[1]}: ${match[2]}`;
                currentPhase = 'proposing';
            } else {
                displayLine = `  🤖 ${match[1]}: ${match[2]}`;
            }
        }
        // Extract evaluations
        else if (line.match(/\[Negotiation\] (\w+) evaluated (\w+): (accept|reject)/)) {
            const match = line.match(/\[Negotiation\] (\w+) evaluated (\w+): (accept|reject)/);
            if (currentPhase !== 'evaluating') {
                displayLine = `
        ↓
┌─────────────────────────────────────────┐
│  📋 STEP 2: Peer Evaluation             │
└─────────────────────────────────────────┘
  ${match[3] === 'accept' ? '✅' : '❌'} ${match[1]} → ${match[3].toUpperCase()}`;
                currentPhase = 'evaluating';
            } else {
                displayLine = `  ${match[3] === 'accept' ? '✅' : '❌'} ${match[1]} → ${match[3].toUpperCase()}`;
            }
        }
        // Extract commits
        else if (line.match(/✓ Commit created for (\w+) \((\d+) accepts, (\d+) rejects\)/)) {
            const match = line.match(/✓ Commit created for (\w+) \((\d+) accepts, (\d+) rejects\)/);
            if (currentPhase !== 'committing') {
                displayLine = `
        ↓
┌─────────────────────────────────────────┐
│  ✅ STEP 3: Consensus & Commit          │
└─────────────────────────────────────────┘
  Commit: ${match[2]} accepts, ${match[3]} rejects`;
                currentPhase = 'committing';
            } else {
                displayLine = `  Commit: ${match[2]} accepts, ${match[3]} rejects`;
            }
        }
        // Extract rejections
        else if (line.includes('✗ REJECTED') || line.includes('✗ Cannot create commit')) {
            displayLine = `  ${line}`;
        }
        // Extract file modifications
        else if (line.match(/\[CodeWriter\] Modified (\d+) files?/)) {
            const match = line.match(/\[CodeWriter\] Modified (\d+) files?/);
            if (parseInt(match[1]) > 0) {
                displayLine = `
        ↓
┌─────────────────────────────────────────┐
│  📝 STEP 4: File Modifications          │
└─────────────────────────────────────────┘
  Modified ${match[1]} file(s)`;
                currentPhase = 'modifying';
            }
        }
        // Extract completion
        else if (line.includes('NEGOTIATION COMPLETE') || line.includes('Total rounds:')) {
            if (!currentPhase.includes('complete')) {
                displayLine = `
        ↓
╔═════════════════════════════════════════╗
║     🎉 NEGOTIATION COMPLETE             ║
╚═════════════════════════════════════════╝
`;
                currentPhase = 'complete';
            }
        }
        // Extract summary stats
        else if (line.match(/Total (rounds|commits|proposals):/)) {
            displayLine = `  ${line}`;
        }
        else if (line.match(/Files modified:/)) {
            displayLine = `  ${line}`;
        }
        // Extract warnings/errors
        else if (line.includes('⚠️') || line.includes('Warning:') || line.includes('Error:')) {
            displayLine = `\n⚠️  ${line.replace('⚠️', '').trim()}`;
        }

        // Only append if we have content to display
        if (displayLine && streamingMessageElement) {
            streamingMessageElement.textContent += displayLine + '\n';
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    };

    const completeHandler = async (data) => {
        if (streamingMessageElement) {
            streamingMessageElement.textContent += '\n✓ Command completed\n';
        }

        // Cleanup listeners
        window.graphbus.onCommandOutput(() => {});
        window.graphbus.onCommandComplete(() => {});
        window.graphbus.onCommandError(() => {});

        await window.graphbus.claudeAddSystemMessage(`Negotiation completed. Output: ${fullOutput}`);
        setTimeout(() => checkForCompoundRequestContinuation(), 500);
    };

    const errorHandler = (data) => {
        if (streamingMessageElement) {
            streamingMessageElement.textContent += `\n✗ Error: ${data.error}\n`;
        }
    };

    // Register handlers
    window.graphbus.onCommandOutput(outputHandler);
    window.graphbus.onCommandComplete(completeHandler);
    window.graphbus.onCommandError(errorHandler);

    // Start streaming command
    try {
        await window.graphbus.runCommandStreaming(command);
    } catch (error) {
        if (streamingMessageElement) {
            streamingMessageElement.textContent += `\n✗ Exception: ${error.message}\n`;
        }
    }
}

// Parse and display negotiation output as individual messages
function parseAndDisplayNegotiation(output) {
    const lines = output.split('\n');
    let totalRounds = 0;
    let totalCommits = 0;
    let filesModified = 0;

    // Extract header info
    const intentMatch = output.match(/User intent: (.+)/);
    const userIntent = intentMatch ? intentMatch[1] : null;

    if (userIntent) {
        addMessage(`🎯 Negotiation Intent: ${userIntent}`, 'system');
    }

    // Parse round headers
    const roundMatches = [...output.matchAll(/NEGOTIATION ROUND (\d+)\/(\d+)/g)];
    if (roundMatches.length > 0) {
        totalRounds = parseInt(roundMatches[roundMatches.length - 1][2]);
    }

    // Parse agent proposals with full context
    const proposalMatches = [...output.matchAll(/(\w+): Proposing '(.+?)'\.\.\./g)];
    const proposalsByRound = {};

    for (const match of proposalMatches) {
        const [_, agent, proposal] = match;
        const roundNum = output.substring(0, match.index).match(/NEGOTIATION ROUND (\d+)/g);
        const round = roundNum ? parseInt(roundNum[roundNum.length - 1].match(/\d+/)[0]) : 1;

        if (!proposalsByRound[round]) {
            proposalsByRound[round] = [];
        }
        proposalsByRound[round].push({ agent, proposal });
    }

    // Display by round with much more granular detail
    for (let round = 1; round <= totalRounds; round++) {
        addMessage(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 ROUND ${round}/${totalRounds}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');

        const roundSection = getRoundSection(output, round);
        if (!roundSection) continue;

        // 1. Show proposals for this round
        const proposals = proposalsByRound[round] || [];
        if (proposals.length > 0) {
            addMessage(`\n💡 Phase 1: Proposal Generation (${proposals.length} proposals)`, 'system');
            proposals.forEach(({ agent, proposal }) => {
                addMessage(`  🤖 ${agent} proposes:\n     "${proposal}"`, 'assistant');
            });
        }

        // 2. Show individual agent evaluations with details
        const evaluationLines = roundSection.split('\n').filter(line =>
            line.includes('evaluated') && (line.includes('accept') || line.includes('reject'))
        );

        if (evaluationLines.length > 0) {
            addMessage(`\n📋 Phase 2: Peer Evaluation (${evaluationLines.length} evaluations)`, 'system');

            evaluationLines.forEach(line => {
                // Parse: "AgentA evaluated proposal_id: accept" or "AgentA evaluated proposal_id: reject"
                const evalMatch = line.match(/(\w+) evaluated (\w+): (accept|reject)/);
                if (evalMatch) {
                    const [_, evaluator, proposalId, decision] = evalMatch;
                    const emoji = decision === 'accept' ? '✅' : '❌';
                    addMessage(`  ${emoji} ${evaluator} → ${proposalId}: ${decision.toUpperCase()}`, 'assistant');
                }
            });
        }

        // 3. Show validation checks
        const validationLines = roundSection.split('\n').filter(line =>
            line.includes('Validating') || line.includes('Schema') || line.includes('valid')
        );

        if (validationLines.length > 0) {
            addMessage(`\n🔍 Phase 3: Schema Validation`, 'system');
            validationLines.forEach(line => {
                if (line.trim()) {
                    addMessage(`  ${line.trim()}`, 'assistant');
                }
            });
        }

        // 4. Show consensus decisions with detailed vote counts
        const commitMatches = [...roundSection.matchAll(/✓ Commit created for (\w+) \((\d+) accepts, (\d+) rejects\)/g)];
        if (commitMatches.length > 0) {
            addMessage(`\n✅ Phase 4: Consensus & Commit`, 'system');
            commitMatches.forEach(match => {
                const [_, proposalId, accepts, rejects] = match;
                const totalVotes = parseInt(accepts) + parseInt(rejects);
                const acceptRate = totalVotes > 0 ? Math.round((parseInt(accepts) / totalVotes) * 100) : 0;
                addMessage(`  🎯 Proposal ${proposalId}:`, 'assistant');
                addMessage(`     Votes: ${accepts} accepts, ${rejects} rejects (${acceptRate}% approval)`, 'assistant');
                addMessage(`     Status: ✓ COMMITTED`, 'assistant');
                totalCommits++;
            });
        }

        // 5. Show file modifications with details
        const fileMatches = [...roundSection.matchAll(/✓ Modified (.+)/g)];
        if (fileMatches.length > 0) {
            addMessage(`\n📝 Phase 5: File Modifications (${fileMatches.length} files)`, 'system');
            const uniqueFiles = new Set(fileMatches.map(m => m[1].split('\n')[0]));
            uniqueFiles.forEach(file => {
                addMessage(`  📄 ${file}`, 'assistant');
                filesModified++;
            });
        }

        // 6. Show any errors or warnings for this round
        const errorLines = roundSection.split('\n').filter(line =>
            line.includes('Error:') || line.includes('Failed:') || line.includes('Warning:')
        );

        if (errorLines.length > 0) {
            addMessage(`\n⚠️ Issues Detected:`, 'system');
            errorLines.forEach(line => {
                if (line.trim()) {
                    addMessage(`  ${line.trim()}`, 'system');
                }
            });
        }

        // 7. Show any rejected proposals with reasons
        const rejectLines = roundSection.split('\n').filter(line =>
            line.includes('Rejected:') || (line.includes('reject') && line.includes('reason'))
        );

        if (rejectLines.length > 0) {
            addMessage(`\n🚫 Rejected Proposals:`, 'system');
            rejectLines.forEach(line => {
                if (line.trim()) {
                    addMessage(`  ${line.trim()}`, 'assistant');
                }
            });
        }
    }

    // Final summary
    const summaryMatch = output.match(/ORCHESTRATION COMPLETE[\s\S]*?Total rounds: (\d+)[\s\S]*?Total commits: (\d+)[\s\S]*?Files modified: (\d+)/);
    if (summaryMatch) {
        const [_, rounds, commits, files] = summaryMatch;
        addMessage(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎉 NEGOTIATION COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
        addMessage(`📊 Summary:\n  • Rounds: ${rounds}\n  • Commits: ${commits}\n  • Files Modified: ${files}`, 'assistant');
    } else if (totalCommits > 0) {
        addMessage(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎉 NEGOTIATION COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'system');
        addMessage(`📊 Summary:\n  • Rounds: ${totalRounds}\n  • Commits: ${totalCommits}\n  • Files Modified: ${filesModified}`, 'assistant');
    }

    // Show any warnings or errors
    const warningMatches = [...output.matchAll(/Warning: (.+)/g)];
    if (warningMatches.length > 0) {
        addMessage(`\n⚠️ Warnings (${warningMatches.length}):`, 'system');
        warningMatches.slice(0, 3).forEach(match => {
            addMessage(`  • ${match[1]}`, 'system');
        });
        if (warningMatches.length > 3) {
            addMessage(`  • ...and ${warningMatches.length - 3} more`, 'system');
        }
    }
}

// Helper to extract a specific round's section from output
function getRoundSection(output, roundNum) {
    const roundStart = output.indexOf(`NEGOTIATION ROUND ${roundNum}/`);
    if (roundStart === -1) return null;

    const nextRound = output.indexOf(`NEGOTIATION ROUND ${roundNum + 1}/`, roundStart + 1);
    const orchestrationComplete = output.indexOf('ORCHESTRATION COMPLETE', roundStart);

    const endPos = nextRound !== -1 ? nextRound : (orchestrationComplete !== -1 ? orchestrationComplete : output.length);
    return output.substring(roundStart, endPos);
}

// GraphBus operations (legacy - kept for backward compatibility)
async function startRuntime() {
    await autoStartRuntime();
}

async function stopRuntime() {
    try {
        addMessage('Stopping runtime...', 'assistant');
        const result = await window.graphbus.stopRuntime();

        if (result.success) {
            workflowState.isRunning = false;
            workflowState.phase = 'built';
            addMessage(`✓ Runtime stopped`, 'assistant');
            updateSystemStateDisplay();
            stopStatusPolling();
        } else {
            addMessage(`✗ ${result.error}`, 'assistant');
        }
    } catch (error) {
        addMessage(`✗ ${error.message}`, 'assistant');
    }
}

async function buildAgents() {
    await autoBuildAgents();
}

async function listAgentsCommand() {
    try {
        const result = await window.graphbus.listAgents();

        if (result.success) {
            const agents = result.result;
            if (agents.length === 0) {
                addMessage('No agents loaded yet.', 'assistant');

                if (!workflowState.isRunning) {
                    addMessage('The runtime needs to be started first. Want me to start it?', 'assistant');
                    workflowState.phase = 'awaiting_runtime_confirmation';
                }
            } else {
                workflowState.agentsLoaded = true;
                let message = `Here are your available agents:\n\n`;
                agents.forEach(agent => {
                    message += `• **${agent.name}**\n`;
                    if (agent.methods.length > 0) {
                        message += `  Methods: ${agent.methods.join(', ')}\n`;
                    }
                });
                message += `\nYou can call any method like: "${agents[0].name}.${agents[0].methods[0]}"`;
                addMessage(message, 'assistant');
            }
        } else {
            addMessage(`✗ ${result.error}`, 'assistant');
        }
    } catch (error) {
        addMessage(`✗ ${error.message}`, 'assistant');
    }
}

async function callMethodCommand(methodCall) {
    await intelligentMethodCall(methodCall);
}

async function callMethod() {
    const methodCall = document.getElementById('methodCall').value;
    await intelligentMethodCall(methodCall);
}

// Graph operations
async function loadGraph() {
    await autoLoadGraph();
}

// Store current graph data for interactions
let currentGraphData = { nodes: [], edges: [] };
let graphNetwork = null;

function displayAgents(nodes, edges = []) {
    if (!nodes || nodes.length === 0) {
        const graphCanvas = document.getElementById('graphCanvas');
        graphCanvas.innerHTML = '<p class="placeholder" style="padding: 20px; text-align: center;">No agents to display</p>';
        document.getElementById('nodesCount').textContent = '0';
        return;
    }

    // Debug: Log what we're receiving
    console.log('displayAgents called with:', {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes: nodes.map(n => n.name),
        edges: edges
    });

    // Update agent counter in stats bar
    document.getElementById('nodesCount').textContent = nodes.length;

    // Update workflow status now that we know agent count
    updateSystemStateDisplay();

    // Store graph data
    currentGraphData = { nodes, edges };

    // Prepare vis.js data
    const visNodes = nodes.map(node => ({
        id: node.name,
        label: node.name,
        title: `<b>${node.name}</b><br/>Module: ${node.module}<br/>Methods: ${node.methods.join(', ')}`,
        color: {
            background: '#667eea',
            border: '#4c51bf',
            highlight: {
                background: '#818cf8',
                border: '#6366f1'
            }
        },
        font: { color: '#ffffff' },
        shape: 'box',
        data: node // Store full node data
    }));

    const visEdges = edges.map(edge => ({
        from: edge.source,
        to: edge.target,
        arrows: {
            to: {
                enabled: true,
                scaleFactor: 1,
                type: 'arrow'
            }
        },
        color: {
            color: '#f59e0b',
            highlight: '#fbbf24',
            hover: '#fbbf24',
            opacity: 1.0
        },
        width: 3,
        label: edge.type || 'depends_on',
        font: {
            color: '#888',
            size: 11,
            align: 'middle',
            background: 'rgba(0, 0, 0, 0.6)',
            strokeWidth: 0
        },
        smooth: {
            enabled: true,
            type: 'cubicBezier',
            roundness: 0.5
        }
    }));

    // Debug: Log vis.js formatted edges
    console.log('vis.js edges:', visEdges);

    // Create network
    const container = document.getElementById('graphCanvas');
    const data = { nodes: visNodes, edges: visEdges };

    console.log('Creating vis.js network with data:', data);
    const options = {
        nodes: {
            borderWidth: 2,
            borderWidthSelected: 3,
            font: { size: 14, face: 'monospace' }
        },
        edges: {
            width: 2,
            selectionWidth: 3
        },
        physics: {
            enabled: true,
            barnesHut: {
                gravitationalConstant: -8000,
                springLength: 150,
                springConstant: 0.04
            },
            stabilization: {
                iterations: 200
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 100,
            navigationButtons: true,
            keyboard: false // Disable by default, enable on focus
        }
    };

    graphNetwork = new vis.Network(container, data, options);

    // Make canvas focusable
    container.setAttribute('tabindex', '0');

    // Enable keyboard controls only when graph is focused
    container.addEventListener('focus', () => {
        if (graphNetwork) {
            graphNetwork.setOptions({ interaction: { keyboard: true } });
        }
    });

    container.addEventListener('blur', () => {
        if (graphNetwork) {
            graphNetwork.setOptions({ interaction: { keyboard: false } });
        }
    });

    // Focus graph when clicked
    container.addEventListener('click', () => {
        container.focus();
    });

    // Add click handler for negotiation
    graphNetwork.on('click', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            showAgentActions(nodeId);
        }
    });

    // Add double-click for negotiation
    graphNetwork.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            negotiateAgent(nodeId);
        }
    });
}

// Show actions for selected agent
function showAgentActions(agentName) {
    const node = currentGraphData.nodes.find(n => n.name === agentName);
    if (!node) return;

    const message = `**${agentName}**\n\nModule: ${node.module}\nMethods: ${node.methods.join(', ')}\n\nDouble-click to negotiate this agent, or type a command.`;
    addMessage(message, 'system');
}

// Store current negotiation agent
let currentNegotiationAgent = null;

// Show negotiation modal
function showNegotiationModal(agentName) {
    const node = currentGraphData.nodes.find(n => n.name === agentName);
    if (!node) return;

    currentNegotiationAgent = agentName;

    // Populate agent info
    document.getElementById('modalAgentName').textContent = agentName;
    document.getElementById('modalAgentModule').textContent = node.module;
    document.getElementById('modalAgentMethods').textContent = node.methods.join(', ') || 'None';

    // Build dependency information
    const dependencies = [];
    const dependents = [];

    currentGraphData.edges.forEach(edge => {
        if (edge.source === agentName) {
            dependencies.push(edge.target);
        }
        if (edge.target === agentName) {
            dependents.push(edge.source);
        }
    });

    // Populate dependencies
    const depList = document.getElementById('modalDependencies');
    depList.innerHTML = '';

    if (dependencies.length === 0 && dependents.length === 0) {
        depList.innerHTML = '<div style="color: #888; font-size: 13px;">No dependencies</div>';
    } else {
        if (dependencies.length > 0) {
            dependencies.forEach(dep => {
                const item = document.createElement('div');
                item.className = 'dependency-item depends-on';
                item.innerHTML = `<span style="color: #f59e0b;">↓</span> Depends on: <strong>${dep}</strong>`;
                depList.appendChild(item);
            });
        }
        if (dependents.length > 0) {
            dependents.forEach(dep => {
                const item = document.createElement('div');
                item.className = 'dependency-item used-by';
                item.innerHTML = `<span style="color: #10b981;">↑</span> Used by: <strong>${dep}</strong>`;
                depList.appendChild(item);
            });
        }
    }

    // Clear previous intent
    document.getElementById('negotiationIntent').value = '';
    document.getElementById('negotiationRounds').value = 3;

    // Show modal
    document.getElementById('negotiationModal').style.display = 'flex';
}

// Close negotiation modal
function closeNegotiationModal() {
    document.getElementById('negotiationModal').style.display = 'none';
    currentNegotiationAgent = null;
}

// Submit negotiation
async function submitNegotiation() {
    if (!workflowState.claudeInitialized) {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings.', 'system');
        closeNegotiationModal();
        return;
    }

    const intent = document.getElementById('negotiationIntent').value.trim();
    const rounds = parseInt(document.getElementById('negotiationRounds').value) || 3;

    if (!intent) {
        alert('Please provide an intent for the negotiation');
        return;
    }

    closeNegotiationModal();

    addMessage(`Starting negotiation for ${currentNegotiationAgent} with intent: "${intent}" (${rounds} rounds)`, 'assistant');

    // Use Claude to run targeted negotiation with intent
    const command = `Negotiate ${currentNegotiationAgent} with the intent to "${intent}". Run: graphbus negotiate .graphbus --intent "${intent}" --rounds ${rounds}`;

    try {
        const response = await window.graphbus.claudeChat(command, {
            hasBuilt: workflowState.hasBuilt,
            isRunning: workflowState.isRunning,
            phase: workflowState.phase,
            workingDirectory: workingDirectory
        });

        if (response.success) {
            const { message, action, params } = response.result;
            if (message) addMessage(message, 'assistant');
            if (action) await executeClaudeAction(action, params);
        }
    } catch (error) {
        addMessage(`Error: ${error.message}`, 'assistant');
    }
}

// Negotiate specific agent (called from double-click)
async function negotiateAgent(agentName) {
    if (!workflowState.claudeInitialized) {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings.', 'system');
        return;
    }

    showNegotiationModal(agentName);
}

// Negotiate all agents
async function negotiateAllAgents() {
    if (!workflowState.claudeInitialized) {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings.', 'system');
        return;
    }

    // Prompt for user intent
    const intent = prompt(`What should all agents focus on improving?\n\nExamples:\n- "optimize performance"\n- "improve error handling"\n- "enhance data validation"\n- "improve code quality"\n- "add comprehensive logging"`);

    if (!intent || intent.trim() === '') {
        addMessage('Negotiation cancelled - no intent provided', 'system');
        return;
    }

    const command = `negotiate all agents with the intent to "${intent}" for 5 rounds`;
    await sendCommand(command);
}

// Fit graph to view
function fitGraphToView() {
    if (graphNetwork) {
        graphNetwork.fit({
            animation: {
                duration: 1000,
                easingFunction: 'easeInOutQuad'
            }
        });
    }
}

// Reset graph physics
function resetGraphPhysics() {
    if (graphNetwork) {
        graphNetwork.stabilize();
        addMessage('🔄 Graph layout reset', 'system');
    }
}

// Status polling
function startStatusPolling() {
    stopStatusPolling();
    statusInterval = setInterval(updateStatus, 2000);
    updateStatus();
}

function stopStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
    }
}

async function updateStatus() {
    try {
        const result = await window.graphbus.getStats();

        if (result.success) {
            const stats = result.result;
            const statusDot = document.getElementById('statusDot');

            if (stats.is_running) {
                statusDot.classList.add('running');
                document.getElementById('nodesCount').textContent = stats.nodes_count || 0;

                if (stats.message_bus) {
                    document.getElementById('messagesPublished').textContent = stats.message_bus.messages_published || 0;
                    document.getElementById('messagesDelivered').textContent = stats.message_bus.messages_delivered || 0;
                }
            } else {
                statusDot.classList.remove('running');
            }
        }
    } catch (error) {
        console.error('Status update failed:', error);
    }
}

// Alert system (deprecated - using chat messages now)
function showAlert(message, type) {
    // Toast notifications still work but chat is primary
    console.log(`[${type}] ${message}`);
}

// Initialize working directory
async function initializeWorkingDirectory() {
    try {
        const result = await window.graphbus.getWorkingDirectory();
        if (result.success) {
            workingDirectory = result.result;
            updateWorkingDirectoryDisplay();

            // Set default artifacts directory relative to working directory
            currentArtifactsDir = `${workingDirectory}/.graphbus`;
        }
    } catch (error) {
        console.error('Failed to get working directory:', error);
        workingDirectory = '/';
    }
}

// Update working directory display
function updateWorkingDirectoryDisplay() {
    const pathElement = document.getElementById('workingDirPath');
    if (!pathElement) return;

    // Show shortened path (last 2 segments)
    const segments = workingDirectory.split('/').filter(s => s);
    const shortPath = segments.length > 2
        ? '.../' + segments.slice(-2).join('/')
        : workingDirectory;

    pathElement.textContent = shortPath;
    pathElement.title = `Click to change\nFull path: ${workingDirectory}`;
}

// Handle working directory click
async function changeWorkingDirectory() {
    try {
        // Save current conversation before changing
        await saveConversation();

        const result = await window.graphbus.browseDirectory();

        if (result.success) {
            workingDirectory = result.result;
            currentArtifactsDir = `${workingDirectory}/.graphbus`;
            updateWorkingDirectoryDisplay();

            // Clear conversation UI
            document.getElementById('messages').innerHTML = '';
            workflowState.conversationHistory = [];

            // Check for existing state in new directory
            const hasState = await checkAndLoadExistingState();

            // Load conversation from new directory
            if (hasState) {
                await loadConversation();
            }

            // Update Claude with new directory
            if (workflowState.claudeInitialized) {
                await window.graphbus.claudeUpdateDirectory(workingDirectory);
            }

            addMessage(`📁 Working directory changed to: ${workingDirectory}`, 'system');

            // Reset workflow if directory changed
            workflowState.phase = 'initial';
            workflowState.hasBuilt = hasState;
            workflowState.isRunning = false;
            updateSystemStateDisplay();
        }
    } catch (error) {
        console.error('Failed to change directory:', error);
    }
}

// View cycling state
let focusedViewIndex = 0;
const views = [
    { name: 'graph', label: 'Agent Graph' },
    { name: 'conversation', label: 'Conversation' },
    { name: 'state', label: 'System State' },
    { name: 'settings', label: 'Settings' }
];

// Cycle to next view
function cycleView(direction = 1) {
    focusedViewIndex = (focusedViewIndex + direction + views.length) % views.length;
    const view = views[focusedViewIndex];
    switchView(view.name);
    console.log(`Switched to: ${view.label}`);
}

// Keyboard shortcuts
document.addEventListener('DOMContentLoaded', async () => {
    const chatInput = document.getElementById('chatInput');
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendCommand();
        }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Tab to cycle forward, Shift+Tab to cycle backward
        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
            // Only cycle if not in any input field (chat, settings, etc.)
            const activeElement = document.activeElement;
            const isInInputField = activeElement && (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.tagName === 'SELECT'
            );

            // If not in an input field, cycle views
            if (!isInInputField) {
                e.preventDefault();
                cycleView(e.shiftKey ? -1 : 1);
            }
        }

        // Ctrl+1,2,3,4 to jump to specific view
        if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            focusedViewIndex = parseInt(e.key) - 1;
            const view = views[focusedViewIndex];
            switchView(view.name);
        }

        // Escape to focus chat input
        if (e.key === 'Escape') {
            chatInput.focus();
        }
    });

    // Add Enter key support for API key input
    const apiKeyInput = document.getElementById('apiKeyInput');
    if (apiKeyInput) {
        apiKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveApiKey();
            }
        });
    }

    // Add click handler for working directory
    const workingDirElement = document.getElementById('workingDirPath');
    if (workingDirElement) {
        workingDirElement.style.cursor = 'pointer';
        workingDirElement.addEventListener('click', changeWorkingDirectory);
    }

    // Initialize working directory first
    await initializeWorkingDirectory();

    // Initialize Claude first (needed for project creation)
    const claudeReady = await initializeClaude();

    // Check if there's an existing project or show welcome screen
    const hasExistingProject = await checkForExistingProject();

    if (hasExistingProject) {
        // Has existing project - rehydrate state
        await checkAndLoadExistingState();

        // Start polling on load
        startStatusPolling();

        if (claudeReady) {
            // Claude is ready, start orchestration
            setTimeout(() => orchestrateWorkflow(), 500);
        } else {
            // Claude not ready - show setup message
            workflowState.phase = 'initial';
            setTimeout(() => orchestrateWorkflow(), 500);
        }
    } else {
        // No existing project - welcome screen is already shown by checkForExistingProject()
        // User will choose to create new or open existing project
    }

    // Set up menu event listeners
    window.menu.onNewProject(() => {
        showNewProjectForm();
    });

    window.menu.onOpenProject(() => {
        openExistingProject();
    });

    window.menu.onChangeDirectory(() => {
        changeWorkingDirectory();
    });

    window.menu.onSwitchView((view) => {
        switchView(view);
    });

    window.menu.onBuildAgents(() => {
        if (workflowState.claudeInitialized) {
            sendCommand('build the agents');
        } else {
            addMessage('⚠️ Please configure Claude API key in Settings first', 'system');
            switchView('settings');
        }
    });

    window.menu.onNegotiate(() => {
        if (workflowState.hasBuilt) {
            switchView('conversation');
            const chatInput = document.getElementById('chatInput');
            chatInput.value = 'negotiate the agents with intent: ';
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        } else {
            addMessage('⚠️ Please build agents first before negotiating', 'system');
        }
    });

    window.menu.onStartRuntime(() => {
        if (workflowState.hasBuilt) {
            startRuntime();
        } else {
            addMessage('⚠️ Please build agents first', 'system');
        }
    });

    window.menu.onStopRuntime(() => {
        stopRuntime();
    });
});

// Rehydrate complete state from .graphbus folder
async function checkAndLoadExistingState() {
    try {
        // Call the new rehydrate-state API
        const result = await window.graphbus.rehydrateState(workingDirectory);

        if (!result.success) {
            console.log('No .graphbus directory found in', workingDirectory);
            return false;
        }

        const state = result.result;
        console.log('Rehydrating state from .graphbus:', state);

        // 1. Restore graph visualization
        if (state.graph && state.graph.nodes && state.graph.nodes.length > 0) {
            workflowState.hasBuilt = true;
            workflowState.phase = 'built';
            currentArtifactsDir = `${workingDirectory}/.graphbus`;

            console.log('Rehydrating graph with:', {
                nodeCount: state.graph.nodes.length,
                edgeCount: (state.graph.edges || []).length,
                edges: state.graph.edges
            });

            // Display the graph with dependencies
            displayAgents(state.graph.nodes, state.graph.edges || []);

            addMessage(`🔄 Rehydrated GraphBus project with ${state.graph.nodes.length} agent(s)`, 'system');
            if (state.graph.edges && state.graph.edges.length > 0) {
                addMessage(`🔗 Loaded ${state.graph.edges.length} dependency edge(s)`, 'system');
            }
        }

        // 2. Restore conversation history
        if (state.conversationHistory && state.conversationHistory.messages) {
            const messages = state.conversationHistory.messages;
            console.log(`Restoring ${messages.length} conversation messages`);

            // Clear existing messages
            const messagesContainer = document.getElementById('messages');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
            }

            // Restore each message
            messages.forEach(msg => {
                addMessage(msg.text, msg.type);
            });

            addMessage('✓ Conversation history restored', 'system');
        }

        // 3. Restore build summary
        if (state.buildSummary) {
            console.log('Build summary:', state.buildSummary);

            // Update system state display with build info
            const builtStatus = document.getElementById('builtStatus');
            if (builtStatus) {
                builtStatus.textContent = `${state.buildSummary.num_agents} agents`;
            }

            // Show negotiation info if available
            if (state.buildSummary.num_negotiations > 0) {
                addMessage(`📊 Found ${state.buildSummary.num_negotiations} negotiation rounds in history`, 'system');
            }

            // Show modified files if available
            if (state.buildSummary.modified_files && state.buildSummary.modified_files.length > 0) {
                addMessage(`📝 ${state.buildSummary.modified_files.length} file(s) modified by negotiations`, 'system');
            }
        }

        // 4. Restore negotiation history
        if (state.negotiations && state.negotiations.length > 0) {
            console.log(`Found ${state.negotiations.length} negotiations`);

            // Count unique rounds
            const rounds = new Set(state.negotiations.map(n => n.round));
            const totalCommits = state.negotiations.length;

            addMessage(`🤝 Negotiation history: ${totalCommits} commits across ${rounds.size} round(s)`, 'system');
        }

        // 5. Update workflow state display
        updateSystemStateDisplay();

        // 6. Update Claude with restored state
        if (workflowState.claudeInitialized && state.graph) {
            const agentNames = state.graph.nodes.map(n => n.name).join(', ');
            await window.graphbus.claudeAddSystemMessage(
                `State rehydrated: ${state.graph.nodes.length} agents (${agentNames}), ${state.buildSummary?.num_negotiations || 0} negotiations completed`
            );
        }

        return true;
    } catch (error) {
        console.log('No existing GraphBus state found:', error.message);
        return false;
    }
}

// Welcome Screen and Project Initialization
let selectedTemplate = 'blank';
let newProjectDirectory = null;

function showWelcomeScreen() {
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.querySelector('.main-layout').style.display = 'none';
}

function hideWelcomeScreen() {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.querySelector('.main-layout').style.display = 'flex';
}

function showNewProjectForm() {
    document.getElementById('newProjectForm').style.display = 'flex';
}

function closeNewProjectForm() {
    document.getElementById('newProjectForm').style.display = 'none';
    // Reset form
    document.getElementById('newProjectPath').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectPathError').style.display = 'none';
    newProjectDirectory = null;
    selectTemplate('blank');
}

async function browseNewProjectDirectory() {
    try {
        const result = await window.graphbus.browseDirectory();

        if (result.success && result.result) {
            const selectedPath = result.result;

            // Check if .graphbus already exists
            const checkResult = await window.graphbus.runCommand(`test -d "${selectedPath}/.graphbus" && echo "exists" || echo "missing"`);

            if (checkResult.success && checkResult.result.stdout.includes('exists')) {
                // .graphbus exists - cannot create new project here
                document.getElementById('projectPathError').textContent = '❌ This directory already contains a GraphBus project. Please choose a different directory.';
                document.getElementById('projectPathError').style.display = 'block';
                document.getElementById('newProjectPath').value = '';
                newProjectDirectory = null;
            } else {
                // Valid directory for new project
                document.getElementById('newProjectPath').value = selectedPath;
                document.getElementById('projectPathError').style.display = 'none';
                newProjectDirectory = selectedPath;
            }
        }
    } catch (error) {
        console.error('Error browsing directory:', error);
    }
}

function selectTemplate(templateName) {
    selectedTemplate = templateName;

    // Update UI
    document.querySelectorAll('.template-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`[data-template="${templateName}"]`).classList.add('selected');
}

async function createNewProject() {
    // Validate inputs
    if (!newProjectDirectory) {
        alert('Please select a project directory');
        return;
    }

    const description = document.getElementById('projectDescription').value.trim();
    if (!description) {
        alert('Please provide a project description');
        return;
    }

    // Close form
    closeNewProjectForm();
    hideWelcomeScreen();

    // Switch to conversation view
    switchView('conversation');

    // Set working directory
    await window.graphbus.setWorkingDirectory(newProjectDirectory);
    workingDirectory = newProjectDirectory;
    updateWorkingDirectoryDisplay();

    // Add message about project creation
    addMessage(`🚀 Creating new GraphBus project in ${newProjectDirectory}`, 'system');
    addMessage(`📋 Project Description: ${description}`, 'system');
    addMessage(`🎨 Template: ${selectedTemplate}`, 'system');

    // Use Claude to create the project
    if (workflowState.claudeInitialized) {
        const prompt = `Create a new GraphBus project based on this description: "${description}". Use the "${selectedTemplate}" template approach. Generate appropriate agents, build the project, and explain what you created.`;

        addMessage(prompt, 'user');

        try {
            const response = await window.graphbus.claudeChat(prompt, {
                hasBuilt: false,
                isRunning: false,
                phase: 'initial',
                workingDirectory: newProjectDirectory
            });

            if (response.success) {
                const { message, action, params } = response.result;
                if (message) addMessage(message, 'assistant');
                if (action) await executeClaudeAction(action, params);
            }
        } catch (error) {
            addMessage(`Error: ${error.message}`, 'system');
        }
    } else {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings to use AI-powered project creation.', 'system');
    }
}

async function openExistingProject() {
    try {
        const result = await window.graphbus.browseDirectory();

        if (result.success && result.result) {
            const selectedPath = result.result;

            // Check if .graphbus exists
            const checkResult = await window.graphbus.runCommand(`test -d "${selectedPath}/.graphbus" && echo "exists" || echo "missing"`);

            if (!checkResult.success || !checkResult.result.stdout.includes('exists')) {
                // No .graphbus - cannot open
                alert('❌ This directory does not contain a GraphBus project (.graphbus folder not found). Please choose a directory with an existing project or create a new one.');
                return;
            }

            // Valid existing project - load it
            hideWelcomeScreen();

            // Set working directory
            await window.graphbus.setWorkingDirectory(selectedPath);
            workingDirectory = selectedPath;
            updateWorkingDirectoryDisplay();

            // Rehydrate state
            await checkAndLoadExistingState();

            addMessage(`📂 Opened existing project: ${selectedPath}`, 'system');
        }
    } catch (error) {
        console.error('Error opening project:', error);
        alert(`Failed to open project: ${error.message}`);
    }
}

// Check if we should show welcome screen on startup
async function checkForExistingProject() {
    const result = await window.graphbus.rehydrateState(workingDirectory);

    if (!result.success || !result.result || !result.result.hasGraphbus) {
        // No existing project - show welcome screen
        showWelcomeScreen();
        return false;
    }

    // Has existing project - load it
    return true;
}

console.log('GraphBus UI Renderer loaded');
