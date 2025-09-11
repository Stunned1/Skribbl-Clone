use crate::models::{DrawPath, DrawStroke, FrontendDrawPath, FrontendDrawStroke};
use crate::state::AppState;
use crate::utils::{convert_color, convert_brush_size};
use axum::extract::ws::Message;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

/// Handle drawing update messages (complete paths)
pub async fn handle_draw_update(
    state: &AppState,
    room_code: &str,
    path: &FrontendDrawPath,
    _tx: &UnboundedSender<Message>,
) {
    // Get the room
    if let Some(mut room) = state.get_room(room_code) {
        // TODO: Get the actual player ID from the WebSocket connection
        // For now, we'll assume the current drawer is the one sending
        if let Some(_current_drawer) = room.current_drawer {
            // Convert frontend path to backend path
            // IMPORTANT: Preserve the frontend ID to prevent duplicate processing
            let backend_path = DrawPath {
                id: Uuid::parse_str(&path.id).unwrap_or_else(|_| Uuid::new_v4()),
                player_id: _current_drawer,
                color: convert_color(&path.strokes[0].color),
                color_hex: path.strokes[0].color.clone(), // Keep original hex color
                brush_size: convert_brush_size(path.strokes[0].brush_size),
                strokes: path.strokes.iter().map(|stroke| DrawStroke {
                    x: stroke.x,
                    y: stroke.y,
                    timestamp: chrono::Utc::now().timestamp() as u64,
                    color_hex: stroke.color.clone(),
                    alpha: if stroke.alpha == 0.0 { 1.0 } else { stroke.alpha },
                    is_eraser: stroke.is_eraser,
                    brush_px: stroke.brush_size,
                    brush_size: convert_brush_size(stroke.brush_size),
                }).collect(),
                created_at: chrono::Utc::now(),
            };
            
            // Add path to room's drawing_paths
            room.drawing_paths.push(backend_path.clone());
            
            // Update the room in state
            if let Err(e) = state.update_room(room_code, room) {
                println!("Failed to update room {}: {}", room_code, e);
                return;
            }
            
            // Broadcast drawing update to all players in the room
            let draw_msg = crate::models::ServerMessage::DrawUpdate {
                room_code: room_code.to_string(),
                path: backend_path,
            };
            if let Ok(json) = serde_json::to_string(&draw_msg) {
                state.broadcast_to_room(room_code, Message::Text(json));
            }
            
            println!("Drawing update in room {}: added path with {} strokes", room_code, path.strokes.len());
        } else {
            println!("No current drawer in room {}", room_code);
        }
    } else {
        println!("Room {} not found for drawing update", room_code);
    }
}

/// Handle live drawing stroke messages
pub async fn handle_draw_stroke(
    state: &AppState,
    room_code: &str,
    stroke: &FrontendDrawStroke,
    _tx: &UnboundedSender<Message>,
) {
    // Get the room
    if let Some(room) = state.get_room(room_code) {
        // TODO: Get the actual player ID from the WebSocket connection
        // For now, we'll assume the current drawer is the one sending
        if let Some(_current_drawer) = room.current_drawer {
            // Convert frontend stroke to backend stroke
            let backend_stroke = DrawStroke {
                x: stroke.x,
                y: stroke.y,
                timestamp: chrono::Utc::now().timestamp() as u64,
                color_hex: stroke.color.clone(),
                alpha: if stroke.alpha == 0.0 { 1.0 } else { stroke.alpha },
                is_eraser: stroke.is_eraser,
                brush_px: stroke.brush_size,
                brush_size: convert_brush_size(stroke.brush_size),
            };
            
            // Broadcast stroke immediately to all players in the room
            let stroke_msg = crate::models::ServerMessage::DrawStroke {
                room_code: room_code.to_string(),
                stroke: backend_stroke,
            };
            if let Ok(json) = serde_json::to_string(&stroke_msg) {
                state.broadcast_to_room(room_code, Message::Text(json));
            }
            
            println!("Live stroke in room {}: ({}, {})", room_code, stroke.x, stroke.y);
        } else {
            println!("No current drawer in room {}", room_code);
        }
    } else {
        println!("Room {} not found for live stroke", room_code);
    }
}
