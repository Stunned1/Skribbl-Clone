import React, { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { GameRoomData, Player } from '../types/game';
import './WaitingRoom.css';

interface WaitingRoomProps {
  room: GameRoomData;
  currentPlayer: Player;
  onLeaveRoom: () => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  room,
  currentPlayer,
  onLeaveRoom,
}) => {
  const { sendMessage, isConnected } = useWebSocket();
  const [players, setPlayers] = useState<Player[]>([]);
  const isHost = currentPlayer.id === room.host_id;
  const [maxRounds, setMaxRounds] = useState<number>(room.max_rounds || 3);

  useEffect(() => {
    // Update players when room changes
    // Ensure consistent player order by sorting by joined_at timestamp
    const sortedPlayers = Object.values(room.players).sort((a, b) => {
      const aTime = new Date(a.joined_at).getTime();
      const bTime = new Date(b.joined_at).getTime();
      return aTime - bTime; // Oldest first (host first, then join order)
    });
    setPlayers(sortedPlayers);
    // keep local max rounds in sync
    if (typeof room.max_rounds === 'number') {
      setMaxRounds(room.max_rounds);
    }
  }, [room]);

  const handleStartGame = () => {
    if (isHost && players.length >= 2) {
      sendMessage({
        type: 'StartGame',
        room_code: room.code,
      });
      // onGameStart(); // This line is removed as per the edit hint
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(room.code);
  };

  return (
    <div className="waiting-room">
      <div className="waiting-room-header">
        <h1>Waiting Room</h1>
        <div className="room-info">
          <span className="room-code">Room: {room.code}</span>
          <button onClick={copyRoomCode} className="copy-button">
            Copy Code
          </button>
        </div>
      </div>

      <div className="waiting-room-content">
        <div className="players-section">
          <h2>Players ({players.length}/{room.max_players})</h2>
          <div className="players-list">
            {players.map((player) => (
              <div key={player.id} className="player-item">
                <div className="player-info">
                  <span className="player-name">
                    {player.username}
                    {player.id === room.host_id && ' (Host)'}
                  </span>
                  <span className="player-status">Ready</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="game-settings">
          <h3>Game Settings</h3>
          <div className="setting-item">
            <span>Round Duration:</span>
            <span>{room.round_duration}s</span>
          </div>
          <div className="setting-item">
            <span>Max Cycles:</span>
            {isHost ? (
              <select
                value={maxRounds}
                onChange={(e) => {
                  const next = Math.min(5, Math.max(1, parseInt(e.target.value, 10)));
                  setMaxRounds(next);
                  // broadcast setting change
                  sendMessage({
                    type: 'UpdateSettings',
                    room_code: room.code,
                    max_rounds: next,
                  } as any);
                }}
              >
                {[1,2,3,4,5].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            ) : (
              <span>{room.max_rounds}</span>
            )}
          </div>
        </div>

        <div className="waiting-room-actions">
          {isHost ? (
            <div>
              <button
                onClick={handleStartGame}
                disabled={players.length < 2}
                className="start-game-button"
              >
                Start Game ({players.length}/2+ players)
              </button>
              <div style={{fontSize: '12px', color: '#666', marginTop: '5px'}}>
                Debug: isHost={isHost.toString()}, players={players.length}, isConnected={isConnected.toString()}
              </div>
            </div>
          ) : (
            <div className="waiting-message">
              Waiting for host to start the game...
            </div>
          )}
          
          <button onClick={onLeaveRoom} className="leave-room-button">
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
};
