use axum::{
    routing::{get, post},
    Router,
    Json,
    http::StatusCode,
    serve,
    extract::ws::{WebSocket, WebSocketUpgrade},
    response::IntoResponse,
};
use std::net::SocketAddr;
use tower_http::cors::{CorsLayer, Any};
use axum::extract::ws::Message;
use futures_util::{SinkExt, StreamExt};

mod models;
mod state;
mod utils;
mod websocket;
mod scoring;

use models::*;
use state::AppState;

use uuid::Uuid;





async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        message: "Skribbl Clone Backend is running!".to_string(),
    })
}

async fn create_room(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<CreateRoomRequest>
) -> (StatusCode, Json<CreateRoomResponse>) {
    let room_code = state.generate_room_code();
    
    let player_id = Uuid::new_v4();
    let player = Player {
        id: player_id,
        username: payload.username.clone(),
        score: 0,
        state: PlayerState::Spectator,
        is_connected: true,
        is_drawing: false,
        joined_at: chrono::Utc::now(),
        artist_streak: 0,
    };
    
    let _room = state.create_room(room_code.clone(), payload.round_duration, 8, player_id);
    
    if let Err(_e) = state.add_player_to_room(&room_code, player.clone()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(CreateRoomResponse {
                success: false,
                message: "Failed to add player to room".to_string(),
                room: None,
                player: None,
            })
        );
    }
    
    // Get the created room
    let room = state.get_room(&room_code).unwrap();
    
    (
        StatusCode::CREATED,
        Json(CreateRoomResponse {
            success: true,
            message: "Room created successfully".to_string(),
            room: Some(room.clone()),
            player: Some(player),
        })
    )
}

async fn join_room(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<JoinRoomRequest>
) -> (StatusCode, Json<JoinRoomResponse>) {
    if state.get_room(&payload.room_code).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(JoinRoomResponse {
                success: false,
                message: "Room not found".to_string(),
                room: None,
                player: None,
            })
        );
    }
    
    let player_id = Uuid::new_v4();
    let player = Player {
        id: player_id,
        username: payload.username.clone(),
        score: 0,
        state: PlayerState::Spectator,
        is_connected: true,
        is_drawing: false,
        joined_at: chrono::Utc::now(),
        artist_streak: 0,
    };
    
    match state.add_player_to_room(&payload.room_code, player.clone()) {
        Ok(_) => {
            let room = state.get_room(&payload.room_code).unwrap();
            (
                StatusCode::OK,
                Json(JoinRoomResponse {
                    success: true,
                    message: "Joined room successfully".to_string(),
                    room: Some(room.clone()),
                    player: Some(player),
                })
            )
        },
        Err(_e) => (
            StatusCode::BAD_REQUEST,
            Json(JoinRoomResponse {
                success: false,
                message: "Failed to join room".to_string(),
                room: None,
                player: None,
            })
        ),
    }
}

async fn leave_room(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<LeaveRoomRequest>
) -> (StatusCode, Json<serde_json::Value>) {
    let room_code = payload.room_code.trim().to_uppercase();
    let player_id_str = payload.player_id.trim();
    
    if room_code.len() != 6 || !room_code.chars().all(|c| c.is_alphanumeric()) {
        return (
            StatusCode::BAD_REQUEST, 
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid room code format"
            }))
        );
    }
    
    let player_id = match Uuid::parse_str(player_id_str) {
        Ok(id) => id,
        Err(_) => return (
            StatusCode::BAD_REQUEST, 
            Json(serde_json::json!({
                "success": false,
                "error": "Invalid player ID format"
            }))
        ),
    };
    
    if let Some(room) = state.get_room(&room_code) {
        if !room.players.contains_key(&player_id) {
            return (
                StatusCode::FORBIDDEN, 
                Json(serde_json::json!({
                    "success": false,
                    "error": "Player is not in this room"
                }))
            );
        }
    }
    
    match state.remove_player_from_room(&room_code, &player_id) {
        Ok((player, room_will_be_empty)) => {
            // Check if this was the host and transfer ownership if needed
            if !room_will_be_empty {
                if let Some(room) = state.get_room(&room_code) {
                    if room.host_id == player_id {
                        // This was the host, transfer ownership
                        if let Ok(new_host_id) = state.transfer_host_ownership(&room_code) {
                            if let Some(new_host) = room.players.get(&new_host_id) {
                                println!("Host ownership transferred to {}", new_host.username);
                                
                                // Broadcast host change to remaining players
                                let host_change_msg = ServerMessage::HostChanged {
                                    new_host: new_host.clone(),
                                };
                                if let Ok(json) = serde_json::to_string(&host_change_msg) {
                                    state.broadcast_to_room(&room_code, Message::Text(json));
                                }
                            }
                        }
                    }
                }
            }
            
            (
                StatusCode::OK, 
                Json(serde_json::json!({
                    "success": true,
                    "message": format!("Player {} left the room", player.username)
                }))
            )
        },
        Err(e) => (
            StatusCode::NOT_FOUND, 
            Json(serde_json::json!({
                "success": false,
                "error": e
            }))
        ),
    }
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}









async fn handle_socket(socket: WebSocket, state: AppState) {
    let (sender, mut receiver) = socket.split();
    println!("New WebSocket connection established");
    
    // Create a channel for sending messages back to this connection
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    
    // Spawn a task to forward messages from the channel to the WebSocket
    let mut sender_task = sender;
    tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if let Err(e) = sender_task.send(message).await {
                println!("Failed to send message: {}", e);
                break;
            }
        }
    });
    
    let mut current_player_id: Option<Uuid> = None;
    let mut current_room_code: Option<String> = None;
    
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                println!("Received message: {}", text);
                
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        println!("Successfully parsed message: {:?}", client_msg);
                        match client_msg {
                            ClientMessage::JoinRoom { room_code, username } => {
                                println!("Calling handle_join_room for {} in room {}", username, room_code);
                                websocket::rooms::handle_join_room(&state, &room_code, &username, &tx, &mut current_player_id, &mut current_room_code).await;
                            },
                            ClientMessage::LeaveRoom { room_code, player_id } => {
                                println!("Calling handle_leave_room for player {} in room {}", player_id, room_code);
                                websocket::rooms::handle_leave_room(&state, &room_code, &player_id, &tx, &mut current_player_id, &mut current_room_code).await;
                            },
                            ClientMessage::DrawUpdate { room_code, path } => {
                                websocket::drawing::handle_draw_update(&state, &room_code, &path, &tx).await;
                            },
                            ClientMessage::DrawStroke { room_code, stroke } => {
                                websocket::drawing::handle_draw_stroke(&state, &room_code, &stroke, &tx).await;
                            },
                            ClientMessage::Chat { room_code, message } => {
                                if let Some(player_id) = current_player_id {
                                    // Get player info from state
                                    if let Some(player) = state.get_player(&player_id) {
                                        websocket::chat::handle_chat(&state, &room_code, &message, player_id, &player.username, &tx).await;
                                    } else {
                                        println!("Player not found for chat message");
                                    }
                                } else {
                                    println!("No current player ID for chat message");
                                }
                            },
                            ClientMessage::Guess { room_code, guess } => {
                                websocket::chat::handle_guess(&state, &room_code, &guess, &tx).await;
                            },
                            ClientMessage::StartGame { room_code } => {
                                websocket::rooms::handle_start_game(&state, &room_code, &tx).await;
                            },
                            ClientMessage::EndRound { room_code } => {
                                websocket::rooms::handle_end_round(&state, &room_code, &tx).await;
                            },
                            ClientMessage::WordSelected { room_code, word } => {
                                websocket::rooms::handle_word_selected(&state, &room_code, &word, &tx).await;
                            },
                            ClientMessage::UpdateSettings { room_code, max_rounds } => {
                                websocket::rooms::handle_update_settings(&state, &room_code, max_rounds, &tx).await;
                            },
                            ClientMessage::WinnersChat { room_code, message } => {
                                if let Some(player_id) = current_player_id {
                                    if let Some(player) = state.get_player(&player_id) {
                                        websocket::chat::handle_winners_chat(&state, &room_code, &message, player_id, &player.username).await;
                                    }
                                }
                            }
                        }
                    },
                    Err(e) => {
                        println!("Failed to parse message: {}", e);
                        let error_msg = ServerMessage::Error {
                            message: "Invalid message format".to_string(),
                        };
                        if let Ok(json) = serde_json::to_string(&error_msg) {
                            let _ = tx.send(Message::Text(json));
                        }
                    }
                }
            },
            Ok(Message::Close(_)) => {
                println!("WebSocket connection closed");
                break;
            },
            Err(e) => {
                println!("WebSocket error: {}", e);
                break;
            },
            _ => {}
        }
    }
    
    // Clean up connection when socket closes
    if let Some(player_id) = current_player_id {
        state.remove_connection(&player_id);
        if let Some(room_code) = &current_room_code {
            // Notify other players that this player disconnected
            let disconnect_msg =                 ServerMessage::PlayerLeft {
                    room_code: room_code.clone(),
                    player: Player {
                        id: player_id,
                        username: "Unknown".to_string(),
                        score: 0,
                        state: PlayerState::Disconnected,
                        is_connected: false,
                        is_drawing: false,
                        joined_at: chrono::Utc::now(),
                        artist_streak: 0,
                    },
                };
            if let Ok(json) = serde_json::to_string(&disconnect_msg) {
                state.broadcast_to_room(room_code, Message::Text(json));
            }
        }
    }
    
    println!("WebSocket connection ended");
}

#[tokio::main]
async fn main() {
    let state = AppState::new();
    
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/createRoom", post(create_room))
        .route("/joinRoom", post(join_room))
        .route("/leaveRoom", post(leave_room))
        .route("/ws", get(websocket_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Skribbl Clone Backend starting on {}", addr);
    println!("Health check: http://localhost:3000/health");
    println!("Create room: POST http://localhost:3000/createRoom");
    println!("Join room: POST http://localhost:3000/joinRoom");
    println!("Leave room: POST http://localhost:3000/leaveRoom");
    println!("WebSocket: ws://localhost:3000/ws");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("Server listening on {}", addr);
    
    serve(listener, app).await.unwrap();
}
