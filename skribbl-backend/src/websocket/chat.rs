use crate::models::ChatMessage;
use crate::state::AppState;
use axum::extract::ws::Message;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

/// Handle chat messages
pub async fn handle_chat(
    state: &AppState,
    room_code: &str,
    message: &str,
    player_id: Uuid,
    username: &str,
    _tx: &UnboundedSender<Message>,
) {
    // Only non-winners/non-artist messages are evaluated as guesses.
    if let Some(room) = state.get_room(room_code) {
        let is_artist = room.current_drawer.map(|d| d == player_id).unwrap_or(false);
        let is_winner = room.winners.contains(&player_id);

        // Winners (including artist) always route to winners-only chat and never trigger guess logic
        if is_artist || is_winner {
            // Winners-only message path
            let chat_msg = ChatMessage {
                id: Uuid::new_v4(),
                player_id,
                username: username.to_string(),
                message: message.to_string(),
                timestamp: chrono::Utc::now(),
                is_winners_only: true,
            };
            if let Some(mut r) = state.get_room(room_code) {
                r.chat_messages.push(chat_msg.clone());
                if r.chat_messages.len() > 10 { r.chat_messages.remove(0); }
                let _ = state.update_room(room_code, r.clone());
                // Server-side filtered room state
                state.broadcast_room_state_filtered(room_code);
            }
            // Winners-only message is only sent to winners
            let server_msg = crate::models::ServerMessage::ChatMessage { message: chat_msg };
            if let Ok(json) = serde_json::to_string(&server_msg) {
                state.broadcast_to_winners(room_code, Message::Text(json));
            }
            println!("Winners-only chat (auto) in room {} from {}: {}", room_code, username, message);
            return;
        }

        // Non-winner: check if this is a correct guess
        if let Some(current_word) = &room.word {
            let is_correct_guess = message.trim().to_lowercase() == current_word.to_lowercase();
            if is_correct_guess {
                handle_correct_guess(state, room_code, message, player_id, username).await;
                return;
            }
        }
    }
    
    // Create chat message
    let chat_msg = ChatMessage {
        id: Uuid::new_v4(),
        player_id,
        username: username.to_string(),
        message: message.to_string(),
        timestamp: chrono::Utc::now(),
        is_winners_only: false, // Regular chat messages are visible to all
    };
    
    // Store message in room's chat history (keep last 10)
    if let Some(mut room) = state.get_room(room_code) {
        room.chat_messages.push(chat_msg.clone());
        if room.chat_messages.len() > 10 {
            room.chat_messages.remove(0); // Remove oldest message
        }
        
        // Update room with new chat history
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room chat history: {}", e);
        }
        
        // Server-side filtered room state to all
        state.broadcast_room_state_filtered(room_code);
    }
    
    // Broadcast chat message
    let server_msg = crate::models::ServerMessage::ChatMessage {
        message: chat_msg,
    };
    
    if let Ok(json) = serde_json::to_string(&server_msg) {
        state.broadcast_to_room(room_code, Message::Text(json));
    }
    
    println!("Chat message in room {} from {}: {}", room_code, username, message);
}

/// Handle correct word guesses
async fn handle_correct_guess(
    state: &AppState,
    room_code: &str,
    word: &str,
    player_id: Uuid,
    username: &str,
) {
    if let Some(mut room) = state.get_room(room_code) {
        // Check if this player already guessed correctly
        let already_guessed = room.current_round_guesses
            .iter()
            .any(|guess| guess.player_id == player_id);
        
        if already_guessed {
            return; // Player already guessed correctly
        }
        
        // Calculate time remaining and normalized time
        let current_time = chrono::Utc::now();
        let round_start = room.round_start_time.unwrap_or(current_time);
        let elapsed = current_time.signed_duration_since(round_start).num_seconds() as u32;
        let time_remaining = room.round_duration.saturating_sub(elapsed);
        let normalized_time = (time_remaining as f64 / room.round_duration as f64).clamp(0.0, 1.0);
        
        // Create guess record
        let guess = crate::models::Guess {
            player_id,
            username: username.to_string(),
            word: word.to_string(),
            timestamp: current_time,
            time_remaining,
            normalized_time,
        };
        
        // Add to room's current round guesses
        room.current_round_guesses.push(guess.clone());
        
        // Add player to winners list (if not already there)
        if !room.winners.contains(&player_id) {
            room.winners.push(player_id);
        }
        
        // Update room in state
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room with guess: {}", e);
            return;
        }
        
        // Broadcast correct guess event to everyone (no chat leakage)
        let correct_guess_msg = crate::models::ServerMessage::CorrectGuess {
            player: room.players.get(&player_id).unwrap().clone(),
            word: word.to_string(),
        };
        if let Ok(json) = serde_json::to_string(&correct_guess_msg) {
            state.broadcast_to_room(room_code, Message::Text(json));
        }
        
        // Broadcast filtered room state reflecting new winner
        state.broadcast_room_state_filtered(room_code);
        
        println!("Correct guess in room {} by {}: {}", room_code, username, word);
        
        // Check if everyone has guessed correctly
        let potential_guessers = room.players.len() - 1; // Exclude artist
        if room.current_round_guesses.len() >= potential_guessers {
            // Everyone guessed correctly - end round
            handle_round_end(state, room_code).await;
        }
    }
}

/// Handle round end when everyone guesses correctly
async fn handle_round_end(state: &AppState, room_code: &str) {
    if let Some(room) = state.get_room(room_code) {
        // Calculate scores using the scoring system
        let potential_guessers = room.players.len() - 1;
        let artist_streak = room.players.get(&room.current_drawer.unwrap_or_default())
            .map(|p| p.artist_streak)
            .unwrap_or(0);
        
        let scores = crate::scoring::calculate_round_scores(
            room.round_number,
            &room.word.unwrap_or_default(),
            room.round_duration,
            room.current_round_guesses.clone(),
            potential_guessers as u32,
            artist_streak,
        );
        
        // Broadcast round scores
        let round_scores_msg = crate::models::ServerMessage::RoundScores {
            scores: scores.clone(),
        };
        
        if let Ok(json) = serde_json::to_string(&round_scores_msg) {
            state.broadcast_to_room(room_code, Message::Text(json));
        }
        
        // Update player scores and artist streaks
        update_player_scores(state, room_code, &scores).await;
        
        // Rotate drawer and reset round state
        if let Some(mut r2) = state.get_room(room_code) {
            // Determine ordered players by joined_at
            let mut ordered: Vec<_> = r2.players.values().cloned().collect();
            ordered.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));
            let current = r2.current_drawer;
            let next_drawer = if let Some(cur) = current {
                let idx = ordered.iter().position(|p| p.id == cur).unwrap_or(0);
                let next_idx = (idx + 1) % ordered.len();
                ordered[next_idx].id
            } else {
                // If none set, pick first
                ordered.first().map(|p| p.id).unwrap_or_else(|| cur_default())
            };

            // Check if we're starting a new cycle (back to first player)
            let is_new_cycle = if let Some(cur) = current {
                let cur_idx = ordered.iter().position(|p| p.id == cur).unwrap_or(0);
                let next_idx = (cur_idx + 1) % ordered.len();
                let will_be_new_cycle = next_idx == 0; // If next drawer is first player, it's a new cycle
                println!("Cycle check: current_idx={}, next_idx={}, players_total={}, will_be_new_cycle={}", 
                        cur_idx, next_idx, ordered.len(), will_be_new_cycle);
                will_be_new_cycle
            } else {
                false
            };

            println!("Before update - Round: {}, Cycle: {}, Max Cycles: {}", 
                    r2.round_number, r2.cycle_number, r2.max_rounds);

            // Increment round number and cycle number if needed
            if is_new_cycle {
                r2.cycle_number = r2.cycle_number.saturating_add(1);
                r2.round_number = 1; // Reset to 1 for new cycle
                println!("New cycle started! Cycle {} of {} (max cycles)", r2.cycle_number, r2.max_rounds);
            } else {
                r2.round_number = r2.round_number.saturating_add(1); // Increment round within cycle
            }
            
            println!("After update - Round: {}, Cycle: {}, Max Cycles: {}", 
                    r2.round_number, r2.cycle_number, r2.max_rounds);
            
            // CRITICAL FIX: Additional cycle progression logic
            // Ensure cycle increments every N rounds where N = number of players
            let players_count = ordered.len() as u32;
            if r2.round_number > players_count {
                // We've exceeded the number of players in this cycle, force a new cycle
                r2.cycle_number = r2.cycle_number.saturating_add(1);
                r2.round_number = 1; // Reset to 1 for new cycle
                println!("Force new cycle! Round {} > {} players, Cycle {} of {} (max cycles)", 
                        r2.round_number, players_count, r2.cycle_number, r2.max_rounds);
            }
            
            // Enhanced debugging: Log the complete state after all updates
            println!("Final state after cycle logic:");
            println!("   - Players count: {}", players_count);
            println!("   - Round number: {}", r2.round_number);
            println!("   - Cycle number: {}", r2.cycle_number);
            println!("   - Max cycles: {}", r2.max_rounds);
            println!("   - Is new cycle: {}", is_new_cycle);
            
            // Log round completion
            let unknown_str = "Unknown".to_string();
            let none_str = "None".to_string();
            
            let current_drawer_name = if let Some(cur_id) = current {
                r2.players.get(&cur_id).map(|p| &p.username).unwrap_or(&unknown_str)
            } else {
                &none_str
            };
            let next_drawer_name = if let Some(idx) = ordered.iter().position(|p| p.id == next_drawer) {
                ordered.get(idx).map(|p| &p.username).unwrap_or(&unknown_str)
            } else {
                &unknown_str
            };
            println!(
                "Round {} complete. Current drawer: {}, Next drawer: {}, Cycle: {} of {}",
                r2.round_number, current_drawer_name, next_drawer_name, r2.cycle_number, r2.max_rounds
            );
            
            // Reset per-round state
            r2.current_drawer = Some(next_drawer);
            r2.word = None;
            r2.round_start_time = None;
            r2.round_end_time = None;
            r2.current_round_guesses.clear();
            r2.drawing_paths.clear();
            r2.winners.clear();
            // Artist is always a winner
            r2.winners.push(next_drawer);

            let _ = state.update_room(room_code, r2.clone());

            // Announce next drawer
            if let Some(drawer_player) = r2.players.get(&next_drawer) {
                let next_msg = crate::models::ServerMessage::RoundStart { room_code: room_code.to_string(), drawer: drawer_player.clone() };
                if let Ok(json) = serde_json::to_string(&next_msg) {
                    state.broadcast_to_room(room_code, Message::Text(json));
                }
            }

            // Check if game should end (max cycles reached)
            if r2.cycle_number > r2.max_rounds {
                println!("Game ending: Cycle {} > Max Cycles {} - Game Over!", r2.cycle_number, r2.max_rounds);
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

            // Send filtered state so visibility is correct
            state.broadcast_room_state_filtered(room_code);
        }

        println!("Round ended in room {} with scores: {:?}", room_code, scores);
    }
}

fn cur_default() -> uuid::Uuid { uuid::Uuid::nil() }

/// Update player scores and artist streaks after round end
pub(crate) async fn update_player_scores(state: &AppState, room_code: &str, scores: &crate::models::RoundScores) {
    if let Some(mut room) = state.get_room(room_code) {
        // Update guesser scores
        for (player_id, score) in &scores.guesser_scores {
            if let Some(player) = room.players.get_mut(player_id) {
                player.score += score;
            }
        }
        
        // Update artist score and streak
        if let Some(drawer_id) = room.current_drawer {
            // Get the potential guessers count before borrowing mutably
            let potential_guessers = room.players.len() - 1;
            
            if let Some(player) = room.players.get_mut(&drawer_id) {
                player.score += scores.artist_score;
                
                // Check if artist streak should increment before borrowing mutably
                let should_increment = crate::scoring::should_increment_artist_streak(
                    &scores.correct_guesses,
                    scores.round_duration,
                    potential_guessers as u32,
                );
                
                player.artist_streak = crate::scoring::update_artist_streak(
                    player.artist_streak,
                    should_increment,
                );
            }
        }
        
        // Update room in state
        if let Err(e) = state.update_room(room_code, room.clone()) {
            println!("Failed to update room with scores: {}", e);
        }
    }
}

/// Handle winners-only chat messages
pub async fn handle_winners_chat(
    state: &AppState,
    room_code: &str,
    message: &str,
    player_id: Uuid,
    username: &str,
) {
    // Check if this player is a winner (has guessed correctly or is the artist)
    if let Some(room) = state.get_room(room_code) {
        let is_winner = room.winners.contains(&player_id) || 
                       room.current_drawer.map(|d| d == player_id).unwrap_or(false);
        
        if !is_winner {
            println!("Player {} tried to send winners-only message but is not a winner", username);
            return;
        }
        
        // Create winners-only chat message
        let chat_msg = ChatMessage {
            id: Uuid::new_v4(),
            player_id,
            username: username.to_string(),
            message: message.to_string(),
            timestamp: chrono::Utc::now(),
            is_winners_only: true, // This message is only visible to winners
        };
        
        // Store message in room's chat history
        if let Some(mut room) = state.get_room(room_code) {
            room.chat_messages.push(chat_msg.clone());
            if room.chat_messages.len() > 10 {
                room.chat_messages.remove(0);
            }
            
            if let Err(e) = state.update_room(room_code, room.clone()) {
                println!("Failed to update room chat history: {}", e);
            }
            
            // Broadcast GameStateUpdate so frontend gets updated chat
            let game_state_msg = crate::models::ServerMessage::GameStateUpdate {
                room: room.clone(),
            };
            
            if let Ok(json) = serde_json::to_string(&game_state_msg) {
                state.broadcast_to_room(room_code, Message::Text(json));
            }
        }
        
        // Broadcast winners-only message to all (frontend will filter based on is_winners_only flag)
        let server_msg = crate::models::ServerMessage::ChatMessage {
            message: chat_msg,
        };
        
        if let Ok(json) = serde_json::to_string(&server_msg) {
            state.broadcast_to_room(room_code, Message::Text(json));
        }
        
        println!("Winners-only chat message in room {} from {}: {}", room_code, username, message);
    }
}

/// Handle word guesses
pub async fn handle_guess(
    _state: &AppState,
    room_code: &str,
    guess: &str,
    _tx: &UnboundedSender<Message>,
) {
    // TODO: Validate guess against current word
    // TODO: Award points if correct
    // TODO: Handle round end if word is guessed
    
    println!("Guess in room {}: {}", room_code, guess);
}
