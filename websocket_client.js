// websocket_client.js - WebSocket client for connecting to GraphBus CLI
const WebSocket = require('ws');
const EventEmitter = require('events');

class GraphBusWebSocketClient extends EventEmitter {
    constructor(url = 'ws://localhost:8765') {
        super();
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        this.connected = false;
        this.messageQueue = [];
        this.pendingQuestions = new Map(); // question_id -> {resolve, reject}
    }

    /**
     * Connect to GraphBus WebSocket server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to GraphBus at ${this.url}...`);

            this.ws = new WebSocket(this.url);

            this.ws.on('open', () => {
                console.log('Connected to GraphBus WebSocket');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;

                // Send queued messages
                while (this.messageQueue.length > 0) {
                    const message = this.messageQueue.shift();
                    this.ws.send(message);
                }

                this.emit('connected');
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this._handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('Disconnected from GraphBus');
                this.connected = false;
                this.emit('disconnected');
                this._attemptReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.emit('error', error);

                // If initial connection fails, reject the promise
                if (!this.connected) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Handle incoming message from GraphBus
     */
    _handleMessage(message) {
        const { type, data, id } = message;

        console.log(`Received ${type}:`, data);

        switch (type) {
            case 'agent_message':
                // Agent sent a message - display in chat
                this.emit('agentMessage', {
                    agent: data.agent,
                    text: data.text,
                    metadata: data.metadata,
                    timestamp: data.timestamp
                });
                break;

            case 'progress':
                // Progress update
                this.emit('progress', {
                    current: data.current,
                    total: data.total,
                    message: data.message,
                    percent: data.percent
                });
                break;

            case 'question':
                // Agent is asking a question - show modal and wait for answer
                this.emit('question', {
                    questionId: data.question_id,
                    question: data.question,
                    options: data.options,
                    context: data.context
                });
                break;

            case 'error':
                // Error occurred
                this.emit('error', {
                    message: data.message,
                    exception: data.exception,
                    type: data.type
                });
                break;

            case 'result':
                // Operation completed with result
                this.emit('result', data);
                break;

            default:
                console.warn(`Unknown message type: ${type}`);
        }
    }

    /**
     * Send user message/command to GraphBus
     */
    sendMessage(text, metadata = {}) {
        this.send({
            type: 'user_message',
            data: {
                text: text,
                metadata: metadata,
                timestamp: Date.now()
            }
        });
    }

    /**
     * Send answer to a question
     */
    sendAnswer(questionId, answer) {
        this.send({
            type: 'answer',
            data: {
                question_id: questionId,
                answer: answer
            }
        });
    }

    /**
     * Send generic message to server
     */
    send(message) {
        const messageStr = JSON.stringify(message);

        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(messageStr);
        } else {
            // Queue message for when connection is restored
            this.messageQueue.push(messageStr);
            console.log('Message queued (not connected)');
        }
    }

    /**
     * Attempt to reconnect
     */
    _attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.emit('maxReconnectAttemptsReached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);

        setTimeout(() => {
            this.connect().catch(error => {
                console.error('Reconnection failed:', error);
            });
        }, delay);
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.maxReconnectAttempts = 0; // Prevent reconnection
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}

module.exports = GraphBusWebSocketClient;
