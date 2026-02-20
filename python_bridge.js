// python_bridge.js - Bridge between Electron and Python graphbus-core
const { PythonShell } = require('python-shell');
const path = require('path');
const fs = require('fs');

class PythonBridge {
    constructor() {
        // Try multiple Python paths (Homebrew, system, etc.)
        const possiblePaths = [
            '/opt/homebrew/bin/python3',  // macOS Homebrew (M1/M2)
            '/usr/local/bin/python3',      // macOS Homebrew (Intel)
            '/usr/bin/python3',            // Linux/macOS system
            'python3'                      // Use PATH
        ];

        // Use the first path that actually exists on disk; fall back to PATH-based 'python3'
        this.pythonPath = possiblePaths.find(p => p === 'python3' || fs.existsSync(p)) || 'python3';
        this.graphbusPath = path.join(__dirname, '..', 'graphbus');
        this.runtimeActive = false;
        this.currentExecutor = null;

        console.log('PythonBridge initialized');
        console.log('Python path:', this.pythonPath);
        console.log('GraphBus path:', this.graphbusPath);
    }

    async execute(code) {
        return new Promise((resolve, reject) => {
            const options = {
                mode: 'text',
                pythonPath: this.pythonPath,
                pythonOptions: ['-u']
            };

            PythonShell.runString(code, options, (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });
    }

    async buildAgents(config) {
        const { agentsDir, outputDir, enableAgents, llmModel, apiKey } = config;

        const code = `
import sys
sys.path.insert(0, '${this.graphbusPath}')

from graphbus_core.build.builder import build_project
from graphbus_core.config import BuildConfig, LLMConfig

config = BuildConfig(
    root_package="",
    agent_dirs=["${agentsDir}"],
    output_dir="${outputDir}"
)

${enableAgents && llmModel && apiKey ? `
llm_config = LLMConfig(model="${llmModel}", api_key="${apiKey}")
config.llm_config = llm_config
` : ''}

artifacts = build_project(config)
print(f"SUCCESS:Built {len(artifacts.agents)} agents with {len(artifacts.topics)} topics")
`;

        try {
            const result = await this.execute(code);
            return this.parseOutput(result);
        } catch (error) {
            throw new Error(`Build failed: ${error.message}`);
        }
    }

    async startRuntime(config) {
        const { artifactsDir } = config;

        const code = `
import sys
sys.path.insert(0, '${this.graphbusPath}')

from graphbus_core.runtime.executor import RuntimeExecutor
from graphbus_core.config import RuntimeConfig

config = RuntimeConfig(artifacts_dir="${artifactsDir}", enable_message_bus=True)
executor = RuntimeExecutor(config)
executor.start()

print(f"SUCCESS:Runtime started with {executor.nodes.__len__()} nodes")

# Keep reference (this stays in memory)
_executor = executor
`;

        try {
            const result = await this.execute(code);
            this.runtimeActive = true;
            return this.parseOutput(result);
        } catch (error) {
            throw new Error(`Runtime start failed: ${error.message}`);
        }
    }

    async stopRuntime() {
        if (!this.runtimeActive) {
            return { message: 'Runtime not running' };
        }

        const code = `
if '_executor' in globals():
    _executor.stop()
    del _executor
    print("SUCCESS:Runtime stopped")
else:
    print("SUCCESS:Runtime was not active")
`;

        try {
            const result = await this.execute(code);
            this.runtimeActive = false;
            return this.parseOutput(result);
        } catch (error) {
            throw new Error(`Runtime stop failed: ${error.message}`);
        }
    }

    async callMethod(agent, method, args = {}) {
        if (!this.runtimeActive) {
            throw new Error('Runtime not running');
        }

        const argsJson = JSON.stringify(args);

        const code = `
import json
if '_executor' in globals():
    result = _executor.call_method("${agent}", "${method}", **json.loads('${argsJson}'))
    print(f"SUCCESS:{result}")
else:
    print("ERROR:Runtime not initialized")
`;

        try {
            const result = await this.execute(code);
            return this.parseOutput(result);
        } catch (error) {
            throw new Error(`Method call failed: ${error.message}`);
        }
    }

    async publishEvent(topic, payload) {
        if (!this.runtimeActive) {
            throw new Error('Runtime not running');
        }

        const payloadJson = JSON.stringify(payload);

        const code = `
import json
if '_executor' in globals():
    _executor.publish("${topic}", json.loads('${payloadJson}'), source="electron_ui")
    print("SUCCESS:Event published to ${topic}")
else:
    print("ERROR:Runtime not initialized")
`;

        try {
            const result = await this.execute(code);
            return this.parseOutput(result);
        } catch (error) {
            throw new Error(`Event publish failed: ${error.message}`);
        }
    }

    async getStats() {
        if (!this.runtimeActive) {
            return { running: false };
        }

        const code = `
import json
if '_executor' in globals():
    stats = _executor.get_stats()
    print(f"SUCCESS:{json.dumps(stats)}")
else:
    print('SUCCESS:{"running": false}')
`;

        try {
            const result = await this.execute(code);
            const parsed = this.parseOutput(result);
            return JSON.parse(parsed.message || '{"running": false}');
        } catch (error) {
            return { running: false };
        }
    }

    async loadGraphData(artifactsDir) {
        const code = `
import sys
import json
import traceback

sys.path.insert(0, '${this.graphbusPath}')

try:
    from graphbus_core.runtime.loader import ArtifactLoader

    loader = ArtifactLoader("${artifactsDir}")
    graph, agents, topics, subscriptions = loader.load_all()

    # Convert to JSON-serializable format
    nodes = []
    for agent in agents:
        methods_list = []
        if hasattr(agent, 'methods'):
            methods_list = [m.name if hasattr(m, 'name') else str(m) for m in agent.methods]

        subscriptions_list = []
        if hasattr(agent, 'subscriptions'):
            for s in agent.subscriptions:
                if hasattr(s, 'topic'):
                    # s.topic might be a Topic object or a string
                    topic = s.topic
                    if hasattr(topic, 'name'):
                        subscriptions_list.append(topic.name)
                    else:
                        subscriptions_list.append(str(topic))
                else:
                    subscriptions_list.append(str(s))

        nodes.append({
            'id': agent.name,
            'name': agent.name,
            'module': agent.module,
            'class_name': agent.class_name,
            'methods': methods_list,
            'subscriptions': subscriptions_list
        })

    # Get edges from graph
    edges = []
    import networkx as nx
    for source, target in graph.graph.edges():
        edges.append({
            'source': str(source),
            'target': str(target),
            'type': 'depends_on'
        })

    # Convert topics to strings
    topics_list = []
    for t in topics:
        if hasattr(t, 'name'):
            topics_list.append(t.name)
        else:
            topics_list.append(str(t))

    result = {
        'nodes': nodes,
        'edges': edges,
        'topics': topics_list
    }

    # Custom JSON encoder to handle any remaining non-serializable objects
    def default_converter(obj):
        if hasattr(obj, 'name'):
            return obj.name
        elif hasattr(obj, '__dict__'):
            return str(obj)
        else:
            return str(obj)

    json_str = json.dumps(result, default=default_converter)
    print(f"SUCCESS:{json_str}")

except Exception as e:
    error_msg = traceback.format_exc()
    print(f"ERROR:Load graph failed: {str(e)}\\n{error_msg}")
`;

        try {
            const result = await this.execute(code);
            const parsed = this.parseOutput(result);
            return JSON.parse(parsed.message);
        } catch (error) {
            throw new Error(`Load graph failed: ${error.message}`);
        }
    }

    async listAgents() {
        if (!this.runtimeActive) {
            return [];
        }

        const code = `
import json
if '_executor' in globals():
    agents = []
    for agent_def in _executor.agent_definitions:
        agents.append({
            'name': agent_def.name,
            'module': agent_def.module,
            'class_name': agent_def.class_name,
            'methods': [m.name for m in getattr(agent_def, 'methods', [])]
        })
    print(f"SUCCESS:{json.dumps(agents)}")
else:
    print('SUCCESS:[]')
`;

        try {
            const result = await this.execute(code);
            const parsed = this.parseOutput(result);
            return JSON.parse(parsed.message || '[]');
        } catch (error) {
            return [];
        }
    }

    parseOutput(output) {
        if (!output || output.length === 0) {
            return { message: '' };
        }

        const lastLine = output[output.length - 1];

        if (lastLine.startsWith('SUCCESS:')) {
            return {
                success: true,
                message: lastLine.substring(8),
                fullOutput: output.join('\n')
            };
        } else if (lastLine.startsWith('ERROR:')) {
            throw new Error(lastLine.substring(6));
        } else {
            return {
                message: output.join('\n')
            };
        }
    }

    cleanup() {
        if (this.runtimeActive) {
            this.stopRuntime().catch(console.error);
        }
    }
}

module.exports = PythonBridge;
