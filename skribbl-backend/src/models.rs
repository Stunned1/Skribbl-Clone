use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// Game state enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GameState {
    Waiting,    
    Playing,    
    Finished,   
}

// Player state enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PlayerState {
    Spectator,  
    Drawing,    
    Guessing,   
    Disconnected,
}

// Color enum for drawing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Color {
    Black,
    Red,
    Green,
    Blue,
    Yellow,
    Purple,
    Orange,
    Brown,
    Pink,
    Gray,
}

// Brush size enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BrushSize {
    Small,
    Medium,
    Large,
}

// Individual player struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: Uuid,
    pub username: String,
    pub score: u32,
    pub state: PlayerState,
    pub is_connected: bool,
    pub is_drawing: bool,
    pub joined_at: chrono::DateTime<chrono::Utc>,
    pub artist_streak: u32, // Track artist streak across rounds (0-5)
}

// Drawing stroke for canvas
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawStroke {
    pub x: f32,
    pub y: f32,
    pub timestamp: u64,
    #[serde(rename = "color")]
    pub color_hex: String,
    #[serde(default)]
    pub alpha: f32,
    #[serde(default)]
    pub is_eraser: bool,
    #[serde(rename = "brushPx", default)]
    pub brush_px: u32,
    #[serde(rename = "brushSize")]
    pub brush_size: BrushSize,
}

// Complete drawing path
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawPath {
    pub id: Uuid,
    #[serde(rename = "playerId")]
    pub player_id: Uuid,
    pub color: Color,
    #[serde(rename = "colorHex")]
    pub color_hex: String, // Hex color string for frontend compatibility
    #[serde(rename = "brushSize")]
    pub brush_size: BrushSize,
    pub strokes: Vec<DrawStroke>,
    #[serde(rename = "createdAt")]
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: Uuid,
    pub player_id: Uuid,
    pub username: String,
    pub message: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub is_winners_only: bool,
}

// Guess tracking for scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guess {
    pub player_id: Uuid,
    pub username: String,
    pub word: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub time_remaining: u32, // Seconds remaining when guessed
    pub normalized_time: f64, // tᵢ / T (clamped 0-1)
}

// Round scoring results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundScores {
    pub round_number: u32,
    pub word: String,
    pub guesser_scores: HashMap<Uuid, u32>, // Player ID -> Score
    pub artist_score: u32,
    pub artist_streak: u32,
    pub round_duration: u32,
    pub correct_guesses: Vec<Guess>,
    pub median_guess_time: f64, // Median of normalized times
    pub fraction_guessed: f64,  // G/N
}

// Game room struct
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: Uuid,
    pub code: String,                    // 6-character room code
    pub host_id: Uuid,                   // ID of the host/creator
    pub players: HashMap<Uuid, Player>,  // Player ID -> Player
    pub current_drawer: Option<Uuid>,    // ID of player currently drawing
    pub word: Option<String>,            
    pub round_number: u32,
    pub max_rounds: u32, // Maximum number of cycles (complete rotations through all players)
    pub cycle_number: u32, // Track how many times we've gone through all players
    pub round_duration: u32,             
    pub game_state: GameState,
    pub round_start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub round_end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub drawing_paths: Vec<DrawPath>,    // All drawing paths in current round
    pub chat_messages: Vec<ChatMessage>, // Chat history (keep last 10 between rounds)
    pub current_round_guesses: Vec<Guess>, // Track guesses for current round scoring
    pub winners: Vec<Uuid>, // Players who have guessed correctly (including artist)
    pub max_players: u8,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

// Request/Response structs for API endpoints
#[derive(Debug, Deserialize)]
pub struct CreateRoomRequest {
    pub username: String,
    pub round_duration: u32,
}

#[derive(Debug, Serialize)]
pub struct CreateRoomResponse {
    pub success: bool,
    pub message: String,
    pub room: Option<Room>,
    pub player: Option<Player>,
}

#[derive(Debug, Deserialize)]
pub struct JoinRoomRequest {
    pub room_code: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct JoinRoomResponse {
    pub success: bool,
    pub message: String,
    pub room: Option<Room>,
    pub player: Option<Player>,
}

#[derive(Debug, Deserialize)]
pub struct LeaveRoomRequest {
    pub room_code: String,
    pub player_id: String,
}

// Frontend drawing path format (simplified)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendDrawPath {
    pub id: String,
    pub strokes: Vec<FrontendDrawStroke>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendDrawStroke {
    pub x: f32,
    pub y: f32,
    pub color: String,
    pub brush_size: u32,
    #[serde(default)]
    pub alpha: f32,
    #[serde(default)]
    pub is_eraser: bool,
    #[serde(default)]
    pub brush_px: u32,
}

// WebSocket message types
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    JoinRoom { room_code: String, username: String },
    LeaveRoom { room_code: String, player_id: String },
    DrawUpdate { room_code: String, path: FrontendDrawPath },
    DrawStroke { room_code: String, stroke: FrontendDrawStroke },
    Chat { room_code: String, message: String },
    WinnersChat { room_code: String, message: String },
    Guess { room_code: String, guess: String },
    StartGame { room_code: String },
    EndRound { room_code: String },
    WordSelected { room_code: String, word: String },
    UpdateSettings { room_code: String, max_rounds: u32 },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    PlayerJoined { room_code: String, player: Player },
    PlayerLeft { room_code: String, player: Player },
    DrawUpdate { room_code: String, path: DrawPath },
    DrawStroke { room_code: String, stroke: DrawStroke },
    ChatMessage { message: ChatMessage },
    CorrectGuess { player: Player, word: String },
    RoundScores { scores: RoundScores }, // Detailed scoring results
    GameStarted { room_code: String, drawer: Player },
    PlayerKicked { room_code: String, player: Player },
    RoundEnd { word: String, scores: HashMap<String, u32> },
    GameEnded { final_scores: HashMap<String, u32> },
    RoundStart { room_code: String, drawer: Player },
    GameStateUpdate { room: Room },
    HostChanged { new_host: Player },
    Error { message: String },
    WordSelected { word: String },
}

// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub message: String,
}
