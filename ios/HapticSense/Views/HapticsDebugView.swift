import SwiftUI

/// Local-only controls to exercise `HapticEngine` without Socket.IO (remove or gate behind `#if DEBUG` after integration).
struct HapticsDebugView: View {
    @State private var lastLabel = "—"

    var body: some View {
        NavigationStack {
            List {
                Section("Patterns") {
                    patternButton("Bass hit", event: .sampleBassHit)
                    patternButton("Rhythm tap", event: .sampleRhythmTap)
                    patternButton("Alert snap", event: .sampleAlertSnap)
                    patternButton("Sustained", event: .sampleSustained)
                }

                Section("Samples (contract)") {
                    Button("Play all samples (staggered)") {
                        playSequence(HapticEvent.allSamples)
                    }
                }

                Section("Status") {
                    LabeledContent("Core Haptics") {
                        Text(HapticEngine.shared.supportsHaptics ? "Supported" : "Unavailable")
                            .foregroundStyle(HapticEngine.shared.supportsHaptics ? .green : .secondary)
                    }
                    LabeledContent("Last label") {
                        Text(lastLabel)
                            .lineLimit(2)
                    }
                }
            }
            .navigationTitle("Haptics Debug")
        }
    }

    private func patternButton(_ title: String, event: HapticEvent) -> some View {
        Button(title) {
            HapticEngine.shared.playEvent(event)
            lastLabel = event.label
        }
    }

    private func playSequence(_ events: [HapticEvent]) {
        for (index, event) in events.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.6) {
                HapticEngine.shared.playEvent(event)
                lastLabel = event.label
            }
        }
    }
}

#Preview {
    HapticsDebugView()
}
