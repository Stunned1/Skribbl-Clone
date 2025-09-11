import { useState, useCallback, useEffect } from 'react';
import type { ClientMessage, ServerMessage } from '../types/game';
import { websocketManager } from '../utils/websocket-manager';

interface UseWebSocketOptions {
  onMessage?: (message: ServerMessage) => void;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (message: ClientMessage) => void;
  error: string | null;
}

export const useWebSocket = (options: UseWebSocketOptions = {}): UseWebSocketReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Debug logging for isConnected changes
  useEffect(() => {
    console.log('useWebSocket: isConnected changed to:', isConnected);
  }, [isConnected]);

  const connect = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      await websocketManager.connect();
      setIsConnected(true);
      setError(null);
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setError('Failed to connect to game server');
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    console.log('🔥 disconnect() called');
    websocketManager.disconnect();
    setIsConnected(false);
    setError(null);
  }, []);

  const sendMessage = useCallback((message: ClientMessage) => {
    websocketManager.sendMessage(message);
  }, []);

  // Set up message handler and sync connection status
  useEffect(() => {
    if (options.onMessage) {
      websocketManager.addMessageHandler(options.onMessage);
    }

    // Sync connection status
    const syncStatus = () => {
      const status = websocketManager.getConnectionStatus();
      setIsConnected(status.isConnected);
    };

    // Initial sync
    syncStatus();

    // Set up periodic sync
    const interval = setInterval(syncStatus, 1000);

    return () => {
      if (options.onMessage) {
        websocketManager.removeMessageHandler(options.onMessage);
      }
      clearInterval(interval);
    };
  }, [options.onMessage]);

  return {
    isConnected,
    connect,
    disconnect,
    sendMessage,
    error,
  };
};

