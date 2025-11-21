import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
    Node,
    Edge,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    MiniMap,
    addEdge,
    Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';

const AgentGraph = ({ nodes: initialNodes, edges: initialEdges }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Initialize nodes and edges when props change
    useEffect(() => {
        if (initialNodes && initialNodes.length > 0) {
            // Convert agent nodes to React Flow format
            const rfNodes = initialNodes.map((node) => ({
                id: node.name,
                data: {
                    label: (
                        <div style={{ textAlign: 'center', color: '#fff' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{node.name}</div>
                            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>
                                {node.module}
                            </div>
                        </div>
                    ),
                    methods: node.methods,
                    module: node.module,
                },
                position: { x: Math.random() * 400, y: Math.random() * 400 },
                style: {
                    background: '#667eea',
                    border: '2px solid #4c51bf',
                    borderRadius: '8px',
                    padding: '12px',
                    minWidth: '120px',
                    minHeight: '60px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                },
            }));

            // Convert edges to React Flow format
            const rfEdges = (initialEdges || []).map((edge, index) => ({
                id: `${edge.source}-${edge.target}-${index}`,
                source: edge.source,
                target: edge.target,
                label: edge.type || 'depends_on',
                animated: true,
                style: {
                    stroke: '#f59e0b',
                    strokeWidth: 2,
                },
                labelStyle: {
                    background: 'rgba(0, 0, 0, 0.6)',
                    color: '#888',
                    fontSize: '11px',
                    fill: '#888',
                },
            }));

            setNodes(rfNodes);
            setEdges(rfEdges);
        }
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    const onConnect = useCallback(
        (connection) => setEdges((eds) => addEdge(connection, eds)),
        [setEdges]
    );

    // Handle node click to show details
    const handleNodeClick = useCallback((event, node) => {
        const methods = node.data.methods || [];
        const tooltip = `Module: ${node.data.module}\nMethods: ${methods.join(', ')}`;
        console.log(`Clicked node: ${node.id}\n${tooltip}`);
    }, []);

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                fitView
            >
                <Background color="#1a1a1a" style={{ backgroundColor: '#0f0f0f' }} />
                <Controls />
                <MiniMap
                    nodeColor={(node) => '#667eea'}
                    nodeStrokeColor="#4c51bf"
                    nodeClassName="minimap-node"
                    style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid #667eea',
                    }}
                />
            </ReactFlow>
        </div>
    );
};

export default AgentGraph;
