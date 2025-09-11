import type { 
  CreateRoomResponse, 
  JoinRoomResponse, 
  LeaveRoomResponse, 
  HealthResponse 
} from '../types/game';

const API_BASE_URL = '/api';

class ApiService {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, defaultOptions);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  async createRoom(username: string, roundDuration: number): Promise<CreateRoomResponse> {
    return this.request<CreateRoomResponse>('/createRoom', {
      method: 'POST',
      body: JSON.stringify({
        username,
        round_duration: roundDuration,
      }),
    });
  }

  async joinRoom(roomCode: string, username: string): Promise<JoinRoomResponse> {
    return this.request<JoinRoomResponse>('/joinRoom', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        username,
      }),
    });
  }

  async leaveRoom(roomCode: string, playerId: string): Promise<LeaveRoomResponse> {
    return this.request<LeaveRoomResponse>('/leaveRoom', {
      method: 'POST',
      body: JSON.stringify({
        room_code: roomCode,
        player_id: playerId,
      }),
    });
  }

  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }
}

export const api = new ApiService();
