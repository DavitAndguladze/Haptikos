// Shared event format — the contract between the web team and iOS team.
// Both sides code against this interface independently.

export interface HapticEvent {
  timestamp: number;          // Date.now() when event was detected
  event_type: 'bass_hit' | 'rhythm_tap' | 'alert_snap' | 'sustained';
  intensity: number;          // 0.0 – 1.0 (vibration strength)
  duration: number;           // milliseconds (how long the haptic should last)
  label: string;              // human-readable description for dashboard display
}

// Examples:
// { timestamp: 1712764800000, event_type: "bass_hit",    intensity: 0.85, duration: 150, label: "Kick drum" }
// { timestamp: 1712764800050, event_type: "rhythm_tap",  intensity: 0.60, duration: 80,  label: "Hi-hat pattern" }
// { timestamp: 1712764800120, event_type: "alert_snap",  intensity: 0.95, duration: 50,  label: "Snare hit" }
// { timestamp: 1712764800200, event_type: "sustained",   intensity: 0.70, duration: 400, label: "Bass note" }
