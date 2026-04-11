import Foundation

/// Shared event contract — matches server's HapticEvent interface.
/// Datuna owns the haptic pattern logic; this model is the decode target.
struct HapticEvent: Codable {
    let timestamp: Double
    let event_type: String
    let intensity: Float
    let duration: Double
    let label: String
}
