import React, { useState } from 'react';
import './Lobby.css';

interface LobbyProps {
  onJoinRoom: (roomCode: string, username: string) => Promise<{ success: boolean; message?: string }>;
  onCreateRoom: (username: string, roundDuration: number) => Promise<{ success: boolean; message?: string }>;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoinRoom, onCreateRoom }) => {
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [prevTab, setPrevTab] = useState<'create' | 'join'>('create');
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roundDuration, setRoundDuration] = useState(60);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleTabSwitch = (next: 'create' | 'join') => {
    if (next === activeTab) return;
    setPrevTab(activeTab);
    setActiveTab(next);
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    if (serverError) {
      setServerError(null);
    }
  };

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomCode(e.target.value.toUpperCase());
    if (serverError) {
      setServerError(null);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setServerError(null); // Clear any previous errors
      const result = await onCreateRoom(username.trim(), roundDuration);
      if (!result.success) {
        setServerError("Sorry, we're having trouble creating your room right now. Please try again.");
      }
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && roomCode.trim()) {
      setServerError(null); // Clear any previous errors
      const result = await onJoinRoom(roomCode.trim().toUpperCase(), username.trim());
      if (!result.success) {
        setServerError("Your username might be taken, or you might have the wrong Room Code.");
      }
    }
  };

  return (
    <div className="lobby-container">
      <div className="lobby-sidebar">
        <div className="lobby-header">
          <img src="/riot-skribbl-logo.png" alt="Riot Skribbl" />
          <div className="tab-bar">
            <button
              className={`tab-button ${activeTab === 'create' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('create')}
            >
              Create Room
            </button>
            <button
              className={`tab-button ${activeTab === 'join' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('join')}
            >
              Join Room
            </button>
            <div className={`tab-indicator ${activeTab === 'create' ? 'create' : 'join'} ${prevTab === 'create' && activeTab === 'join' ? 'anim-ltr' : ''} ${prevTab === 'join' && activeTab === 'create' ? 'anim-rtl' : ''}`} />
          </div>
        </div>

        <div className="lobby-content">
          {activeTab === 'create' ? (
            <form onSubmit={handleCreateRoom} className="lobby-form">
              <div className="form-group">
                <div className="floating-input">
                  <input
                    id="username-create"
                    type="text"
                    value={username}
                    onChange={handleUsernameChange}
                    placeholder=" "
                    required
                    maxLength={22}
                    className={`form-input ${serverError ? 'error' : ''}`}
                  />
                  <label htmlFor="username-create" className="floating-label">USERNAME</label>
                </div>
              </div>

              <div className="form-group">
                <div className="floating-input">
                  <select
                    id="round-duration"
                    value={roundDuration}
                    onChange={(e) => setRoundDuration(Number(e.target.value))}
                    className="form-select"
                  >
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={90}>90 seconds</option>
                    <option value={120}>120 seconds</option>
                  </select>
                  <label htmlFor="round-duration" className="floating-label">ROUND DURATION</label>
                  <div className="select-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6,9 12,15 18,9"></polyline>
                    </svg>
                  </div>
                </div>
              </div>

              {serverError && (
                <div className="error-message">
                  {serverError}
                </div>
              )}

              <button 
                type="submit" 
                className="submit-button"
                disabled={!username.trim()}
              >
                <svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12,5 19,12 12,19"></polyline>
                </svg>
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoinRoom} className="lobby-form">
              <div className="form-group">
                <div className="floating-input">
                  <input
                    id="username-join"
                    type="text"
                    value={username}
                    onChange={handleUsernameChange}
                    placeholder=" "
                    required
                    maxLength={22}
                    className={`form-input ${serverError ? 'error' : ''}`}
                  />
                  <label htmlFor="username-join" className="floating-label">USERNAME</label>
                </div>
              </div>

              <div className="form-group">
                <div className="floating-input">
                  <input
                    id="room-code"
                    type="text"
                    value={roomCode}
                    onChange={handleRoomCodeChange}
                    placeholder=" "
                    required
                    maxLength={6}
                    className={`form-input ${serverError ? 'error' : ''}`}
                  />
                  <label htmlFor="room-code" className="floating-label">ROOM CODE</label>
                </div>
              </div>

              {serverError && (
                <div className="error-message">
                  {serverError}
                </div>
              )}

              <button 
                type="submit" 
                className="submit-button"
                disabled={!username.trim() || !roomCode.trim()}
              >
                <svg width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12,5 19,12 12,19"></polyline>
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="lobby-image">
        <img src="/jett.png" alt="Jett" />
      </div>
    </div>
  );
};
