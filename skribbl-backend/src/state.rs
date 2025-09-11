use crate::models::{Room, Player, GameState};
use dashmap::DashMap;
use std::sync::Arc;
use uuid::Uuid;
use chrono::Utc;
use axum::extract::ws::Message;
use tokio::sync::mpsc;

// WebSocket connection info
pub struct WebSocketConnection {
    pub player_id: Uuid,
    pub room_code: String,
    pub sender: mpsc::UnboundedSender<Message>,
}

// Global application state for storing rooms and players
#[derive(Clone)]
pub struct AppState {
    pub rooms: Arc<DashMap<String, Room>>,      // Room code -> Room
    pub players: Arc<DashMap<Uuid, Player>>,    // Player ID -> Player
    pub connections: Arc<DashMap<Uuid, WebSocketConnection>>, // Player ID -> WebSocket connection
}

impl AppState {
    // Create a new AppState instance
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(DashMap::new()),
            players: Arc::new(DashMap::new()),
            connections: Arc::new(DashMap::new()),
        }
    }

    // Generate a unique 6-character room code
    pub fn generate_room_code(&self) -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        
        loop {
            // Generate a random 6-character code (uppercase letters and numbers)
            let code: String = (0..6)
                .map(|_| {
                    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                    chars.chars().nth(rng.gen_range(0..chars.len())).unwrap()
                })
                .collect();
            
            // Check if this code is already in use
            if !self.rooms.contains_key(&code) {
                return code;
            }
        }
    }

    // Create a new room
    pub fn create_room(&self, room_code: String, round_duration: u32, max_players: u8, host_id: Uuid) -> Room {
        let room = Room {
            id: Uuid::new_v4(),
            code: room_code.clone(),
            host_id,
            players: std::collections::HashMap::new(),
            current_drawer: None,
            word: None,
            round_number: 0,
            max_rounds: 3, // Default to 3 rounds
            cycle_number: 1, // Start at cycle 1, not 0
            round_duration,
            game_state: GameState::Waiting,
            round_start_time: None,
            round_end_time: None,
            drawing_paths: Vec::new(),
            chat_messages: Vec::new(),
            current_round_guesses: Vec::new(),
            winners: Vec::new(),
            max_players,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        
        self.rooms.insert(room_code, room.clone());
        room
    }

    // Get a room by its code
    pub fn get_room(&self, room_code: &str) -> Option<Room> {
        self.rooms.get(room_code).map(|room| room.clone())
    }

    // Add a player to a room
    pub fn add_player_to_room(&self, room_code: &str, player: Player) -> Result<(), String> {
        if let Some(mut room) = self.rooms.get_mut(room_code) {
            // Check if room is full
            if room.players.len() >= room.max_players as usize {
                return Err("Room is full".to_string());
            }
            
            // Check if username is already taken in this room
            if room.players.values().any(|p| p.username == player.username) {
                return Err("Username already taken in this room".to_string());
            }
            
            // Add player to room
            room.players.insert(player.id, player.clone());
            room.updated_at = Utc::now();
            
            // Also store player in global players map
            self.players.insert(player.id, player);
            
            Ok(())
        } else {
            Err("Room not found".to_string())
        }
    }

    // Remove a player from a room
    pub fn remove_player_from_room(&self, room_code: &str, player_id: &Uuid) -> Result<(Player, bool), String> {
        println!("=== remove_player_from_room started ===");
        println!("room_code: {}, player_id: {}", room_code, player_id);
        
        // First, get the player and check if room will be empty
        let (player, room_will_be_empty) = {
            if let Some(mut room) = self.rooms.get_mut(room_code) {
                println!("Room found, current players: {}", room.players.len());
                
                if let Some(player) = room.players.remove(player_id) {
                    println!("Player found and removed from room");
                    room.updated_at = Utc::now();
                    
                    // Check if room will be empty after this player leaves
                    let room_will_be_empty = room.players.is_empty();
                    println!("Room will be empty: {}", room_will_be_empty);
                    
                    (player, room_will_be_empty)
                } else {
                    println!("Player not found in room");
                    return Err("Player not found in room".to_string());
                }
            } else {
                println!("Room not found");
                return Err("Room not found".to_string());
            }
        };
        
        // Now remove from global players map
        self.players.remove(player_id);
        println!("Player removed from global players map");
        
        // If room is empty, remove it (after releasing the mutable reference)
        if room_will_be_empty {
            println!("Removing empty room");
            // Drop the mutable reference first, then remove
            drop(self.rooms.get_mut(room_code));
            
            // Now it's safe to remove
            self.rooms.remove(room_code);
            println!("Room removed successfully");
            
            // Clean up any remaining connections for this room
            self.connections.retain(|_, conn| conn.room_code != room_code);
            println!("Cleaned up connections for room {}", room_code);
        }
        
        println!("About to return success");
        let result = Ok((player, room_will_be_empty));
        println!("Returning: {:?}", result);
        result
    }

    // Get a player by ID
    pub fn get_player(&self, player_id: &Uuid) -> Option<Player> {
        self.players.get(player_id).map(|player| player.clone())
    }

    // Update an entire room
    pub fn update_room(&self, room_code: &str, updated_room: Room) -> Result<(), String> {
        if let Some(mut room) = self.rooms.get_mut(room_code) {
            *room = updated_room;
            room.updated_at = Utc::now();
            Ok(())
        } else {
            Err("Room not found".to_string())
        }
    }

    // Add a WebSocket connection for a player
    pub fn add_connection(&self, player_id: Uuid, room_code: String, sender: mpsc::UnboundedSender<Message>) {
        let connection = WebSocketConnection {
            player_id,
            room_code,
            sender,
        };
        self.connections.insert(player_id, connection);
    }

    // Remove a WebSocket connection
    pub fn remove_connection(&self, player_id: &Uuid) {
        self.connections.remove(player_id);
    }



    // Broadcast message to all players in a room
    pub fn broadcast_to_room(&self, room_code: &str, message: Message) {
        for connection in self.connections.iter() {
            if connection.room_code == room_code {
                let _ = connection.sender.send(message.clone());
            }
        }
    }

    // Broadcast message to all players in a room except one specific player
    pub fn broadcast_to_room_excluding(&self, room_code: &str, message: Message, exclude_player_id: Uuid) {
        println!("broadcast_to_room_excluding: room={}, exclude_player={}, total_connections={}", 
                 room_code, exclude_player_id, self.connections.len());
        
        let mut sent_count = 0;
        for connection in self.connections.iter() {
            if connection.room_code == room_code && connection.player_id != exclude_player_id {
                println!("Sending to player {} (excluding {})", connection.player_id, exclude_player_id);
                let _ = connection.sender.send(message.clone());
                sent_count += 1;
            }
        }
        println!("broadcast_to_room_excluding: sent to {} players", sent_count);
    }



    // Transfer host ownership to the next available player
    pub fn transfer_host_ownership(&self, room_code: &str) -> Result<Uuid, String> {
        if let Some(mut room) = self.rooms.get_mut(room_code) {
            if let Some(next_host) = room.players.keys().next().cloned() {
                room.host_id = next_host;
                room.updated_at = Utc::now();
                println!("Host ownership transferred to player {}", next_host);
                Ok(next_host)
            } else {
                Err("No players available to become host".to_string())
            }
        } else {
            Err("Room not found".to_string())
        }
    }

    // Helper: determine if a player is a winner (artist or guessed correctly)
    fn is_player_winner(room: &Room, player_id: &Uuid) -> bool {
        room.current_drawer.map(|d| d == *player_id).unwrap_or(false)
            || room.winners.contains(player_id)
    }

    // Broadcast to winners only (artist + winners)
    pub fn broadcast_to_winners(&self, room_code: &str, message: Message) {
        if let Some(room) = self.get_room(room_code) {
            for connection in self.connections.iter() {
                if connection.room_code == room_code {
                    if Self::is_player_winner(&room, &connection.player_id) {
                        let _ = connection.sender.send(message.clone());
                    }
                }
            }
        }
    }

    // Broadcast to non-winners only
    pub fn broadcast_to_non_winners(&self, room_code: &str, message: Message) {
        if let Some(room) = self.get_room(room_code) {
            for connection in self.connections.iter() {
                if connection.room_code == room_code {
                    if !Self::is_player_winner(&room, &connection.player_id) {
                        let _ = connection.sender.send(message.clone());
                    }
                }
            }
        }
    }

    // Broadcast GameStateUpdate with server-side filtering per recipient
    pub fn broadcast_room_state_filtered(&self, room_code: &str) {
        if let Some(room) = self.get_room(room_code) {
            for connection in self.connections.iter() {
                if connection.room_code != room_code { continue; }

                let is_winner = Self::is_player_winner(&room, &connection.player_id);
                let mut visible_room = room.clone();

                if !is_winner {
                    // Hide the word and winners-only chat from non-winners
                    visible_room.word = None;
                    visible_room.chat_messages = visible_room
                        .chat_messages
                        .into_iter()
                        .filter(|m| !m.is_winners_only)
                        .collect();
                }

                let state_update_msg = crate::models::ServerMessage::GameStateUpdate { room: visible_room };
                if let Ok(json) = serde_json::to_string(&state_update_msg) {
                    let _ = connection.sender.send(Message::Text(json));
                }
            }
        }
    }
}
