'use strict';

// ─── Frequency band definitions ──────────────────────────────────────────────
// Bin math: 44.1 kHz sample rate, fftSize 2048 → 1024 usable bins,
// each bin covers 44100 / 2048 ≈ 21.5 Hz.
// These boundaries must stay in sync with frequency-bands.ts on the server.
const BANDS = [
  { name: 'Sub-bass', start: 0,   end: 3,    color: '#9b59b6' },
  { name: 'Bass',     start: 3,   end: 11,   color: '#3498db' },
  { name: 'Mids',     start: 11,  end: 93,   color: '#2ecc71' },
  { name: 'Highs',    start: 93,  end: 372,  color: '#f39c12' },
  { name: 'Presence', start: 372, end: 1024, color: '#e74c3c' },
];

// Pre-build a lookup array so getBandColor() is O(1) at 60 fps.
const BIN_COLOR_LUT = new Array(1024);
for (const band of BANDS) {
  for (let i = band.start; i < band.end; i++) {
    BIN_COLOR_LUT[i] = band.color;
  }
}

// ─── Band analyzer (JS port of frequency-bands.ts) ───────────────────────────
// Must stay in sync with server/src/analysis/frequency-bands.ts.
function analyzeBands(fftData) {
  function avg(start, end) {
    const actualEnd = Math.min(end, fftData.length);
    if (actualEnd <= start) return 0;
    let sum = 0;
    for (let i = start; i < actualEnd; i++) sum += fftData[i];
    return sum / (actualEnd - start) / 255;
  }
  return {
    subBass:  avg(0,   3),
    bass:     avg(3,   11),
    mids:     avg(11,  93),
    highs:    avg(93,  372),
    presence: avg(372, 1024),
  };
}

// ─── EventDetector (JS port of event-detector.ts) ────────────────────────────
// Must stay in sync with server/src/analysis/event-detector.ts.
// Tunable thresholds — Datuna: adjust these during integration.
const DETECTOR_CONFIG = {
  bassFluxThreshold:  0.15,
  midsFluxThreshold:  0.12,
  highsFluxThreshold: 0.18,
  dynamicMultiplier:  2.0,
  minEnergy:          0.08,
  sustainedThreshold: 0.35,
  sustainedDuration:  200,  // ms
  cooldowns: { bass_hit: 150, rhythm_tap: 100, alert_snap: 100, sustained: 300 },
};

class EventDetector {
  constructor() {
    this._cfg           = DETECTOR_CONFIG;
    this._prev          = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._means         = { subBass: 0, bass: 0, mids: 0, highs: 0, presence: 0 };
    this._lastFired     = { bass_hit: 0, rhythm_tap: 0, alert_snap: 0, sustained: 0 };
    this._sustainedSince = {};
  }

  detect(bands) {
    const now    = Date.now();
    const events = [];
    const cfg    = this._cfg;

    // Positive spectral flux — only rising edges matter.
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

    // Rule 4 — sustained (band held above threshold for >sustainedDuration ms)
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

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('visualizer');
const ctx         = canvas.getContext('2d');
const startBtn    = document.getElementById('startBtn');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const eventLog    = document.getElementById('eventLog');
const phoneCount  = document.getElementById('phoneCount');
// phoneCount and the plural span are updated by Socket.IO in a later sprint.

// ─── Audio state ─────────────────────────────────────────────────────────────
let audioCtx      = null;
let analyser      = null;
let dataArray     = null;  // Uint8Array — reused every frame to avoid GC pressure
let animationId   = null;
let stream        = null;
let isListening   = false;

const detector = new EventDetector(); // singleton — reset() on stream stop

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function resizeCanvas() {
  // Match the CSS layout size so bars don't blur on HiDPI screens.
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.scale(dpr, dpr);
}

function drawIdle() {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, w, h);

  // Dim, flat placeholder bars so the layout doesn't feel empty.
  const binCount = 1024;
  const barW = w / binCount;
  for (let i = 0; i < binCount; i++) {
    ctx.fillStyle = BIN_COLOR_LUT[i] + '22'; // ~13% opacity
    ctx.fillRect(i * barW, h - 4, Math.max(barW - 0.5, 0.5), 4);
  }
}

// ─── Main render loop ─────────────────────────────────────────────────────────
function drawBars() {
  analyser.getByteFrequencyData(dataArray);

  // Run event detection before drawing so the log updates in the same frame.
  const bands  = analyzeBands(dataArray);
  const events = detector.detect(bands);
  for (const ev of events) {
    addEvent(ev);
    console.debug('[IHear]', ev.event_type, ev.label, `intensity=${ev.intensity.toFixed(2)}`);
  }

  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const binCount = dataArray.length; // 1024

  ctx.clearRect(0, 0, w, h);

  const barW = w / binCount;

  for (let i = 0; i < binCount; i++) {
    const norm      = dataArray[i] / 255;        // 0 – 1
    const barHeight = norm * h;
    const x         = i * barW;
    const y         = h - barHeight;

    ctx.fillStyle = BIN_COLOR_LUT[i];
    ctx.fillRect(x, y, Math.max(barW - 0.5, 0.5), barHeight);
  }

  // Subtle vertical separator lines between bands.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  for (const band of BANDS) {
    const x = (band.start / binCount) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  animationId = requestAnimationFrame(drawBars);
}

// ─── Microphone control ───────────────────────────────────────────────────────
async function startListening() {
  try {
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();

    analyser.fftSize              = 2048;
    analyser.smoothingTimeConstant = 0.8; // 0 = no smoothing, 1 = max (sluggish)

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    dataArray = new Uint8Array(analyser.frequencyBinCount); // 1024 elements

    isListening = true;
    startBtn.textContent = 'Stop Listening';
    startBtn.classList.add('btn--active');
    statusDot.className  = 'dot dot--active';
    statusText.textContent = 'Listening\u2026';

    // Kick off the render loop.
    animationId = requestAnimationFrame(drawBars);
  } catch (err) {
    console.error('[IHear] Microphone error:', err);
    statusDot.className    = 'dot dot--error';
    statusText.textContent = `Mic error: ${err.message}`;
  }
}

function stopListening() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
    analyser  = null;
    dataArray = null;
  }

  isListening = false;
  detector.reset(); // clear EMA / cooldown state so next session starts clean
  startBtn.textContent   = 'Start Listening';
  startBtn.classList.remove('btn--active');
  statusDot.className    = 'dot dot--idle';
  statusText.textContent = 'Microphone inactive';
  drawIdle();
}

startBtn.addEventListener('click', () => {
  if (isListening) stopListening();
  else startListening();
});

// ─── Event log ────────────────────────────────────────────────────────────────
// addEvent() will be called by the Socket.IO layer (added in a later sprint).
// It accepts a HapticEvent-shaped object as defined in types.ts.
const MAX_LOG_ENTRIES = 10;

/**
 * Append a detected event to the on-screen log.
 * Matches the HapticEvent interface from server/src/types.ts.
 *
 * @param {object} event
 * @param {number} event.timestamp
 * @param {string} event.event_type  'bass_hit' | 'rhythm_tap' | 'alert_snap' | 'sustained'
 * @param {number} event.intensity   0.0 – 1.0
 * @param {number} event.duration    milliseconds
 * @param {string} event.label       human-readable description
 */
function addEvent(event) {
  // Remove the placeholder if present.
  const placeholder = eventLog.querySelector('.event-log__empty');
  if (placeholder) placeholder.remove();

  const li = document.createElement('li');
  li.className = `event-log__item event-log__item--${event.event_type}`;

  const time = new Date(event.timestamp).toLocaleTimeString([], { hour12: false });

  li.innerHTML = `
    <span class="event-log__label">${event.label}</span>
    <span class="event-log__meta">
      ${event.event_type} &middot;
      intensity ${(event.intensity * 100).toFixed(0)}% &middot;
      ${event.duration}ms &middot;
      ${time}
    </span>
  `.trim();

  eventLog.prepend(li);

  // Keep only the last MAX_LOG_ENTRIES items.
  const items = eventLog.querySelectorAll('.event-log__item');
  if (items.length > MAX_LOG_ENTRIES) {
    items[items.length - 1].remove();
  }
}

// Expose for the Socket.IO layer (added in the next sprint).
window.IHear = { addEvent };

// ─── Init ─────────────────────────────────────────────────────────────────────
// Resize once now, then re-size on window resize (debounced).
resizeCanvas();
drawIdle();

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeCanvas();
    if (!isListening) drawIdle();
  }, 100);
});
