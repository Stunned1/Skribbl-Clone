use crate::state::AppState;
use axum::extract::ws::Message;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;
use tokio::sync::mpsc;


/// Handle room joining
pub async fn handle_join_room(
    state: &AppState,
    room_code: &str,
    username: &str,
    tx: &UnboundedSender<Message>,
    current_player_id: &mut Option<Uuid>,
    current_room_code: &mut Option<String>,
) {
    println!("handle_join_room called for {} in room {}", username, room_code);
    
    // Check if room exists
    if let Some(room) = state.get_room(room_code) {
        println!("Room {} found, current players: {}", room_code, room.players.len());
        
        // Check if room is full
        if room.players.len() >= room.max_players as usize {
            let error_msg = crate::models::ServerMessage::Error {
                message: "Room is full".to_string(),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = tx.send(Message::Text(json));
            }
            return;
        }
        
        // For WebSocket joins, we need to find the existing player and establish the connection
        // The REST API already handled username validation and player creation
        if let Some(existing_player) = room.players.values().find(|p| p.username == username) {
            println!("Found existing player {} in room, establishing WebSocket connection", username);
            
            // Register WebSocket connection for existing player
            state.add_connection(existing_player.id, room_code.to_string(), tx.clone());
            
            println!("Registered WebSocket connection for existing player {}", username);
            
            // Update current connection info
            *current_player_id = Some(existing_player.id);
            *current_room_code = Some(room_code.to_string());
            
            println!("Updated connection info for player {}", username);
            
            // Send success message to joining player
            let success_msg = crate::models::ServerMessage::PlayerJoined {
                room_code: room_code.to_string(),
                player: existing_player.clone(),
            };
            if let Ok(json) = serde_json::to_string(&success_msg) {
                let _ = tx.send(Message::Text(json));
                println!("Sent success message to player {}", username);
            }
            
            // Broadcast to all other players in the room (excluding the joining player)
            let broadcast_msg = crate::models::ServerMessage::PlayerJoined {
                room_code: room_code.to_string(),
                player: existing_player.clone(),
            };
            if let Ok(json) = serde_json::to_string(&broadcast_msg) {
                println!("Broadcasting PlayerJoined message to room {} (excluding joining player)", room_code);
                state.broadcast_to_room_excluding(room_code, Message::Text(json), existing_player.id);
                println!("Broadcast completed for room {}", room_code);
            }

            // After join, send filtered room state to everyone so visibility is correct
            state.broadcast_room_state_filtered(room_code);
            
            println!("Player {} WebSocket connection established in room {}", username, room_code);
        } else {
            println!("Player {} not found in room {}, this shouldn't happen", username, room_code);
            let error_msg = crate::models::ServerMessage::Error {
                message: "Player not found in room".to_string(),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = tx.send(Message::Text(json));
            }
        }
    } else {
        let error_msg = crate::models::ServerMessage::Error {
            message: "Room not found".to_string(),
        };
        if let Ok(json) = serde_json::to_string(&error_msg) {
            let _ = tx.send(Message::Text(json));
        }
    }
}

/// Handle room leaving
pub async fn handle_leave_room(
    state: &AppState,
    room_code: &str,
    player_id: &str,
    tx: &UnboundedSender<Message>,
    current_player_id: &mut Option<Uuid>,
    current_room_code: &mut Option<String>,
) {
    println!("=== handle_leave_room started ===");
    println!("room_code: {}, player_id_str: {}", room_code, player_id);
    
    // Parse player ID
    let player_id_uuid = match Uuid::parse_str(player_id) {
        Ok(id) => {
            println!("Successfully parsed player_id: {}", id);
            id
        },
        Err(e) => {
            println!("Failed to parse player_id: {}", e);
            let error_msg = crate::models::ServerMessage::Error {
                message: "Invalid player ID format".to_string(),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = tx.send(Message::Text(json));
            }
            return;
        }
    };
    
    println!("Calling state.remove_player_from_room for room {} and player {}", room_code, player_id_uuid);
    
    // Remove player from room
    match state.remove_player_from_room(room_code, &player_id_uuid) {
        Ok((player, room_will_be_empty)) => {
            println!("remove_player_from_room succeeded: player={}, room_will_be_empty={}", player.username, room_will_be_empty);
            println!("Continuing with leave room processing...");
            
            // Remove WebSocket connection
            state.remove_connection(&player_id_uuid);
            
            // Clear current connection info
            *current_player_id = None;
            *current_room_code = None;
            
            // Send success message to leaving player
            let success_msg = crate::models::ServerMessage::PlayerLeft {
                room_code: room_code.to_string(),
                player: player.clone(),
            };
            if let Ok(json) = serde_json::to_string(&success_msg) {
                let _ = tx.send(Message::Text(json));
            }
            
            // Check if this was the host and transfer ownership if needed
            if !room_will_be_empty {
                // Check if this was the host BEFORE removing the player
                let was_host = if let Some(room) = state.get_room(room_code) {
                    room.host_id == player_id_uuid
                } else {
                    false
                };
                
                if was_host {
                    // This was the host, transfer ownership
                    println!("Host {} is leaving, transferring ownership", player.username);
                    if let Ok(new_host_id) = state.transfer_host_ownership(room_code) {
                        // Get the new host info AFTER the transfer
                        if let Some(new_host) = state.get_player(&new_host_id) {
                            println!("Host ownership transferred to {}", new_host.username);
                            
                            // CRITICAL: Update the room state to reflect the new host BEFORE broadcasting
                            if let Some(mut room) = state.get_room(room_code) {
                                room.host_id = new_host_id;
                                if let Err(e) = state.update_room(room_code, room) {
                                    println!("Failed to update room with new host: {}", e);
                                }
                            }
                            
                            // Broadcast host change to remaining players
                            let host_change_msg = crate::models::ServerMessage::HostChanged {
                                new_host: new_host.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&host_change_msg) {
                                println!("Broadcasting HostChanged message to remaining players");
                                state.broadcast_to_room(room_code, Message::Text(json));
                            }
                        } else {
                            println!("Failed to get new host player info");
                        }
                    } else {
                        println!("Failed to transfer host ownership");
                    }
                }
                
                // Broadcast PlayerLeft message to remaining players
                let broadcast_msg = crate::models::ServerMessage::PlayerLeft {
                    room_code: room_code.to_string(),
                    player: player.clone(),
                };
                if let Ok(json) = serde_json::to_string(&broadcast_msg) {
                    println!("Broadcasting PlayerLeft message to remaining players in room {}", room_code);
                    state.broadcast_to_room(room_code, Message::Text(json));
                }
            } else {
                println!("Room {} will be empty after player {} leaves, no broadcast needed", room_code, player_id);
            }
            
            println!("Player {} left room {}", player_id, room_code);
        },
        Err(e) => {
            println!("remove_player_from_room failed: {}", e);
            let error_msg = crate::models::ServerMessage::Error {
                message: format!("Failed to leave room: {}", e),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = tx.send(Message::Text(json));
            }
        }
    }
}

/// Handle game start
pub async fn handle_start_game(
    state: &AppState,
    room_code: &str,
    tx: &UnboundedSender<Message>,
) {
    // Get the room
    if let Some(mut room) = state.get_room(room_code) {
        // Check if room has enough players
        if room.players.len() < 2 {
            let error_msg = crate::models::ServerMessage::Error {
                message: "Need at least 2 players to start".to_string(),
            };
            if let Ok(json) = serde_json::to_string(&error_msg) {
                let _ = tx.send(Message::Text(json));
            }
            return;
        }
        
        // Select first drawer (first player in the room)
        let drawer_id = *room.players.keys().next().unwrap();
        
        // Update room state - NO WORD SELECTED YET, wait for player to choose
        room.game_state = crate::models::GameState::Playing;
        room.word = None; // No word until player selects one
        room.current_drawer = Some(drawer_id);
        room.round_number = 1; // Round within current cycle
        room.cycle_number = 1; // Current cycle
        room.round_start_time = None; // No round start time until word is selected
        room.round_end_time = None; // No round end time until word is selected
        
        println!("🎮 Game started in room {}: Round {}, Cycle {} of {}, Drawer: {} (Max Cycles: {})", 
                room_code, room.round_number, room.cycle_number, room.max_rounds,
                room.players.get(&drawer_id).map(|p| &p.username).unwrap_or(&"Unknown".to_string()),
                room.max_rounds);
        
        // Reset winners list and current round guesses for new round
        room.winners.clear();
        room.current_round_guesses.clear();
        room.drawing_paths.clear();
        
        // Add current drawer to winners list (artist is always a winner)
        room.winners.push(drawer_id);
        
        // Update the room in state
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room: {}", e);
        }
        
        // Broadcast game start to all players
        let game_start_msg = crate::models::ServerMessage::RoundStart {
            room_code: room_code.to_string(),
            drawer: room.players.get(&drawer_id).unwrap().clone(),
        };
        if let Ok(json) = serde_json::to_string(&game_start_msg) {
            state.broadcast_to_room(room_code, Message::Text(json));
        }

        // Send filtered room state so non-winners don't see the word or winners chat
        state.broadcast_room_state_filtered(room_code);
        
        println!("✅ Game started in room {} - waiting for player to select word", room_code);
    } else {
        let error_msg = crate::models::ServerMessage::Error {
            message: "Room not found".to_string(),
        };
        if let Ok(json) = serde_json::to_string(&error_msg) {
            let _ = tx.send(Message::Text(json));
        }
    }
}

/// Handle round end
pub async fn handle_end_round(
    state: &AppState,
    room_code: &str,
    _tx: &UnboundedSender<Message>,
) {
    println!("🔄 handle_end_round called for room: {}", room_code);
    
    // Full round end: compute scores, update players, rotate drawer, reset round state, and broadcast next round
    if let Some(room) = state.get_room(room_code) {
        println!("✅ Room found, proceeding with round end logic");
        // Calculate scores using the scoring system
        let potential_guessers = room.players.len().saturating_sub(1);
        let artist_streak = room
            .players
            .get(&room.current_drawer.unwrap_or_default())
            .map(|p| p.artist_streak)
            .unwrap_or(0);

        let scores = crate::scoring::calculate_round_scores(
            room.round_number,
            &room.word.clone().unwrap_or_default(),
            room.round_duration,
            room.current_round_guesses.clone(),
            potential_guessers as u32,
            artist_streak,
        );

        // Broadcast round scores
        let round_scores_msg = crate::models::ServerMessage::RoundScores { scores: scores.clone() };
        if let Ok(json) = serde_json::to_string(&round_scores_msg) {
            state.broadcast_to_room(room_code, Message::Text(json));
        }

        // Update player scores and artist streaks
        super::chat::update_player_scores(state, room_code, &scores).await;

        // Rotate drawer and reset round state for next round
        println!("🔄 About to rotate drawer and update cycle logic");
        if let Some(mut r2) = state.get_room(room_code) {
            println!("✅ Got room for cycle logic, proceeding with drawer rotation");
            // Determine ordered players by joined_at
            let mut ordered: Vec<_> = r2.players.values().cloned().collect();
            ordered.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));
            
            // Safety check: ensure we have players
            if ordered.is_empty() {
                println!("⚠️  ERROR: No players in room {} during round end", room_code);
                return;
            }
            
            let current = r2.current_drawer;
            let next_drawer = if let Some(cur) = current {
                let cur_idx = ordered.iter().position(|p| p.id == cur).unwrap_or(0);
                let next_idx = (cur_idx + 1) % ordered.len();
                ordered[next_idx].id
            } else {
                ordered.first().map(|p| p.id).unwrap_or_else(uuid::Uuid::nil)
            };

            // Check if we're starting a new cycle (back to first player)
            let is_new_cycle = if let Some(cur) = current {
                let cur_idx = ordered.iter().position(|p| p.id == cur).unwrap_or(0);
                let next_idx = (cur_idx + 1) % ordered.len();
                let will_be_new_cycle = next_idx == 0; // If next drawer is first player, it's a new cycle
                println!("🔄 Cycle check: current_idx={}, next_idx={}, players_total={}, will_be_new_cycle={}", 
                        cur_idx, next_idx, ordered.len(), will_be_new_cycle);
                will_be_new_cycle
            } else {
                false
            };

            println!("📊 Before update - Round: {}, Cycle: {}, Max Cycles: {}", 
                    r2.round_number, r2.cycle_number, r2.max_rounds);

            // Increment round number and cycle number if needed
            if is_new_cycle {
                r2.cycle_number = r2.cycle_number.saturating_add(1);
                r2.round_number = 1; // Reset to 1 for new cycle
                println!("🎯 New cycle started! Cycle {} of {} (max cycles)", r2.cycle_number, r2.max_rounds);
            } else {
                r2.round_number = r2.round_number.saturating_add(1); // Increment round within cycle
            }
            
            println!("📊 After update - Round: {}, Cycle: {}, Max Cycles: {}", 
                    r2.round_number, r2.cycle_number, r2.max_rounds);
            
            // CRITICAL FIX: Additional cycle progression logic
            // Ensure cycle increments every N rounds where N = number of players
            let players_count = ordered.len() as u32;
            if r2.round_number > players_count {
                // We've exceeded the number of players in this cycle, force a new cycle
                r2.cycle_number = r2.cycle_number.saturating_add(1);
                r2.round_number = 1; // Reset to 1 for new cycle
                println!("🎯 Force new cycle! Round {} > {} players, Cycle {} of {} (max cycles)", 
                        r2.round_number, players_count, r2.cycle_number, r2.max_rounds);
            }
            
            // Enhanced debugging: Log the complete state after all updates
            println!("🔍 Final state after cycle logic:");
            println!("   - Players count: {}", players_count);
            println!("   - Round number: {}", r2.round_number);
            println!("   - Cycle number: {}", r2.cycle_number);
            println!("   - Max cycles: {}", r2.max_rounds);
            println!("   - Is new cycle: {}", is_new_cycle);
            
            // Get current drawer name safely
            let unknown_str = "Unknown".to_string();
            let none_str = "None".to_string();
            
            let current_drawer_name = if let Some(cur_id) = current {
                r2.players.get(&cur_id).map(|p| &p.username).unwrap_or(&unknown_str)
            } else {
                &none_str
            };
            println!("   - Current drawer: {}", current_drawer_name);
            
            // Get next drawer name safely
            let next_drawer_name = if let Some(idx) = ordered.iter().position(|p| p.id == next_drawer) {
                ordered.get(idx).map(|p| &p.username).unwrap_or(&unknown_str)
            } else {
                &unknown_str
            };
            println!("   - Next drawer: {}", next_drawer_name);
            
            // Log round completion
            println!(
                "🎮 Round {} complete. Current drawer: {}, Next drawer: {}, Cycle: {} of {}",
                r2.round_number, current_drawer_name, next_drawer_name, r2.cycle_number, r2.max_rounds
            );
            
            r2.current_drawer = Some(next_drawer);
            r2.word = None;
            r2.round_start_time = None;
            r2.round_end_time = None;
            r2.current_round_guesses.clear();
            r2.drawing_paths.clear();
            r2.winners.clear();
            r2.winners.push(next_drawer); // artist is always a winner

            let _ = state.update_room(room_code, r2.clone());

            // Check if game should end (max cycles reached)
            if r2.cycle_number > r2.max_rounds {
                println!("🏁 Game ending: Cycle {} > Max Cycles {} - Game Over!", r2.cycle_number, r2.max_rounds);
                // Game over - broadcast final scores
                r2.game_state = crate::models::GameState::Finished;
                if let Err(e) = state.update_room(room_code, r2.clone()) {
                    println!("Failed to update room to finished state: {}", e);
                }
                
                let game_end_msg = crate::models::ServerMessage::GameEnded {
                    final_scores: r2.players.iter().map(|(id, p)| (id.to_string(), p.score)).collect(),
                };
                if let Ok(json) = serde_json::to_string(&game_end_msg) {
                    state.broadcast_to_room(room_code, Message::Text(json));
                }
                return; // Don't start next round
            }

            // Announce next drawer
            if let Some(drawer_player) = r2.players.get(&next_drawer) {
                let next_msg = crate::models::ServerMessage::RoundStart {
                    room_code: room_code.to_string(),
                    drawer: drawer_player.clone(),
                };
                if let Ok(json) = serde_json::to_string(&next_msg) {
                    state.broadcast_to_room(room_code, Message::Text(json));
                }
            }

            // Send filtered state so visibility is correct
            state.broadcast_room_state_filtered(room_code);
        }
    }
}

/// Handle word selection
pub async fn handle_word_selected(
    state: &AppState,
    room_code: &str,
    word: &str,
    _tx: &UnboundedSender<Message>,
) {
    // Persist the selected word and update round timings
    if let Some(mut room) = state.get_room(room_code) {
        // Check if a word is already selected for this round
        if room.word.is_some() {
            println!("⚠️  Word already selected in room {}, ignoring new selection: {}", room_code, word);
            return;
        }
        
        // Check if the game is in playing state
        if room.game_state != crate::models::GameState::Playing {
            println!("⚠️  Game not in playing state in room {}, ignoring word selection: {}", room_code, word);
            return;
        }
        
        // Check if there's a current drawer
        if room.current_drawer.is_none() {
            println!("⚠️  No current drawer in room {}, ignoring word selection: {}", room_code, word);
            return;
        }
        
        // Clear any existing word and timers
        room.word = Some(word.to_string());
        room.round_start_time = Some(chrono::Utc::now());
        room.round_end_time = Some(chrono::Utc::now() + chrono::Duration::seconds(room.round_duration as i64));
        
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room with selected word: {}", e);
            return;
        }
        
        println!("✅ Word selected in room {}: {} (starting {}s timer)", room_code, word, room.round_duration);
        
        // Start backend timer to end round automatically
        // Note: This timer will be the only active timer for this round
        let room_code_clone = room_code.to_string();
        let state_clone = state.clone();
        let round_duration = room.round_duration;
        let word_clone = word.to_string(); // Clone the word for the async block
        let current_drawer_id = room.current_drawer; // Store current drawer ID
        
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(round_duration as u64)).await;
            
            // Check if round is still active before ending
            if let Some(current_room) = state_clone.get_room(&room_code_clone) {
                // Only end the round if:
                // 1. Game is still playing
                // 2. Current drawer exists and is the same as when the timer started
                // 3. The word is still the same (no new word was selected)
                // 4. The drawer hasn't changed (prevents old timers from affecting new rounds)
                if current_room.game_state == crate::models::GameState::Playing 
                   && current_room.current_drawer.is_some()
                   && current_room.current_drawer == current_drawer_id
                   && current_room.word.as_ref() == Some(&word_clone) {
                    println!("Backend timer expired for word '{}', ending round in room {}", word_clone, room_code_clone);
                    let (tx_dummy, _rx) = mpsc::unbounded_channel::<Message>();
                    handle_end_round(&state_clone, &room_code_clone, &tx_dummy).await;
                } else {
                    println!("Backend timer expired but round is no longer active, word changed, or drawer changed - not ending round");
                }
            }
        });
        
        // Broadcast filtered room state so all clients sync appropriately
        state.broadcast_room_state_filtered(room_code);
    }

    // Do NOT broadcast the word globally; state filtering will reveal it only to winners
    // Instead, send WordSelected with the word to winners, and an empty word to non-winners
    let word_msg_winners = crate::models::ServerMessage::WordSelected {
        word: word.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&word_msg_winners) {
        state.broadcast_to_winners(room_code, Message::Text(json));
    }

    // Empty string ensures frontend treats it as hidden but still starts timers
    let word_msg_non_winners = crate::models::ServerMessage::WordSelected {
        word: String::new(),
    };
    if let Ok(json) = serde_json::to_string(&word_msg_non_winners) {
        state.broadcast_to_non_winners(room_code, Message::Text(json));
    }
}

/// Update room settings (host-only). Currently supports max_rounds (1..=5)
pub async fn handle_update_settings(
    state: &AppState,
    room_code: &str,
    max_rounds: u32,
    _tx: &UnboundedSender<Message>,
) {
    let clamped = max_rounds.clamp(1, 5);
    if let Some(mut room) = state.get_room(room_code) {
        room.max_rounds = clamped;
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room settings: {}", e);
            return;
        }
        // Broadcast full room state so all clients sync
        state.broadcast_room_state_filtered(room_code);
    }
}
