import Foundation

/// Matches the shared JSON contract (`event_type` snake_case keys from server / PLAN).
enum HapticEventType: String, Codable, CaseIterable, Sendable {
    case bass_hit
    case rhythm_tap
    case alert_snap
    case sustained
}

struct HapticEvent: Codable, Equatable, Sendable {
    let timestamp: TimeInterval
    let event_type: HapticEventType
    /// 0.0 ... 1.0
    let intensity: Float
    /// Milliseconds (per contract)
    let duration: Double
    let label: String

    enum CodingKeys: String, CodingKey {
        case timestamp
        case event_type
        case intensity
        case duration
        case label
    }
}

extension HapticEvent {
    static let sampleBassHit = HapticEvent(
        timestamp: 1_712_764_800_000,
        event_type: .bass_hit,
        intensity: 1.0,
        duration: 150,
        label: "Kick drum"
    )

    static let sampleRhythmTap = HapticEvent(
        timestamp: 1_712_764_800_050,
        event_type: .rhythm_tap,
        intensity: 1.0,
        duration: 80,
        label: "Hi-hat pattern"
    )

    static let sampleAlertSnap = HapticEvent(
        timestamp: 1_712_764_800_120,
        event_type: .alert_snap,
        intensity: 1.0,
        duration: 50,
        label: "Snare hit"
    )

    static let sampleSustained = HapticEvent(
        timestamp: 1_712_764_800_200,
        event_type: .sustained,
        intensity: 1.0,
        duration: 400,
        label: "Bass note"
    )

    static let allSamples: [HapticEvent] = [
        sampleBassHit,
        sampleRhythmTap,
        sampleAlertSnap,
        sampleSustained,
    ]
}
