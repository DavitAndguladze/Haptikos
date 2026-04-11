export interface HapticEvent {
  timestamp: number;
  event_type: 'bass_hit' | 'rhythm_tap' | 'alert_snap' | 'sustained';
  intensity: number;
  duration: number;
  label: string;
}