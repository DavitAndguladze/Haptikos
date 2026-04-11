# Haptikos

**Making the invisible world of sound tangible for the deaf community.**

Haptikos is a real-time audio-to-haptic bridge that captures sound from a laptop, classifies musical events using frequency analysis, and delivers semantic haptic feedback to an iPhone — all over local WiFi with under 50ms latency.

Built at **SproutGT Hackathon**.

---

## How It Works

```
Audio playing on laptop → WebAudio API captures stream
       ↓
  FFT analysis splits audio into 5 frequency bands
       ↓
  Event detector classifies: bass_hit, rhythm_tap, alert_snap, sustained
       ↓
  Socket.IO relays haptic events to connected iPhones
       ↓
  Core Haptics fires pre-built vibration patterns
       ↓
  User feels the music
```

### Haptic Event Types

| Event | Trigger | What You Feel |
|-------|---------|---------------|
| `bass_hit` | Kick drums, bass drops | Deep rumble |
| `rhythm_tap` | Hi-hats, snare body, guitar picks | Crisp tap |
| `alert_snap` | Snare cracks, cymbal hits | Sharp snap |
| `sustained` | Held notes, pads | Slow fading pulse |

### Frequency Bands

| Band | Range | Musical Source |
|------|-------|---------------|
| Sub-bass | 20–80 Hz | Kick drums, bass drops |
| Bass | 80–250 Hz | Bass guitar, low synths |
| Mids | 250–2,000 Hz | Vocals, guitars, rhythmic patterns |
| Highs | 2,000–8,000 Hz | Hi-hats, cymbals, snares |
| Presence | 8,000+ Hz | Sibilance, air, transients |

---

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Xcode** (for iOS app)
- iPhone with Taptic Engine (iPhone 8 or later)
- Laptop and iPhone on the same WiFi network

### Server Setup

```bash
cd server
npm install
npm run dev
```

The server starts at `http://localhost:3000` and serves the web dashboard.

### iOS Setup

1. Open `ios/HapticSense.xcodeproj` in Xcode
2. Socket.IO-Client-Swift is included via SPM
3. Build and run on a physical iPhone (haptics don't work in the simulator)

### Pairing

1. Open the dashboard at `http://localhost:3000` in Chrome
2. Scan the QR code shown on the dashboard with the iOS app
3. The connection status dot turns green when paired
4. Click **Start Listening** and share your system audio
5. Play music — feel it on your phone

---

## Project Structure

```
Haptikos/
├── server/                          # Node.js + TypeScript
│   ├── src/
│   │   ├── index.ts                 # Express + Socket.IO server
│   │   ├── types.ts                 # Shared HapticEvent interface
│   │   ├── analysis/
│   │   │   ├── frequency-bands.ts   # FFT → 5 frequency bands
│   │   │   └── event-detector.ts    # Band energies → haptic events
│   │   ├── broadcast/
│   │   │   └── socket-manager.ts    # Socket.IO rooms + QR code
│   │   └── public/                  # Web dashboard
│   │       ├── index.html
│   │       ├── app.js               # WebAudio capture + visualization
│   │       └── style.css
│   ├── package.json
│   └── tsconfig.json
└── ios/
    └── HapticSense/                 # SwiftUI app
        ├── HapticSenseApp.swift
        ├── ContentView.swift
        ├── Views/
        │   ├── QRScannerView.swift  # Camera-based QR pairing
        │   └── RadialRingView.swift # 5-ring audio visualizer
        ├── Haptics/
        │   ├── HapticEngine.swift   # CHHapticEngine wrapper
        │   └── HapticPatterns.swift # Pre-built vibration patterns
        ├── Network/
        │   └── SocketManager.swift  # Socket.IO client
        └── Models/
            └── HapticEvent.swift    # Event model (matches server)
```

---

## Tech Stack

### Server
| Technology | Purpose |
|------------|---------|
| Express | HTTP server, static file serving |
| Socket.IO | Real-time WebSocket relay |
| WebAudio API | Audio capture and FFT analysis |
| qrcode | QR code generation for pairing |
| TypeScript | Type-safe server code |

### iOS
| Technology | Purpose |
|------------|---------|
| SwiftUI | App UI and state management |
| Core Haptics | Taptic Engine vibration patterns |
| Socket.IO-Client-Swift | Real-time event reception |
| AVFoundation | QR code scanning |

---

## Architecture

The system is split into two independent halves connected by a shared event format:

```typescript
interface HapticEvent {
  timestamp: number;
  event_type: 'bass_hit' | 'rhythm_tap' | 'alert_snap' | 'sustained' | 'stream';
  intensity: number;    // 0.0 – 1.0
  duration: number;     // milliseconds
  label: string;
}
```

The web dashboard performs all audio analysis and classification. The server acts as a stateless relay. The iPhone does no computation — it pattern-matches on `event_type` and fires the corresponding pre-built haptic pattern, keeping latency minimal.

---

## Team

| Name | Role |
|------|------|
| **Samuel** | iOS — Networking, QR scanner, UI |
| **Fiona** | Server — Express, Socket.IO infrastructure |
| **Alexia** | Web — Audio analysis, dashboard, visualization |
| **Datuna** | iOS — Core Haptics, pattern design, audio tuning |

---

## License

This project is licensed under the [MIT License](LICENSE).
