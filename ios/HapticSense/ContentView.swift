import SwiftUI

struct ContentView: View {
    @EnvironmentObject var socketManager: HapticSocketManager
    #if DEBUG
    @State private var showDebug = false
    #endif

    @State private var showScanner = false
    @State private var manualIP = ""
    @State private var currentIntensity: Float = 0.0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

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

                // Pulsing Orb
                PulsingOrbView(intensity: currentIntensity)

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
            currentIntensity = event.intensity
            // Decay back to idle after the event duration
            let decay = max(event.duration / 1000.0, 0.15)
            DispatchQueue.main.asyncAfter(deadline: .now() + decay) {
                currentIntensity = 0.0
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
