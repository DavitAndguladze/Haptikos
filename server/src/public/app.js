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
const NUM_SPOKES     = 144;  // per ring — 4 rings × 144 spokes = 576 lines/frame
const INNER_RADIUS   = 30;   // starting radius of the innermost ring, px (at 550 ref)
const MIN_THICKNESS  = 2;    // paper-thin minimum when a band is silent, px
const MAX_THICKNESS  = 90;   // maximum spoke length at full energy, px
const DOMINANT_BONUS = 2.2;  // dominant band expands dramatically, pushing outer rings out

// Ring config — 4 concentric layers, innermost to outermost.
// Base radii are computed dynamically each frame via zero-gap stacking.
const RING_CONFIG = [
  { name: 'subBass', color: '#1A2FCC', r: 26,  g: 47,  b: 204 }, // Deep Blue   — innermost
  { name: 'bass',    color: '#00C9B1', r: 0,   g: 201, b: 177 }, // Teal
  { name: 'mids',    color: '#FF5A5F', r: 255, g: 90,  b: 95  }, // Coral
  { name: 'highs',   color: '#FFD700', r: 255, g: 215, b: 0   }, // Bright Gold — outermost
];

// Animation time reference for wobble motion.
const _startTime = performance.now();

// Per-ring temporal smoothing state — allocated once to avoid GC pressure.
const _ringPrev = {};
for (const ring of RING_CONFIG) {
  _ringPrev[ring.name] = new Float32Array(NUM_SPOKES);
}

// Scratch buffers for per-ring spoke computation (reused across rings each frame).
const _spokeLengths  = new Float32Array(NUM_SPOKES);
const _spokeSmoothed = new Float32Array(NUM_SPOKES);

// Responsive scale factor — updated in setupCanvas(), read when drawing rings.
let _scale = 1;

// Previous frame layout for temporal smoothing of base radii and thicknesses.
let _previousLayout = null;

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
  const size = Math.min(550, window.innerWidth - 60);
  // Set CSS size (layout dimensions) separately from pixel buffer size.
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width  = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.scale(dpr, dpr);
  _scale = size / 550; // scale all ring radii/lengths relative to the 550px reference
}

// CSS size in logical pixels — what we use for all coordinate math.
function cssSize() {
  return parseFloat(canvas.style.width) || 500;
}

// ─── Radial visualizer ────────────────────────────────────────────────────────

// Compute dynamic ring layout: stacked with no gaps.
// Each ring's base radius is where the previous ring's average spoke length ended.
function computeRingLayout(bands, dominantName) {
  const layout        = [];
  let   currentRadius = INNER_RADIUS * _scale;
  const minPx         = MIN_THICKNESS * _scale;
  const maxPx         = MAX_THICKNESS * _scale;

  for (const ring of RING_CONFIG) {
    let energy = Math.pow(bands[ring.name] || 0, 0.5); // power curve

    const isDominant = ring.name === dominantName && energy > 0.05;
    if (isDominant) energy = Math.min(1.0, energy * DOMINANT_BONUS);

    const avgThick = minPx + energy * (maxPx - minPx);

    layout.push({
      name:         ring.name,
      color:        ring.color,
      r:            ring.r,
      g:            ring.g,
      b:            ring.b,
      baseRadius:   currentRadius,
      avgThickness: avgThick,
      energy:       energy,
    });

    currentRadius += avgThick; // next ring starts right here — no gap
  }

  return layout;
}

// Draw one ring using its computed layout (dynamic baseRadius + avgThickness).
function drawRing(cx, cy, ringLayout, time) {
  const { name, color, r, g, b, baseRadius, avgThickness, energy } = ringLayout;

  const minPx        = MIN_THICKNESS * _scale;
  const wobbleAmount = energy * avgThickness * 0.5;

  // Build raw per-spoke lengths with organic wobble.
  for (let i = 0; i < NUM_SPOKES; i++) {
    let length = avgThickness;
    length += Math.sin(i * 0.15 + time * 2.5)       * wobbleAmount * 0.50;
    length += Math.sin(i * 0.40 + time * 4.0 + 1.5) * wobbleAmount * 0.35;
    length += Math.sin(i * 0.90 + time * 6.0 + 3.0) * wobbleAmount * 0.25;
    length += Math.sin(i * 1.70 + i * i * 0.01)     * wobbleAmount * 0.15; // per-spoke noise
    _spokeLengths[i] = Math.max(minPx, Math.min(MAX_THICKNESS * _scale * 1.5, length));
  }

  // Spatial smoothing — ±2 neighbours, wrapping at seam.
  for (let i = 0; i < NUM_SPOKES; i++) {
    let sum = 0;
    for (let d = -2; d <= 2; d++) sum += _spokeLengths[(i + d + NUM_SPOKES) % NUM_SPOKES];
    _spokeSmoothed[i] = sum / 5;
  }

  // Temporal smoothing — 40% previous, 60% current.
  const prev = _ringPrev[name];
  for (let i = 0; i < NUM_SPOKES; i++) {
    _spokeSmoothed[i] = prev[i] * 0.4 + _spokeSmoothed[i] * 0.6;
    prev[i]           = _spokeSmoothed[i];
  }

  const brightness = 0.2 + energy * 0.8; // wide range: barely-visible (0.2) when silent → full (1.0) when loud

  ctx.save();
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.strokeStyle = color;
  ctx.shadowBlur  = energy > 0.1 ? 10 : 0;
  ctx.shadowColor = `rgba(${r},${g},${b},0.5)`;
  ctx.globalAlpha = brightness;

  for (let i = 0; i < NUM_SPOKES; i++) {
    const angle = (i / NUM_SPOKES) * Math.PI * 2 - Math.PI / 2;
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(cx + baseRadius                       * cos, cy + baseRadius                       * sin);
    ctx.lineTo(cx + (baseRadius + _spokeSmoothed[i]) * cos, cy + (baseRadius + _spokeSmoothed[i]) * sin);
    ctx.stroke();
  }

  ctx.restore();
}

// bands is passed in from drawFrame to avoid recomputing what the detector already has.
function drawRadial(fftData, bands) {
  const size = cssSize();
  const cx   = size / 2;
  const cy   = size / 2;

  ctx.clearRect(0, 0, size, size);

  const time = (performance.now() - _startTime) / 1000;

  // Find dominant band.
  let dominantName   = 'subBass';
  let dominantEnergy = 0;
  for (const key of ['subBass', 'bass', 'mids', 'highs']) {
    if (bands[key] > dominantEnergy) { dominantEnergy = bands[key]; dominantName = key; }
  }

  // Compute dynamic stacked layout.
  const layout = computeRingLayout(bands, dominantName);

  // Smooth base radii and thicknesses so rings slide rather than jump.
  if (_previousLayout) {
    for (let i = 0; i < layout.length; i++) {
      layout[i].baseRadius   = _previousLayout[i].baseRadius   * 0.5 + layout[i].baseRadius   * 0.5;
      layout[i].avgThickness = _previousLayout[i].avgThickness * 0.4 + layout[i].avgThickness * 0.6;
    }
  }
  _previousLayout = layout.map(ring => ({ ...ring }));

  for (const ringLayout of layout) {
    drawRing(cx, cy, ringLayout, time);
  }
}

function drawIdle() {
  const size = cssSize();
  const cx   = size / 2;
  const cy   = size / 2;

  ctx.clearRect(0, 0, size, size);

  // All bands silent → all rings at MIN_THICKNESS, packed into a tight 15px cluster.
  ctx.save();
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 0.25;

  let currentRadius = INNER_RADIUS * _scale;
  const minPx       = MIN_THICKNESS * _scale;

  for (const ring of RING_CONFIG) {
    ctx.strokeStyle = ring.color;
    for (let i = 0; i < NUM_SPOKES; i++) {
      const angle = (i / NUM_SPOKES) * Math.PI * 2 - Math.PI / 2;
      const cos   = Math.cos(angle);
      const sin   = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(cx + currentRadius         * cos, cy + currentRadius         * sin);
      ctx.lineTo(cx + (currentRadius + minPx) * cos, cy + (currentRadius + minPx) * sin);
      ctx.stroke();
    }
    currentRadius += minPx; // stack with no gap
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

  drawRadial(dataArray, bands); // pass bands to avoid recomputing in drawRadial
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
  for (const ring of RINGS) _ringPrev[ring.name].fill(0); // clear temporal state

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
