import SwiftUI

struct PulsingOrbView: View {

    // MARK: - Input

    /// 0.0–1.0 intensity drives the pulse scale and glow brightness.
    var intensity: Float = 0.0

    // MARK: - Animation State

    @State private var pulseScale: CGFloat = 1.0
    @State private var glowOpacity: Double = 0.6
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // MARK: - Palette (from mockup)

    private let navyCore    = Color(red: 0.0,  green: 0.0,  blue: 0.50)  // #000080
    private let blueRing    = Color(red: 0.0,  green: 0.0,  blue: 1.0)   // #0000FF
    private let orangeRing  = Color(red: 1.0,  green: 0.65, blue: 0.0)   // #FFA500
    private let yellowGlow  = Color(red: 1.0,  green: 1.0,  blue: 0.0)   // #FFFF00
    private let coralText   = Color(red: 1.0,  green: 0.40, blue: 0.38)  // ~#FF6661

    // MARK: - Body

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let orbDiameter = side * 0.75

            ZStack {
                // Background
                Color.black.ignoresSafeArea()

                VStack(spacing: side * 0.06) {
                    Spacer()

                    // --- Orb ---
                    ZStack {
                        // Layer 1 — Yellow outer glow
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        yellowGlow.opacity(0.9),
                                        yellowGlow.opacity(0.4),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: orbDiameter * 0.28,
                                    endRadius: orbDiameter * 0.55
                                )
                            )
                            .frame(width: orbDiameter * 1.3, height: orbDiameter * 1.3)
                            .blur(radius: 30)
                            .opacity(glowOpacity)

                        // Layer 2 — Orange mid ring
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        orangeRing,
                                        orangeRing.opacity(0.6),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: orbDiameter * 0.22,
                                    endRadius: orbDiameter * 0.42
                                )
                            )
                            .frame(width: orbDiameter * 1.05, height: orbDiameter * 1.05)
                            .blur(radius: 18)

                        // Layer 3 — Blue inner ring
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        blueRing,
                                        blueRing.opacity(0.7),
                                        Color.clear
                                    ],
                                    center: .center,
                                    startRadius: orbDiameter * 0.10,
                                    endRadius: orbDiameter * 0.32
                                )
                            )
                            .frame(width: orbDiameter * 0.85, height: orbDiameter * 0.85)
                            .blur(radius: 12)

                        // Layer 4 — Navy core
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        navyCore,
                                        navyCore.opacity(0.85)
                                    ],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: orbDiameter * 0.25
                                )
                            )
                            .frame(width: orbDiameter * 0.55, height: orbDiameter * 0.55)
                            .blur(radius: 6)
                    }
                    .scaleEffect(pulseScale)
                    .drawingGroup() // Metal-backed rendering
                    .accessibilityLabel("Pulsing sound orb")

                    // --- Tagline ---
                    Text("Feel the Sound")
                        .font(.system(size: side * 0.08, weight: .bold, design: .rounded))
                        .foregroundStyle(coralText)
                        .accessibilityAddTraits(.isHeader)

                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .onChange(of: intensity) { _, newValue in
            pulse(to: newValue)
        }
    }

    // MARK: - Animation

    private func pulse(to value: Float) {
        let clamped = CGFloat(min(max(value, 0), 1))
        let targetScale = 1.0 + clamped * 0.15      // max 15% growth
        let targetGlow  = 0.6 + Double(clamped) * 0.4 // 0.6 → 1.0

        if reduceMotion {
            pulseScale = targetScale
            glowOpacity = targetGlow
        } else {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
                pulseScale = targetScale
            }
            withAnimation(.easeOut(duration: 0.2)) {
                glowOpacity = targetGlow
            }
        }
    }
}

// MARK: - Preview

#Preview("Idle") {
    PulsingOrbView(intensity: 0.0)
}

#Preview("Bass Hit") {
    PulsingOrbView(intensity: 0.85)
}
