import CoreHaptics
import Foundation

/// Routes decoded `HapticEvent`s to Core Haptics patterns. Call `playEvent` from networking/UI (single entry point).
final class HapticEngine {
    static let shared = HapticEngine()

    private var engine: CHHapticEngine?
    private let stateLock = NSLock()
    private let restartDelay: TimeInterval = 0.1

    // MARK: - Stream player
    // A single long-running CHHapticAdvancedPatternPlayer that receives real-time
    // intensity/sharpness updates via sendParameters(). This is what makes you feel
    // the full texture of the music rather than just discrete beat events.
    private var streamPlayer: CHHapticAdvancedPatternPlayer?
    private var streamStartedAt: Date?
    private let streamMaxDuration: TimeInterval = 28.0  // restart before the 30s pattern expires

    private(set) var supportsHaptics: Bool = false

    private init() {
        refreshCapabilities()
        startEngineIfNeeded()
    }

    private func refreshCapabilities() {
        supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    private func startEngineIfNeeded() {
        stateLock.lock()
        defer { stateLock.unlock() }

        refreshCapabilities()
        guard supportsHaptics else {
            engine = nil
            return
        }

        do {
            let newEngine = try CHHapticEngine()
            newEngine.resetHandler = { [weak self] in
                self?.handleReset()
            }
            newEngine.stoppedHandler = { [weak self] _ in
                self?.handleStopped()
            }
            try newEngine.start()
            engine = newEngine
        } catch {
            #if DEBUG
            print("HapticEngine: failed to start — \(error.localizedDescription)")
            #endif
            engine = nil
        }
    }

    private func handleReset() {
        scheduleRestart()
    }

    private func handleStopped() {
        scheduleRestart()
    }

    private func scheduleRestart() {
        DispatchQueue.main.asyncAfter(deadline: .now() + restartDelay) { [weak self] in
            self?.stateLock.lock()
            self?.engine = nil
            self?.streamPlayer = nil      // player is tied to the engine — clear on reset
            self?.streamStartedAt = nil
            self?.stateLock.unlock()
            self?.startEngineIfNeeded()
        }
    }

    /// Call on socket connect to ensure the engine is running before the first beat arrives.
    func warmUp() {
        stateLock.lock()
        let alreadyRunning = engine != nil
        stateLock.unlock()
        if !alreadyRunning { startEngineIfNeeded() }
    }

    // MARK: - Stream

    /// Update the continuous stream player with current audio envelope parameters.
    /// Called ~20×/s from the socket thread; creates/restarts the player as needed.
    func updateStream(intensity: Float, sharpness: Float) {
        stateLock.lock()
        let current = engine

        // Restart if player is missing or the underlying pattern is about to expire.
        let needsRestart: Bool
        if let started = streamStartedAt {
            needsRestart = streamPlayer == nil || Date().timeIntervalSince(started) >= streamMaxDuration
        } else {
            needsRestart = true
        }
        stateLock.unlock()

        guard let current else { return }

        if needsRestart {
            do {
                let pattern = try HapticPatterns.streamBase()
                let player  = try current.makeAdvancedPlayer(with: pattern)
                try player.start(atTime: CHHapticTimeImmediate)
                stateLock.lock()
                streamPlayer    = player
                streamStartedAt = Date()
                stateLock.unlock()
            } catch {
                #if DEBUG
                print("HapticEngine: stream player start failed — \(error.localizedDescription)")
                #endif
                return
            }
        }

        stateLock.lock()
        let player = streamPlayer
        stateLock.unlock()

        guard let player else { return }

        let params: [CHHapticDynamicParameter] = [
            CHHapticDynamicParameter(
                parameterID: .hapticIntensityControl,
                value: min(max(intensity, 0), 1),
                relativeTime: 0
            ),
            CHHapticDynamicParameter(
                parameterID: .hapticSharpnessControl,
                value: min(max(sharpness, 0), 1),
                relativeTime: 0
            ),
        ]
        do {
            try player.sendParameters(params, atTime: CHHapticTimeImmediate)
        } catch {
            // Player may have expired naturally — clear so it restarts on next call.
            stateLock.lock()
            streamPlayer    = nil
            streamStartedAt = nil
            stateLock.unlock()
        }
    }

    /// Stop and release the stream player (call on socket disconnect).
    func stopStream() {
        stateLock.lock()
        let player = streamPlayer
        streamPlayer    = nil
        streamStartedAt = nil
        stateLock.unlock()
        try? player?.stop(atTime: CHHapticTimeImmediate)
    }

    // MARK: - Transient events

    func playEvent(_ event: HapticEvent) {
        // Stream events are handled by updateStream(), not as discrete patterns.
        if event.event_type == .stream {
            updateStream(
                intensity: event.intensity,
                sharpness: event.sharpness ?? 0.4
            )
            return
        }

        stateLock.lock()
        let current = engine
        stateLock.unlock()

        guard let current else {
            #if DEBUG
            print("HapticEngine: no engine (supportsHaptics=\(supportsHaptics))")
            #endif
            return
        }

        let pattern: CHHapticPattern
        do {
            switch event.event_type {
            case .bass_hit:
                pattern = try HapticPatterns.bassHit(intensity: event.intensity, durationMs: event.duration)
            case .rhythm_tap:
                pattern = try HapticPatterns.rhythmTap(intensity: event.intensity)
            case .alert_snap:
                pattern = try HapticPatterns.alertSnap(intensity: event.intensity)
            case .sustained:
                pattern = try HapticPatterns.sustained(intensity: event.intensity, durationMs: event.duration)
            case .stream:
                return  // handled above — unreachable
            }
        } catch {
            #if DEBUG
            print("HapticEngine: pattern build failed — \(error.localizedDescription)")
            #endif
            return
        }

        do {
            let player = try current.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            #if DEBUG
            print("HapticEngine: play failed — \(error.localizedDescription)")
            #endif
        }
    }
}
