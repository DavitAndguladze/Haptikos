'use strict';

// ─── Band definitions ─────────────────────────────────────────────────────────
// Bin math: 44.1 kHz, fftSize 2048 → 1024 usable bins, ~21.5 Hz/bin.
// Must stay in sync with server/src/analysis/frequency-bands.ts.
const BANDS = [
  { name: 'Sub-bass', start: 0,   end: 3    },
  { name: 'Bass',     start: 3,   end: 11   },
  { name: 'Mids',     start: 11,  end: 93   },
  { name: 'Highs',    start: 93,  end: 372  },
  { name: 'Presence', start: 372, end: 1024 },
];

// ─── Radial visualizer constants ──────────────────────────────────────────────
const NUM_SPOKES    = 180;  // evenly spaced around 360°
const INNER_RADIUS  = 80;   // hollow centre, px
const MAX_SPOKE_LEN = 150;  // maximum spoke length at full energy, px
const SMOOTH_WIN    = 2;    // ±2 neighbours → moving-average window of 5

// Pre-compute which FFT bin each spoke samples and what colour it gets.
// Colour mapping matches the spec's three-zone scheme:
//   sub-bass + bass → orange  |  mids → magenta  |  highs + presence → cyan
const SPOKE_BINS   = new Uint16Array(NUM_SPOKES);
const SPOKE_COLORS = new Array(NUM_SPOKES);

for (let i = 0; i < NUM_SPOKES; i++) {
  const bin        = Math.min(Math.round(i * 1024 / NUM_SPOKES), 1023);
  SPOKE_BINS[i]    = bin;
  SPOKE_COLORS[i]  = bin < 11  ? '#FF6B2B'   // sub-bass + bass  → orange
                   : bin < 93  ? '#FF2D78'   // mids              → magenta
                   :             '#00F0FF';  // highs + presence  → cyan
}

// Per-frame scratch buffers — allocated once to avoid GC pressure at 60 fps.
const _raw      = new Float32Array(NUM_SPOKES);
const _smoothed = new Float32Array(NUM_SPOKES);
const _innerLen = new Float32Array(NUM_SPOKES);

// ─── Band analyzer ────────────────────────────────────────────────────────────
// JS port of server/src/analysis/frequency-bands.ts — must stay in sync.
function analyzeBands(fftData) {
  function avg(start, end) {
    const cap = Math.min(end, fftData.length);
    if (cap <= start) return 0;
    let sum = 0;
    for (let i = start; i < cap; i++) sum += fftData[i];
    return sum / (cap - start) / 255;
  }
  return {
    subBass:  avg(0,   3),
    bass:     avg(3,   11),
    mids:     avg(11,  93),
    highs:    avg(93,  372),
    presence: avg(372, 1024),
  };
}

// ─── EventDetector ────────────────────────────────────────────────────────────
// JS port of server/src/analysis/event-detector.ts — must stay in sync.
// Datuna: tune thresholds in DETECTOR_CONFIG during integration.
const DETECTOR_CONFIG = {
  bassFluxThreshold:  0.15,
  midsFluxThreshold:  0.12,
  highsFluxThreshold: 0.18,
  dynamicMultiplier:  2.0,
  minEnergy:          0.08,
  sustainedThreshold: 0.35,
  sustainedDuration:  200,   // ms
  cooldowns: { bass_hit: 150, rhythm_tap: 100, alert_snap: 100, sustained: 300 },
};

class EventDetector {
  constructor() {
    this._cfg            = DETECTOR_CONFIG;
    this._prev           = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._means          = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._lastFired      = { bass_hit: 0, rhythm_tap: 0, alert_snap: 0, sustained: 0 };
    this._sustainedSince = {};
  }

  detect(bands) {
    const now    = Date.now();
    const events = [];
    const cfg    = this._cfg;

    // Positive spectral flux — only rising edges trigger events.
    const flux = {
      subBass:  Math.max(0, bands.subBass  - this._prev.subBass),
      bass:     Math.max(0, bands.bass     - this._prev.bass),
      mids:     Math.max(0, bands.mids     - this._prev.mids),
      highs:    Math.max(0, bands.highs    - this._prev.highs),
      presence: Math.max(0, bands.presence - this._prev.presence),
    };

    // Update per-band EMA (α = 0.97 ≈ 1 s window at 60 fps).
    const α = 0.97;
    for (const k of Object.keys(this._means)) {
      this._means[k] = α * this._means[k] + (1 - α) * bands[k];
    }

    const canFire = (type) => now - this._lastFired[type] >= cfg.cooldowns[type];
    const clamp   = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
    const dynT    = (base, mean) => Math.max(base, mean * cfg.dynamicMultiplier);

    const fire = (type, intensity, duration, label) => {
      this._lastFired[type] = now;
      events.push({ timestamp: now, event_type: type, intensity: clamp(intensity, 0, 1), duration, label });
    };

    // Rule 1 — bass_hit
    if (canFire('bass_hit')) {
      if (flux.subBass > dynT(cfg.bassFluxThreshold, this._means.subBass) && bands.subBass > cfg.minEnergy) {
        fire('bass_hit', clamp(flux.subBass / 0.4, 0, 1), 150, 'Kick drum');
      } else if (flux.bass > dynT(cfg.bassFluxThreshold, this._means.bass) && bands.bass > cfg.minEnergy) {
        fire('bass_hit', clamp(flux.bass / 0.4, 0, 1), 150, 'Bass note');
      }
    }

    // Rule 2 — rhythm_tap
    if (canFire('rhythm_tap')) {
      if (flux.mids > dynT(cfg.midsFluxThreshold, this._means.mids) && bands.mids > cfg.minEnergy) {
        fire('rhythm_tap', clamp(flux.mids / 0.35, 0, 1), 80, 'Rhythm hit');
      }
    }

    // Rule 3 — alert_snap
    if (canFire('alert_snap')) {
      if (flux.highs > dynT(cfg.highsFluxThreshold, this._means.highs) && bands.highs > cfg.minEnergy) {
        fire('alert_snap', clamp(flux.highs / 0.45, 0, 1), 50, 'Snare hit');
      } else if (flux.presence > dynT(cfg.highsFluxThreshold, this._means.presence) && bands.presence > cfg.minEnergy) {
        fire('alert_snap', clamp(flux.presence / 0.45, 0, 1), 50, 'Cymbal snap');
      }
    }

    // Rule 4 — sustained
    if (canFire('sustained')) {
      const sustainedBands = [
        ['subBass',  'Deep sustain'],
        ['bass',     'Bass note'],
        ['mids',     'Sustained tone'],
        ['highs',    'High sustain'],
        ['presence', 'Airy sustain'],
      ];
      for (const [band, label] of sustainedBands) {
        if (bands[band] > cfg.sustainedThreshold) {
          if (this._sustainedSince[band] === undefined) {
            this._sustainedSince[band] = now;
          } else if (now - this._sustainedSince[band] >= cfg.sustainedDuration) {
            fire('sustained', clamp(bands[band] * 1.1, 0, 1), 400, label);
            delete this._sustainedSince[band];
            break;
          }
        } else {
          delete this._sustainedSince[band];
        }
      }
    } else {
      this._sustainedSince = {};
    }

    this._prev = { ...bands };
    return events;
  }

  reset() {
    this._prev           = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._means          = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._sustainedSince = {};
    this._lastFired      = { bass_hit: 0, rhythm_tap: 0, alert_snap: 0, sustained: 0 };
  }
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('visualizer');
const ctx         = canvas.getContext('2d');
const startBtn    = document.getElementById('startBtn');
const statusLine  = document.getElementById('statusLine');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const eventLog    = document.getElementById('eventLog');
const phonesCount = document.getElementById('phonesCount');

// ─── Audio state ──────────────────────────────────────────────────────────────
let audioCtx    = null;
let analyser    = null;
let dataArray   = null;
let animationId = null;
let stream      = null;
let isListening = false;

const detector  = new EventDetector(); // singleton — reset() when stream stops

// ─── Canvas setup ─────────────────────────────────────────────────────────────
function setupCanvas() {
  const dpr  = window.devicePixelRatio || 1;
  const size = Math.min(500, window.innerWidth - 60);
  // Set CSS size (layout dimensions) separately from pixel buffer size.
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width  = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.scale(dpr, dpr);
}

// CSS size in logical pixels — what we use for all coordinate math.
function cssSize() {
  return parseFloat(canvas.style.width) || 500;
}

// ─── Radial visualizer ────────────────────────────────────────────────────────

function computeSpokes(fftData) {
  // Map each spoke to a raw length from the corresponding FFT bin.
  for (let i = 0; i < NUM_SPOKES; i++) {
    _raw[i] = (fftData[SPOKE_BINS[i]] / 255) * MAX_SPOKE_LEN;
  }
  // Moving-average smoothing so the shape looks organic rather than jagged.
  for (let i = 0; i < NUM_SPOKES; i++) {
    let sum = 0;
    for (let d = -SMOOTH_WIN; d <= SMOOTH_WIN; d++) {
      sum += _raw[(i + d + NUM_SPOKES) % NUM_SPOKES];
    }
    _smoothed[i] = sum / (2 * SMOOTH_WIN + 1);
  }
}

/**
 * Draw one ring of spokes.
 * Batches consecutive same-colour spokes to minimise ctx state changes.
 */
function drawRing(cx, cy, innerR, lengths, alpha, shadowBlur) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth   = 2;
  let lastColor   = null;

  for (let i = 0; i < NUM_SPOKES; i++) {
    const color = SPOKE_COLORS[i];
    if (color !== lastColor) {
      ctx.shadowBlur  = shadowBlur;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      lastColor = color;
    }
    const angle = (i / NUM_SPOKES) * Math.PI * 2 - Math.PI / 2;
    const len   = lengths[i];
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx + innerR        * cos, cy + innerR        * sin);
    ctx.lineTo(cx + (innerR + len) * cos, cy + (innerR + len) * sin);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRadial(fftData) {
  const size = cssSize();
  const cx   = size / 2;
  const cy   = size / 2;

  ctx.clearRect(0, 0, size, size);
  computeSpokes(fftData);

  // Outer ring — full opacity, full glow.
  drawRing(cx, cy, INNER_RADIUS, _smoothed, 1.0, 15);

  // Inner ring — 60% scale, 50% opacity, softer glow. Creates depth.
  for (let i = 0; i < NUM_SPOKES; i++) _innerLen[i] = _smoothed[i] * 0.6;
  drawRing(cx, cy, INNER_RADIUS * 0.6, _innerLen, 0.5, 8);
}

function drawIdle() {
  const size = cssSize();
  const cx   = size / 2;
  const cy   = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Calm resting state: a perfect ring of short, dim spokes.
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.lineWidth   = 2;
  ctx.shadowBlur  = 0;

  for (let i = 0; i < NUM_SPOKES; i++) {
    const angle = (i / NUM_SPOKES) * Math.PI * 2 - Math.PI / 2;
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);
    ctx.strokeStyle = SPOKE_COLORS[i];
    ctx.beginPath();
    ctx.moveTo(cx + INNER_RADIUS        * cos, cy + INNER_RADIUS        * sin);
    ctx.lineTo(cx + (INNER_RADIUS + 8)  * cos, cy + (INNER_RADIUS + 8)  * sin);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Main render loop ─────────────────────────────────────────────────────────
function drawFrame() {
  analyser.getByteFrequencyData(dataArray);

  // Detection runs in the same frame so the event log updates immediately.
  const bands  = analyzeBands(dataArray);
  const events = detector.detect(bands);
  for (const ev of events) {
    addEvent(ev);
    console.debug('[IHear]', ev.event_type, ev.label, `intensity=${ev.intensity.toFixed(2)}`);
  }

  drawRadial(dataArray);
  animationId = requestAnimationFrame(drawFrame);
}

// ─── Microphone control ───────────────────────────────────────────────────────
async function startListening() {
  try {
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize               = 2048;
    analyser.smoothingTimeConstant = 0.8;

    audioCtx.createMediaStreamSource(stream).connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount); // 1024 elements

    isListening = true;
    startBtn.textContent = 'Stop Listening';
    startBtn.classList.add('btn--active');
    statusDot.className  = 'dot dot--active';
    statusText.textContent = 'Microphone Active';
    statusLine.classList.add('status--active');

    animationId = requestAnimationFrame(drawFrame);
  } catch (err) {
    console.error('[IHear] Microphone error:', err);
    statusDot.className    = 'dot dot--error';
    statusText.textContent = `Mic error: ${err.message}`;
  }
}

function stopListening() {
  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
  if (stream)      { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx)    { audioCtx.close(); audioCtx = null; analyser = null; dataArray = null; }

  isListening = false;
  detector.reset();

  startBtn.textContent   = 'Start Listening';
  startBtn.classList.remove('btn--active');
  statusDot.className    = 'dot dot--idle';
  statusText.textContent = 'Microphone Inactive';
  statusLine.classList.remove('status--active');

  drawIdle();
}

startBtn.addEventListener('click', () => {
  if (isListening) stopListening();
  else startListening();
});

// ─── Event log ────────────────────────────────────────────────────────────────
// Called by the detector loop above, and also exposed for the Socket.IO layer
// (Fiona's sprint) via window.IHear.addEvent.
const MAX_LOG_ENTRIES = 10;

/**
 * Append one detected event to the on-screen log.
 * Shape matches the HapticEvent interface from server/src/types.ts.
 */
function addEvent(event) {
  const placeholder = eventLog.querySelector('.log-empty');
  if (placeholder) placeholder.remove();

  const li = document.createElement('li');
  li.className = 'log-entry';

  const time = new Date(event.timestamp).toLocaleTimeString([], { hour12: false });

  // Sanitise label before injecting — no user-controlled data, but good practice.
  const label = String(event.label).replace(/</g, '&lt;');
  li.innerHTML = `
    <span class="log-dot log-dot--${event.event_type}"></span>
    <span class="log-label">${label}</span>
    <span class="log-time">${time}</span>
  `.trim();

  eventLog.prepend(li);

  const items = eventLog.querySelectorAll('.log-entry');
  if (items.length > MAX_LOG_ENTRIES) items[items.length - 1].remove();
}

// Expose for Socket.IO layer (Fiona's sprint) and phone-count updates.
window.IHear = {
  addEvent,
  setPhoneCount(n) {
    document.getElementById('phoneCount').textContent = n;
    phonesCount.classList.toggle('has-phones', n > 0);
  },
};

// ─── Init ─────────────────────────────────────────────────────────────────────
setupCanvas();
drawIdle();

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    setupCanvas();
    if (!isListening) drawIdle();
  }, 100);
});
