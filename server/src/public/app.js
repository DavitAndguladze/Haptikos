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
