// renderer.js - UI logic and GraphBus API calls

let statusInterval;
let workingDirectory = null; // Will be set from main process
let codeMirrorEditor = null; // CodeMirror editor instance
let xterm = null; // xterm.js terminal instance
let terminalInitialized = false; // Track if terminal is initialized
let terminalMode = 'auto'; // Terminal input mode: 'auto', 'cmd', or 'prompt'

// Terminal shell-like features
let commandHistory = []; // Track command history
let historyIndex = -1; // Current position in history
let currentUser = 'user'; // Current user
let currentHostname = 'localhost'; // Current hostname
let currentIpAddress = '127.0.0.1'; // Current IP address
let systemCpuUsage = '--'; // CPU usage percentage
let systemMemoryUsage = '--'; // Memory usage percentage
let systemStorageUsage = '--'; // Storage usage percentage
let systemResourcesInterval = null; // Timer for resource updates
let graphbusVersion = 'unknown'; // GraphBus CLI version
let graphbusUiVersion = '0.1.5'; // GraphBus UI version (from package.json)
const knownCommands = ['ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'sudo', 'grep', 'find', 'git', 'npm', 'node', 'python', 'graphbus', 'help', 'clear', 'exit', 'build', 'negotiate', 'run', 'validate', 'status', 'env', 'history', 'top', 'df', 'ps'];

// Initialize CodeMirror editor (using CodeMirror 5)
function initializeCodeMirror() {
    const container = document.getElementById('fileEditorContainer');
    if (!container) return;

    codeMirrorEditor = CodeMirror(container, {
        lineNumbers: true,
        lineWrapping: true,
        theme: 'one-dark',
        mode: 'text/plain',
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        styleActiveLine: true,
        matchBrackets: true,
        autofocus: false,
        height: '100%',
        extraKeys: {
            'Ctrl-S': saveCurrentFile,
            'Cmd-S': saveCurrentFile,
            'Ctrl-Z': 'undo',
            'Cmd-Z': 'undo',
            'Ctrl-Shift-Z': 'redo',
            'Cmd-Shift-Z': 'redo',
            'Ctrl-Y': 'redo',
            'Cmd-Y': 'redo',
            'Ctrl-F': 'find',
            'Cmd-F': 'find',
            'Ctrl-H': 'replace',
            'Cmd-H': 'replace'
        }
    });

    // Set editor to fill container
    container.querySelector('.CodeMirror').style.height = '100%';
}

// Load command history from localStorage
function loadCommandHistory() {
    try {
        const saved = localStorage.getItem('terminalCommandHistory');
        commandHistory = saved ? JSON.parse(saved) : [];
        historyIndex = -1;
    } catch (e) {
        commandHistory = [];
    }
}

// Save command to history
function addToHistory(command) {
    commandHistory.push(command);
    // Keep only last 100 commands
    if (commandHistory.length > 100) {
        commandHistory.shift();
    }
    try {
        localStorage.setItem('terminalCommandHistory', JSON.stringify(commandHistory));
    } catch (e) {
        console.error('Failed to save command history:', e);
    }
    historyIndex = -1;
}

// Get command from history (up/down arrow keys)
function getHistoryCommand(direction) {
    if (commandHistory.length === 0) return '';
    if (direction === 'up') {
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
        }
    } else if (direction === 'down') {
        if (historyIndex > 0) {
            historyIndex--;
        } else {
            historyIndex = -1;
            return '';
        }
    }
    return historyIndex >= 0 ? commandHistory[commandHistory.length - 1 - historyIndex] : '';
}

// Fetch system credentials (user, hostname, IP)
async function fetchSystemCredentials() {
    try {
        // Get username using whoami
        const userResult = await window.graphbus.runCommand('whoami');
        if (userResult.success) {
            currentUser = (userResult.result.stdout || 'user').trim();
        }

        // Get hostname
        const hostResult = await window.graphbus.runCommand('hostname');
        if (hostResult.success) {
            currentHostname = (hostResult.result.stdout || 'localhost').trim();
        }

        // Get IP address
        const ipResult = await window.graphbus.runCommand("ifconfig | grep 'inet ' | grep -v 127.0.0.1 | head -1 | awk '{print $2}'");
        if (ipResult.success) {
            const ip = (ipResult.result.stdout || '127.0.0.1').trim();
            currentIpAddress = ip || '127.0.0.1';
        }

        // Update display with new credentials
        updateTerminalInfo();
    } catch (error) {
        console.error('Error fetching system credentials:', error);
    }
}

// Fetch graphbus CLI version
async function fetchGraphbusVersion() {
    try {
        const versionResult = await window.graphbus.runCommand('graphbus --version');
        if (versionResult.success) {
            const output = (versionResult.result.stdout || '').trim();
            // Extract version from output (e.g., "graphbus, version 0.1.1")
            const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
            if (versionMatch) {
                graphbusVersion = versionMatch[1];
                console.log('[Version] GraphBus CLI version:', graphbusVersion);
            }
        } else if (versionResult.result && versionResult.result.stderr) {
            console.warn('[Version] Error fetching graphbus version:', versionResult.result.stderr);
        }
        updateVersionDisplay();
    } catch (error) {
        console.error('[Version] Error fetching graphbus version:', error);
    }
}

// Update version display in the UI
function updateVersionDisplay() {
    const versionEl = document.getElementById('terminalVersions');
    if (versionEl) {
        if (graphbusVersion && graphbusVersion !== 'unknown') {
            versionEl.textContent = `UI: v${graphbusUiVersion} | CLI: v${graphbusVersion}`;
        } else {
            versionEl.textContent = `UI: v${graphbusUiVersion}`;
        }
        versionEl.title = `graphbus-ui v${graphbusUiVersion} | graphbus CLI v${graphbusVersion}`;
    }
}

// Fetch system resource information
async function fetchSystemResources() {
    try {
        // Get CPU usage
        const cpuResult = await window.graphbus.runCommand("ps aux | awk 'NR>1 {sum+=$3} END {print int(sum)}'");
        if (cpuResult.success) {
            const cpu = (cpuResult.result.stdout || '0').trim();
            systemCpuUsage = cpu ? `${cpu}%` : '--';
        }

        // Get memory usage
        const memResult = await window.graphbus.runCommand("vm_stat | grep 'Pages in' | awk '{print int($3*4096/(1024*1024*1024))}'");
        if (memResult.success) {
            const mem = (memResult.result.stdout || '0').trim();
            systemMemoryUsage = mem ? `${mem}GB` : '--';
        }

        // Get storage usage
        const storageResult = await window.graphbus.runCommand("df -h / | tail -1 | awk '{print $5}'");
        if (storageResult.success) {
            const storage = (storageResult.result.stdout || '--').trim();
            systemStorageUsage = storage || '--';
        }

        // Update display
        updateSystemResourcesDisplay();
    } catch (error) {
        console.error('Error fetching system resources:', error);
    }
}

// Update system resources in the info bar
function updateSystemResourcesDisplay() {
    const cpuEl = document.getElementById('terminalCpu');
    const memEl = document.getElementById('terminalMemory');
    const storageEl = document.getElementById('terminalStorage');

    if (cpuEl) cpuEl.textContent = systemCpuUsage;
    if (memEl) memEl.textContent = systemMemoryUsage;
    if (storageEl) storageEl.textContent = systemStorageUsage;
}

// Update terminal info display
function updateTerminalInfo() {
    const cwdElement = document.getElementById('terminalCwd');
    const cwdPrompt = document.getElementById('terminalPromptCwd');
    const userElement = document.getElementById('terminalUser');
    const userPrompt = document.getElementById('terminalPromptUser');
    const ipElement = document.getElementById('terminalIp');

    // Display full working directory (pwd)
    if (cwdElement && workingDirectory) {
        cwdElement.textContent = workingDirectory;
        cwdElement.title = workingDirectory;
    }

    // Display condensed path in prompt
    if (cwdPrompt && workingDirectory) {
        const displayPath = workingDirectory === '/' ? '~' : workingDirectory.startsWith('/Users/')
            ? workingDirectory.substring(workingDirectory.lastIndexOf('/') + 1) || workingDirectory
            : workingDirectory;
        cwdPrompt.textContent = displayPath;
    }

    // Display hostname only
    if (userElement) {
        userElement.textContent = currentHostname;
    }

    if (userPrompt) {
        userPrompt.textContent = currentHostname;
    }

    // Display IP address
    if (ipElement) {
        ipElement.textContent = currentIpAddress;
    }
}

// Show autocomplete suggestions
function showAutocomplete(input) {
    const autocompleteDiv = document.getElementById('terminalAutocomplete');
    if (!input || input.length === 0) {
        autocompleteDiv.classList.remove('show');
        return;
    }

    const inputLower = input.toLowerCase();
    const matches = knownCommands.filter(cmd => cmd.startsWith(inputLower));

    if (matches.length === 0) {
        autocompleteDiv.classList.remove('show');
        return;
    }

    autocompleteDiv.innerHTML = matches.slice(0, 5).map((cmd, i) =>
        `<div class="terminal-autocomplete-item" data-cmd="${cmd}">${cmd}</div>`
    ).join('');

    autocompleteDiv.classList.add('show');

    // Add click handlers
    autocompleteDiv.querySelectorAll('.terminal-autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            const inputField = document.getElementById('terminalInput');
            inputField.value = item.dataset.cmd;
            autocompleteDiv.classList.remove('show');
            inputField.focus();
        });
    });
}

// Execute history command
async function executeHistoryCommand() {
    writeTerminal('╔════════════════════════════════════════════════════════════╗', 'header');
    writeTerminal('║  📜 Command History                                        ║', 'header');
    writeTerminal('╚════════════════════════════════════════════════════════════╝', 'header');

    if (commandHistory.length === 0) {
        writeTerminal('(No command history yet)', 'warning');
        return;
    }

    const recentCommands = commandHistory.slice(-50); // Show last 50
    recentCommands.forEach((cmd, i) => {
        const lineNum = (commandHistory.length - recentCommands.length + i + 1).toString().padStart(4);
        writeTerminal(`  ${lineNum}  ${cmd}`);
    });
}

// Execute env command
async function executeEnvCommand() {
    writeTerminal('╔════════════════════════════════════════════════════════════╗', 'header');
    writeTerminal('║  🌍 Environment Variables                                  ║', 'header');
    writeTerminal('╚════════════════════════════════════════════════════════════╝', 'header');

    try {
        const result = await window.graphbus.runCommand('env');
        if (result.success) {
            const envOutput = (result.result.stdout || result.result || '').split('\n');
            envOutput.forEach(line => {
                if (line.trim()) {
                    writeTerminal(line);
                }
            });
        } else {
            writeTerminal('Failed to get environment variables', 'error');
        }
    } catch (error) {
        writeTerminal(`Error: ${error.message}`, 'error');
    }
}

// Use Claude Haiku to classify input as command or prompt
async function classifyInputWithHaiku(input) {
    try {
        const response = await window.graphbus.claudeChat(
            `Classify this input as either 'command' or 'prompt'. Respond with ONLY one word: "command" or "prompt".\n\nInput: ${input}`,
            { role: 'classifier' }
        );

        if (response.success && response.result.message) {
            const classification = response.result.message.trim().toLowerCase();
            if (classification.includes('command')) return 'command';
            if (classification.includes('prompt')) return 'prompt';
        }
    } catch (error) {
        console.error('Error classifying input:', error);
    }

    // Fallback to regex detection if Haiku fails
    return detectInputType(input);
}

// Detect if input is a command or a prompt (fallback regex-based detection)
function detectInputType(input) {
    const trimmed = input.trim().toLowerCase();

    // Known system commands - only these specific ones at the start
    const knownCommands = ['ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'sudo', 'grep', 'find', 'git', 'npm', 'node', 'python', 'graphbus', 'help', 'clear', 'exit', 'build', 'negotiate', 'run', 'validate'];

    // Check if starts with known command
    const startsWithKnownCommand = knownCommands.some(cmd => trimmed === cmd || /^\s*/.test(trimmed) && trimmed.startsWith(cmd + ' '));

    // Command patterns (only specific ones)
    const commandPatterns = [
        /^(ls|cd|pwd|cat|echo|mkdir|rm|cp|mv|chmod|sudo|grep|find|git|npm|node|python|graphbus|help|clear|exit|build|negotiate|run|validate)(\s|$)/,  // known command with optional args
        /^-[a-zA-Z]/,   // flag-like (starts with -)
        /^--[a-z]/,     // long flag
    ];

    // Natural language prompt indicators - these should be treated as prompts
    const promptIndicators = [
        /\?$/,          // ends with ?
        /^(how|what|why|when|where|who|do|can|should|will|is|are|help\s+me|tell\s+me|show\s+me|explain|describe|list)\b/i,
        /\b(please|help|need|want|make|create|generate|build|implement|would|could|can you|please|setup|configure|design)\b/i
    ];

    // Check patterns
    const isCommand = commandPatterns.some(p => p.test(trimmed));
    const isPrompt = promptIndicators.some(p => p.test(trimmed));

    // Priority: explicit prompts win over ambiguous patterns
    if (isPrompt) return 'prompt';
    if (isCommand) return 'command';
    if (!trimmed) return null;

    // Default: if it has prompt keywords, treat as prompt, otherwise command
    return 'prompt';  // Default to prompt for ambiguous input
}

// Write output to terminal
function writeTerminal(text, type = 'output') {
    const outputDiv = document.getElementById('terminalOutput');
    if (!outputDiv) return;

    const line = document.createElement('div');
    line.className = 'terminal-line';

    // Format based on type
    if (type === 'header') {
        line.style.color = '#667eea';
        line.style.fontWeight = 'bold';
        line.style.marginTop = '6px';
    } else if (type === 'error') {
        line.style.color = '#ff5555';
    } else if (type === 'warning') {
        line.style.color = '#ffff55';
    } else if (type === 'success') {
        line.style.color = '#55ff55';
    } else if (type === 'command') {
        line.style.color = '#667eea';
        line.style.marginTop = '4px';
        line.style.fontWeight = '600';
    }

    line.textContent = text;
    outputDiv.appendChild(line);

    // Auto-scroll to bottom
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

// Add a visual separator line to the terminal
function writeTerminalSeparator() {
    const outputDiv = document.getElementById('terminalOutput');
    if (!outputDiv) return;

    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.style.marginTop = '8px';
    line.style.marginBottom = '8px';
    line.style.color = '#333';
    line.style.fontSize = '11px';
    line.textContent = '─────────────────────────────────────────────────────';
    outputDiv.appendChild(line);

    // Auto-scroll to bottom
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

// Initialize HTML-based terminal
function initializeTerminal() {
    const outputDiv = document.getElementById('terminalOutput');
    const inputField = document.getElementById('terminalInput');
    const modeButtons = document.querySelectorAll('.mode-btn');
    const envVarsBtn = document.getElementById('envVarsBtn');
    const historyBtn = document.getElementById('historyBtn');

    if (!outputDiv || !inputField) return;

    terminalInitialized = true;

    // Load command history
    loadCommandHistory();

    // Fetch system credentials (user, hostname, IP)
    fetchSystemCredentials();

    // Fetch graphbus version
    fetchGraphbusVersion();

    // Update terminal info display
    updateTerminalInfo();

    // Fetch system resources initially and then every 5 seconds
    fetchSystemResources();
    if (systemResourcesInterval) clearInterval(systemResourcesInterval);
    systemResourcesInterval = setInterval(() => {
        fetchSystemResources();
    }, 5000);

    // Write welcome message
    writeTerminal('╔════════════════════════════════════════════════════════════╗', 'header');
    writeTerminal('║  📡 GraphBus Terminal - Claude AI Orchestration             ║', 'header');
    writeTerminal('║  Powered by Claude for intelligent agent management         ║', 'header');
    writeTerminal('╚════════════════════════════════════════════════════════════╝', 'header');
    writeTerminal('');
    writeTerminal('Mode: Auto-detect with Claude Haiku');
    writeTerminal('Keyboard shortcuts: ↑/↓ = History, Tab = Autocomplete, Ctrl+C = Clear');
    writeTerminal('Available modes:');
    writeTerminal('  • Commands: ls, build, negotiate, run, validate, status');
    writeTerminal('  • Questions: Natural language queries sent to Claude');
    writeTerminal('  • Type "help" for more information');
    writeTerminal('');

    // Handle mode button clicks
    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            terminalMode = btn.dataset.mode;
            writeTerminal(`Mode changed to: ${btn.textContent}`, 'header');
            inputField.focus();
        });
    });

    // Handle Env button
    if (envVarsBtn) {
        envVarsBtn.addEventListener('click', async () => {
            await executeEnvCommand();
            inputField.focus();
        });
    }

    // Handle History button
    if (historyBtn) {
        historyBtn.addEventListener('click', async () => {
            await executeHistoryCommand();
            inputField.focus();
        });
    }

    // Handle input field keyboard events
    inputField.addEventListener('keydown', async (e) => {
        // Arrow keys for history navigation
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const cmd = getHistoryCommand('up');
            inputField.value = cmd;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const cmd = getHistoryCommand('down');
            inputField.value = cmd;
        }
        // Tab for autocomplete
        else if (e.key === 'Tab') {
            e.preventDefault();
            const input = inputField.value.trim();
            if (input) {
                showAutocomplete(input);
            }
        }
        // Ctrl+C to clear
        else if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            inputField.value = '';
            document.getElementById('terminalAutocomplete').classList.remove('show');
        }
    });

    // Handle input for autocomplete
    inputField.addEventListener('input', (e) => {
        const input = e.target.value.trim();
        if (input.length > 0 && !input.includes(' ')) {
            showAutocomplete(input);
        } else {
            document.getElementById('terminalAutocomplete').classList.remove('show');
        }
    });

    // Handle input field Enter key
    inputField.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const input = inputField.value.trim();
            inputField.value = ''; // Clear input
            document.getElementById('terminalAutocomplete').classList.remove('show');

            if (!input) return;

            // Add to history
            addToHistory(input);

            // Echo input to terminal
            writeTerminal(`$ ${input}`, 'command');

            // Determine input type based on mode
            let inputType;
            if (terminalMode === 'auto') {
                // Use Haiku for classification
                inputType = await classifyInputWithHaiku(input);
            } else if (terminalMode === 'cmd') {
                inputType = 'command';
            } else {
                inputType = 'prompt';
            }

            if (inputType) {
                writeTerminal(`[${terminalMode === 'auto' ? '🤖 AI-detected' : '👤 Forced'} as ${inputType === 'command' ? '⚙️ COMMAND' : '❓ PROMPT'}]`);
                writeTerminal('');

                if (inputType === 'command') {
                    await executeTerminalCommand(input);
                } else {
                    await sendPromptToClaude(input);
                }
            }

            writeTerminal('');
        }
    });

    // Focus input field by default
    inputField.focus();
}

// Execute terminal command
async function executeTerminalCommand(command) {
    const trimmed = command.trim();

    // Handle built-in commands
    if (trimmed === 'help') {
        writeTerminal('Available commands:', 'header');
        writeTerminal('  build       - Build the agent system');
        writeTerminal('  negotiate   - Run agent negotiation');
        writeTerminal('  run         - Start the runtime');
        writeTerminal('  validate    - Validate the agent setup');
        writeTerminal('  ls          - List project files');
        writeTerminal('  status      - Show orchestration status');
        writeTerminal('  clear       - Clear terminal');
        writeTerminal('  help        - Show this help');
        writeTerminal('  exit        - Exit terminal');
        return;
    }

    if (trimmed === 'status') {
        writeTerminal('📊 Orchestration Status:', 'header');
        writeTerminal(`Phase: ${workflowState.phase}`);
        writeTerminal(`Built: ${workflowState.hasBuilt ? '✅ Yes' : '❌ No'}`);
        writeTerminal(`Running: ${workflowState.isRunning ? '✅ Yes' : '❌ No'}`);
        writeTerminal(`Agents Loaded: ${workflowState.agentsLoaded ? '✅ Yes' : '❌ No'}`);
        writeTerminal(`Claude Ready: ${workflowState.claudeInitialized ? '✅ Yes' : '❌ No'}`);
        return;
    }

    if (trimmed === 'clear') {
        const outputDiv = document.getElementById('terminalOutput');
        if (outputDiv) outputDiv.innerHTML = '';
        return;
    }

    if (trimmed === 'exit') {
        writeTerminal('Goodbye!');
        return;
    }

    // Execute system command via GraphBus
    writeTerminal(`⚙️  Executing: ${trimmed}`, 'command');

    try {
        const result = await window.graphbus.runCommand(trimmed);
        if (result.success) {
            // Handle stdout/stderr output
            const output = (result.result.stdout || result.result || '').split('\n');
            if (output.length > 0 && output.some(line => line.trim())) {
                writeTerminal('📋 Output:', 'header');
                output.forEach(line => {
                    if (line.trim()) writeTerminal(`  ${line}`);
                });
            }

            // Show stderr if present
            if (result.result.stderr) {
                writeTerminal('⚠️  Errors:', 'warning');
                result.result.stderr.split('\n').forEach(line => {
                    if (line.trim()) writeTerminal(`  ${line}`, 'warning');
                });
            }
        } else {
            writeTerminal(`❌ Error: ${result.error || result.message}`, 'error');
        }
    } catch (error) {
        writeTerminal(`❌ Error: ${error.message}`, 'error');
    }
}

// Send prompt to Claude
async function sendPromptToClaude(prompt) {
    // Show that we're sending to Claude
    writeTerminal(`📡 Sending to Claude AI...`, 'command');

    try {
        // Check if Claude is initialized
        if (!workflowState.claudeInitialized) {
            writeTerminal(`⚠️  Claude not yet initialized. Using fallback interpretation.`, 'warning');
            const handled = await interpretCommand(prompt);
            if (!handled) {
                writeTerminal(`❌ Could not interpret command. Try "help" for available options.`, 'error');
            }
            return;
        }

        // Send to Claude with full context
        const response = await window.graphbus.claudeChat(prompt, {
            hasBuilt: workflowState.hasBuilt,
            isRunning: workflowState.isRunning,
            phase: workflowState.phase,
            agentsLoaded: workflowState.agentsLoaded,
            workingDirectory: workingDirectory
        });

        if (response.success) {
            const { message, action, params, plan } = response.result;

            // Display Claude's response
            if (message) {
                writeTerminal(`🤖 Claude:`, 'header');
                const lines = message.split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        writeTerminal(`  ${line}`);
                    }
                });
            }

            // If Claude suggested an action, execute it
            if (action) {
                writeTerminal(`⚙️  Executing: ${action}`, 'command');
                if (params) {
                    writeTerminal(`   Parameters: ${JSON.stringify(params)}`);
                }

                // Execute the suggested action
                if (action === 'run_command' && params && params.command) {
                    try {
                        const cmdResult = await window.graphbus.runCommand(params.command);
                        if (cmdResult.success) {
                            if (cmdResult.result.stdout) {
                                const lines = cmdResult.result.stdout.split('\n');
                                lines.forEach(line => {
                                    if (line.trim()) writeTerminal(line);
                                });
                            }
                        } else {
                            writeTerminal(`❌ Command failed: ${cmdResult.error || 'Unknown error'}`, 'error');
                            if (cmdResult.result && cmdResult.result.stderr) {
                                const errLines = cmdResult.result.stderr.split('\n');
                                errLines.forEach(line => {
                                    if (line.trim()) writeTerminal(`  ${line}`, 'error');
                                });
                            }
                        }
                    } catch (error) {
                        writeTerminal(`❌ Error executing command: ${error.message}`, 'error');
                    }
                }
            }

            // Check for structured plan
            const structuredPlan = plan || parsePlanFromClaudeResponse(response.result);
            if (structuredPlan) {
                writeTerminal(`📋 Plan Created: ${structuredPlan.name}`, 'header');
                if (structuredPlan.agents && structuredPlan.agents.length > 0) {
                    writeTerminal(`   Agents: ${structuredPlan.agents.map(a => a.name).join(', ')}`);
                }
            }
        } else {
            writeTerminal(`❌ Error: ${response.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        writeTerminal(`❌ Error communicating with Claude: ${error.message}`, 'error');
    }
}

// Rehydrate project state from working directory
async function rehydrateState(dir) {
    try {
        console.log('[Rehydrate] Starting state rehydration for:', dir);
        const result = await window.graphbus.rehydrateState(dir);
        if (result && result.success) {
            console.log('[Rehydrate] State rehydrated successfully');
            // Trigger initial update of views
            updateSystemStateDisplay();
        } else {
            console.error('[Rehydrate] Failed to rehydrate state:', result?.error);
        }
    } catch (error) {
        console.error('[Rehydrate] Error rehydrating state:', error);
    }
}

// Listen for initial working directory from main process (when passed via CLI args)
let initialWorkingDirReceived = false; // Flag to track if CLI dir was passed

window.menu.onInitialWorkingDirectory((dir) => {
    console.log('[Renderer] Received initial working directory:', dir);
    workingDirectory = dir;
    initialWorkingDirReceived = true;

    // Function to initialize and show main layout
    async function initializeAndShowMainLayout() {
        try {
            console.log('[Renderer] Initializing with directory:', dir);

            // First, rehydrate the state
            await rehydrateState(dir);
            console.log('[Renderer] State rehydration complete');

            // Initialize terminal if needed
            if (!terminalInitialized) {
                console.log('[Renderer] Initializing terminal...');
                initializeTerminal();
                console.log('[Renderer] Terminal initialized');
            }

            // Now show main layout
            const loadingScreen = document.getElementById('loadingScreen');
            const welcomeScreen = document.getElementById('welcomeScreen');
            const mainLayout = document.querySelector('.main-layout');

            if (loadingScreen) {
                console.log('[Renderer] Hiding loading screen');
                loadingScreen.classList.add('hidden');
            }
            if (welcomeScreen) {
                welcomeScreen.classList.add('hidden');
            }
            if (mainLayout) {
                console.log('[Renderer] Showing main layout');
                mainLayout.classList.add('visible');
            }

            // Switch to terminal view
            console.log('[Renderer] Switching to conversation view');
            switchView('conversation');

            // Start status polling
            startStatusPolling();
            console.log('[Renderer] Status polling started');
        } catch (error) {
            console.error('[Renderer] Error during initialization:', error);
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.classList.add('hidden');
            }
            addMessage('❌ Error initializing project: ' + error.message, 'error');
        }
    }

    // Wait for DOM to be ready before initializing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAndShowMainLayout);
    } else {
        // DOM is already loaded
        initializeAndShowMainLayout();
    }
});
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

// currentDraft stores current input when navigating history
let currentDraft = '';

// Auto-negotiation tracking
let pendingAutoNegotiation = false;
let autoNegotiationIntent = '';

// Project metadata
let projectDescription = ''; // Editable project description/intent

// Command history persistence
const HISTORY_STORAGE_KEY = 'graphbus_command_history';
const MAX_HISTORY_SIZE = 100;
let autocompleteIndex = -1;

// Process flow control
let isProcessing = false;
let inputQueue = [];
let lastEscapeTime = 0;
const DOUBLE_ESC_THRESHOLD = 500; // ms
let currentWorkflowStage = 'init';
let workflowDAG = null;
let workflowPlan = null; // Stores the created DAG plan
let existingAgents = []; // Track agents found during check_agents stage

// Reverse search state
let reverseSearchActive = false;
let reverseSearchIndex = 0;
let reverseSearchQuery = '';



/**
 * Define default workflow stages (can be customized per request)
 */
const DEFAULT_WORKFLOW_STAGES = {
    init: {
        name: 'Initialize',
        description: 'Setting up the project',
        autoProgress: true,
        nextStage: 'check_agents',
        action: () => ({ prompt: '🚀 Checking your project structure...', autoRun: true })
    },

    check_agents: {
        name: 'Check Agents',
        description: 'Analyzing existing agents',
        autoProgress: false,
        nextStage: 'generate_agents',
        requiredInput: false,
        action: () => ({ prompt: '🔍 Checking for existing agents...', command: 'ls -la agents/' })
    },

    generate_agents: {
        name: 'Generate Agents',
        description: 'Creating new agent files',
        autoProgress: false,
        nextStage: 'build',
        requiredInput: false,
        condition: (state) => !state.hasAllAgents,
        action: (state) => ({
            prompt: `📝 Generating missing agents (need: ${state.neededAgents?.join(', ') || 'agents'})...`,
            autoRun: true
        })
    },

    build: {
        name: 'Build',
        description: 'Building agent dependency graph',
        autoProgress: true,
        nextStage: 'negotiate',
        action: (state) => ({
            prompt: `🏗️ Building agents and analyzing dependencies...\n💡 Intent: "${projectDescription || state.intent || 'improve system'}"`,
            command: 'graphbus build agents/ --enable-agents -v',
            autoRun: true
        })
    },

    negotiate: {
        name: 'Negotiate',
        description: 'Running agent self-assessment',
        autoProgress: false,
        nextStage: 'runtime',
        requiredInput: false,
        action: (state) => ({
            prompt: `🤝 Running negotiation with intent: "${projectDescription || state.intent || 'improve system'}"`,
            command: `graphbus negotiate .graphbus --intent "${projectDescription || state.intent || 'enhance agent implementation'}" --rounds 5 -v`,
            autoRun: true
        })
    },

    runtime: {
        name: 'Runtime',
        description: 'Starting agent orchestration',
        autoProgress: true,
        nextStage: 'complete',
        action: () => ({
            prompt: '⚙️ Starting GraphBus runtime with agent orchestration...',
            command: 'graphbus run .graphbus',
            autoRun: true
        })
    },

    complete: {
        name: 'Complete',
        description: 'Workflow finished',
        autoProgress: false,
        action: () => ({
            prompt: '✅ Workflow complete! Your agents are ready. What would you like to do next?',
            requiresUserInput: true
        })
    }
};

/**
 * Parse structured plan from Claude's response object
 */
function parsePlanFromClaudeResponse(response) {
    if (!response || !response.plan) {
        return null;
    }

    console.log('[Plan] Extracted structured plan from Claude response');
    return response.plan;
}

/**
 * Display a structured plan from Claude to the user
 */
function displayStructuredPlan(plan) {
    if (!plan) return;

    console.log('[Plan] Displaying structured plan:', plan.name);

    // Show plan header
    let planDisplay = `📋 **PLAN: ${plan.name}**\n`;
    planDisplay += `Intent: ${plan.intent}\n\n`;

    // Show proposed agents
    if (plan.agents && plan.agents.length > 0) {
        planDisplay += `**Proposed Agents:**\n`;
        plan.agents.forEach(agent => {
            planDisplay += `• ${agent.name} - ${agent.description}\n`;
            if (agent.topics && agent.topics.length > 0) {
                planDisplay += `  Topics: ${agent.topics.join(', ')}\n`;
            }
        });
        planDisplay += `\n`;
    }

    // Show pub/sub topology
    if (plan.pub_sub_topology && Object.keys(plan.pub_sub_topology).length > 0) {
        planDisplay += `**Pub/Sub Topology:**\n`;
        Object.entries(plan.pub_sub_topology).forEach(([topic, description]) => {
            planDisplay += `• ${topic}: ${description}\n`;
        });
        planDisplay += `\n`;
    }

    // Show workflow stages
    if (plan.workflow_stages && plan.workflow_stages.length > 0) {
        planDisplay += `**Workflow Stages:**\n`;
        plan.workflow_stages.forEach((stage, idx) => {
            planDisplay += `${idx + 1}. ${stage.stage.toUpperCase()} - ${stage.description}\n`;
        });
    }

    addMessage(planDisplay, 'system');
}

/**
 * Convert structured plan to DAG stages
 */
function createDAGFromPlan(plan) {
    console.log('[Plan] Converting structured plan to DAG stages');

    if (!plan || !plan.workflow_stages) {
        console.log('[Plan] No workflow stages in plan, using defaults');
        return { dag: DEFAULT_WORKFLOW_STAGES, stageOrder: ['init'], intent: '' };
    }

    // Create custom DAG from plan's workflow stages
    let dag = { ...DEFAULT_WORKFLOW_STAGES };
    let stageOrder = [];

    // CRITICAL: Always ensure check_agents comes before generate_agents
    const hasCheckAgents = plan.workflow_stages.some(s => s.stage.toLowerCase() === 'check_agents');
    const hasGenerateAgents = plan.workflow_stages.some(s => s.stage.toLowerCase() === 'generate_agents');

    if (hasGenerateAgents && !hasCheckAgents) {
        console.log('[Plan] Adding check_agents stage before generate_agents (search-first pattern)');
        plan.workflow_stages.unshift({
            stage: 'check_agents',
            command: 'ls -la agents/',
            description: 'Check existing agents first (never generate duplicates)'
        });
    }

    // Map plan stages to DAG stages
    plan.workflow_stages.forEach((stage, idx) => {
        const stageName = stage.stage.toLowerCase();

        // Add stage to order if not already there
        if (!stageOrder.includes(stageName)) {
            stageOrder.push(stageName);
        }

        // Update DAG entry with plan details
        if (!dag[stageName]) {
            dag[stageName] = {
                name: stage.stage.toUpperCase(),
                description: stage.description,
                autoProgress: false,
                nextStage: null
            };
        }

        // Set up next stage link - find next stage in the filtered order
        const nextIdx = plan.workflow_stages.findIndex(s => s.stage.toLowerCase() === stageName) + 1;
        if (nextIdx < plan.workflow_stages.length) {
            const nextStage = plan.workflow_stages[nextIdx].stage.toLowerCase();
            dag[stageName].nextStage = nextStage;
        } else {
            dag[stageName].nextStage = 'complete';
        }

        // Add action if command is specified
        if (stage.command) {
            dag[stageName].command = stage.command;
            dag[stageName].action = () => ({
                prompt: `▶️ ${stage.description}`,
                command: stage.command,
                autoRun: true
            });
        } else if (stage.commands && stage.commands.length > 0) {
            // Handle multiple commands (like generate_agents)
            dag[stageName].commands = stage.commands;
            dag[stageName].action = () => ({
                prompt: `▶️ ${stage.description}`,
                commands: stage.commands,
                autoRun: true
            });
        }
    });

    return {
        dag: dag,
        stageOrder: stageOrder,
        intent: plan.intent || '',
        plan: plan
    };
}

/**
 * Create a custom DAG based on Claude's analysis and current context
 */
function createWorkflowDAG(claudeMessage, context = {}) {
    console.log(`[DAG] Creating DAG based on Claude's analysis and context`);

    // Parse Claude's message to understand what will happen
    const lowerMsg = claudeMessage.toLowerCase();

    // Build the DAG based on context
    let dag = { ...DEFAULT_WORKFLOW_STAGES };
    let stageOrder = [];

    // Always start from current position, don't restart
    if (context.currentStage) {
        stageOrder = [context.currentStage];
    } else {
        stageOrder = ['init'];
    }

    // Analyze what Claude says it will do
    const willCheck = /check|inspect|list|scan/i.test(lowerMsg);
    const willGenerate = /generate|create|new/i.test(lowerMsg);
    const willBuild = /build|compile|analyze/i.test(lowerMsg);
    const willNegotiate = /negotiate|improve|self-assess|optimize/i.test(lowerMsg);
    const willRun = /run|execute|start|activate/i.test(lowerMsg);

    // Build the pipeline based on what Claude will do
    if (willCheck && !stageOrder.includes('check_agents')) {
        stageOrder.push('check_agents');
    }

    if (willGenerate && !stageOrder.includes('generate_agents')) {
        stageOrder.push('generate_agents');
    }

    if (willBuild && !stageOrder.includes('build')) {
        stageOrder.push('build');
    }

    if (willNegotiate && !stageOrder.includes('negotiate')) {
        stageOrder.push('negotiate');
    }

    if (willRun && !stageOrder.includes('runtime')) {
        stageOrder.push('runtime');
    }

    // Add completion stage
    if (!stageOrder.includes('complete')) {
        stageOrder.push('complete');
    }

    // If only has initial stage, use full pipeline
    if (stageOrder.length === 1) {
        stageOrder = ['init', 'check_agents', 'generate_agents', 'build', 'negotiate', 'runtime', 'complete'];
    }

    // Link stages in order
    for (let i = 0; i < stageOrder.length - 1; i++) {
        const currentStage = stageOrder[i];
        const nextStage = stageOrder[i + 1];
        if (dag[currentStage]) {
            dag[currentStage].nextStage = nextStage;
        }
    }

    // Mark last stage as having no next
    const lastStage = stageOrder[stageOrder.length - 1];
    if (dag[lastStage]) {
        dag[lastStage].nextStage = null;
    }

    console.log(`[DAG] Created context-aware DAG: ${stageOrder.join(' → ')}`);
    return { dag, stageOrder, message: claudeMessage, context };
}

/**
 * Display the DAG plan for user approval
 */
function displayWorkflowPlan(plan) {
    const { stageOrder, intent } = plan;

    let planText = `📋 **Workflow Plan**\n\n`;
    planText += `Intent: "${intent}"\n\n`;
    planText += `Stages:\n`;

    stageOrder.forEach((stage, idx) => {
        const stageInfo = plan.dag[stage];
        planText += `${idx + 1}. ${stageInfo?.name || stage}\n`;
    });

    addMessage(planText, 'system');
    addMessage('Starting execution...', 'system');
}

/**
 * Initialize workflow DAG (legacy - now creates on demand)
 */
function initializeWorkflowDAG() {
    // Use default stages for initialization
    workflowDAG = DEFAULT_WORKFLOW_STAGES;
    console.log('[DAG] Default workflow stages loaded');
}

/**
 * Get current stage info
 */
function getCurrentStageInfo() {
    return workflowDAG[currentWorkflowStage] || workflowDAG.init;
}

/**
 * Move to next stage in DAG
 */
async function progressToNextStage() {
    const currentStage = getCurrentStageInfo();

    if (!currentStage.nextStage) {
        console.log('[DAG] No next stage defined');
        return false;
    }

    const nextStage = currentStage.nextStage;
    console.log(`[DAG] Progressing: ${currentWorkflowStage} → ${nextStage}`);

    currentWorkflowStage = nextStage;
    const stageInfo = getCurrentStageInfo();

    // Show stage transition
    addMessage(`➡️ Moving to: ${stageInfo.name}`, 'system');

    // Execute stage action
    if (stageInfo.action) {
        const actionResult = stageInfo.action({ intent: autoNegotiationIntent });

        if (actionResult.prompt) {
            addMessage(actionResult.prompt, 'system');
        }

        // Auto-run single command if specified
        if (actionResult.command && actionResult.autoRun) {
            console.log(`[DAG] Auto-running: ${actionResult.command}`);
            await new Promise(resolve => setTimeout(resolve, 500));
            await queueOrExecuteCommand(actionResult.command);
            return true;
        }

        // Auto-run multiple commands if specified (e.g., generate_agents)
        if (actionResult.commands && actionResult.autoRun && Array.isArray(actionResult.commands)) {
            console.log(`[DAG] Auto-running ${actionResult.commands.length} commands`);

            // For generate_agents stage, filter out commands for agents that already exist
            let commandsToRun = actionResult.commands;
            if (currentWorkflowStage === 'generate_agents' && existingAgents.length > 0) {
                commandsToRun = filterGenerateCommands(actionResult.commands);
                if (commandsToRun.length === 0) {
                    addMessage('✓ All planned agents already exist - skipping generation', 'system');
                    return true;
                }
            }

            for (const cmd of commandsToRun) {
                await new Promise(resolve => setTimeout(resolve, 300));
                await queueOrExecuteCommand(cmd);
            }
            return true;
        }

        // If requires user input, prompt for it
        if (actionResult.requiresUserInput) {
            isProcessing = false;
            addMessage(`💬 Your input needed: ${actionResult.prompt}`, 'system');
            document.getElementById('chatInput').focus();
            return false;
        }
    }

    return true;
}

/**
 * Check if we should auto-progress to next stage
 */
async function checkAndAutoProgress() {
    const currentStage = getCurrentStageInfo();

    // If stage has autoProgress enabled and no next action is running
    if (currentStage.autoProgress && !isProcessing) {
        console.log(`[DAG] Auto-progressing from ${currentWorkflowStage}`);
        await progressToNextStage();
    }
}

/**
 * Add command to input queue if processing, otherwise execute immediately
 */
function queueOrExecuteCommand(command) {
    if (isProcessing) {
        console.log(`[Queue] Added to input queue: ${command}`);
        inputQueue.push(command);
        addMessage(`📋 Queued: ${command}`, 'system');
    } else {
        // Execute immediately
        document.getElementById('chatInput').value = command;
        sendCommand();
    }
}

/**
 * Process next queued input
 */
async function processNextQueuedInput() {
    if (inputQueue.length > 0) {
        const nextCommand = inputQueue.shift();
        console.log(`[Queue] Processing queued command: ${nextCommand}`);
        addMessage(`▶️ Auto-executing: ${nextCommand}`, 'system');

        // Small delay to ensure UI updates
        await new Promise(resolve => setTimeout(resolve, 500));

        document.getElementById('chatInput').value = nextCommand;
        await sendCommand();
    }
}

/**
 * Analyze Claude's response for task completion and auto-continue decision
 */
function analyzeClaudeResponse(message) {
    const lowerMsg = message.toLowerCase();

    // Check if task is handed back to user
    const handedToUser = /(?:your turn|ready for|waiting for|awaiting|user|you can|try|next step|proceed with)/i.test(message);

    // Check for self-evident next steps the AI should continue with
    const shouldAutoContinue = /(?:let me|i'll|now|next|then|proceeding|running|executing)/i.test(message) &&
        !handedToUser;

    // Check for explicit continuation markers
    const hasContMsg = /continuing|moving on|next up|generating|building|running/i.test(message);

    return {
        handedToUser,
        shouldAutoContinue: shouldAutoContinue || hasContMsg,
        requiresUserInput: handedToUser && lowerMsg.includes('?'),
        isComplete: /complete|done|finished|success|ready/i.test(message) && handedToUser
    };
}

/**
 * Parse check_agents output to extract existing agent file names
 */
function parseExistingAgents(output) {
    console.log('[Agents] Parsing existing agents from ls output');

    existingAgents = [];

    // Extract .py files from ls output
    const lines = output.split('\n');
    lines.forEach(line => {
        const match = line.match(/(\w+(?:_\w+)*_agent\.py)$/);
        if (match) {
            const filename = match[1];
            const agentName = filename.replace(/_agent\.py$/, '').replace(/_/g, ' ');
            existingAgents.push({
                filename: filename,
                name: agentName,
                baseName: filename.replace(/.py$/, '')
            });
        }
    });

    console.log(`[Agents] Found ${existingAgents.length} existing agents:`, existingAgents.map(a => a.filename));
    return existingAgents;
}

/**
 * Check if an agent matches an existing one (case-insensitive, name normalization)
 */
function agentAlreadyExists(plannedAgentName) {
    const normalized = plannedAgentName.toLowerCase().replace(/\s+/g, '_');

    return existingAgents.some(existing => {
        // Check multiple naming patterns
        const existingBase = existing.baseName.toLowerCase();
        return (
            existingBase === normalized ||
            existingBase.includes(normalized) ||
            normalized.includes(existingBase) ||
            existingBase.includes(normalized.replace(/_agent$/, '')) ||
            normalized.replace(/_agent$/, '') === existingBase.replace(/_agent$/, '')
        );
    });
}

/**
 * Filter generate_agents commands to only include truly missing agents
 */
function filterGenerateCommands(commands) {
    if (!Array.isArray(commands)) return commands;

    console.log('[Agents] Filtering generate commands - checking against existing agents');

    const filtered = commands.filter(cmd => {
        // Extract agent name from "graphbus generate agent AgentName" command
        const match = cmd.match(/graphbus generate agent (\w+)/i);
        if (!match) return true; // Keep if we can't parse

        const agentName = match[1];

        if (agentAlreadyExists(agentName)) {
            console.log(`[Agents] SKIPPING generation of ${agentName} - already exists`);
            return false; // Filter out - agent already exists
        }

        console.log(`[Agents] WILL generate ${agentName} - not found in existing agents`);
        return true; // Keep - need to generate
    });

    return filtered;
}

/**
 * Cancel current flow - clear processing state and queues
 */
function cancelFlow() {
    console.log('[Flow] Cancelling current flow');
    isProcessing = false;
    inputQueue = [];
    document.getElementById('chatInput').value = '';
    addMessage('🛑 Flow cancelled. Ready for new input.', 'system');
}

/**
 * Load command history from localStorage
 */
function loadCommandHistory() {
    try {
        const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (stored) {
            commandHistory = JSON.parse(stored);
            console.log(`Loaded ${commandHistory.length} commands from history`);
        }
    } catch (error) {
        console.error('Failed to load command history:', error);
    }
}

/**
 * Save command history to localStorage
 */
function saveCommandHistory() {
    try {
        // Keep only recent commands
        const recentHistory = commandHistory.slice(-MAX_HISTORY_SIZE);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(recentHistory));
    } catch (error) {
        console.error('Failed to save command history:', error);
    }
}

/**
 * Get autocomplete suggestions
 */
function getAutocompleteSuggestions(input) {
    const suggestions = [];
    const lowerInput = input.toLowerCase();

    // GraphBus commands
    const graphbusCommands = [
        'graphbus build agents/ --enable-agents -v',
        'graphbus run .graphbus',
        'graphbus negotiate .graphbus --intent "',
        'graphbus inspect .graphbus',
        'graphbus generate agent ',
        'graphbus list-templates',
        'graphbus validate agents/',
        'graphbus dashboard .graphbus'
    ];

    // Add matching GraphBus commands
    graphbusCommands.forEach(cmd => {
        if (cmd.toLowerCase().includes(lowerInput)) {
            suggestions.push(cmd);
        }
    });

    // Add matching previous commands
    commandHistory.forEach(cmd => {
        if (cmd.toLowerCase().includes(lowerInput) && !suggestions.includes(cmd)) {
            suggestions.push(cmd);
        }
    });

    return suggestions.slice(0, 5); // Top 5 suggestions
}

/**
 * Start reverse search (Ctrl+R)
 */
function startReverseSearch() {
    if (reverseSearchActive) {
        // Cycle to next match
        reverseSearchIndex++;
        searchHistoryReverse();
        return;
    }

    reverseSearchActive = true;
    reverseSearchQuery = '';
    reverseSearchIndex = 0;

    showReverseSearchOverlay();
}

/**
 * Search command history in reverse
 */
function searchHistoryReverse() {
    const query = reverseSearchQuery.toLowerCase();
    const matches = commandHistory
        .map((cmd, idx) => ({ cmd, idx }))
        .filter(item => item.cmd.toLowerCase().includes(query))
        .reverse();

    if (matches.length === 0) {
        document.getElementById('chatInput').value = '';
        updateReverseSearchOverlay('No matches', 0, 0);
        return;
    }

    const matchIndex = reverseSearchIndex % matches.length;
    const match = matches[matchIndex];

    document.getElementById('chatInput').value = match.cmd;
    updateReverseSearchOverlay(query, matchIndex + 1, matches.length);
}

/**
 * Show reverse search overlay
 */
function showReverseSearchOverlay() {
    let overlay = document.getElementById('reverseSearchOverlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reverseSearchOverlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="reverse-search-box">
            <div class="reverse-search-header">
                <span class="reverse-search-label">(reverse-i-search)</span>
            </div>
            <div class="reverse-search-input">
                <input type="text" id="reverseSearchInput" placeholder="Search history..." autofocus>
                <span class="reverse-search-counter" id="reverseSearchCounter">0/0</span>
            </div>
            <div class="reverse-search-help">
                Use Ctrl+R to cycle | Enter to accept | Esc to cancel
            </div>
        </div>
    `;

    overlay.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 12px 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        min-width: 300px;
        animation: slideUp 0.2s ease-out;
    `;

    const input = document.getElementById('reverseSearchInput');
    input.focus();
    input.addEventListener('input', (e) => {
        reverseSearchQuery = e.target.value;
        reverseSearchIndex = 0;
        searchHistoryReverse();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            endReverseSearch(true);
        } else if (e.key === 'Escape') {
            endReverseSearch(false);
        } else if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            startReverseSearch();
        }
    });
}

/**
 * Update reverse search overlay
 */
function updateReverseSearchOverlay(query, current, total) {
    const counter = document.getElementById('reverseSearchCounter');
    if (counter) {
        counter.textContent = `${total > 0 ? current : 0}/${total}`;
    }
}

/**
 * End reverse search
 */
function endReverseSearch(accept) {
    reverseSearchActive = false;
    reverseSearchIndex = 0;
    reverseSearchQuery = '';

    const overlay = document.getElementById('reverseSearchOverlay');
    if (overlay) {
        overlay.remove();
    }

    if (accept) {
        document.getElementById('chatInput').focus();
    } else {
        document.getElementById('chatInput').value = '';
        document.getElementById('chatInput').focus();
    }
}

/**
 * Show autocomplete suggestions (Warp-style)
 */
function showAutocomplete(input, suggestions) {
    let autocompleteContainer = document.getElementById('autocompleteContainer');

    if (!suggestions || suggestions.length === 0) {
        if (autocompleteContainer) {
            autocompleteContainer.remove();
        }
        return;
    }

    // Create or reuse autocomplete container
    if (!autocompleteContainer) {
        autocompleteContainer = document.createElement('div');
        autocompleteContainer.id = 'autocompleteContainer';
        const chatInput = document.getElementById('chatInput');
        chatInput.parentElement.style.position = 'relative';
        chatInput.parentElement.insertBefore(autocompleteContainer, chatInput);
    }

    autocompleteContainer.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        background: #0d0d0d;
        border: 1px solid #333;
        border-radius: 8px;
        list-style: none;
        margin: 0 0 8px 0;
        padding: 4px 0;
        max-height: 280px;
        overflow-y: auto;
        overflow-x: hidden;
        font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        font-size: 12px;
        z-index: 1000;
        width: 100%;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        animation: slideUp 0.15s ease-out;
    `;

    // Update autocomplete list
    autocompleteContainer.innerHTML = '';
    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 10px 14px;
            cursor: pointer;
            color: #a78bfa;
            transition: all 0.1s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
            ${index === autocompleteIndex ? 'background: #1a1a1a; border-left: 3px solid #a78bfa;' : 'border-left: 3px solid transparent;'}
        `;

        // Add keyboard hint
        const hintSpan = document.createElement('span');
        hintSpan.style.cssText = `
            font-size: 10px;
            color: #666;
            margin-left: 12px;
            flex-shrink: 0;
        `;
        hintSpan.textContent = index === 0 ? 'Tab to use' : '';

        item.addEventListener('click', () => {
            document.getElementById('chatInput').value = suggestion;
            autocompleteContainer.remove();
            autocompleteIndex = -1;
        });
        item.addEventListener('mouseover', () => {
            item.style.background = '#1a1a1a';
            item.style.borderLeft = '3px solid #a78bfa';
            autocompleteIndex = index;
        });
        item.addEventListener('mouseout', () => {
            item.style.background = 'transparent';
            item.style.borderLeft = '3px solid transparent';
        });

        const textSpan = document.createElement('span');
        textSpan.textContent = suggestion;
        textSpan.style.flex = '1';

        item.appendChild(textSpan);
        item.appendChild(hintSpan);
        autocompleteContainer.appendChild(item);
    });
}


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

    // If switching to settings view, load project description
    if (viewName === 'settings') {
        loadProjectDescriptionUI();
    }

    // If switching to files view, load the file tree
    if (viewName === 'files') {
        setTimeout(() => {
            loadFileTree();
        }, 100);
    }
}

// Project Description Management
async function loadProjectDescriptionUI() {
    if (!workingDirectory) return;

    try {
        // Try to read from .graphbus/project_description.txt first
        const descPath = await window.graphbus.runCommand(`echo "${workingDirectory}/.graphbus/project_description.txt"`);
        const result = await window.graphbus.readFile(descPath.result.stdout.trim());

        if (result.success) {
            document.getElementById('projectDescriptionInput').value = result.data;
        } else {
            // If not found, try to get from graph.json intent
            const graphResult = await window.graphbus.runCommand(`cat "${workingDirectory}/.graphbus/graph.json"`);
            if (graphResult.success) {
                try {
                    const graph = JSON.parse(graphResult.result.stdout);
                    if (graph.intent) {
                        document.getElementById('projectDescriptionInput').value = graph.intent;
                    }
                } catch (e) {
                    console.error('Error parsing graph.json for intent:', e);
                }
            }
        }
    } catch (error) {
        console.error('Error loading project description:', error);
    }
}

async function saveProjectDescription() {
    if (!workingDirectory) {
        alert('No project open');
        return;
    }

    const description = document.getElementById('projectDescriptionInput').value.trim();
    if (!description) {
        alert('Please enter a description');
        return;
    }

    try {
        // Save to .graphbus/project_description.txt
        const descPath = `${workingDirectory}/.graphbus/project_description.txt`;
        await window.graphbus.writeFile(descPath, description);

        // Also update graph.json intent if possible
        // This is a bit complex via CLI, so we'll just save the text file for now
        // and let the build process pick it up if we implement that later

        alert('Project description saved!');
    } catch (error) {
        console.error('Error saving project description:', error);
        alert('Failed to save description: ' + error.message);
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

// Extract intent from user input (e.g., "build to improve error handling")
function extractIntentFromInput(input) {
    // Look for patterns like:
    // - "build to improve..."
    // - "negotiate for..."
    // - "build with intent..."
    const intentPatterns = [
        /(?:build|negotiate)\s+(?:to|for|with intent\s+to)\s+(.+?)(?:\s+|$)/i,
        /intent\s*:?\s*(.+?)(?:\s+|$)/i,
        /(?:improve|enhance|optimize|focus on)\s+(.+?)(?:\s+|$)/i
    ];

    for (const pattern of intentPatterns) {
        const match = input.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return null;
}

// Smart command interpreter - understands intent
async function interpretCommand(command) {
    const lower = command.toLowerCase();
    const extractedIntent = extractIntentFromInput(command);

    // Affirmative responses
    if (lower.match(/^(yes|yeah|sure|ok|okay|yep|go|do it|please|start|build)/)) {
        if (workflowState.phase === 'awaiting_build_confirmation') {
            if (extractedIntent) {
                // Augment project intent with conversational intent
                const augmentedIntent = projectDescription
                    ? `${projectDescription}; also ${extractedIntent}`
                    : extractedIntent;
                projectDescription = augmentedIntent;
                await saveProjectMetadata(augmentedIntent);
                addMessage(`💡 Augmented intent: ${augmentedIntent}`, 'system');
            }
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
        if (extractedIntent) {
            // Augment project intent with conversational intent
            const augmentedIntent = projectDescription
                ? `${projectDescription}; also ${extractedIntent}`
                : extractedIntent;
            projectDescription = augmentedIntent;
            await saveProjectMetadata(augmentedIntent);
            addMessage(`💡 Augmented intent: ${augmentedIntent}`, 'system');
        }
        await autoBuildAgents();
        return true;
    }

    // Negotiate
    if (lower.includes('negotiate')) {
        if (extractedIntent) {
            // Augment project intent with conversational intent
            const augmentedIntent = projectDescription
                ? `${projectDescription}; also ${extractedIntent}`
                : extractedIntent;
            projectDescription = augmentedIntent;
            await saveProjectMetadata(augmentedIntent);
            addMessage(`💡 Augmented intent: ${augmentedIntent}`, 'system');
        }
        // Trigger negotiation
        const negotiateCmd = `graphbus negotiate .graphbus --intent "${projectDescription || 'improve system'}" --rounds 5 -v`;
        await runShellCommand(negotiateCmd);
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
    const buildCommand = `graphbus build ${agentsDir} --enable-agents -v`;

    currentArtifactsDir = `${workingDirectory}/.graphbus`;

    try {
        const intentMsg = projectDescription ? `\n💡 Intent: ${projectDescription}` : '';
        addMessage(`Building agents in ${workingDirectory}/${agentsDir}...${intentMsg}`, 'assistant');

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
    // If terminal is initialized, write to terminal instead
    if (terminalInitialized) {
        // Add type indicator
        const typeIcon = type === 'assistant' ? '🤖' : type === 'user' ? '👤' : '📢';
        const typeLabel = type === 'assistant' ? 'Assistant' : type === 'user' ? 'User' : 'System';

        // Write formatted message to terminal
        const lines = text.split('\n');
        writeTerminal(`${typeIcon} [${typeLabel}]`, 'header');

        lines.forEach(line => {
            if (line) {
                writeTerminal(`  ${line}`);
            }
        });

        return;
    }

    // Fallback: original message display (if #messages exists)
    const messages = document.getElementById('messages');
    if (!messages) return;

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

            // Clear existing messages
            const messagesContainer = document.getElementById('messages');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
            }

            // Restore messages to UI using addMessage (includes copy buttons)
            savedMessages.forEach(msg => {
                // Temporarily disable auto-save during restoration
                const messages = document.getElementById('messages');

                // Create message wrapper
                const msgWrapper = document.createElement('div');
                msgWrapper.className = `message-wrapper ${msg.type}`;

                // Create message content
                const msgElement = document.createElement('div');
                msgElement.className = `message ${msg.type}`;
                msgElement.style.whiteSpace = 'pre-wrap';
                msgElement.textContent = msg.text;

                // Create copy button
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.innerHTML = '📋';
                copyBtn.title = 'Copy to clipboard';
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(msg.text).then(() => {
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

                msgWrapper.appendChild(msgElement);
                msgWrapper.appendChild(copyBtn);
                messages.appendChild(msgWrapper);
            });

            // Restore to history
            workflowState.conversationHistory = savedMessages;

            const messages = document.getElementById('messages');
            messages.scrollTop = messages.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load conversation:', error);
    }
}

// Save project metadata (description/intent)
async function saveProjectMetadata(description) {
    try {
        if (!workingDirectory) return;

        const metadata = {
            description: description || projectDescription,
            createdAt: new Date().toISOString()
        };

        // Save to .graphbus/project.json
        const result = await window.graphbus.writeFile(
            `${workingDirectory}/.graphbus/project.json`,
            JSON.stringify(metadata, null, 2)
        );

        if (result.success) {
            projectDescription = description || projectDescription;
            console.log('Project metadata saved:', metadata);
        }
    } catch (error) {
        console.error('Failed to save project metadata:', error);
    }
}

// Load project metadata (description/intent)
async function loadProjectMetadata() {
    try {
        if (!workingDirectory) return;

        const result = await window.graphbus.readFile(
            `${workingDirectory}/.graphbus/project.json`
        );

        if (result.success && result.result) {
            const metadata = JSON.parse(result.result);
            projectDescription = metadata.description || '';
            console.log('Project metadata loaded:', metadata);
            return metadata;
        }
    } catch (error) {
        console.error('Failed to load project metadata:', error);
    }
    return null;
}

// Save project description from UI
async function saveProjectDescription() {
    const input = document.getElementById('projectDescriptionInput');
    const description = input.value.trim();

    if (!description) {
        alert('Please enter a project description');
        return;
    }

    await saveProjectMetadata(description);
    addMessage(`💾 Project description updated: ${description}`, 'system');
}

// Load project description into UI
async function loadProjectDescriptionUI() {
    const input = document.getElementById('projectDescriptionInput');
    input.value = projectDescription || '';
}

async function sendCommand() {
    const input = document.getElementById('chatInput');
    const command = input.value.trim();
    if (!command) return;

    // Set processing flag
    isProcessing = true;

    // Add to command history
    commandHistory.push(command);
    saveCommandHistory(); // Persist to localStorage
    historyIndex = -1; // Reset history navigation
    currentDraft = '';

    // Clear autocomplete
    const autocompleteList = document.getElementById('autocompleteList');
    if (autocompleteList) autocompleteList.remove();

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
            const { message, action, params, plan } = response.result;

            // Check for structured plan from Claude (plan-first workflow)
            const structuredPlan = plan || parsePlanFromClaudeResponse(response.result);
            if (structuredPlan) {
                console.log('[Plan-First] Structured plan detected from Claude');

                // Display the plan to user
                displayStructuredPlan(structuredPlan);

                // Convert plan to DAG stages
                workflowPlan = createDAGFromPlan(structuredPlan);
                workflowDAG = workflowPlan.dag;
                currentWorkflowStage = 'init'; // Start from init stage
                autoNegotiationIntent = structuredPlan.intent || '';

                // Show Claude's message
                if (message) {
                    addMessage(message, 'assistant');
                }

                // Start execution of the plan
                console.log('[Plan-First] Starting plan execution');
                isProcessing = true;
                await new Promise(resolve => setTimeout(resolve, 300));
                await progressToNextStage();
            } else {
                // Traditional workflow (no structured plan)
                // Show Claude's message
                if (message) {
                    addMessage(message, 'assistant');

                    // Analyze Claude's response for task completion and auto-continue decision
                    const analysis = analyzeClaudeResponse(message);
                    console.log('[Loopback] Response analysis:', analysis);

                    // Create context-aware DAG based on Claude's message
                    const contextData = {
                        currentStage: currentWorkflowStage,
                        hasBuilt: workflowState.hasBuilt,
                        isRunning: workflowState.isRunning,
                        phase: workflowState.phase
                    };
                    workflowPlan = createWorkflowDAG(message, contextData);
                    workflowDAG = workflowPlan.dag;

                    // If task is handed back to user, mark processing as complete
                    if (analysis.handedToUser) {
                        console.log('[Loopback] Control handed to user - processing complete');
                        isProcessing = false;

                        // Auto-execute queued inputs if any
                        if (inputQueue.length > 0) {
                            console.log(`[Queue] ${inputQueue.length} commands queued, auto-executing...`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await processNextQueuedInput();
                        } else {
                            // Prompt user for next action
                            const stageInfo = getCurrentStageInfo();
                            if (stageInfo.nextStage) {
                                addMessage(`🎯 Next: ${stageInfo.nextStage}. What would you like to do?`, 'system');
                            }
                        }
                    } else if (analysis.shouldAutoContinue) {
                        // Claude indicated it will continue - show plan and auto-execute
                        console.log('[Loopback] Auto-continue detected - executing DAG plan');
                        displayWorkflowPlan(workflowPlan);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await progressToNextStage();
                    } else {
                        // Check if we should auto-progress based on current stage
                        console.log('[Loopback] Checking for auto-progression...');
                        await checkAndAutoProgress();
                    }
                }
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

            // Mark processing as complete on error
            isProcessing = false;
        }
    } catch (error) {
        addMessage(`Error: ${error.message}`, 'assistant');
        isProcessing = false;
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
                    // Pre-flight check for graphbus init
                    if (params.command.includes('graphbus init')) {

                    }
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
    // Track agent generation for auto-negotiation
    if (command.includes('graphbus generate agent')) {
        // Extract intent from recent conversation history
        // Look back at the last few user messages to find the project description
        const recentMessages = workflowState.conversationHistory.slice(-10);
        for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            if (msg.type === 'user' && msg.text && msg.text.length > 20) {
                // This is likely the project description/intent
                autoNegotiationIntent = msg.text;
                pendingAutoNegotiation = true;
                console.log('Auto-negotiation scheduled with intent:', autoNegotiationIntent);
                break;
            }
        }
    }

    // Use streaming for build and negotiate commands
    if ((command.includes('graphbus build') && command.includes('--enable-agents')) ||
        command.includes('graphbus negotiate')) {
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

            // Parse existing agents if this was a check_agents command
            if ((command.includes('ls -la agents/') || command.includes('graphbus inspect')) && stdout) {
                parseExistingAgents(stdout);
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
        window.graphbus.onCommandOutput(() => { });
        window.graphbus.onCommandComplete(() => { });
        window.graphbus.onCommandError(() => { });

        // Check if this was a build command and auto-negotiation is pending
        if (command.includes('graphbus build') && command.includes('--enable-agents') && pendingAutoNegotiation) {
            pendingAutoNegotiation = false; // Reset flag

            // Automatically trigger negotiation with the stored intent
            addMessage(`\n🤖 Build complete! Automatically running negotiation so agents can self-assess and improve...`, 'system');

            const negotiateCommand = `graphbus negotiate .graphbus --intent "${autoNegotiationIntent}" --rounds 5`;

            // Small delay to let UI update
            setTimeout(async () => {
                await runStreamingCommand(negotiateCommand);
            }, 500);

            return; // Don't proceed with other handlers yet
        }

        await window.graphbus.claudeAddSystemMessage(`Command completed. Output: ${fullOutput}`);
        setTimeout(() => checkForCompoundRequestContinuation(), 500);
    };

    const errorHandler = (data) => {
        if (streamingMessageElement) {
            streamingMessageElement.textContent += `\n✗ Error: ${data.error}\n`;
        }
    };

    // Prompt handler for interactive input
    const promptHandler = (data) => {
        const { question } = data;
        showPromptModal(question);
    };

    // Register handlers
    window.graphbus.onCommandOutput(outputHandler);
    window.graphbus.onCommandComplete(completeHandler);
    window.graphbus.onCommandError(errorHandler);
    window.graphbus.onCommandPrompt(promptHandler);

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
                    addMessage(`  ${line.trim()}`, 'assistant');
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
    const graphCanvas = document.getElementById('graphCanvas');

    if (!nodes || nodes.length === 0) {
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

    // Clear the container
    graphCanvas.innerHTML = '';

    // Show placeholder for agent graph (React graph disabled for now)
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder';
    placeholder.style.cssText = 'padding: 40px; color: #888; text-align: center; font-size: 14px;';
    placeholder.innerHTML = `
        <div style="opacity: 0.6;">
            <div style="margin-bottom: 20px; font-size: 12px; color: #666;">Agent Graph View</div>
            <div style="font-size: 12px;">
                Showing ${nodes?.length || 0} agents and ${edges?.length || 0} connections
            </div>
        </div>
    `;
    graphCanvas.appendChild(placeholder);
    console.log('Agent graph view rendered');
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

// State file viewer
let currentStateFileContent = '';

async function loadStateFile(filename, event) {
    try {
        // Ensure working directory is set
        if (!workingDirectory) {
            document.getElementById('stateFileContent').textContent = 'Error: No working directory set. Please change to a GraphBus project directory.';
            return;
        }

        const graphbusDir = `${workingDirectory}/.graphbus`;
        const filePath = `${graphbusDir}/${filename}`;

        console.log('Loading state file:', filePath);

        // Read file using command
        const result = await window.graphbus.runCommand(`cat "${filePath}"`);

        if (result.success && result.result.stdout) {
            const rawContent = result.result.stdout;

            // Try to parse and format based on file type
            try {
                const json = JSON.parse(rawContent);
                const formatted = formatStateData(filename, json);

                // Update UI
                document.getElementById('stateFileContent').innerHTML = formatted;
                document.getElementById('currentStateFile').textContent = filename;
                document.getElementById('copyStateBtn').style.display = 'block';
                currentStateFileContent = JSON.stringify(json, null, 2);
            } catch (e) {
                // Not JSON, show as plain text
                document.getElementById('stateFileContent').textContent = rawContent;
                currentStateFileContent = rawContent;
            }

            // Update active state
            document.querySelectorAll('.state-file-item').forEach(item => {
                item.classList.remove('active');
            });
            if (event && event.target) {
                event.target.classList.add('active');
            }
        } else {
            document.getElementById('stateFileContent').textContent = `Error: File not found or empty\n\nPath: ${filePath}\nWorking Dir: ${workingDirectory}\n\n${result.error || result.stderr || 'Unknown error'}`;
            document.getElementById('copyStateBtn').style.display = 'none';
        }
    } catch (error) {
        document.getElementById('stateFileContent').textContent = `Error loading file: ${error.message}\n\nPath: ${filePath}\nWorking Dir: ${workingDirectory}`;
        document.getElementById('copyStateBtn').style.display = 'none';
    }
}

function formatStateData(filename, data) {
    switch (filename) {
        case 'graph.json':
            return formatGraph(data);
        case 'agents.json':
            return formatAgents(data);
        case 'topics.json':
            return formatTopics(data);
        case 'build_summary.json':
            return formatBuildSummary(data);
        case 'conversations.json':
            return formatConversations(data);
        case 'negotiations.json':
            return formatNegotiations(data);
        default:
            return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
}

function formatGraph(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>📊 Graph Structure</h3>`;
    html += `<div class="state-section">`;
    html += `<h4>Nodes (${data.nodes.length})</h4>`;
    data.nodes.forEach(node => {
        html += `<div class="state-card">`;
        html += `<div class="state-card-header">${node.name}</div>`;
        html += `<div class="state-card-body">`;
        html += `<strong>Module:</strong> ${node.data.module}<br>`;
        html += `<strong>Class:</strong> ${node.data.class_name}<br>`;
        html += `<strong>Methods:</strong> ${node.data.methods.join(', ')}<br>`;
        if (node.data.subscriptions && node.data.subscriptions.length > 0) {
            html += `<strong>Subscriptions:</strong> ${node.data.subscriptions.join(', ')}`;
        }
        html += `</div></div>`;
    });
    html += `</div>`;

    html += `<div class="state-section">`;
    html += `<h4>Edges (${data.edges.length})</h4>`;
    data.edges.forEach(edge => {
        html += `<div class="state-edge">`;
        html += `${edge.src} → ${edge.dst} <span class="edge-type">(${edge.data.edge_type})</span>`;
        html += `</div>`;
    });
    html += `</div></div>`;
    return html;
}

function formatAgents(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>🤖 Agents (${data.length})</h3>`;
    data.forEach(agent => {
        html += `<div class="state-card">`;
        html += `<div class="state-card-header">${agent.name}</div>`;
        html += `<div class="state-card-body">`;
        html += `<strong>Module:</strong> ${agent.module}<br>`;
        html += `<strong>Class:</strong> ${agent.class_name}<br>`;
        html += `<strong>Methods:</strong> ${agent.methods.join(', ')}`;
        html += `</div></div>`;
    });
    html += '</div>';
    return html;
}

function formatTopics(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>📢 Topics (${data.length})</h3>`;
    data.forEach(topic => {
        html += `<div class="state-card">`;
        html += `<div class="state-card-header">${topic}</div>`;
        html += `</div>`;
    });
    html += '</div>';
    return html;
}

function formatBuildSummary(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>🔨 Build Summary</h3>`;
    html += `<div class="state-summary">`;
    html += `<div class="summary-item"><strong>Total Agents:</strong> ${data.total_agents}</div>`;
    html += `<div class="summary-item"><strong>Total Topics:</strong> ${data.total_topics}</div>`;
    html += `<div class="summary-item"><strong>Total Edges:</strong> ${data.total_edges}</div>`;
    html += `<div class="summary-item"><strong>Build Time:</strong> ${data.build_time_seconds}s</div>`;
    html += `<div class="summary-item"><strong>Status:</strong> ${data.status}</div>`;
    if (data.timestamp) {
        html += `<div class="summary-item"><strong>Timestamp:</strong> ${new Date(data.timestamp * 1000).toLocaleString()}</div>`;
    }
    html += `</div></div>`;
    return html;
}

function formatConversations(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>💬 Conversations (${data.messages.length} messages)</h3>`;
    data.messages.forEach(msg => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        html += `<div class="conversation-msg ${msg.type}">`;
        html += `<span class="msg-time">${time}</span>`;
        html += `<span class="msg-type">[${msg.type}]</span>`;
        html += `<div class="msg-text">${msg.text}</div>`;
        html += `</div>`;
    });
    html += '</div>';
    return html;
}

function formatNegotiations(data) {
    let html = '<div class="state-formatted">';
    html += `<h3>🤝 Negotiations (${data.length})</h3>`;
    data.forEach((neg, i) => {
        html += `<div class="state-card">`;
        html += `<div class="state-card-header">Negotiation #${i + 1}</div>`;
        html += `<div class="state-card-body">`;
        html += `<strong>Proposal ID:</strong> ${neg.proposal_id}<br>`;
        html += `<strong>Agent:</strong> ${neg.agent}<br>`;
        html += `<strong>Improvement:</strong> ${neg.improvement_type}<br>`;
        html += `<strong>Status:</strong> ${neg.status}<br>`;
        if (neg.commit_id) {
            html += `<strong>Commit:</strong> ${neg.commit_id}<br>`;
        }
        html += `<strong>Round:</strong> ${neg.round}`;
        html += `</div></div>`;
    });
    html += '</div>';
    return html;
}

function copyStateContent() {
    const copyBtn = document.getElementById('copyStateBtn');
    navigator.clipboard.writeText(currentStateFileContent).then(() => {
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
}

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
    const displayElement = document.getElementById('workingDirectoryDisplay');
    if (displayElement) {
        if (!workingDirectory) {
            displayElement.textContent = 'No project open';
            return;
        }

        const parts = workingDirectory.split('/');
        const dirName = parts[parts.length - 1] || parts[parts.length - 2];
        displayElement.textContent = dirName;
        displayElement.title = workingDirectory;
    }
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

/**
 * File Browser Variables
 */
let currentOpenFile = null;
let fileContents = {};
let fileModified = {};

/**
 * Load and display file tree for current working directory
 */
async function loadFileTree() {
    const fileTreeContainer = document.getElementById('fileTree');

    if (!workingDirectory) {
        fileTreeContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">📁 Open or create a project to view files</div>';
        return;
    }

    fileTreeContainer.innerHTML = '<div class="loading" style="padding: 20px; text-align: center; color: #666;">Loading files...</div>';

    try {
        console.log('Loading files from:', workingDirectory);
        const result = await window.graphbus.listFiles(workingDirectory);
        console.log('File list result:', result);

        if (result.success) {
            console.log('Files loaded:', result.result?.length || 0, 'files');
            const tree = buildFileTreeHTML(result.result, workingDirectory);
            console.log('File tree HTML generated:', tree?.length || 0, 'chars');
            fileTreeContainer.innerHTML = tree || '<div style="padding: 20px; text-align: center; color: #666;">No files found</div>';
        } else {
            console.error('File list failed:', result.error);
            fileTreeContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #f87171;">${result.error || 'Error loading files'}</div>`;
        }
    } catch (error) {
        console.error('Failed to load file tree:', error);
        fileTreeContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #f87171;">Error: ${error.message}</div>`;
    }
}

/**
 * Build HTML tree structure from files list
 */
function buildFileTreeHTML(files, basePath) {
    if (!files || files.length === 0) return '';

    // Group files by directory
    const tree = {};
    const dirs = new Set();

    files.forEach(file => {
        const relativePath = file.replace(basePath + '/', '');
        const parts = relativePath.split('/');

        // Skip certain directories
        if (parts[0].startsWith('.') && !parts[0].includes('.graphbus') && !parts[0].includes('.git')) {
            return;
        }

        let current = tree;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
                current[parts[i]] = {};
                dirs.add(parts.slice(0, i + 1).join('/'));
            }
            current = current[parts[i]];
        }

        if (!current._files) current._files = [];
        current._files.push({
            name: parts[parts.length - 1],
            path: file
        });
    });

    return renderTreeNode(tree, basePath, 0);
}

/**
 * Render a single tree node recursively
 */
function renderTreeNode(node, basePath, level = 0) {
    let html = '';

    // Sort folders first, then files
    const folders = Object.keys(node).filter(k => k !== '_files' && typeof node[k] === 'object').sort();
    const files = (node._files || []).sort((a, b) => a.name.localeCompare(b.name));

    folders.forEach(folderName => {
        const folderId = folderName.replace(/\//g, '_');
        html += `
            <div class="file-tree-item">
                <div class="file-tree-folder" id="folder_${folderId}" onclick="toggleFolder(this)">
                    <span style="margin-left: ${level * 8}px;">📁 ${folderName}</span>
                </div>
                <div class="file-tree-children" id="children_${folderId}">
                    ${renderTreeNode(node[folderName], basePath, level + 1)}
                </div>
            </div>
        `;
    });

    files.forEach(file => {
        const fileId = file.path.replace(/\//g, '_').replace(/\./g, '_');
        const icon = getFileIcon(file.name);
        html += `
            <div class="file-tree-file" id="file_${fileId}" onclick="openFile('${file.path}')">
                ${icon} ${file.name}
            </div>
        `;
    });

    return html;
}

/**
 * Get file icon based on extension
 */
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'py': '🐍',
        'js': '⚙️',
        'json': '{}',
        'md': '📝',
        'txt': '📄',
        'yaml': '📋',
        'yml': '📋',
        'graphbus': '📊',
        'sh': '🔧',
        'ts': '⚙️',
        'tsx': '⚛️',
        'jsx': '⚛️',
        'css': '🎨',
        'html': '🌐',
        'xml': '📋'
    };
    return icons[ext] || '📄';
}

/**
 * Toggle folder expansion
 */
function toggleFolder(folderElement) {
    folderElement.classList.toggle('expanded');
    const folderId = folderElement.id.replace('folder_', '');
    const childrenElement = document.getElementById('children_' + folderId);
    if (childrenElement) {
        childrenElement.style.display = childrenElement.style.display === 'none' ? 'block' : 'none';
    }
}

/**
 * Open a file for editing
 */
async function openFile(filePath) {
    try {
        // Clear previous selection
        document.querySelectorAll('.file-tree-file.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Mark as selected
        const fileId = filePath.replace(/\//g, '_').replace(/\./g, '_');
        const fileElement = document.getElementById('file_' + fileId);
        if (fileElement) {
            fileElement.classList.add('selected');
        }

        // Load file content
        const result = await window.graphbus.readFile(filePath);

        if (result.success) {
            currentOpenFile = filePath;
            fileContents[filePath] = result.result;
            fileModified[filePath] = false;

            // Update CodeMirror editor
            if (codeMirrorEditor) {
                codeMirrorEditor.setValue(result.result);

                // Detect language mode from file extension
                const ext = filePath.split('.').pop().toLowerCase();
                const modeMap = {
                    'py': 'python',
                    'js': 'javascript',
                    'json': 'javascript',
                    'md': 'markdown',
                    'txt': 'null'
                };
                const mode = modeMap[ext] || 'null';
                codeMirrorEditor.setOption('mode', mode);
            }

            // Update UI
            document.getElementById('currentFilePath').textContent = filePath.replace(workingDirectory, '');
            document.getElementById('fileModified').style.display = 'none';
            document.getElementById('saveFileBtn').style.display = 'inline-block';
            document.getElementById('closeFileBtn').style.display = 'inline-block';
            document.getElementById('fileStats').style.display = 'block';

            // Update stats
            updateFileStats();
        } else {
            addMessage(`❌ Failed to open file: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to open file:', error);
        addMessage(`❌ Error opening file: ${error.message}`, 'error');
    }
}

/**
 * Update file statistics
 */
function updateFileStats() {
    if (!codeMirrorEditor) return;

    const content = codeMirrorEditor.getValue();
    const lines = codeMirrorEditor.lineCount();
    const chars = content.length;

    document.getElementById('lineCount').textContent = `Lines: ${lines}`;
    document.getElementById('charCount').textContent = `Chars: ${chars}`;
}

/**
 * Save current file
 */
async function saveCurrentFile() {
    if (!currentOpenFile || !codeMirrorEditor) return;

    try {
        const content = codeMirrorEditor.getValue();
        const result = await window.graphbus.writeFile(currentOpenFile, content);

        if (result.success) {
            fileContents[currentOpenFile] = content;
            fileModified[currentOpenFile] = false;

            document.getElementById('fileModified').style.display = 'none';
            addMessage(`✅ File saved: ${currentOpenFile.replace(workingDirectory, '')}`, 'system');
        } else {
            addMessage(`❌ Failed to save file: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to save file:', error);
        addMessage(`❌ Error saving file: ${error.message}`, 'error');
    }
}

/**
 * Close current file
 */
function closeCurrentFile() {
    if (currentOpenFile && fileModified[currentOpenFile]) {
        if (!confirm('File has unsaved changes. Close anyway?')) {
            return;
        }
    }

    currentOpenFile = null;

    // Clear CodeMirror editor
    if (codeMirrorEditor) {
        codeMirrorEditor.setValue('');
        codeMirrorEditor.setOption('mode', 'null');
    }

    document.getElementById('currentFilePath').textContent = 'Select a file to view';
    document.getElementById('fileModified').style.display = 'none';
    document.getElementById('saveFileBtn').style.display = 'none';
    document.getElementById('closeFileBtn').style.display = 'none';
    document.getElementById('fileStats').style.display = 'none';

    document.querySelectorAll('.file-tree-file.selected').forEach(el => {
        el.classList.remove('selected');
    });
}

/**
 * Refresh file tree
 */
function refreshFileTree() {
    loadFileTree();
}

/**
 * Collapse all folders
 */
function collapseAllFolders() {
    document.querySelectorAll('.file-tree-folder.expanded').forEach(folder => {
        folder.classList.remove('expanded');
        const folderId = folder.id.replace('folder_', '');
        const childrenElement = document.getElementById('children_' + folderId);
        if (childrenElement) {
            childrenElement.style.display = 'none';
        }
    });
}

// View cycling state
let focusedViewIndex = 0;
const views = [
    { name: 'graph', label: 'Agent Graph' },
    { name: 'conversation', label: 'Conversation' },
    { name: 'state', label: 'System State' },
    { name: 'files', label: 'File Editor' },
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
    // Initialize CodeMirror editor
    initializeCodeMirror();

    // Add file editor change listener to CodeMirror
    if (codeMirrorEditor) {
        codeMirrorEditor.on('change', () => {
            if (!currentOpenFile) return;
            if (!fileModified[currentOpenFile]) {
                fileModified[currentOpenFile] = true;
                document.getElementById('fileModified').style.display = 'inline';
            }
            updateFileStats();
        });
    }

    // Initialize xterm.js terminal
    initializeTerminal();

    // Initialize workflow DAG
    initializeWorkflowDAG();

    // Load command history from localStorage
    loadCommandHistory();

    const chatInput = document.getElementById('chatInput');

    // Send command on Enter
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendCommand();
        }
    });

    // Autocomplete on input
    chatInput.addEventListener('input', (e) => {
        const input = e.target.value.trim();
        if (input.length > 2) {
            const suggestions = getAutocompleteSuggestions(input);
            showAutocomplete(input, suggestions);
        } else {
            const autocompleteList = document.getElementById('autocompleteList');
            if (autocompleteList) {
                autocompleteList.remove();
            }
        }
    });

    // Arrow key navigation for command history & autocomplete
    chatInput.addEventListener('keydown', (e) => {
        const autocompleteList = document.getElementById('autocompleteList');

        if (e.key === 'ArrowUp') {
            e.preventDefault();

            if (commandHistory.length === 0) return;

            // Save current input when first pressing up
            if (historyIndex === -1) {
                currentDraft = chatInput.value;
                historyIndex = commandHistory.length;
            }

            // Navigate up in history
            if (historyIndex > 0) {
                historyIndex--;
                chatInput.value = commandHistory[historyIndex];
                if (autocompleteList) autocompleteList.remove();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();

            if (historyIndex === -1) return; // Not navigating history

            // Navigate down in history
            historyIndex++;

            if (historyIndex >= commandHistory.length) {
                // Reached the bottom, restore draft
                historyIndex = -1;
                chatInput.value = currentDraft;
            } else {
                chatInput.value = commandHistory[historyIndex];
            }
            if (autocompleteList) autocompleteList.remove();
        } else if (e.key === 'Tab') {
            // Tab to accept autocomplete suggestion
            e.preventDefault();
            if (autocompleteList && autocompleteList.children.length > 0) {
                const firstItem = autocompleteList.children[0];
                chatInput.value = firstItem.textContent;
                autocompleteList.remove();
                historyIndex = -1;
            }
        } else if (e.key !== 'Enter') {
            // Reset history navigation when typing
            if (historyIndex !== -1) {
                historyIndex = -1;
                currentDraft = '';
            }
        }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+R for reverse search in command history
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            startReverseSearch();
            return;
        }

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

        // Escape key handling
        if (e.key === 'Escape') {
            const now = Date.now();
            const timeSinceLastEsc = now - lastEscapeTime;

            if (timeSinceLastEsc < DOUBLE_ESC_THRESHOLD) {
                // Double press detected - cancel flow
                e.preventDefault();
                cancelFlow();
                lastEscapeTime = 0;
            } else {
                // Single press - clear input or focus
                if (chatInput.value.trim()) {
                    // Clear input if it has content
                    chatInput.value = '';
                    const autocompleteList = document.getElementById('autocompleteList');
                    if (autocompleteList) autocompleteList.remove();
                } else {
                    // Focus chat input
                    chatInput.focus();
                }
                lastEscapeTime = now;
            }
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

    // Skip this if a working directory was already provided via CLI
    if (!initialWorkingDirReceived) {
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
        // Load project metadata (description/intent)
        await loadProjectMetadata();

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
    console.log('[DEBUG] showWelcomeScreen called');
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
    }
    document.getElementById('welcomeScreen').style.display = 'flex';
    document.querySelector('.main-layout').style.display = 'none';
}

function hideWelcomeScreen() {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.querySelector('.main-layout').style.display = 'flex';
}

function showNewProjectForm() {
    console.log('[DEBUG] showNewProjectForm called');

    // Hide welcome screen
    document.getElementById('welcomeScreen').style.display = 'none';

    // Show modal
    const modal = document.getElementById('newProjectForm');
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
}

function closeNewProjectForm() {
    document.getElementById('newProjectForm').style.display = 'none';

    // Show welcome screen again
    document.getElementById('welcomeScreen').style.display = 'flex';

    // Reset form
    document.getElementById('newProjectPath').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectPathError').style.display = 'none';
    newProjectDirectory = null;
    selectTemplate('blank');
}

async function browseNewProjectDirectory() {
    console.log('[DEBUG] browseNewProjectDirectory called');
    try {
        const result = await window.graphbus.browseDirectory();
        console.log('[DEBUG] browseDirectory result:', result);

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

    // Show main layout
    document.querySelector('.main-layout').style.display = 'flex';

    // Switch to conversation view
    switchView('conversation');

    // Set working directory
    await window.graphbus.setWorkingDirectory(newProjectDirectory);
    workingDirectory = newProjectDirectory;
    updateWorkingDirectoryDisplay();

    // Save project metadata
    await saveProjectMetadata(description);

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
    console.log('[DEBUG] openExistingProject called');
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
    try {
        const result = await window.graphbus.rehydrateState(workingDirectory);

        if (!result.success || !result.result || !result.result.hasGraphbus) {
            // No existing project - show welcome screen
            showWelcomeScreen();
            return false;
        }

        // Has existing project - load it
        return true;
    } catch (error) {
        console.error('Error checking for existing project:', error);
        showWelcomeScreen();
        return false;
    }
}

// ===========================
// PR Review Functions
// ===========================

let currentSelectedPR = null;

// Load and display PR list
async function refreshPRList() {
    try {
        const tracking = await window.graphbus.prLoadTracking();

        if (!tracking.success || !tracking.result || !tracking.result.prs || tracking.result.prs.length === 0) {
            // Show empty state
            document.getElementById('prList').innerHTML = `
                <div class="empty-state">
                    <div style="font-size: 48px; margin-bottom: 12px;">📭</div>
                    <p>No pull requests yet</p>
                    <p style="font-size: 12px; color: #888;">Run a negotiation to create your first PR</p>
                </div>
            `;
            return;
        }

        const prList = document.getElementById('prList');
        prList.innerHTML = '';

        // Display PRs (most recent first)
        const prs = tracking.result.prs.reverse();
        prs.forEach((pr, index) => {
            const prItem = document.createElement('div');
            prItem.className = 'pr-item';
            if (index === 0 && !currentSelectedPR) {
                prItem.classList.add('active');
            }
            prItem.onclick = () => selectPR(pr);

            const title = `GraphBus: ${pr.intent}`;
            const timeAgo = formatTimeAgo(pr.timestamp);

            prItem.innerHTML = `
                <div class="pr-item-title">${title}</div>
                <div class="pr-item-meta">
                    <div>PR #${pr.prNumber || 'N/A'}</div>
                    <div>🌿 ${pr.branchName}</div>
                    <div>⏱️ ${timeAgo}</div>
                </div>
                <div class="pr-item-intent">"${pr.intent}"</div>
            `;

            prList.appendChild(prItem);
        });

        // Auto-select first PR if none selected
        if (!currentSelectedPR && prs.length > 0) {
            selectPR(prs[0]);
        }

    } catch (error) {
        console.error('Error loading PR list:', error);
        addMessage(`❌ Failed to load PR list: ${error.message}`, 'system');
    }
}

// Select and display PR details
async function selectPR(prData) {
    currentSelectedPR = prData;

    // Update active state in list
    document.querySelectorAll('.pr-item').forEach(item => item.classList.remove('active'));
    event.currentTarget?.classList.add('active');

    // Hide empty state, show content
    document.getElementById('prDetailsEmpty').style.display = 'none';
    document.getElementById('prDetailsContent').style.display = 'block';

    // Populate PR details
    document.getElementById('prTitle').textContent = `GraphBus: ${prData.intent}`;
    document.getElementById('prBranch').textContent = prData.branchName;
    document.getElementById('prStatus').textContent = 'open';
    document.getElementById('prLink').href = prData.prUrl;
    document.getElementById('prCommits').textContent = prData.commitCount || 0;
    document.getElementById('prNegotiationId').textContent = prData.negotiationId.substring(0, 8);
    document.getElementById('prIntent').textContent = prData.intent;

    // Load comments
    await refreshPRComments();
}

// Refresh PR comments from GitHub
async function refreshPRComments() {
    if (!currentSelectedPR) return;

    const commentsContainer = document.getElementById('prComments');
    commentsContainer.innerHTML = '<div class="loading">Loading comments...</div>';

    try {
        const result = await window.graphbus.githubGetPRComments(currentSelectedPR.prNumber);

        if (!result.success) {
            commentsContainer.innerHTML = `<div class="pr-comment"><div class="pr-comment-body" style="color: #ef4444;">❌ Failed to load comments: ${result.error}</div></div>`;
            return;
        }

        const comments = result.comments || [];

        if (comments.length === 0) {
            commentsContainer.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">No comments yet</div>';
            return;
        }

        commentsContainer.innerHTML = '';
        comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = 'pr-comment';

            const timeAgo = formatTimeAgo(new Date(comment.created_at).getTime());

            commentEl.innerHTML = `
                <div class="pr-comment-header">
                    <span class="pr-comment-author">@${comment.user.login}</span>
                    <span class="pr-comment-time">${timeAgo}</span>
                </div>
                <div class="pr-comment-body">${comment.body}</div>
            `;

            commentsContainer.appendChild(commentEl);
        });

    } catch (error) {
        console.error('Error loading comments:', error);
        commentsContainer.innerHTML = `<div class="pr-comment"><div class="pr-comment-body" style="color: #ef4444;">❌ Error: ${error.message}</div></div>`;
    }
}





// Format timestamp as "X ago"
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}

// Update switchView to load PR list when switching to PR review
const originalSwitchView = switchView;
switchView = function (viewName) {
    originalSwitchView(viewName);


};

// Interactive prompt modal functions
function showPromptModal(question) {
    const modal = document.getElementById('promptModal');
    const questionEl = document.getElementById('promptQuestion');
    const inputEl = document.getElementById('promptInput');

    questionEl.textContent = question;
    inputEl.value = '';
    modal.style.display = 'block';

    // Focus input and handle Enter key
    setTimeout(() => {
        inputEl.focus();
        inputEl.onkeypress = (e) => {
            if (e.key === 'Enter') {
                submitPromptResponse();
            }
        };
    }, 100);
}

async function submitPromptResponse() {
    const modal = document.getElementById('promptModal');
    const inputEl = document.getElementById('promptInput');
    const response = inputEl.value.trim();

    if (!response) {
        alert('Please enter a response');
        return;
    }

    // Hide modal and clear input
    modal.style.display = 'none';
    inputEl.value = '';

    // Send response to stdin
    try {
        const result = await window.graphbus.sendStdin(response);
        if (result.success) {
            console.log('Sent response to process stdin:', response);
            addMessage(`✓ You answered: ${response}`, 'user');
        } else {
            console.error('Failed to send response to stdin:', result.error);
            addMessage(`⚠️ Failed to send response: ${result.error}`, 'system');
        }
    } catch (error) {
        console.error('Error sending response to stdin:', error);
        addMessage(`⚠️ Error: ${error.message}`, 'system');
    }
}

console.log('GraphBus UI Renderer loaded');
