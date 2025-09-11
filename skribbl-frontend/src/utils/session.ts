export interface UserSession {
  userId: string;
  username: string;
  roomCode?: string;
}

const SESSION_KEY = 'skribbl_user_session';

export const sessionManager = {
  // Save user session to localStorage
  saveSession: (session: UserSession): void => {
    try {
      console.log('Saving session:', session);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      console.log('Session saved successfully');
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  },

  // Get user session from localStorage
  getSession: (): UserSession | null => {
    try {
      const sessionData = localStorage.getItem(SESSION_KEY);
      console.log('Retrieved session data:', sessionData);
      const session = sessionData ? JSON.parse(sessionData) : null;
      console.log('Parsed session:', session);
      return session;
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  },

  // Clear user session
  clearSession: (): void => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  },

  // Update room code in session
  updateRoomCode: (roomCode: string): void => {
    try {
      const session = sessionManager.getSession();
      if (session) {
        session.roomCode = roomCode;
        sessionManager.saveSession(session);
      }
    } catch (error) {
      console.error('Failed to update room code:', error);
    }
  },

  // Check if user is already in a room
  isInRoom: (): boolean => {
    const session = sessionManager.getSession();
    return !!(session?.roomCode);
  }
};
