import CoreHaptics
import Foundation

/// Pre-built Core Haptics recipes; tune sharpness/intensity constants with Alexia during calibration.
enum HapticPatterns {

    private static func clamp01(_ v: Float) -> Float {
        min(max(v, 0), 1)
    }

    private static func seconds(fromMilliseconds ms: Double) -> TimeInterval {
        max(ms / 1000.0, 0.001)
    }

    // MARK: - Public factories

    /// Deep rumble — continuous, low sharpness.
    static func bassHit(intensity: Float, durationMs: Double) throws -> CHHapticPattern {
        let i = clamp01(intensity)
        let sharpness: Float = 0.3
        let dur = seconds(fromMilliseconds: durationMs)
        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0,
            duration: dur
        )
        return try CHHapticPattern(events: [event], parameters: [])
    }

    /// Crisp tap — transient, medium sharpness.
    static func rhythmTap(intensity: Float) throws -> CHHapticPattern {
        let i = clamp01(intensity)
        let sharpness: Float = 0.6
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0
        )
        return try CHHapticPattern(events: [event], parameters: [])
    }

    /// Sharp snap — transient, max sharpness.
    static func alertSnap(intensity: Float) throws -> CHHapticPattern {
        let i = clamp01(intensity)
        let sharpness: Float = 1.0
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: i),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0
        )
        return try CHHapticPattern(events: [event], parameters: [])
    }

    /// Slow pulse — continuous with intensity fade over `durationMs`.
    static func sustained(intensity: Float, durationMs: Double) throws -> CHHapticPattern {
        let i = clamp01(intensity)
        let sharpness: Float = 0.4
        let dur = seconds(fromMilliseconds: durationMs)

        let intensityCurve = CHHapticParameterCurve(
            parameterID: .hapticIntensityControl,
            controlPoints: [
                CHHapticParameterCurve.ControlPoint(relativeTime: 0, value: i),
                CHHapticParameterCurve.ControlPoint(relativeTime: dur, value: 0),
            ],
            relativeTime: 0
        )

        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0,
            duration: dur
        )

        return try CHHapticPattern(events: [event], parameterCurves: [intensityCurve])
    }
}
