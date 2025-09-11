import type { ClientMessage, ServerMessage } from '../types/game';

class WebSocketManager {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private messageHandlers: Set<(message: ServerMessage) => void> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private url = 'ws://localhost:3000/ws';

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already connected, resolve immediately
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        resolve();
        return;
      }

      // If connecting, wait for it
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        const checkConnection = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.isConnected = true;
            resolve();
          } else if (this.ws?.readyState === WebSocket.CONNECTING) {
            setTimeout(checkConnection, 100);
          } else {
            // Connection failed, create new one
            this.connect().then(resolve).catch(reject);
          }
        };
        checkConnection();
        return;
      }

      try {
        console.log('Creating new WebSocket connection...');
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          console.log('Raw WebSocket message received:', event.data);
          try {
            const message: ServerMessage = JSON.parse(event.data);
            console.log('Parsed WebSocket message:', message);
            
            // Broadcast to all registered handlers
            this.messageHandlers.forEach(handler => {
              try {
                handler(message);
              } catch (error) {
                console.error('Error in message handler:', error);
              }
            });
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };

        this.ws.onclose = (event) => {
          console.log('🔴 WebSocket CLOSED:', event.code, event.reason);
          this.isConnected = false;
          
          // Attempt to reconnect after a delay
          if (event.code !== 1000) { // Not a normal closure
            this.reconnectTimeout = setTimeout(() => {
              console.log('Attempting to reconnect...');
              this.connect();
            }, 3000);
          }
        };

        this.ws.onerror = (event) => {
          console.error('WebSocket error:', event);
          this.isConnected = false;
          reject(new Error('WebSocket connection failed'));
        };

      } catch (err) {
        console.error('Failed to connect WebSocket:', err);
        reject(err);
      }
    });
  }

  disconnect() {
    console.log('🔥 disconnect() called');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      console.log('🔥 Closing WebSocket connection');
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    
    this.isConnected = false;
  }

  sendMessage(message: ClientMessage) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      console.log('Sending WebSocket message:', message);
      this.ws.send(messageStr);
    } else {
      console.warn('WebSocket is not connected, cannot send message');
      console.warn('isConnected:', this.isConnected);
      console.warn('ws:', this.ws);
      console.warn('readyState:', this.ws?.readyState);
    }
  }

  addMessageHandler(handler: (message: ServerMessage) => void) {
    this.messageHandlers.add(handler);
  }

  removeMessageHandler(handler: (message: ServerMessage) => void) {
    this.messageHandlers.delete(handler);
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: this.ws?.readyState
    };
  }
}

// Export singleton instance
export const websocketManager = new WebSocketManager();
