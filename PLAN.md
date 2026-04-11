# HapticSense - Implementation Plan

**Tagline:** Making the invisible world of sound tangible for the deaf community.

## Context
Building a real-time haptic bridge at SproutGT Hackathon (16 hours). A web app captures audio via WebAudio API, classifies musical events, and sends semantic haptic triggers over Socket.IO to an iPhone that fires pre-built Core Haptics patterns. Team of 4, feature-branch workflow.

---

## Shared Event Format (The Contract)

This is the **single most important thing** — it's the interface between the web team and iOS team. Both sides code against this format independently.

```typescript
// Shared event format — agreed upon BEFORE anyone starts coding
interface HapticEvent {
  timestamp: number;          // Date.now() when event was detected
  event_type: 'bass_hit' | 'rhythm_tap' | 'alert_snap' | 'sustained';
  intensity: number;          // 0.0 - 1.0 (how strong)
  duration: number;           // milliseconds (how long the haptic should last)
  label: string;              // human-readable description for dashboard display
}

// Examples:
{ timestamp: 1712764800000, event_type: "bass_hit",    intensity: 0.85, duration: 150, label: "Kick drum" }
{ timestamp: 1712764800050, event_type: "rhythm_tap",  intensity: 0.60, duration: 80,  label: "Hi-hat pattern" }
{ timestamp: 1712764800120, event_type: "alert_snap",  intensity: 0.95, duration: 50,  label: "Snare hit" }
{ timestamp: 1712764800200, event_type: "sustained",   intensity: 0.70, duration: 400, label: "Bass note" }
```

**Why this format works:**
- `event_type` tells the iPhone which pre-built haptic pattern to fire
- `intensity` scales the vibration strength dynamically
- `duration` controls how long continuous patterns last
- `label` is for the dashboard UI only (shows what was detected)
- Both teams can work independently: web team sends this format, iOS team receives it

### What "Pre-built Haptic Patterns" Means

The iOS app has **4 vibration recipes hardcoded**:

| event_type | What the phone does | How it feels |
|------------|-------------------|--------------|
| `bass_hit` | Strong continuous vibration, low sharpness, `duration` ms | Deep rumble (like feeling a subwoofer) |
| `rhythm_tap` | Quick transient tap, high sharpness | Crisp single tap |
| `alert_snap` | Maximum intensity + sharpness transient | Sharp snap |
| `sustained` | Continuous vibration that fades over `duration` ms | Slow pulse |

When an event arrives, the phone doesn't compute anything — it just looks up the pattern by `event_type`, sets the `intensity`, and fires. This is why it's near-instant.

---

## Team & Platforms

| Name | Platform | Role |
|------|----------|------|
| **Fiona** | Windows | Server + Socket.IO infrastructure |
| **Alexia** | Windows | Web Audio Analysis + Dashboard (works with Datuna on audio logic) |
| **Samuel** | MacBook | iOS Networking + QR Scanner + UI |
| **Datuna** | MacBook | iOS Core Haptics + Audio-related tuning (audio engineer) |

**Platform constraint:** Fiona & Alexia can't run Xcode → they handle web/server. Samuel & Datuna handle iOS.

---

## Git Workflow: Feature Branches + PRs

### Branch Strategy
```
main (protected — only merge via PR)
  ├── feat/server-setup        (Fiona — Server + Socket.IO)
  ├── feat/audio-analysis      (Alexia — WebAudio + event detection, Datuna advises on audio)
  ├── feat/ios-haptics         (Datuna — Core Haptics + patterns)
  └── feat/ios-networking      (Samuel — Socket.IO client + QR + UI)
```

### Rules
1. **Never push directly to main** — always create a PR
2. Each person owns specific files (listed below) — no overlap = no merge conflicts
3. First PR merged sets up the shared structure (Fiona's job)
4. Use `git pull origin main` before creating a PR to stay current

### How Each Person Works Independently with Claude Code

**Step 1** (All together, 15 min): Fiona creates the shared scaffolding on `main`:
- `.gitignore`, `package.json`, `tsconfig.json`
- `server/src/types.ts` with the `HapticEvent` interface
- Empty placeholder files in every folder so the structure exists
- Push to main, everyone pulls

**Step 2** (Independent): Each person branches off main and works on their files only:

```bash
# Each person runs:
git checkout main && git pull
git checkout -b feat/their-branch-name
# ... work with Claude Code ...
git push -u origin feat/their-branch-name
# Create PR on GitHub
```

**Step 3** (Integration): PRs merged in order:
1. `feat/server-setup` first (Fiona — server runs, Socket.IO accepts connections)
2. `feat/audio-analysis` second (Alexia — web dashboard sends events)
3. `feat/ios-haptics` + `feat/ios-networking` (Datuna + Samuel — iOS app connects and vibrates)

---

## Project Structure

```
IHear/
├── .gitignore
├── PLAN.md
├── server/                              # Node.js/TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                     # [Fiona] Express + Socket.IO + serve web app
│       ├── types.ts                     # [Shared] HapticEvent interface — set up first
│       ├── analysis/
│       │   ├── frequency-bands.ts       # [Alexia] Split FFT into 5 bands
│       │   └── event-detector.ts        # [Alexia] Detect bass_hit, rhythm_tap, etc.
│       ├── broadcast/
│       │   └── socket-manager.ts        # [Fiona] Socket.IO server + QR code
│       └── public/                      # [Alexia] Web dashboard
│           ├── index.html
│           ├── app.js                   # WebAudio capture + FFT + classification + viz
│           └── style.css
└── ios/
    └── HapticSense/                     # Xcode project (SwiftUI)
        ├── HapticSenseApp.swift          # [Samuel]
        ├── ContentView.swift             # [Samuel] Main UI
        ├── Views/
        │   └── QRScannerView.swift       # [Samuel] Camera QR scanner
        ├── Haptics/
        │   ├── HapticEngine.swift        # [Datuna] CHHapticEngine wrapper
        │   └── HapticPatterns.swift      # [Datuna] Pre-built patterns (audio expertise)
        ├── Network/
        │   └── SocketManager.swift       # [Samuel] Socket.IO client
        └── Models/
            └── HapticEvent.swift         # [Datuna] Event model (matches server types.ts)
```

---

## Person-by-Person Task Breakdown

### Fiona (Windows): Server + Socket.IO Infrastructure
**Branch:** `feat/server-setup`
**Files:** `index.ts`, `broadcast/socket-manager.ts`, `types.ts` (initial setup)

**What to build:**
1. Express server on port 3000 serving `public/` as static files
2. Socket.IO server with websocket-only transport
3. Two Socket.IO "rooms": `dashboard` (web app) and `phones` (iPhones)
4. Relay: when dashboard emits `haptic` event, broadcast to all phones
5. `/qr` endpoint: detect local IP via `os.networkInterfaces()`, generate QR code with `qrcode` npm package encoding `http://local-ip:3000`
6. `/health` endpoint: returns `{ status: "ok", phones: N, dashboards: N }`

**How to test independently:**
```bash
# Start server
npx tsx src/index.ts
# In another terminal, test with a fake event:
node -e "const io = require('socket.io-client')('http://localhost:3000', {transports:['websocket']}); io.on('connect', () => { io.emit('haptic', {timestamp:Date.now(), event_type:'bass_hit', intensity:0.8, duration:150, label:'test'}); console.log('sent'); setTimeout(()=>process.exit(),1000); })"
```

**Claude Code prompt for Fiona:**
> "Set up an Express + Socket.IO server in server/src/index.ts. It should serve the public/ directory as static files, accept Socket.IO connections with websocket-only transport, have two rooms ('dashboard' and 'phones'), relay 'haptic' events from dashboard to phones, and have /qr and /health endpoints. Use the HapticEvent interface from types.ts. Port 3000."

---

### Alexia (Windows): Web Audio Analysis + Dashboard
**Branch:** `feat/audio-analysis`
**Files:** `analysis/frequency-bands.ts`, `analysis/event-detector.ts`, `public/index.html`, `public/app.js`, `public/style.css`

**Note:** Alexia should consult Datuna on threshold values and frequency band boundaries — his audio engineering expertise is critical for making the detection feel musical rather than random.

**What to build:**
1. `public/app.js` — WebAudio API setup:
   - Create AudioContext + AnalyserNode (fftSize: 2048)
   - Capture audio via `navigator.mediaDevices.getUserMedia({ audio: true })` or tab capture
   - Read FFT data at ~60fps with `requestAnimationFrame`
2. `analysis/frequency-bands.ts` — split 1024 frequency bins into 5 bands:
   - Sub-bass (bins 0-3): 20-80 Hz
   - Bass (bins 3-11): 80-250 Hz
   - Mids (bins 11-93): 250-2000 Hz
   - Highs (bins 93-372): 2000-8000 Hz
   - Presence (bins 372+): 8000+ Hz
   - (Bin index = frequency / (sampleRate / fftSize), at 44.1kHz with 2048 FFT)
3. `analysis/event-detector.ts` — detect events using energy thresholds:
   - Track previous frame's band energies
   - `bass_hit`: sub-bass energy spikes above dynamic threshold
   - `rhythm_tap`: rapid mids spikes
   - `alert_snap`: sharp transient across highs
   - `sustained`: continuous high energy in any band for >200ms
4. `public/index.html` — dashboard showing:
   - QR code image (fetched from `/qr`)
   - Waveform/frequency bar visualization
   - Event log (last 10 detected events)
   - Connected phones count

**How to test independently (no server needed):**
- Open `index.html` directly in browser, play music, verify console logs show detected events
- The classification logic is pure JavaScript — doesn't need Socket.IO to test

**Claude Code prompt for Alexia:**
> "Build a web audio analyzer in server/src/public/app.js that uses WebAudio API's AnalyserNode to capture audio and classify it into haptic events. Split FFT data into 5 frequency bands (sub-bass, bass, mids, highs, presence). Detect bass_hit, rhythm_tap, alert_snap, and sustained events using energy thresholds and spectral flux. Emit events matching the HapticEvent interface from types.ts via Socket.IO. Also build the dashboard HTML with a waveform visualization and QR code display."

---

### Datuna (MacBook): iOS Core Haptics + Audio Tuning
**Branch:** `feat/ios-haptics`
**Files:** `Haptics/HapticEngine.swift`, `Haptics/HapticPatterns.swift`, `Models/HapticEvent.swift`

**Why Datuna:** As the audio engineer, Datuna owns the haptic pattern design — translating musical concepts into physical vibration. He also advises Alexia on frequency band boundaries and detection thresholds. During tuning phase (Hours 6+), Datuna leads threshold calibration across both web analysis and haptic patterns.

**What to build:**
1. `HapticEvent.swift` — Swift struct matching the shared format:
   ```swift
   struct HapticEvent: Codable {
       let timestamp: Double
       let event_type: String  // bass_hit, rhythm_tap, alert_snap, sustained
       let intensity: Float    // 0.0-1.0
       let duration: Double    // milliseconds
       let label: String
   }
   ```
2. `HapticEngine.swift` — CHHapticEngine wrapper:
   - Init: check `supportsHaptics`, create + start engine
   - `resetHandler`: restart engine after interruption
   - `stoppedHandler`: attempt restart with 0.5s delay
   - `playEvent(_ event: HapticEvent)`: route to correct pattern by event_type
3. `HapticPatterns.swift` — 4 pre-built pattern factories (Datuna designs these):
   - `bassHit(intensity:duration:)` → `.hapticContinuous`, low sharpness (0.2), variable intensity
   - `rhythmTap(intensity:)` → `.hapticTransient`, medium sharpness (0.5)
   - `alertSnap(intensity:)` → `.hapticTransient`, max sharpness (1.0), max intensity
   - `sustained(intensity:duration:)` → `.hapticContinuous` with intensity curve
   - **Datuna should experiment with sharpness/intensity combos to make each pattern feel musically distinct**

**How to test independently (no server needed):**
- Add a test button in a temporary SwiftUI view
- On tap, fire each pattern type sequentially with 1s delays
- Verify each feels distinct on a real iPhone

**Claude Code prompt for Datuna:**
> "Build a Core Haptics system for a SwiftUI app. Create HapticEvent.swift (Codable struct with timestamp, event_type, intensity, duration, label). Create HapticEngine.swift wrapping CHHapticEngine with lifecycle management (resetHandler, stoppedHandler). Create HapticPatterns.swift with 4 static pattern factories: bassHit (continuous, low sharpness), rhythmTap (transient, medium sharpness), alertSnap (transient, max sharpness), sustained (continuous with fade). Include a playEvent method that routes by event_type."

---

### Samuel (MacBook): iOS Networking + QR + UI
**Branch:** `feat/ios-networking`
**Files:** `HapticSenseApp.swift`, `ContentView.swift`, `Views/QRScannerView.swift`, `Network/SocketManager.swift`

**What to build:**
1. `SocketManager.swift` — Socket.IO client:
   - Connect to URL extracted from QR code
   - Config: `.forceWebsockets(true)`, `.reconnects(true)`
   - Listen for `"haptic"` event, decode to `HapticEvent`, publish via `@Published`
   - Emit `"register-phone"` on connect to join phones room
   - Publish connection state as `@Published var isConnected: Bool`
2. `QRScannerView.swift` — UIViewRepresentable wrapping AVCaptureSession:
   - Camera preview + QR code detection
   - Extract URL string from QR metadata
   - Call completion handler with URL
3. `ContentView.swift` — main UI:
   - "Scan QR" button → presents QRScannerView
   - Connection status indicator (green/red dot)
   - Pulsing circle that animates on each haptic event
   - Fallback: text field for manual IP entry
4. `HapticSenseApp.swift`:
   - `@main` app entry, manage `scenePhase` for background/foreground

**How to test independently (no server needed):**
- Mock the SocketManager with a timer that fires fake HapticEvents every 2 seconds
- Verify QR scanner opens camera and reads codes (use any QR code)
- Verify UI updates correctly

**Claude Code prompt for Samuel:**
> "Build the iOS networking and UI layer for a SwiftUI haptic feedback app. Create SocketManager.swift using Socket.IO-Client-Swift that connects to a URL from QR code, listens for 'haptic' events, and publishes HapticEvent objects. Create QRScannerView.swift using AVFoundation to scan QR codes and extract URLs. Create ContentView.swift with a scan button, connection status dot, pulsing circle animation, and manual IP fallback. Handle background/foreground lifecycle in HapticSenseApp.swift."

---

## Architecture: Data Flow

```
YouTube in Browser → WebAudio API captures audio stream
       ↓
  AnalyserNode runs FFT (1024 bins, ~60fps)
       ↓
  Frequency band classifier (sub-bass / bass / mids / highs / presence)
       ↓
  Event detector: "bass_hit", "rhythm_tap", "alert_snap", "sustained"
       ↓
  Socket.IO emit('haptic', { timestamp, event_type, intensity, duration, label })
       ↓  <15ms over local WiFi
  Server relays to all phones in 'phones' room
       ↓
  iPhone pattern-matches event_type → fires pre-built CHHapticPattern
       ↓
  User feels the music
```

**Total expected latency: <50ms**

### Frequency Bands

| Band | Range | Bins (44.1kHz, 2048 FFT) | Musical Source |
|------|-------|--------------------------|---------------|
| Sub-bass | 20-80 Hz | 0-3 | Kick drums, bass drops |
| Bass | 80-250 Hz | 3-11 | Bass guitar, low synths |
| Mids | 250-2,000 Hz | 11-93 | Vocals, guitars, rhythmic patterns |
| Highs | 2,000-8,000 Hz | 93-372 | Hi-hats, cymbals, snares |
| Presence | 8,000+ Hz | 372+ | Sibilance, air, transients |

---

## Prerequisites

### Fix Node.js PATH (Mac team members only)
```bash
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

### Windows team (Fiona & Alexia)
Install Node.js from https://nodejs.org if not already installed.

No BlackHole needed — WebAudio API handles everything in the browser.

---

## First 3 Terminal Commands

```bash
# 1. Create project structure + init npm
mkdir -p server/src/{analysis,broadcast,public} && \
  cd server && npm init -y

# 2. Install all dependencies
cd server && \
  npm install socket.io express qrcode && \
  npm install -D typescript @types/node @types/express @types/qrcode tsx

# 3. Initialize TypeScript
cd server && npx tsc --init --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --outDir dist --rootDir src \
  --strict true --esModuleInterop true
```

Then: create iOS project in Xcode (File > New > Project > iOS > App, "HapticSense", SwiftUI, save to `ios/`). Add Socket.IO-Client-Swift via SPM: `https://github.com/socketio/socket.io-client-swift`.

---

## NPM Packages
| Package | Purpose |
|---------|---------|
| `socket.io` | WebSocket server for haptic event relay |
| `express` | HTTP server, serves web dashboard + QR endpoint |
| `qrcode` | Generate QR code image for iPhone pairing |
| `tsx` (dev) | Run TypeScript directly |

## Swift Packages (SPM)
| Package | Purpose |
|---------|---------|
| `Socket.IO-Client-Swift` | Connect to server, receive haptic events |
| CoreHaptics (system) | Drive Taptic Engine |
| AVFoundation (system) | QR code scanning |

---

## Hourly Milestones

### Phase 1: Scaffolding (Hour 0-1)
- Fiona: push shared structure to main (types.ts, package.json, empty placeholder files)
- Everyone: `git pull origin main`, create feature branches, start coding
- Samuel & Datuna: one of them creates the Xcode project on main first, pushes, then both branch

### Phase 2: Independent Build (Hours 1-4)
- **Hour 1-2**: Server accepts Socket.IO connections (Fiona). FFT data flowing in browser (Alexia). Haptic engine fires test taps (Datuna). QR scanner opens camera (Samuel).
- **Hour 2-3**: Server relays events between rooms (Fiona). Frequency bands classified (Alexia, with Datuna's input on thresholds). All 4 haptic patterns feel distinct (Datuna). Socket.IO client connects to hardcoded URL (Samuel).
- **Hour 3-4**: QR code endpoint works (Fiona). Event detection producing real events from music (Alexia). Pattern intensity scales correctly (Datuna). QR scan -> connect flow works (Samuel).

### Phase 3: Integration (Hours 4-6)
- **Hour 4-5**: Merge Fiona's PR first. Then Alexia's. Test: dashboard -> server -> console.
- **Hour 5-6**: Merge Datuna + Samuel's PRs. **First end-to-end demo**: play music -> phone vibrates.

### Phase 4: Tuning (Hours 6-10)
- **Datuna leads tuning** — plays different songs, adjusts thresholds in Alexia's code, refines haptic patterns in his own code
- All 4 people test together: play different genres, feel the phone, iterate
- This is where the demo goes from "works" to "wow"

### Phase 5: Polish + Demo Prep (Hours 10-16)
- Hours 10-12: Error handling, multi-client testing, UI polish
- Hours 12-14: Pick demo song, perfect thresholds, README, slides
- Hours 14-16: Buffer, rehearsal, final bug fixes

---

## Error Handling
- **No microphone permission**: Show clear instructions in dashboard
- **Haptics unsupported**: Show message, still display visual beat indicator
- **Connection drop**: Socket.IO auto-reconnects; red dot in UI
- **Camera denied**: Fallback to manual IP text field
- **Background/foreground**: Stop haptic engine on background, restart on active

---

## Verification Plan
1. **Audio capture**: Dashboard shows FFT bars moving with music
2. **Event detection**: Console logs events matching the beat
3. **QR pairing**: Scan QR on dashboard -> iPhone connects (green dot)
4. **End-to-end**: Play music -> iPhone vibrates on beats
5. **Pattern distinction**: Bass = rumble, tap = crisp tap, snap = sharp, sustained = long pulse
6. **Latency**: Should feel near-instant (<50ms)
7. **Genre test**: EDM, hip-hop, rock, classical
