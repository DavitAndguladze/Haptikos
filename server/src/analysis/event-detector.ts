// Frame-by-frame audio event classifier.
//
// Takes the output of analyzeFrequencyBands() and returns HapticEvent objects
// that match the shared contract in types.ts.
//
// Design notes:
//   - Spectral flux (frame-to-frame positive energy delta) detects transients.
//   - A per-band exponential moving average gives a dynamic baseline so the
//     detector self-calibrates to the current volume without manual gain tuning.
//   - Sustained energy windows catch held notes / drones.
//   - Per-event-type cooldowns prevent a single kick from firing 60 events/s.
//
// Datuna: the tunable knobs are in DEFAULT_CONFIG. Adjust thresholds during
// integration to make detection feel musical.

import type { HapticEvent } from '../types.js';
import { type BandEnergies } from './frequency-bands.js';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface DetectorConfig {
  /** Minimum positive flux required to call a sub-bass / bass transient. */
  bassFluxThreshold: number;
  /** Minimum positive flux required to call a mids transient. */
  midsFluxThreshold: number;
  /** Minimum positive flux required to call a highs / presence transient. */
  highsFluxThreshold: number;
  /**
   * Dynamic multiplier: effective threshold = max(fixedThreshold, EMA × multiplier).
   * Raises the bar at loud moments so quiet passages stay sensitive.
   */
  dynamicMultiplier: number;
  /** Absolute energy floor — prevents firing on background noise / silence. */
  minEnergy: number;
  /** Band energy level that qualifies as "sustained" (0–1). */
  sustainedThreshold: number;
  /** How long (ms) a band must stay above sustainedThreshold before firing. */
  sustainedDuration: number;
  /** Per-type cooldown in ms — prevents the same hit from repeating every frame. */
  cooldowns: Record<HapticEvent['event_type'], number>;
}

export const DEFAULT_CONFIG: DetectorConfig = {
  bassFluxThreshold:  0.15,
  midsFluxThreshold:  0.12,
  highsFluxThreshold: 0.18,
  dynamicMultiplier:  2.0,
  minEnergy:          0.08,
  sustainedThreshold: 0.35,
  sustainedDuration:  200,  // ms
  cooldowns: {
    bass_hit:   150,
    rhythm_tap: 100,
    alert_snap: 100,
    sustained:  300,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const ZERO_BANDS: BandEnergies = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };

// ─── EventDetector ────────────────────────────────────────────────────────────

/**
 * Stateful per-frame classifier. Create one instance and call detect() at ~60 fps.
 * Call reset() when the audio stream stops so stale state doesn't affect the next
 * session.
 *
 * @example
 * ```ts
 * const detector = new EventDetector();
 * // inside animation loop:
 * const bands  = analyzeFrequencyBands(fftData);
 * const events = detector.detect(bands);
 * for (const ev of events) socket.emit('haptic', ev);
 * ```
 */
export class EventDetector {
  private readonly cfg: DetectorConfig;

  // Previous frame's energies — used to compute spectral flux.
  private prev: BandEnergies = { ...ZERO_BANDS };

  // Exponential moving average per band (α ≈ 0.97 → ~1 s window at 60 fps).
  private means: BandEnergies = { ...ZERO_BANDS };

  // Wall-clock time (ms) of the last fire per event type.
  private lastFired: Record<HapticEvent['event_type'], number> = {
    bass_hit:   0,
    rhythm_tap: 0,
    alert_snap: 0,
    sustained:  0,
  };

  // When each band first crossed sustainedThreshold this run (ms), or undefined.
  private sustainedSince: Partial<Record<keyof BandEnergies, number>> = {};

  constructor(config: Partial<DetectorConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify one frame of band energies.
   *
   * @param bands  Output of analyzeFrequencyBands() for the current frame.
   * @returns      Array of HapticEvents detected this frame (often empty).
   */
  detect(bands: BandEnergies): HapticEvent[] {
    const now    = Date.now();
    const events: HapticEvent[] = [];

    // ── Positive spectral flux: how much each band jumped this frame ──────────
    const flux: BandEnergies = {
      subBass:  Math.max(0, bands.subBass  - this.prev.subBass),
      bass:     Math.max(0, bands.bass     - this.prev.bass),
      mids:     Math.max(0, bands.mids     - this.prev.mids),
      highs:    Math.max(0, bands.highs    - this.prev.highs),
      presence: Math.max(0, bands.presence - this.prev.presence),
    };

    // ── Update per-band EMA ───────────────────────────────────────────────────
    const α = 0.97;
    for (const k of Object.keys(this.means) as Array<keyof BandEnergies>) {
      this.means[k] = α * this.means[k] + (1 - α) * bands[k];
    }

    // ── Local helpers ─────────────────────────────────────────────────────────
    const { cfg } = this;

    const canFire = (type: HapticEvent['event_type']): boolean =>
      now - this.lastFired[type] >= cfg.cooldowns[type];

    const fire = (
      type:      HapticEvent['event_type'],
      intensity: number,
      duration:  number,
      label:     string,
    ): void => {
      this.lastFired[type] = now;
      events.push({ timestamp: now, event_type: type, intensity: clamp(intensity, 0, 1), duration, label });
    };

    // Dynamic threshold: at least the fixed floor, but also at least N× the
    // running mean. Quieter passages stay reactive; loud ones don't over-fire.
    const dynThresh = (base: number, mean: number): number =>
      Math.max(base, mean * cfg.dynamicMultiplier);

    // ── Rule 1 — bass_hit ─────────────────────────────────────────────────────
    // Sub-bass spike → kick drum feel; bass spike → bass note feel.
    if (canFire('bass_hit')) {
      const subThresh  = dynThresh(cfg.bassFluxThreshold, this.means.subBass);
      const bassThresh = dynThresh(cfg.bassFluxThreshold, this.means.bass);

      if (flux.subBass > subThresh && bands.subBass > cfg.minEnergy) {
        fire('bass_hit', clamp(flux.subBass / 0.4, 0, 1), 150, 'Kick drum');
      } else if (flux.bass > bassThresh && bands.bass > cfg.minEnergy) {
        fire('bass_hit', clamp(flux.bass / 0.4, 0, 1), 150, 'Bass note');
      }
    }

    // ── Rule 2 — rhythm_tap ───────────────────────────────────────────────────
    // Mids transient → hi-hat, snare body, guitar pick attack, etc.
    if (canFire('rhythm_tap')) {
      const thresh = dynThresh(cfg.midsFluxThreshold, this.means.mids);
      if (flux.mids > thresh && bands.mids > cfg.minEnergy) {
        fire('rhythm_tap', clamp(flux.mids / 0.35, 0, 1), 80, 'Rhythm hit');
      }
    }

    // ── Rule 3 — alert_snap ───────────────────────────────────────────────────
    // Highs transient → snare crack / cymbal wash; presence → bright snap.
    if (canFire('alert_snap')) {
      const highsThresh    = dynThresh(cfg.highsFluxThreshold, this.means.highs);
      const presenceThresh = dynThresh(cfg.highsFluxThreshold, this.means.presence);

      if (flux.highs > highsThresh && bands.highs > cfg.minEnergy) {
        fire('alert_snap', clamp(flux.highs / 0.45, 0, 1), 50, 'Snare hit');
      } else if (flux.presence > presenceThresh && bands.presence > cfg.minEnergy) {
        fire('alert_snap', clamp(flux.presence / 0.45, 0, 1), 50, 'Cymbal snap');
      }
    }

    // ── Rule 4 — sustained ────────────────────────────────────────────────────
    // Any band held above the energy threshold for >sustainedDuration ms.
    if (canFire('sustained')) {
      const sustainedBands: Array<[keyof BandEnergies, string]> = [
        ['subBass',  'Deep sustain'],
        ['bass',     'Bass note'],
        ['mids',     'Sustained tone'],
        ['highs',    'High sustain'],
        ['presence', 'Airy sustain'],
      ];

      for (const [band, label] of sustainedBands) {
        if (bands[band] > cfg.sustainedThreshold) {
          if (this.sustainedSince[band] === undefined) {
            this.sustainedSince[band] = now;
          } else if (now - (this.sustainedSince[band] as number) >= cfg.sustainedDuration) {
            fire('sustained', clamp(bands[band] * 1.1, 0, 1), 400, label);
            // Reset timer so it won't immediately re-fire next cooldown window.
            delete this.sustainedSince[band];
            break; // one sustained event per frame is enough
          }
        } else {
          delete this.sustainedSince[band];
        }
      }
    } else {
      // Clear sustained timers while in cooldown; the clock starts fresh after.
      this.sustainedSince = {};
    }

    // ── Advance state ─────────────────────────────────────────────────────────
    this.prev = { ...bands };

    return events;
  }

  /** Clear all per-session state. Call when the audio stream is stopped. */
  reset(): void {
    this.prev           = { ...ZERO_BANDS };
    this.means          = { ...ZERO_BANDS };
    this.sustainedSince = {};
    this.lastFired      = { bass_hit: 0, rhythm_tap: 0, alert_snap: 0, sustained: 0 };
  }
}
