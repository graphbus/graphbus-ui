# GraphBus UI - Electron Application

A native desktop application for orchestrating the GraphBus agent framework with natural language processing. Built with Electron and Python bridge.

## Overview

GraphBus UI provides a modern desktop interface to control GraphBus through natural language commands, visualize agent graphs, and monitor runtime execution in real-time.

**Technology Stack:**
- **Electron** - Cross-platform desktop framework
- **Python Shell** - Bridge to graphbus-core Python library
- **HTML/CSS/JavaScript** - Modern UI interface
- **GraphBus Core** - Python agent orchestration framework

## Features

### 💬 Natural Language Interface
Control GraphBus with conversational commands:
- "start the runtime"
- "build the agents"
- "call HelloService.generate_message"
- "list agents"
- "help"

### 🕸️ Agent Graph Visualization
- Interactive agent graph display
- Node relationships and dependencies
- Agent details and methods

### 📊 Real-Time Monitoring
- Runtime statistics
- Message bus metrics
- Method call tracking
- Live status updates (2s polling)

### 🔨 Build Mode
- Build agents from source
- Configure output directories
- View build results

### ⚙️ Runtime Control
- Start/stop runtime
- Call agent methods
- Publish events
- Monitor system health

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **GraphBus Core** installed

### Installation

```bash
cd graphbus-ui

# Install dependencies
npm install

# Run the app
npm start

# Or specify a working directory
npm start -- /path/to/your/project
npm start -- --dir=/path/to/your/project
```

### Specifying Working Directory

You can launch the app with a specific working directory:

```bash
# Using positional argument
npm start -- /Users/yourname/my-graphbus-project

# Using --dir flag
npm start -- --dir=/Users/yourname/my-graphbus-project

# Using relative paths
npm start -- ../my-project
```

The working directory determines:
- Where GraphBus looks for the `agents/` folder
- Where build artifacts are saved (`.graphbus/`)
- Where conversation history is stored

### First Run

1. The app will launch with a chat interface
2. Try: `"start the runtime"`
3. Then: `"list agents"`
4. Then: `"call HelloService.generate_message"`

## Project Structure

```
graphbus-ui/
├── package.json           # NPM configuration
├── main.js                # Electron main process
├── preload.js             # Secure IPC bridge
├── python_bridge.js       # Python-Electron bridge
├── index.html             # Main UI
├── styles.css             # Styling
├── renderer.js            # UI logic
└── README.md              # This file
```

## Architecture

```
┌─────────────────────────────────┐
│      Electron (Node.js)         │
│                                 │
│  ┌──────────┐   ┌────────────┐ │
│  │   UI     │───│  Main      │ │
│  │(Renderer)│   │  Process   │ │
│  └──────────┘   └─────┬──────┘ │
└────────────────────────┼────────┘
                         │
                  ┌──────▼──────┐
                  │PythonBridge │
                  └──────┬──────┘
                         │
            ┌────────────▼─────────────┐
            │  GraphBus Core (Python)  │
            │  • Build Mode            │
            │  • Runtime Mode          │
            │  • Message Bus           │
            └──────────────────────────┘
```

## How It Works

### Python Bridge

The `python_bridge.js` module uses `python-shell` to execute Python code that calls graphbus-core:

```javascript
// Start runtime
const result = await window.graphbus.startRuntime({
    artifactsDir: '.graphbus'
});

// Call agent method
const result = await window.graphbus.callMethod(
    'HelloService',
    'generate_message',
    {}
);
```

### Secure IPC

The `preload.js` script exposes a safe API to the renderer:

```javascript
window.graphbus = {
    build: (config) => ...,
    startRuntime: (config) => ...,
    callMethod: (agent, method, args) => ...,
    // ... more methods
}
```

### Natural Language Processing

The UI includes pattern matching for common commands:

```javascript
if (command.includes('start') && command.includes('runtime')) {
    await startRuntime();
} else if (command.startsWith('call ')) {
    await callMethod(command);
}
```

## Configuration

### Python Path

Edit `python_bridge.js` line 8 to set your Python path:

```javascript
this.pythonPath = '/usr/bin/python3'; // Update as needed
```

Common paths:
- macOS (Homebrew): `/opt/homebrew/bin/python3`
- macOS (System): `/usr/bin/python3`
- Linux: `/usr/bin/python3`
- Windows: `C:\\Python310\\python.exe`

### GraphBus Path

The bridge automatically looks for graphbus in `../graphbus`. If your structure is different, update `python_bridge.js` line 9:

```javascript
this.graphbusPath = path.join(__dirname, '..', 'graphbus');
```

## Development

### Run in Development Mode

```bash
npm run dev
```

This enables:
- DevTools
- Detailed logging
- Hot reload (manual)

### Build for Distribution

```bash
npm run build
```

This creates a distributable app in `dist/`:
- **macOS**: `GraphBus UI.app`
- **Windows**: `GraphBus UI.exe`
- **Linux**: `graphbus-ui`

## Usage Examples

### Example 1: Hello World

```
1. Start app
2. Chat: "build the agents"
3. Wait for build to complete
4. Chat: "start the runtime"
5. Chat: "call HelloService.generate_message"
6. See result in chat
7. Switch to Monitor tab to see stats
```

### Example 2: Graph Visualization

```
1. Start runtime (Chat: "start the runtime")
2. Switch to Graph tab
3. Click "Load Graph"
4. See agents displayed as cards
5. View agent details
```

### Example 3: Real-Time Monitoring

```
1. Start runtime
2. Switch to Monitor tab
3. Watch statistics update every 2 seconds
4. Call some methods
5. See counters increment
```

## Troubleshooting

### "Python not found"

**Fix:** Update `pythonPath` in `python_bridge.js` to your Python location.

```bash
# Find Python
which python3

# Update python_bridge.js with the path
```

### "GraphBus module not found"

**Fix:** Ensure graphbus-core is installed:

```bash
cd ../graphbus
pip install -e .

# Test
python3 -c "import graphbus_core; print('OK')"
```

### "Runtime not starting"

**Fix:** Check the artifacts directory exists and has been built:

```bash
cd ../graphbus/examples/hello_graphbus
graphbus build agents/
ls .graphbus/  # Should show artifacts
```

### DevTools Console Errors

**Fix:** Run with dev mode to see detailed errors:

```bash
npm run dev
```

Check the console for Python errors and stack traces.

## Commands Reference

### Chat Commands

- `"start the runtime"` - Start GraphBus runtime
- `"stop the runtime"` - Stop runtime
- `"build the agents"` - Build from source
- `"list agents"` - Show all agents
- `"call Agent.method"` - Invoke method
- `"help"` - Show command help

### Control Tab Actions

- **Start Runtime** - Launch GraphBus runtime
- **Stop Runtime** - Shutdown runtime
- **Call Method** - Direct method invocation

### Build Tab Actions

- Configure agents directory
- Configure output directory
- Build agents from source

## API Reference

### window.graphbus

The renderer process has access to these methods:

```javascript
// Build agents
await window.graphbus.build({
    agentsDir: './agents',
    outputDir: './.graphbus',
    enableAgents: false,
    llmModel: null,
    apiKey: null
});

// Start runtime
await window.graphbus.startRuntime({
    artifactsDir: './.graphbus'
});

// Stop runtime
await window.graphbus.stopRuntime();

// Call method
await window.graphbus.callMethod(
    'AgentName',
    'method_name',
    { arg1: 'value1' }
);

// Publish event
await window.graphbus.publishEvent(
    '/topic/name',
    { key: 'value' }
);

// Get stats
const stats = await window.graphbus.getStats();

// Load graph
const graph = await window.graphbus.loadGraph('./.graphbus');

// List agents
const agents = await window.graphbus.listAgents();
```

## Keyboard Shortcuts

- **Enter** in chat input - Send command
- **⌘Q** - Quit app (macOS)
- **Ctrl+Q** - Quit app (Windows/Linux)

## Performance

- **Startup**: ~2-3 seconds
- **Build**: Depends on agent count
- **Runtime Start**: 1-2 seconds
- **Method Call**: <100ms
- **Stats Polling**: Every 2 seconds

## Security

- ✅ Context isolation enabled
- ✅ Node integration disabled
- ✅ Secure IPC through preload script
- ✅ No eval() or dangerous APIs
- ✅ Python code validated before execution

## Contributing

Contributions welcome! Areas for improvement:

1. **Graph Visualization** - Add force-directed layout
2. **LLM Integration** - Add streaming chat responses
3. **Build Mode** - Add negotiation history viewer
4. **Monitoring** - Add event timeline visualization
5. **Settings** - Add persistent configuration

## License

MIT License - See main GraphBus repository

## Support

- **Issues**: Report bugs in GitHub issues
- **Docs**: See GraphBus core documentation
- **Examples**: Check `../graphbus/examples/`

---

**Built with** ❤️ **for the GraphBus agent orchestration platform**

**Version**: 1.0.0
**Status**: ✅ Production Ready
