'use strict';

// ─── Spotify PKCE Auth + API ───────────────────────────────────────────────────
//
// SETUP (one-time, ~5 min):
//   1. Go to https://developer.spotify.com → Create an app
//   2. In the app settings add this Redirect URI:  http://<YOUR-LAN-IP>:3000/
//   3. Paste your Client ID below.
//
const SPOTIFY_CLIENT_ID = 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_REDIRECT  = window.location.origin + '/';
const SPOTIFY_SCOPE     = 'user-read-playback-state';

// ─── PKCE crypto helpers ───────────────────────────────────────────────────────
function _randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr   = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

async function _sha256(plain) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}

function _base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Token storage (session only — no localStorage for demo security) ──────────
const _TK  = 'sp_token';
const _EXP = 'sp_expires';

function _saveToken(token, expiresIn) {
  sessionStorage.setItem(_TK,  token);
  sessionStorage.setItem(_EXP, String(Date.now() + expiresIn * 1000));
}

function _loadToken() {
  const token   = sessionStorage.getItem(_TK);
  const expires = Number(sessionStorage.getItem(_EXP));
  if (!token || !expires || Date.now() > expires - 60_000) return null;
  return token;
}

function _clearToken() {
  sessionStorage.removeItem(_TK);
  sessionStorage.removeItem(_EXP);
  sessionStorage.removeItem('sp_verifier');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
window.SpotifyAuth = {

  /** Redirect to Spotify login. Call when user clicks "Connect Spotify". */
  async start() {
    if (SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') {
      alert('Set SPOTIFY_CLIENT_ID in spotify.js first.\nSee the comment at the top of the file.');
      return;
    }
    const verifier  = _randomString(128);
    const challenge = _base64url(await _sha256(verifier));
    sessionStorage.setItem('sp_verifier', verifier);
    const params = new URLSearchParams({
      client_id:             SPOTIFY_CLIENT_ID,
      response_type:         'code',
      redirect_uri:          SPOTIFY_REDIRECT,
      scope:                 SPOTIFY_SCOPE,
      code_challenge_method: 'S256',
      code_challenge:        challenge,
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + params;
  },

  /**
   * Call on page load. Handles the ?code= callback from Spotify.
   * Returns the access token string, or null if not authenticated.
   */
  async handleCallback() {
    // Existing valid token — no work needed.
    const existing = _loadToken();
    if (existing) return existing;

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const verifier = sessionStorage.getItem('sp_verifier');
    if (!code || !verifier) return null;

    // Remove ?code= from the URL without a page reload.
    window.history.replaceState({}, '', window.location.pathname);

    try {
      const resp = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  SPOTIFY_REDIRECT,
          client_id:     SPOTIFY_CLIENT_ID,
          code_verifier: verifier,
        }),
      });
      const data = await resp.json();
      if (data.access_token) {
        _saveToken(data.access_token, data.expires_in ?? 3600);
        sessionStorage.removeItem('sp_verifier');
        return data.access_token;
      }
      console.error('[Spotify] Token exchange error:', data);
    } catch (e) {
      console.error('[Spotify] Token exchange failed:', e);
    }
    return null;
  },

  getToken:   _loadToken,
  clearToken: _clearToken,
};

// ─── Spotify API calls ────────────────────────────────────────────────────────
window.SpotifyAPI = {

  async getCurrentlyPlaying(token) {
    try {
      const r = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204) return null;   // nothing playing
      if (r.status === 401) { _clearToken(); return null; }
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  },

  async getAudioAnalysis(token, trackId) {
    try {
      const r = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  },
};
