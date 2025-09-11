use crate::models::{Guess, RoundScores};
use std::collections::HashMap;
use uuid::Uuid;

// Scoring system constants
pub const SCORING_CONSTANTS: ScoringConstants = ScoringConstants {
    pmax: 500,
    pmin: 100,
    base: 320,
    cap_ratio: 0.80,
    rank_bonuses: [100, 60, 30, 0, 0, 0, 0, 0], // 1st, 2nd, 3rd, 4th+
    tie_window_ms: 200,
    streak_bonus_per_tier: 50,
    max_streak: 5,
};

pub struct ScoringConstants {
    pub pmax: u32,
    pub pmin: u32,
    pub base: u32,
    pub cap_ratio: f64,
    pub rank_bonuses: [u32; 8],
    pub tie_window_ms: u64,
    pub streak_bonus_per_tier: u32,
    pub max_streak: u32,
}

/// Calculate scores for a round based on the scoring system
pub fn calculate_round_scores(
    round_number: u32,
    word: &str,
    round_duration: u32,
    correct_guesses: Vec<Guess>,
    potential_guessers: u32,
    artist_streak: u32,
) -> RoundScores {
    let mut scores = RoundScores {
        round_number,
        word: word.to_string(),
        guesser_scores: HashMap::new(),
        artist_score: 0,
        artist_streak,
        round_duration,
        correct_guesses: correct_guesses.clone(),
        median_guess_time: 0.0,
        fraction_guessed: 0.0,
    };

    // Handle zero-guess rounds
    if correct_guesses.is_empty() {
        return scores;
    }

    // Calculate fraction guessed (G/N)
    let g = correct_guesses.len() as f64;
    let n = potential_guessers as f64;
    let f = g / n;
    scores.fraction_guessed = f;

    // Calculate median guess time
    let mut normalized_times: Vec<f64> = correct_guesses
        .iter()
        .map(|guess| guess.normalized_time)
        .collect();
    normalized_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_index = normalized_times.len() / 2;
    scores.median_guess_time = if normalized_times.len() % 2 == 0 {
        (normalized_times[median_index - 1] + normalized_times[median_index]) / 2.0
    } else {
        normalized_times[median_index]
    };

    // Calculate guesser scores
    let guesser_scores = calculate_guesser_scores(&correct_guesses, round_duration, potential_guessers);
    scores.guesser_scores = guesser_scores;

    // Calculate artist score
    let top_guesser_score = scores.guesser_scores.values().max().unwrap_or(&0);
    scores.artist_score = calculate_artist_score(
        f,
        scores.median_guess_time,
        *top_guesser_score,
        artist_streak,
    );

    scores
}

/// Calculate individual guesser scores
fn calculate_guesser_scores(
    correct_guesses: &[Guess],
    _round_duration: u32,
    _potential_guessers: u32,
) -> HashMap<Uuid, u32> {
    let mut scores = HashMap::new();
    
    if correct_guesses.is_empty() {
        return scores;
    }

    // Sort guesses by timestamp (earliest first)
    let mut sorted_guesses: Vec<&Guess> = correct_guesses.iter().collect();
    sorted_guesses.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    // Calculate rank bonuses with tie detection
    let rank_bonuses = calculate_rank_bonuses(&sorted_guesses);

    // Calculate individual scores
    for (i, guess) in sorted_guesses.iter().enumerate() {
        let time_score = calculate_time_score(guess.normalized_time);
        let rank_bonus = rank_bonuses[i];
        let total_score = time_score + rank_bonus;
        
        scores.insert(guess.player_id, total_score);
    }

    scores
}

/// Calculate time-based score component
fn calculate_time_score(normalized_time: f64) -> u32 {
    let clamped_time = normalized_time.clamp(0.0, 1.0);
    let time_score = SCORING_CONSTANTS.pmin as f64 + 
        (SCORING_CONSTANTS.pmax as f64 - SCORING_CONSTANTS.pmin as f64) * clamped_time;
    
    time_score.floor() as u32
}

/// Calculate rank bonuses with tie detection
fn calculate_rank_bonuses(guesses: &[&Guess]) -> Vec<u32> {
    let mut bonuses = vec![0; guesses.len()];
    
    if guesses.is_empty() {
        return bonuses;
    }

    let mut current_bonus_index = 0;
    let mut i = 0;

    while i < guesses.len() && current_bonus_index < SCORING_CONSTANTS.rank_bonuses.len() {
        let current_time = guesses[i].timestamp.timestamp_millis() as u64;
        
        // Find all guesses within tie window
        let mut tie_count = 1;
        let mut j = i + 1;
        while j < guesses.len() {
            let time_diff = (guesses[j].timestamp.timestamp_millis() as u64).saturating_sub(current_time);
            if time_diff <= SCORING_CONSTANTS.tie_window_ms {
                tie_count += 1;
                j += 1;
            } else {
                break;
            }
        }

        // Assign same bonus to all tied guesses
        let bonus = SCORING_CONSTANTS.rank_bonuses[current_bonus_index];
        for k in i..i + tie_count {
            bonuses[k] = bonus;
        }

        // Competition ranking: if two tie for 1st, both get 1st; next rank is 3rd
        i += tie_count;
        current_bonus_index += tie_count; // advance by tie size
    }

    bonuses
}

/// Calculate artist score
fn calculate_artist_score(
    fraction_guessed: f64,
    median_guess_time: f64,
    top_guesser_score: u32,
    artist_streak: u32,
) -> u32 {
    // Base artist score calculation
    let artist_raw = SCORING_CONSTANTS.base as f64 * fraction_guessed * (0.5 + 0.5 * median_guess_time);
    
    // Add streak bonus
    let streak_bonus = (SCORING_CONSTANTS.streak_bonus_per_tier * artist_streak.min(SCORING_CONSTANTS.max_streak)) as f64;
    let artist_with_streak = artist_raw + streak_bonus;
    
    // Cap to keep artist below top guesser
    let cap = (SCORING_CONSTANTS.cap_ratio * top_guesser_score as f64).floor() as u32;
    
    artist_with_streak.round().min(cap as f64) as u32
}

/// Check if artist streak should increment
pub fn should_increment_artist_streak(
    correct_guesses: &[Guess],
    round_duration: u32,
    potential_guessers: u32,
) -> bool {
    if correct_guesses.is_empty() {
        return false;
    }

    let halfway_point = round_duration / 2;
    let required_half = (potential_guessers / 2) + 1; // Strictly more than 50%

    let guesses_by_halfway = correct_guesses
        .iter()
        .filter(|guess| guess.time_remaining >= halfway_point)
        .count();

    guesses_by_halfway >= required_half as usize
}

/// Update artist streak based on round performance
pub fn update_artist_streak(
    current_streak: u32,
    should_increment: bool,
) -> u32 {
    if should_increment {
        (current_streak + 1).min(SCORING_CONSTANTS.max_streak)
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_time_score_calculation() {
        // Test early guess (high score)
        let early_score = calculate_time_score(1.0);
        assert_eq!(early_score, SCORING_CONSTANTS.pmax);
        
        // Test late guess (low score)
        let late_score = calculate_time_score(0.0);
        assert_eq!(late_score, SCORING_CONSTANTS.pmin);
        
        // Test middle guess
        let middle_score = calculate_time_score(0.5);
        let expected = SCORING_CONSTANTS.pmin + (SCORING_CONSTANTS.pmax - SCORING_CONSTANTS.pmin) / 2;
        assert_eq!(middle_score, expected);
    }

    #[test]
    fn test_rank_bonuses() {
        let mut guesses = vec![
            Guess {
                player_id: Uuid::new_v4(),
                username: "Player1".to_string(),
                word: "test".to_string(),
                timestamp: Utc::now(),
                time_remaining: 100,
                normalized_time: 1.0,
            },
            Guess {
                player_id: Uuid::new_v4(),
                username: "Player2".to_string(),
                word: "test".to_string(),
                timestamp: Utc::now(),
                time_remaining: 80,
                normalized_time: 0.8,
            },
        ];

        let bonuses = calculate_rank_bonuses(guesses.iter().collect());
        assert_eq!(bonuses[0], 100); // 1st place
        assert_eq!(bonuses[1], 60);  // 2nd place
    }

    #[test]
    fn test_artist_score_calculation() {
        let score = calculate_artist_score(0.8, 0.6, 500, 2);
        assert!(score > 0);
        assert!(score <= 400); // Should be capped at 80% of top guesser
    }

    #[test]
    fn test_streak_increment_logic() {
        let round_duration = 120;
        let potential_guessers = 4;
        let required_half = (potential_guessers / 2) + 1; // 3

        // Test case: 3 out of 4 guessed by halfway (should increment)
        let guesses = vec![
            Guess {
                player_id: Uuid::new_v4(),
                username: "Player1".to_string(),
                word: "test".to_string(),
                timestamp: Utc::now(),
                time_remaining: 70, // After halfway
                normalized_time: 0.6,
            },
            Guess {
                player_id: Uuid::new_v4(),
                username: "Player2".to_string(),
                word: "test".to_string(),
                timestamp: Utc::now(),
                time_remaining: 80, // After halfway
                normalized_time: 0.7,
            },
            Guess {
                player_id: Uuid::new_v4(),
                username: "Player3".to_string(),
                word: "test".to_string(),
                timestamp: Utc::now(),
                time_remaining: 90, // After halfway
                normalized_time: 0.8,
            },
        ];

        let should_increment = should_increment_artist_streak(&guesses, round_duration, potential_guessers);
        assert!(should_increment);
    }
}
