import Foundation

/// Per-band energy values streamed every 50ms from the dashboard.
/// Maps directly to the five frequency bands the visualizer uses.
struct BandEnergies: Codable, Equatable, Sendable {
    let subBass:  Float
    let bass:     Float
    let mids:     Float
    let highs:    Float
    let presence: Float

    static let zero = BandEnergies(subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0)
}

/// Matches the shared JSON contract (`event_type` snake_case keys from server / PLAN).
enum HapticEventType: String, Codable, CaseIterable, Sendable {
    case bass_hit
    case rhythm_tap
    case alert_snap
    case sustained
    /// Continuous audio texture — emitted every 50 ms by the dashboard.
    /// Drives a long-running CHHapticAdvancedPatternPlayer via sendParameters().
    case stream
}

struct HapticEvent: Codable, Equatable, Sendable {
    let timestamp: TimeInterval
    let event_type: HapticEventType
    /// 0.0 ... 1.0
    let intensity: Float
    /// Milliseconds (per contract)
    let duration: Double
    let label: String
    /// 0.0 (bass rumble) ... 1.0 (presence buzz). Only present on `stream` events.
    let sharpness: Float?
    /// Per-band energies (0.0–1.0). Only present on `stream` events.
    let bands: BandEnergies?

    enum CodingKeys: String, CodingKey {
        case timestamp
        case event_type
        case intensity
        case duration
        case label
        case sharpness
        case bands
    }
}

extension HapticEvent {
    static let sampleBassHit = HapticEvent(
        timestamp: 1_712_764_800_000,
        event_type: .bass_hit,
        intensity: 1.0,
        duration: 150,
        label: "Kick drum",
        sharpness: nil,
        bands: nil
    )

    static let sampleRhythmTap = HapticEvent(
        timestamp: 1_712_764_800_050,
        event_type: .rhythm_tap,
        intensity: 1.0,
        duration: 80,
        label: "Hi-hat pattern",
        sharpness: nil,
        bands: nil
    )

    static let sampleAlertSnap = HapticEvent(
        timestamp: 1_712_764_800_120,
        event_type: .alert_snap,
        intensity: 1.0,
        duration: 50,
        label: "Snare hit",
        sharpness: nil,
        bands: nil
    )

    static let sampleSustained = HapticEvent(
        timestamp: 1_712_764_800_200,
        event_type: .sustained,
        intensity: 1.0,
        duration: 400,
        label: "Bass note",
        sharpness: nil,
        bands: nil
    )

    static let allSamples: [HapticEvent] = [
        sampleBassHit,
        sampleRhythmTap,
        sampleAlertSnap,
        sampleSustained,
    ]
}
