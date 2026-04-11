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

    /// Deep rumble — continuous. Sharpness scales with intensity (0.1 quiet → 0.4 loud).
    static func bassHit(intensity: Float, durationMs: Double) throws -> CHHapticPattern {
        let i = clamp01(max(intensity, 0.25))          // floor so quiet beats still register
        let sharpness = clamp01(0.1 + i * 0.3)        // 0.1 (soft) → 0.4 (loud)
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

    /// Crisp tap — transient. Sharpness scales with intensity (0.4 quiet → 0.8 loud).
    static func rhythmTap(intensity: Float) throws -> CHHapticPattern {
        let i = clamp01(max(intensity, 0.25))
        let sharpness = clamp01(0.4 + i * 0.4)        // 0.4 (soft) → 0.8 (loud)
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

    /// Sharp snap — transient. Sharpness scales with intensity (0.7 quiet → 1.0 loud).
    static func alertSnap(intensity: Float) throws -> CHHapticPattern {
        let i = clamp01(max(intensity, 0.25))
        let sharpness = clamp01(0.7 + i * 0.3)        // 0.7 (soft) → 1.0 (loud)
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
    /// Sharpness scales with intensity (0.2 quiet → 0.5 loud).
    static func sustained(intensity: Float, durationMs: Double) throws -> CHHapticPattern {
        let i = clamp01(max(intensity, 0.25))
        let sharpness = clamp01(0.2 + i * 0.3)        // 0.2 (soft) → 0.5 (loud)
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
