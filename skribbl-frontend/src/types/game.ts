// Game state enums
export const GameState = {
  Waiting: 'Waiting',
  Playing: 'Playing',
  Finished: 'Finished',
} as const;

export const PlayerState = {
  Ready: 'Ready',
  Playing: 'Playing',
  Drawing: 'Drawing',
  Disconnected: 'Disconnected',
} as const;

// Color and brush size options
export const Colors = {
  Black: '#000000',
  Red: '#FF0000',
  Blue: '#0000FF',
  Green: '#00FF00',
  Yellow: '#FFFF00',
  Purple: '#800080',
  Orange: '#FFA500',
  Pink: '#FFC0CB',
} as const;

export const BrushSizes = {
  Small: 2,
  Medium: 4,
  Large: 8,
} as const;

// Core data structures
export interface Player {
  id: string;
  username: string;
  score: number;
  is_connected: boolean;
  is_drawing: boolean;
  state: typeof PlayerState[keyof typeof PlayerState];
  joined_at: string;
}

export interface DrawStroke {
  x: number;
  y: number;
  color: string;
  brush_size: number;
  alpha?: number;
  is_eraser?: boolean;
  // Backend also sends these fields with camelCase names
  brushSize?: string;
}

export interface DrawPath {
  id: string;
  strokes: DrawStroke[];
  playerId?: string; // Who drew this path
  timestamp?: number; // When it was drawn
  // Backend also sends these fields with camelCase names
  createdAt?: string;
  brushSize?: string;
  colorHex?: string; // Hex color from backend
}

export interface ChatMessage {
  id: string;
  player_id: string;
  username: string;
  message: string;
  timestamp: string;
  is_winners_only: boolean;
}

export interface Guess {
  player_id: string;
  username: string;
  word: string;
  timestamp: string;
  time_remaining: number;
  normalized_time: number;
}

export interface RoundScores {
  round_number: number;
  word: string;
  guesser_scores: Record<string, number>; // Player ID -> Score
  artist_score: number;
  artist_streak: number;
  round_duration: number;
  correct_guesses: Guess[];
  median_guess_time: number;
  fraction_guessed: number;
}

export interface GameRoomData {
  id: string;
  code: string;
  players: Record<string, Player>;
  host_id: string;
  current_drawer: string | null;
  word: string | null;
  cycle_number: number;
  round_number: number; // Round within current cycle
  max_rounds: number; // Maximum number of cycles (complete rotations through all players)
  round_duration: number;
  game_state: typeof GameState[keyof typeof GameState];
  round_start_time: string | null;
  round_end_time: string | null;
  drawing_paths: DrawPath[];
  chat_messages: ChatMessage[];
  current_round_guesses: Guess[];
  winners: string[]; // Player IDs who have guessed correctly
  max_players: number;
  created_at: string;
  updated_at: string;
}

// WebSocket message types
export interface ClientMessage {
  type: 'JoinRoom' | 'LeaveRoom' | 'DrawUpdate' | 'DrawStroke' | 'Chat' | 'Guess' | 'StartGame' | 'EndRound' | 'WordSelected' | 'UpdateSettings';
  room_code: string;
  username?: string;
  player_id?: string;
  path?: DrawPath;
  stroke?: DrawStroke;
  message?: string;
  guess?: string;
  word?: string;
  max_rounds?: number;
}

export interface ServerMessage {
  type: 'PlayerJoined' | 'PlayerLeft' | 'DrawUpdate' | 'DrawStroke' | 'ChatMessage' | 'CorrectGuess' | 'RoundScores' | 'GameStarted' | 'PlayerKicked' | 'RoundEnd' | 'GameEnded' | 'RoundStart' | 'GameStateUpdate' | 'HostChanged' | 'Error' | 'WordSelected';
  room_code?: string;
  player?: Player;
  player_id?: string;
  username?: string;
  path?: DrawPath;
  stroke?: DrawStroke;
  message?: ChatMessage; // For ChatMessage and CorrectGuess
  chatMessage?: ChatMessage; // Legacy field for backward compatibility
  word?: string;
  room?: GameRoomData; // For GameStateUpdate
  errorMessage?: string; // For Error messages
  new_host?: Player; // For HostChanged messages
  drawer?: Player; // For RoundStart messages
  scores?: RoundScores; // For RoundScores
  final_scores?: Record<string, number>; // For GameEnded messages
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

export interface CreateRoomResponse {
  success: boolean;
  message: string;
  room?: GameRoomData;
  player?: Player;
}

export interface JoinRoomResponse {
  success: boolean;
  message: string;
  room?: GameRoomData;
  player?: Player;
}

export interface LeaveRoomResponse {
  success: boolean;
  message: string;
  player?: Player;
}

export interface HealthResponse {
  status: string;
  message: string;
}
