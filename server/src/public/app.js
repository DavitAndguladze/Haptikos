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
const NUM_SPOKES     = 120;  // per ring — 5 rings × 120 spokes = 600 lines/frame
const INNER_RADIUS   = 40;   // starting radius of the innermost ring, px (at 550 ref)
const MIN_THICKNESS  = 3;    // minimum spoke length when a band is silent, px
const MAX_THICKNESS  = 60;   // maximum spoke length at full energy, px
const DOMINANT_BONUS = 1.4;  // dominant band gets 40% extra thickness

// Ring config — color only. Base radii are computed dynamically each frame.
const RING_CONFIG = [
  { name: 'subBass',  color: '#1B1B8F', r: 27,  g: 27,  b: 143 }, // innermost — dark blue
  { name: 'bass',     color: '#4DA6FF', r: 77,  g: 166, b: 255 }, // light blue
  { name: 'mids',     color: '#FF3355', r: 255, g: 51,  b: 85  }, // red
  { name: 'highs',    color: '#FF9F1C', r: 255, g: 159, b: 28  }, // orange
  { name: 'presence', color: '#FFD600', r: 255, g: 214, b: 0   }, // outermost — yellow
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
  cooldowns: { bass_hit: 80, rhythm_tap: 60, alert_snap: 60, sustained: 200 },
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
let audioCtx          = null;
let analyser          = null;
let dataArray         = null;
let animationId       = null;
let analysisIntervalId = null;  // used when tab is in background
let stream            = null;
let isListening       = false;
let _lastBands        = null;   // shared between analysis and draw loops

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

  const brightness = 0.25 + energy * 0.75; // dim (0.25) when quiet → full (1.0) when loud

  ctx.save();
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.strokeStyle = color;
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
  for (const key of ['subBass', 'bass', 'mids', 'highs', 'presence']) {
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

// ─── Analysis loop (runs always, even in background) ─────────────────────────
// Separated from the draw loop so Chrome's background-tab throttling of
// requestAnimationFrame doesn't stop haptic emission.
function runAnalysis() {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);
  _lastBands = analyzeBands(dataArray);
  const events = detector.detect(_lastBands);
  for (const ev of events) {
    addEvent(ev);
    emitHaptic(ev);
    console.debug('[IHear]', ev.event_type, ev.label, `intensity=${ev.intensity.toFixed(2)}`);
  }
}

// ─── Draw loop (requestAnimationFrame — paused when tab is hidden) ────────────
function drawFrame() {
  runAnalysis();
  if (_lastBands) drawRadial(dataArray, _lastBands);
  animationId = requestAnimationFrame(drawFrame);
}

// Switch between rAF (visible) and setInterval (background) so analysis
// keeps running even when the user switches to Spotify or another tab.
document.addEventListener('visibilitychange', () => {
  if (!isListening) return;
  if (document.hidden) {
    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    if (!analysisIntervalId) analysisIntervalId = setInterval(runAnalysis, 20);
  } else {
    if (analysisIntervalId) { clearInterval(analysisIntervalId); analysisIntervalId = null; }
    if (!animationId) animationId = requestAnimationFrame(drawFrame);
  }
});

// ─── Audio capture ────────────────────────────────────────────────────────────
async function startListening() {
  try {
    // Capture system audio via screen share so we hear the music playing on
    // the laptop rather than the built-in microphone.
    // Chrome requires video:true for getDisplayMedia to work; we stop the
    // video tracks immediately — only the audio track is used.
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach(t => t.stop());

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      statusDot.className    = 'dot dot--error';
      statusText.textContent = 'No audio track — check "Share system audio" in the picker';
      return;
    }

    audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 });
    analyser = audioCtx.createAnalyser();
    analyser.fftSize               = 2048;
    analyser.smoothingTimeConstant = 0.0;

    audioCtx.createMediaStreamSource(stream).connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount); // 1024 elements

    // If the user stops sharing via the browser's built-in "Stop sharing" button
    audioTracks[0].addEventListener('ended', () => { if (isListening) stopListening(); });

    isListening = true;
    startBtn.textContent   = 'Stop Listening';
    startBtn.classList.add('btn--active');
    statusDot.className    = 'dot dot--active';
    statusText.textContent = 'System Audio Active';
    statusLine.classList.add('status--active');

    animationId = requestAnimationFrame(drawFrame);
  } catch (err) {
    console.error('[IHear] Audio capture error:', err);
    statusDot.className    = 'dot dot--error';
    statusText.textContent = `Error: ${err.message}`;
  }
}

function stopListening() {
  if (animationId)        { cancelAnimationFrame(animationId); animationId = null; }
  if (analysisIntervalId) { clearInterval(analysisIntervalId); analysisIntervalId = null; }
  if (stream)             { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx)           { audioCtx.close(); audioCtx = null; analyser = null; dataArray = null; }
  _lastBands = null;

  isListening = false;
  detector.reset();
  for (const ring of RING_CONFIG) _ringPrev[ring.name].fill(0); // clear temporal state

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

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket'], query: { role: 'dashboard' } });

socket.on('connect', () => { console.log('[IHear] Socket connected'); });
socket.on('disconnect', () => { console.log('[IHear] Socket disconnected'); });
socket.on('phone-count', (n) => { window.IHear.setPhoneCount(n); });

// When a phone connects, measure round-trip latency for Spotify beat scheduling.
let networkLatencyMs = 30;  // conservative default until measured
socket.on('phone-connected', () => {
  const t0 = Date.now();
  socket.emit('ping-phone', t0);
});
socket.on('pong-phone', (t0) => {
  networkLatencyMs = Math.round((Date.now() - t0) / 2);
  console.log(`[IHear] Network latency: ${networkLatencyMs}ms`);
});

/**
 * Emit a detected haptic event to the server so it relays to all phones.
 * Called from the analysis loop (audio mode) and beat scheduler (Spotify mode).
 */
function emitHaptic(event) {
  if (socket.connected) socket.emit('haptic', event);
}

// ─── Spotify Beat Sync ────────────────────────────────────────────────────────
let _spotifyToken    = null;
let _spotifyTrackId  = null;
let _beatTimeouts    = [];
let _spotifySyncId   = null;   // setInterval for re-sync
let _spotifyMode     = false;

const spotifyTrackEl = document.getElementById('spotifyTrack');
const spotifyBtn     = document.getElementById('spotifyBtn');
const audioHintEl    = document.getElementById('audioHint');

/** Cancel all pending beat timeouts. */
function _clearBeatTimeouts() {
  _beatTimeouts.forEach(clearTimeout);
  _beatTimeouts = [];
}

/**
 * Schedule beats from Spotify's analysis relative to where the track is now.
 * @param {Array}  beats       - from audio-analysis response
 * @param {number} progressMs  - current track position in ms
 */
function _scheduleBeatWindow(beats, progressMs) {
  _clearBeatTimeouts();
  const refNow = Date.now();

  for (const beat of beats) {
    const beatAbsMs  = beat.start * 1000;               // beat position in track (ms)
    const fireInMs   = beatAbsMs - progressMs - networkLatencyMs;
    if (fireInMs < -50) continue;                        // already passed
    const delay      = Math.max(0, fireInMs);
    const confidence = Math.min(beat.confidence ?? 0.8, 1.0);
    const dur        = Math.round((beat.duration ?? 0.4) * 1000);

    const t = setTimeout(() => {
      emitHaptic({
        timestamp:  Date.now(),
        event_type: 'bass_hit',
        intensity:  Math.max(confidence, 0.5),           // floor so every beat registers
        duration:   dur,
        label:      'Beat',
      });
    }, delay);
    _beatTimeouts.push(t);
  }
  console.log(`[IHear] Scheduled ${_beatTimeouts.length} beats (latency=${networkLatencyMs}ms)`);
}

/** Poll Spotify + re-schedule beats every 3 seconds to correct clock drift. */
async function _spotifySyncTick(beats) {
  const player = await window.SpotifyAPI.getCurrentlyPlaying(_spotifyToken);
  if (!player || !player.is_playing) return;

  // Track changed — restart with new analysis.
  if (player.item?.id && player.item.id !== _spotifyTrackId) {
    stopSpotifySync();
    startSpotifySync();
    return;
  }

  _scheduleBeatWindow(beats, player.progress_ms);
}

async function startSpotifySync() {
  if (!_spotifyToken) return;

  statusDot.className    = 'dot dot--active';
  statusText.textContent = 'Spotify — loading track…';

  const player = await window.SpotifyAPI.getCurrentlyPlaying(_spotifyToken);
  if (!player || !player.item) {
    statusText.textContent = 'Spotify — nothing playing';
    return;
  }
  if (!player.is_playing) {
    statusText.textContent = 'Spotify — paused';
    return;
  }

  _spotifyTrackId = player.item.id;
  const trackName = `${player.item.name} — ${(player.item.artists ?? []).map(a => a.name).join(', ')}`;
  spotifyTrackEl.textContent = '♫ ' + trackName;
  spotifyTrackEl.style.display = '';
  statusText.textContent = 'Spotify Synced';
  _spotifyMode = true;

  const analysis = await window.SpotifyAPI.getAudioAnalysis(_spotifyToken, _spotifyTrackId);
  if (!analysis?.beats?.length) {
    statusText.textContent = 'Spotify — analysis unavailable';
    return;
  }

  // Initial schedule using the progress from the earlier /player call.
  // Fetch fresh progress right before scheduling to minimize offset error.
  const fresh = await window.SpotifyAPI.getCurrentlyPlaying(_spotifyToken);
  _scheduleBeatWindow(analysis.beats, fresh?.progress_ms ?? player.progress_ms);

  _spotifySyncId = setInterval(() => _spotifySyncTick(analysis.beats), 3000);
}

function stopSpotifySync() {
  _clearBeatTimeouts();
  if (_spotifySyncId) { clearInterval(_spotifySyncId); _spotifySyncId = null; }
  _spotifyMode    = false;
  _spotifyTrackId = null;
  spotifyTrackEl.style.display = 'none';
}

// Spotify connect button handler.
if (spotifyBtn) {
  spotifyBtn.addEventListener('click', async () => {
    if (_spotifyMode) {
      // Disconnect Spotify — back to audio mode.
      stopSpotifySync();
      _spotifyToken = null;
      window.SpotifyAuth.clearToken();
      spotifyBtn.textContent = 'Connect Spotify';
      spotifyBtn.classList.remove('btn-spotify--active');
      audioHintEl.style.display = '';
      statusDot.className    = 'dot dot--idle';
      statusText.textContent = 'Inactive';
    } else {
      window.SpotifyAuth.start();
    }
  });
}

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

// Handle Spotify OAuth callback (?code= in URL) or restore existing session.
(async () => {
  if (typeof window.SpotifyAuth === 'undefined') return;
  const token = await window.SpotifyAuth.handleCallback();
  if (!token) return;

  _spotifyToken = token;
  spotifyBtn.textContent = 'Disconnect Spotify';
  spotifyBtn.classList.add('btn-spotify--active');
  audioHintEl.style.display = 'none';
  startBtn.style.display    = 'none';    // Spotify mode — audio capture not needed

  await startSpotifySync();
})();
