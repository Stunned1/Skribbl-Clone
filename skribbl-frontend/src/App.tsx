import { useState, useEffect, useRef } from 'react';
import { Lobby } from './components/Lobby';
import { WaitingRoom } from './components/WaitingRoom';
import { GameRoom } from './components/GameRoom';
import { useWebSocket } from './hooks/useWebSocket';
import type { GameRoomData, Player, DrawPath } from './types/game';
import { api } from './services/api';
import { sessionManager } from './utils/session';

type AppState = 'lobby' | 'waiting' | 'game';

function App() {
  const [currentState, setCurrentState] = useState<AppState>('lobby');
  const [currentRoom, setCurrentRoom] = useState<GameRoomData | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const { connect, disconnect, sendMessage } = useWebSocket({
    onMessage: (message) => {
      console.log('=== WebSocket Message Handler Called ===');
      console.log('Message type:', message.type);
      console.log('Full message:', message);
      
      switch (message.type) {
        case 'PlayerJoined':
          console.log('Processing PlayerJoined message:', message);
          console.log('Current room before update:', currentRoom);
          console.log('Room data from ref:', roomDataRef.current);
          
          // Use the ref data if currentRoom is not yet updated
          const roomToUpdate = currentRoom || roomDataRef.current;
          
          if (roomToUpdate && message.player) {
            const updatedRoom = { ...roomToUpdate };
            console.log('Adding player to room:', message.player);
            updatedRoom.players[message.player.id] = message.player;
            console.log('Updated room after adding player:', updatedRoom);
            setCurrentRoom(updatedRoom);
          } else {
            console.log('Missing room data or message.player:', { 
              currentRoom, 
              roomDataRef: roomDataRef.current, 
              player: message.player 
            });
          }
          break;
          
        case 'PlayerLeft':
          console.log('Processing PlayerLeft message:', message);
          // CRITICAL: Always use roomDataRef.current as the source of truth for the most recent state
          // This ensures we have the latest host_id from HostChanged messages
          const roomForLeave = roomDataRef.current;
          const leavingId = message.player_id || (message.player && message.player.id);
          if (roomForLeave && leavingId) {
            const updatedRoom = { ...roomForLeave };
            console.log('Removing player from room:', leavingId);
            console.log('Room host_id BEFORE player removal (should be updated from HostChanged):', updatedRoom.host_id);
            delete updatedRoom.players[leavingId];
            console.log('Updated room after removing player:', updatedRoom);
            console.log('Room host_id AFTER player removal:', updatedRoom.host_id);
            
            // Check if this was the current player leaving
            if (leavingId === currentPlayer?.id) {
              console.log('Current player was removed from room, returning to lobby');
              setCurrentRoom(null);
              setCurrentPlayer(null);
              setCurrentState('lobby');
              sessionManager.clearSession();
              disconnect();
            } else {
              // Another player left, update room
              // CRITICAL: The host_id should already be correct from HostChanged
              console.log('Player left, host_id preserved from HostChanged:', updatedRoom.host_id);
              setCurrentRoom(updatedRoom);
              roomDataRef.current = updatedRoom; // Keep ref in sync
            }
          } else {
            console.log('Missing room data or message.player_id:', { 
              currentRoom: currentRoom?.code, 
              roomDataRef: roomDataRef.current?.code,
              playerId: message.player_id || (message.player && message.player.id)
            });
          }
          break;
          
        case 'HostChanged':
          console.log('Processing HostChanged message:', message);
          console.log('Full HostChanged message:', message);
          console.log('Current room before update:', currentRoom);
          console.log('Room data from ref:', roomDataRef.current);
          console.log('New host data:', message.new_host);
          
          // Use roomDataRef as fallback if currentRoom is not set yet
          const roomForHostChange = currentRoom || roomDataRef.current;
          
          if (roomForHostChange && message.new_host) {
            const updatedRoom = { ...roomForHostChange };
            console.log('Old host_id:', updatedRoom.host_id);
            updatedRoom.host_id = message.new_host.id;
            console.log('New host_id:', updatedRoom.host_id);
            console.log('Host changed to:', message.new_host.username);
            
            // CRITICAL: Update both currentRoom AND roomDataRef immediately
            setCurrentRoom(updatedRoom);
            roomDataRef.current = updatedRoom; // Force update the ref
            console.log('Room state updated and ref synced');
          } else {
            console.log('Missing room data or new_host data');
            console.log('roomForHostChange:', roomForHostChange);
          }
          break;
          
        case 'GameStateUpdate':
          // Update entire room state
          console.log('Processing GameStateUpdate message:', message.room);
          if (message.room) {
            setCurrentRoom(message.room);
            roomDataRef.current = message.room; // Sync ref
            console.log('Room state updated from GameStateUpdate');
          }
          break;
          
        case 'DrawUpdate':
          // Handle drawing updates from other players
          // Don't update room state if we're the current drawer to prevent canvas clearing
          if (message.path && currentRoom) {
            // Normalize the path data structure from the WebSocket message
            // Backend now sends DrawPath with playerId, brushSize, createdAt (camelCase)
            const normalizedPath: DrawPath = {
              id: message.path.id,
              strokes: message.path.strokes || [],
              playerId: message.path.playerId || (message.path as any).player_id, // Handle both field names for backward compatibility
              timestamp: message.path.createdAt ? new Date(message.path.createdAt).getTime() : Date.now(),
            };
            
            console.log('DrawUpdate: Normalized path:', normalizedPath);
            
            if (normalizedPath.playerId !== currentPlayer?.id) {
              const updatedRoom = { ...currentRoom };
              updatedRoom.drawing_paths = [...updatedRoom.drawing_paths, normalizedPath];
              setCurrentRoom(updatedRoom);
              roomDataRef.current = updatedRoom; // Sync ref
              console.log('DrawUpdate: Added path from other player, total paths:', updatedRoom.drawing_paths.length);
            } else {
              console.log('DrawUpdate: Ignoring our own path to prevent canvas clearing');
            }
          }
          break;
          
        case 'ChatMessage':
          // Handle chat messages from other players
          if (message.chatMessage && currentRoom) {
            const updatedRoom = { ...currentRoom };
            updatedRoom.chat_messages = [...updatedRoom.chat_messages, message.chatMessage];
            setCurrentRoom(updatedRoom);
            roomDataRef.current = updatedRoom; // Sync ref
          }
          break;
          
        case 'RoundStart':
          // Round is (re)starting. Always record the new drawer and keep state in sync.
          console.log('Processing RoundStart message:', message);
          setCurrentState('game');
          if (currentRoom && message.drawer) {
            const updatedRoom = { 
              ...currentRoom,
              game_state: 'Playing' as any,
              current_drawer: message.drawer.id,
            } as any;
            console.log('Updated room for RoundStart (drawer only):', updatedRoom);
            setCurrentRoom(updatedRoom);
            roomDataRef.current = updatedRoom;
          }
          break;
          
        case 'GameEnded':
          // Game is over - show final scores and return to lobby
          console.log('Processing GameEnded message:', message);
          if (message.final_scores) {
            // You could show a final scores modal here
            console.log('Final scores:', message.final_scores);
          }
          // Return to lobby
          setCurrentState('lobby');
          setCurrentRoom(null);
          setCurrentPlayer(null);
          sessionManager.clearSession();
          disconnect();
          break;
          
        case 'Error':
          console.error(`Game Error: ${message.errorMessage || 'Unknown error'}`);
          // Could add visual error handling here if needed
          break;
          
        default:
          console.log('Unknown message type:', message.type);
          console.log('Full unknown message:', message);
          break;
      }
    }
  });

  useEffect(() => {
    // Check for existing session on app start
    const existingSession = sessionManager.getSession();
    if (existingSession && existingSession.roomCode) {
      // User was in a room, try to restore session
      console.log('Restoring session for user:', existingSession.username);
      // For now, just clear the session and let them rejoin
      // TODO: Implement proper session restoration
      sessionManager.clearSession();
    }

    // Cleanup WebSocket connection when component unmounts
    return () => {
      console.log('App component unmounting, disconnecting WebSocket');
      disconnect();
    };
  }, []); // Remove disconnect from dependencies to prevent premature disconnection

  // Send WebSocket JoinRoom message when currentRoom and currentPlayer are set
  useEffect(() => {
    console.log('=== useEffect for JoinRoom triggered ===');
    console.log('currentRoom:', currentRoom?.code);
    console.log('currentPlayer:', currentPlayer?.username);
    console.log('currentState:', currentState);
    
    if (currentRoom && currentPlayer && currentState === 'waiting' && !hasSentJoinMessage.current) {
      console.log('State updated, sending WebSocket JoinRoom message');
      hasSentJoinMessage.current = true;
      sendMessage({
        type: 'JoinRoom',
        room_code: currentRoom.code,
        username: currentPlayer.username
      });
    } else {
      console.log('Conditions not met for sending JoinRoom message');
    }
    
    // Cleanup function for StrictMode
    return () => {
      console.log('=== useEffect for JoinRoom cleanup ===');
      // Don't disconnect WebSocket here - just clean up the flag
      hasSentJoinMessage.current = false;
    };
  }, [currentRoom?.code, currentPlayer?.id, currentState]); // More stable dependencies

  // Store the latest room data for WebSocket message processing
  const roomDataRef = useRef<GameRoomData | null>(null);
  
  // Flag to prevent multiple JoinRoom messages
  const hasSentJoinMessage = useRef(false);
  
  // Flag to prevent multiple LeaveRoom calls
  const isLeavingRoom = useRef(false);
  
  // Update the ref whenever currentRoom changes
  useEffect(() => {
    roomDataRef.current = currentRoom;
  }, [currentRoom]);

  const handleJoinRoom = async (roomCode: string, username: string) => {
    try {
      const response = await api.joinRoom(roomCode, username);
      
      if (response.success) {
        const room = response.room;
        const player = response.player;
        
        if (room && player) {
          // Save session first
          sessionManager.saveSession({
            userId: player.id,
            username: player.username,
            roomCode: room.code
          });
          
          // Connect to WebSocket and wait for it to be ready
          await connect();
          
          // Set state - WebSocket message will be sent via useEffect when state updates
          setCurrentRoom(room);
          setCurrentPlayer(player);
          
          // Move to waiting room
          setCurrentState('waiting');
          
          return { success: true };
        } else {
          console.error('Invalid response from server');
          return { success: false, message: 'Invalid response from server' };
        }
      } else {
        console.error(`Failed to join room: ${response.message}`);
        return { success: false, message: response.message || 'Failed to join room' };
      }
    } catch (error) {
      console.error('Error joining room:', error);
      return { success: false, message: 'Failed to join room. Please try again.' };
    }
  };

  const handleCreateRoom = async (username: string, roundDuration: number) => {
    try {
      const response = await api.createRoom(username, roundDuration);
      
      if (response.success) {
        const room = response.room;
        const player = response.player;
        
        if (room && player) {
          // Save session first
          sessionManager.saveSession({
            userId: player.id,
            username: player.username,
            roomCode: room.code
          });
          
          // Connect to WebSocket and wait for it to be ready
          await connect();
          
          // Set state - WebSocket message will be sent via useEffect when state updates
          setCurrentRoom(room);
          setCurrentPlayer(player);
          
          // Move to waiting room
          setCurrentState('waiting');
          
          return { success: true };
        } else {
          console.error('Invalid response from server');
          return { success: false, message: 'Invalid response from server' };
        }
      } else {
        console.error(`Failed to create room: ${response.message}`);
        return { success: false, message: response.message || 'Failed to create room' };
      }
    } catch (error) {
      console.error('Error creating room:', error);
      return { success: false, message: 'Failed to create room. Please try again.' };
    }
  };

  const handleLeaveRoom = async () => {
    console.log('=== handleLeaveRoom called ===');
    console.log('Current state:', currentState);
    console.log('Current room:', currentRoom?.code);
    console.log('Current player:', currentPlayer?.username);
    console.log('Stack trace:', new Error().stack);
    console.log('Caller info:', new Error().stack?.split('\n')[2] || 'Unknown');
    console.log('Component render count:', Date.now());
    
    // Prevent multiple calls
    if (isLeavingRoom.current) {
      console.log('Already leaving, ignoring duplicate call');
      return;
    }
    
    isLeavingRoom.current = true;
    
    if (currentRoom && currentPlayer) {
      // Send WebSocket message to leave room
      sendMessage({
        type: 'LeaveRoom',
        room_code: currentRoom.code,
        player_id: currentPlayer.id
      });
      
      try {
        await api.leaveRoom(currentRoom.code, currentPlayer.id);
      } catch (error) {
        console.error('Error leaving room:', error);
      }
    }
    
    // Disconnect WebSocket
    disconnect();
    
    // Clear session
    sessionManager.clearSession();
    
    // Reset state
    setCurrentRoom(null);
    setCurrentPlayer(null);
    setCurrentState('lobby');
    
    // Reset the join message flag
    hasSentJoinMessage.current = false;
    
    // Reset the leaving flag
    isLeavingRoom.current = false;
  };

  const handleBackToLobby = () => {
    setCurrentState('lobby');
  };

  // Render based on current state
  console.log('Rendering App with state:', currentState);
  
  try {
    if (currentState === 'lobby') {
      console.log('Rendering Lobby component');
      return (
        <Lobby 
          onJoinRoom={handleJoinRoom}
          onCreateRoom={handleCreateRoom}
        />
      );
    }

    if (currentState === 'waiting' && currentRoom && currentPlayer) {
      console.log('Rendering WaitingRoom component');
      return (
        <WaitingRoom
          room={currentRoom}
          currentPlayer={currentPlayer}
          onLeaveRoom={handleLeaveRoom}
        />
      );
    }

    if (currentState === 'game' && currentRoom && currentPlayer) {
      console.log('Rendering GameRoom component');
      return (
        <GameRoom
          room={currentRoom}
          currentPlayer={currentPlayer}
          onLeaveRoom={handleLeaveRoom}
        />
      );
    }
  } catch (error) {
    console.error('Error rendering component:', error);
  return (
      <div className="error-state">
        <h1>Error rendering component</h1>
        <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        <button onClick={handleBackToLobby}>Back to Lobby</button>
      </div>
    );
  }

  // Fallback - should never reach here
  console.log('Rendering fallback error state');
  return (
    <div className="error-state">
      <h1>Something went wrong</h1>
      <button onClick={handleBackToLobby}>Back to Lobby</button>
      </div>
  );
}

export default App;