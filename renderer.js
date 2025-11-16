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
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
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
    const msg = document.createElement('div');
    msg.className = `message ${type}`;

    // Preserve line breaks and basic formatting
    msg.style.whiteSpace = 'pre-wrap';
    msg.textContent = text;

    messages.appendChild(msg);
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
        arrows: 'to',
        color: { color: '#f59e0b', highlight: '#fbbf24' },
        smooth: { type: 'cubicBezier' }
    }));

    // Create network
    const container = document.getElementById('graphCanvas');
    const data = { nodes: visNodes, edges: visEdges };
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
            keyboard: true
        }
    };

    graphNetwork = new vis.Network(container, data, options);

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

// Negotiate specific agent
async function negotiateAgent(agentName) {
    if (!workflowState.claudeInitialized) {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings.', 'system');
        return;
    }

    addMessage(`Starting negotiation for ${agentName}...`, 'assistant');

    // Use Claude to run targeted negotiation
    const command = `Tell me about negotiating ${agentName}. What should we focus on? Then run: graphbus negotiate .graphbus --rounds 3`;

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

// Negotiate all agents
async function negotiateAllAgents() {
    if (!workflowState.claudeInitialized) {
        addMessage('⚠️ Claude not initialized. Please configure API key in Settings.', 'system');
        return;
    }

    const command = 'negotiate all agents for 5 rounds';
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

// Panel cycling state
let focusedPanelIndex = 0;
const panels = [
    { id: 'messageFlow', name: 'Conversation' },
    { id: 'graphCanvas', name: 'Agent Graph' },
    { id: 'stateTransitions', name: 'System State' },
    { id: 'settingsPanel', name: 'Settings' }
];

// Highlight active panel
function highlightActivePanel() {
    // Remove highlight from all panels
    document.querySelectorAll('.panel').forEach(panel => {
        panel.style.boxShadow = '';
        panel.style.borderColor = '#333';
    });

    // Highlight the active panel
    const activePanel = document.getElementById(panels[focusedPanelIndex].id);
    if (activePanel && activePanel.closest('.panel')) {
        const panelElement = activePanel.closest('.panel');
        panelElement.style.boxShadow = '0 0 0 2px #667eea';
        panelElement.style.borderColor = '#667eea';
    }

    // Show which panel is focused in the conversation area
    const panelName = panels[focusedPanelIndex].name;
    console.log(`Focused: ${panelName}`);
}

// Cycle to next panel
function cyclePanel(direction = 1) {
    focusedPanelIndex = (focusedPanelIndex + direction + panels.length) % panels.length;
    highlightActivePanel();
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

            // If not in an input field, cycle panels
            if (!isInInputField) {
                e.preventDefault();
                cyclePanel(e.shiftKey ? -1 : 1);
            }
        }

        // Ctrl+1,2,3,4 to jump to specific panel
        if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            focusedPanelIndex = parseInt(e.key) - 1;
            highlightActivePanel();
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

    // Try to load existing graph data if available
    const hasExistingState = await checkAndLoadExistingState();

    // Load previous conversation if exists
    if (hasExistingState) {
        await loadConversation();
    }

    // Start polling on load
    startStatusPolling();

    // Initialize Claude or start orchestration
    const claudeReady = await initializeClaude();

    if (claudeReady) {
        // Claude is ready, start orchestration
        setTimeout(() => orchestrateWorkflow(), 500);
    } else {
        // Claude not ready - show setup message
        workflowState.phase = 'initial';
        setTimeout(() => orchestrateWorkflow(), 500);
    }

    // Highlight the first panel on load
    setTimeout(() => highlightActivePanel(), 100);
});

// Check for and load existing GraphBus state
async function checkAndLoadExistingState() {
    try {
        const artifactsDir = `${workingDirectory}/.graphbus`;

        // First check if the directory exists via a simple command
        const checkResult = await window.graphbus.runCommand(`test -d "${artifactsDir}" && echo "exists" || echo "missing"`);

        if (!checkResult.success || !checkResult.result.stdout.includes('exists')) {
            console.log('No .graphbus directory found in', workingDirectory);
            return false;
        }

        // Now try to load the graph
        const result = await window.graphbus.loadGraph(artifactsDir);

        if (result.success && result.result) {
            const graphData = result.result;

            if (graphData.nodes && graphData.nodes.length > 0) {
                // We have existing agents built
                workflowState.hasBuilt = true;
                workflowState.phase = 'built';
                currentArtifactsDir = artifactsDir;

                // Display the graph with dependencies
                displayAgents(graphData.nodes, graphData.edges || []);

                addMessage(`✓ Found existing GraphBus project with ${graphData.nodes.length} agent(s)`, 'system');
                updateSystemStateDisplay();

                // Update Claude with graph state
                if (workflowState.claudeInitialized) {
                    const agentNames = graphData.nodes.map(n => n.name).join(', ');
                    await window.graphbus.claudeAddSystemMessage(
                        `Graph loaded: ${graphData.nodes.length} agents found (${agentNames})`
                    );
                }

                return true;
            }
        }
        return false;
    } catch (error) {
        // No existing state, that's fine - don't show error
        console.log('No existing GraphBus state found:', error.message);
        return false;
    }
}

console.log('GraphBus UI Renderer loaded');
