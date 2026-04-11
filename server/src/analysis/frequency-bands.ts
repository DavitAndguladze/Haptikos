// Frequency band splitter for WebAudio FFT data.
//
// Bin math: at 44.1 kHz sample rate with fftSize 2048,
// the analyser produces 1024 usable bins, each covering
// 44100 / 2048 ≈ 21.5 Hz.
//
// These boundaries match the plan and are intentionally tunable —
// Datuna (audio engineer) may adjust them during integration tuning.
//
// Reference: HapticEvent in types.ts is the downstream format that
// event-detector.ts will produce using these band energies.

import type { HapticEvent } from '../types.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
// HapticEvent imported for reference only; event-detector.ts produces those.

export interface BandEnergies {
  /** 20 – 80 Hz  (bins  0 – 2): kick drums, sub-bass drops */
  subBass: number;
  /** 80 – 250 Hz (bins  3 – 10): bass guitar, low synths */
  bass: number;
  /** 250 – 2 000 Hz (bins 11 – 92): vocals, guitars, rhythmic hits */
  mids: number;
  /** 2 000 – 8 000 Hz (bins 93 – 371): hi-hats, cymbals, snares */
  highs: number;
  /** 8 000+ Hz (bins 372 – 1023): sibilance, air, transients */
  presence: number;
}

// Inclusive start, exclusive end — same convention as Array.slice.
const BAND_BINS = {
  subBass:  { start: 0,   end: 3    },
  bass:     { start: 3,   end: 11   },
  mids:     { start: 11,  end: 93   },
  highs:    { start: 93,  end: 372  },
  presence: { start: 372, end: 1024 },
} as const;

/**
 * Compute the average energy (0 – 1) for each of the five frequency bands.
 *
 * @param fftData  Raw output of AnalyserNode.getByteFrequencyData() — values 0-255.
 * @returns        Normalised average energy per band (0.0 – 1.0).
 */
export function analyzeFrequencyBands(fftData: Uint8Array): BandEnergies {
  function avgBins(start: number, end: number): number {
    const actualEnd = Math.min(end, fftData.length);
    if (actualEnd <= start) return 0;
    let sum = 0;
    for (let i = start; i < actualEnd; i++) {
      sum += fftData[i];
    }
    return sum / (actualEnd - start) / 255;
  }

  return {
    subBass:  avgBins(BAND_BINS.subBass.start,  BAND_BINS.subBass.end),
    bass:     avgBins(BAND_BINS.bass.start,     BAND_BINS.bass.end),
    mids:     avgBins(BAND_BINS.mids.start,     BAND_BINS.mids.end),
    highs:    avgBins(BAND_BINS.highs.start,    BAND_BINS.highs.end),
    presence: avgBins(BAND_BINS.presence.start, BAND_BINS.presence.end),
  };
}

// Re-export bin boundaries so event-detector.ts and app.js can stay in sync.
export { BAND_BINS };