// internal_server.js - Embedded WebSocket server for Electron app
const WebSocket = require('ws');
const EventEmitter = require('events');

class InternalWebSocketServer extends EventEmitter {
    constructor(port = 8765) {
        super();
        this.port = port;
        this.wss = null;
        this.clients = new Set();
    }

    /**
     * Start the internal WebSocket server
     */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.wss = new WebSocket.Server({ port: this.port });

                this.wss.on('connection', (ws) => {
                    console.log(`Client connected to internal WebSocket server (total: ${this.clients.size + 1})`);
                    this.clients.add(ws);

                    ws.on('message', (data) => {
                        try {
                            const message = JSON.parse(data.toString());
                            console.log('[Internal Server] Received:', message.type);

                            // Forward message to main process
                            this.emit('message', { ws, message });
                        } catch (error) {
                            console.error('Failed to parse message:', error);
                        }
                    });

                    ws.on('close', () => {
                        this.clients.delete(ws);
                        console.log(`Client disconnected (remaining: ${this.clients.size})`);
                    });

                    ws.on('error', (error) => {
                        console.error('WebSocket error:', error);
                    });
                });

                this.wss.on('error', (error) => {
                    console.error('WebSocket server error:', error);
                    reject(error);
                });

                console.log(`Internal WebSocket server listening on ws://localhost:${this.port}`);
                resolve();
            } catch (error) {
                console.error('Failed to start internal WebSocket server:', error);
                reject(error);
            }
        });
    }

    /**
     * Broadcast message to all connected clients
     */
    broadcast(message) {
        const data = JSON.stringify(message);
        let count = 0;

        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
                count++;
            }
        });

        console.log(`[Internal Server] Broadcast to ${count} client(s):`, message.type);
    }

    /**
     * Send message to specific client
     */
    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Stop the server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.wss) {
                // Close all client connections
                this.clients.forEach((client) => {
                    client.close();
                });
                this.clients.clear();

                // Close server
                this.wss.close(() => {
                    console.log('Internal WebSocket server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get number of connected clients
     */
    getClientCount() {
        return this.clients.size;
    }
}

module.exports = InternalWebSocketServer;
