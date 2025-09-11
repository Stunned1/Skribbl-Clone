use crate::models::{Color, BrushSize};

/// Convert frontend color string to backend Color enum
pub fn convert_color(color_str: &str) -> Color {
    match color_str.to_lowercase().as_str() {
        "#ff0000" | "red" => Color::Red,
        "#00ff00" | "green" => Color::Green,
        "#0000ff" | "blue" => Color::Blue,
        "#ffff00" | "yellow" => Color::Yellow,
        "#800080" | "purple" => Color::Purple,
        "#ffa500" | "orange" => Color::Orange,
        "#a52a2a" | "brown" => Color::Brown,
        "#ffc0cb" | "pink" => Color::Pink,
        "#808080" | "gray" => Color::Gray,
        _ => Color::Black, // Default to black
    }
}

/// Convert frontend brush size number to backend BrushSize enum
pub fn convert_brush_size(size: u32) -> BrushSize {
    match size {
        2 => BrushSize::Small,
        8 => BrushSize::Large,
        _ => BrushSize::Medium, // Default to medium
    }
}
