import SwiftUI

struct ContentView: View {
    @EnvironmentObject var socketManager: HapticSocketManager
    #if DEBUG
    @State private var showDebug = false
    #endif

    @State private var showScanner = false
    @State private var manualIP = ""
    @State private var currentBands: BandEnergies = .zero

    var body: some View {
        ZStack {
            Color(red: 0.039, green: 0.039, blue: 0.071).ignoresSafeArea() // #0A0A12

            VStack(spacing: 0) {
                // Connection status
                HStack(spacing: 6) {
                    Circle()
                        .fill(socketManager.isConnected ? .green : .red)
                        .frame(width: 10, height: 10)

                    Text(socketManager.isConnected ? "Connected" : "Disconnected")
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(.top, 16)

                // Radial ring visualizer
                RadialRingView(bands: currentBands)
                    .frame(maxWidth: .infinity)
                    .aspectRatio(1, contentMode: .fit)
                    .padding(.vertical, 12)

                Text("Feel the Sound")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.35))
                    .padding(.bottom, 8)

                // Controls
                VStack(spacing: 12) {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(.ultraThinMaterial)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }

                    // Manual IP fallback
                    HStack(spacing: 8) {
                        TextField("Server IP (e.g. 192.168.1.5:3000)", text: $manualIP)
                            .font(.system(size: 15, design: .monospaced))
                            .textFieldStyle(.plain)
                            .padding(10)
                            .background(Color.white.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(.white)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)

                        Button("Go") {
                            connectManual()
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.white.opacity(0.15))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .onChange(of: socketManager.lastEvent) { _, event in
            guard let event else { return }

            if event.event_type == .stream {
                if let b = event.bands {
                    // Full per-band data — drive rings directly.
                    currentBands = b
                } else {
                    // Fallback: server sent stream without bands — approximate from
                    // intensity (loudness) and sharpness (frequency centroid).
                    let I = event.intensity
                    let S = event.sharpness ?? 0.5
                    currentBands = BandEnergies(
                        subBass:  I * max(0, 1.0 - S * 3),
                        bass:     I * max(0, 1.0 - S * 2),
                        mids:     I * (1.0 - abs(S - 0.42) * 2),
                        highs:    I * max(0, S * 1.5 - 0.2),
                        presence: I * max(0, S * 2 - 0.9))
                }
                // Never decay stream events — the next stream update replaces this.
                return
            }

            // Transient beat event — spike the relevant band for visual punch.
            let b = currentBands
            switch event.event_type {
            case .bass_hit:
                currentBands = BandEnergies(
                    subBass:  max(b.subBass,  event.intensity * 0.8),
                    bass:     max(b.bass,     event.intensity),
                    mids:     b.mids,
                    highs:    b.highs,
                    presence: b.presence)
            case .rhythm_tap:
                currentBands = BandEnergies(
                    subBass:  b.subBass,
                    bass:     b.bass,
                    mids:     max(b.mids, event.intensity),
                    highs:    b.highs,
                    presence: b.presence)
            case .alert_snap:
                currentBands = BandEnergies(
                    subBass:  b.subBass,
                    bass:     b.bass,
                    mids:     b.mids,
                    highs:    max(b.highs,    event.intensity * 0.8),
                    presence: max(b.presence, event.intensity))
            default: break
            }
            // Decay back to zero after the event duration.
            let decay = max(event.duration / 1000.0, 0.15)
            DispatchQueue.main.asyncAfter(deadline: .now() + decay) {
                currentBands = .zero
            }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView()
                .environmentObject(socketManager)
        }
        #if DEBUG
        .overlay(alignment: .topTrailing) {
            Button("Debug") { showDebug = true }
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.1))
                .foregroundStyle(.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.top, 12)
                .padding(.trailing, 16)
        }
        .sheet(isPresented: $showDebug) {
            HapticsDebugView()
        }
        #endif
    }

    private func connectManual() {
        let raw = manualIP.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        let urlString = raw.hasPrefix("http") ? raw : "http://\(raw)"
        guard let url = URL(string: urlString) else { return }
        socketManager.connect(to: url)
    }
}
