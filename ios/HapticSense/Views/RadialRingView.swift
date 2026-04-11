import SwiftUI

// MARK: - Mutable smoothing state (class avoids SwiftUI re-renders)

private final class RingState {
    var prevSpokeLengths: [[Float]] = Array(
        repeating: Array(repeating: 0, count: 120), count: 5)
    var prevBaseRadii:   [Float] = Array(repeating: 0, count: 5)
    var prevThicknesses: [Float] = Array(repeating: 0, count: 5)
    /// Captured once so `t` stays small and precise in Float32.
    let startDate = Date()
}

// MARK: - RadialRingView

/// 5-ring radial visualizer driven by per-band audio energy.
/// Matches the dashboard canvas exactly: 120 spokes per ring, stacked layout,
/// organic sin() wobble, and temporal smoothing.
struct RadialRingView: View {
    var bands: BandEnergies = .zero

    @State private var rs = RingState()

    // Ring color components (R, G, B) in 0–1 range — innermost to outermost.
    private let rings: [(r: Double, g: Double, b: Double)] = [
        (0.106, 0.106, 0.561),   // subBass  #1B1B8F  dark blue
        (0.302, 0.651, 1.000),   // bass     #4DA6FF  light blue
        (1.000, 0.200, 0.333),   // mids     #FF3355  red
        (1.000, 0.624, 0.110),   // highs    #FF9F1C  orange
        (1.000, 0.839, 0.000),   // presence #FFD600  yellow
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { tl in
            Canvas { ctx, size in
                // Elapsed seconds since view appeared — small value, precise in Float32.
                let t = Float(tl.date.timeIntervalSince(rs.startDate))
                let cx = Float(size.width  / 2)
                let cy = Float(size.height / 2)
                let ref = Float(min(size.width, size.height))
                let scale = ref / 550          // same reference size as dashboard

                let energies: [Float] = [
                    bands.subBass, bands.bass,
                    bands.mids, bands.highs, bands.presence,
                ]

                // Dominant band gets a 40% energy bonus (matches dashboard DOMINANT_BONUS).
                let dominantIdx = energies.indices.max(by: { energies[$0] < energies[$1] }) ?? 0

                let INNER: Float    = 40
                let MIN_T: Float    = 3
                let MAX_T: Float    = 60
                let N               = 120

                // ── Compute raw dynamic stacked layout ──────────────────────────
                var layouts: [(baseR: Float, thick: Float, energy: Float)] = []
                var curRadius: Float = INNER * scale

                for i in 0..<5 {
                    var e = powf(energies[i], 0.5)      // power curve, same as dashboard
                    if i == dominantIdx && e > 0.05 { e = min(1.0, e * 1.4) }
                    let thick = MIN_T * scale + e * (MAX_T - MIN_T) * scale
                    layouts.append((curRadius, thick, e))
                    curRadius += thick
                }

                // ── Smooth base radii and thicknesses (50/50 lerp) ──────────────
                for i in 0..<5 {
                    if rs.prevBaseRadii[i] > 0 {
                        layouts[i] = (
                            baseR:  rs.prevBaseRadii[i]   * 0.5 + layouts[i].baseR  * 0.5,
                            thick:  rs.prevThicknesses[i] * 0.4 + layouts[i].thick  * 0.6,
                            energy: layouts[i].energy
                        )
                    }
                    rs.prevBaseRadii[i]   = layouts[i].baseR
                    rs.prevThicknesses[i] = layouts[i].thick
                }

                // ── Draw each ring ───────────────────────────────────────────────
                for (ri, layout) in layouts.enumerated() {
                    let (baseR, thick, energy) = layout
                    let wobble   = energy * thick * 0.5
                    let minPx    = MIN_T * scale
                    let ring     = rings[ri]
                    let brightness = Double(0.25 + energy * 0.75)

                    // Compute raw spoke lengths with organic wobble.
                    var raw = [Float](repeating: 0, count: N)
                    for s in 0..<N {
                        let fi = Float(s)
                        var len = thick
                        len += sin(fi * 0.15 + t * 2.5)             * wobble * 0.50
                        len += sin(fi * 0.40 + t * 4.0 + 1.5)       * wobble * 0.35
                        len += sin(fi * 0.90 + t * 6.0 + 3.0)       * wobble * 0.25
                        len += sin(fi * 1.70 + fi * fi * 0.01)       * wobble * 0.15
                        raw[s] = max(minPx, len)
                    }

                    // Spatial smoothing ±2 neighbours.
                    var smoothed = [Float](repeating: 0, count: N)
                    for s in 0..<N {
                        var sum: Float = 0
                        for d in -2...2 { sum += raw[(s + d + N) % N] }
                        smoothed[s] = sum / 5
                    }

                    // Temporal smoothing 40/60.
                    let prev = rs.prevSpokeLengths[ri]
                    for s in 0..<N {
                        smoothed[s] = prev[s] * 0.4 + smoothed[s] * 0.6
                    }
                    rs.prevSpokeLengths[ri] = smoothed

                    // Draw 120 spokes as a single stroked path.
                    var path = Path()
                    for s in 0..<N {
                        let angle  = Double(s) / Double(N) * .pi * 2 - .pi / 2
                        let cosA   = CGFloat(Darwin.cos(angle))
                        let sinA   = CGFloat(Darwin.sin(angle))
                        let r0     = CGFloat(baseR)
                        let r1     = CGFloat(baseR + smoothed[s])
                        path.move(to:    CGPoint(x: CGFloat(cx) + r0 * cosA,
                                                 y: CGFloat(cy) + r0 * sinA))
                        path.addLine(to: CGPoint(x: CGFloat(cx) + r1 * cosA,
                                                 y: CGFloat(cy) + r1 * sinA))
                    }

                    ctx.stroke(
                        path,
                        with: .color(Color(
                            red:     ring.r,
                            green:   ring.g,
                            blue:    ring.b,
                            opacity: brightness)),
                        style: StrokeStyle(lineWidth: 2, lineCap: .round)
                    )
                }
            }
        }
        .background(Color(red: 0.039, green: 0.039, blue: 0.071)) // #0A0A12
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    RadialRingView(bands: BandEnergies(
        subBass: 0.3,
        bass: 0.7,
        mids: 0.5,
        highs: 0.4,
        presence: 0.2
    ))
    .frame(width: 350, height: 350)
}
#endif
