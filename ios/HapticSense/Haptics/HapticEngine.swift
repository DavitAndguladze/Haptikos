import CoreHaptics
import Foundation

/// Routes decoded `HapticEvent`s to Core Haptics patterns. Call `playEvent` from networking/UI (single entry point).
final class HapticEngine {
    static let shared = HapticEngine()

    private var engine: CHHapticEngine?
    private let stateLock = NSLock()
    private let restartDelay: TimeInterval = 0.1

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

    func playEvent(_ event: HapticEvent) {
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
