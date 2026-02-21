'use strict';

/**
 * content-script.js
 *
 * Injected into every tab. Hooks into <audio> and <video> elements
 * via the Web Audio API to boost volume beyond 100%.
 *
 * Messages handled:
 *   { action: 'get-volume' }              → { volume: <number|null> }
 *   { action: 'set-volume', volume: <n> } → { ok: true, volume: <n> }
 */

// Tracks elements that have been connected to a GainNode.
// Map<HTMLMediaElement, { ctx: AudioContext, gain: GainNode }>
const tracked = new Map();

// The last volume the user requested (0–600). Stored so newly
// appearing <audio>/<video> elements can automatically get it applied.
let desiredVolume = 100;

/**
 * Connect a media element to a GainNode through a fresh AudioContext.
 * Returns true on success, false if the element is cross-origin locked.
 */
function connect(el) {
  if (tracked.has(el)) return true;
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    tracked.set(el, { ctx, gain });
    return true;
  } catch (_) {
    // Cross-origin media or already connected elsewhere – fall through
    return false;
  }
}

/**
 * Apply `desiredVolume` to every <audio>/<video> on the page.
 * Elements that can't be connected fall back to the native .volume
 * property (capped at 100% by the browser).
 */
function applyVolume() {
  document.querySelectorAll('audio, video').forEach(el => {
    const connected = connect(el);
    if (connected) {
      const { ctx, gain } = tracked.get(el);
      // Resume suspended context (browsers suspend on creation)
      if (ctx.state === 'suspended') ctx.resume();
      gain.gain.value = desiredVolume / 100;
    } else {
      // Fallback: native volume is 0.0–1.0, so clamp to 100%
      el.volume = Math.min(desiredVolume / 100, 1);
    }
  });
}

/**
 * Return the current gain percentage for the first tracked element,
 * or null if no media exists on the page yet.
 */
function getVolume() {
  if (tracked.size > 0) {
    const first = tracked.values().next().value;
    return Math.round(first.gain.gain.value * 100);
  }
  const el = document.querySelector('audio, video');
  if (el) return Math.round(el.volume * 100);
  return null; // no media on page
}

// ─── MutationObserver ────────────────────────────────────────────────────────
// Watch for dynamically added <audio>/<video> (e.g. SPAs, lazy players).
// If a custom volume is active, immediately apply it to new elements.
const observer = new MutationObserver(() => {
  const fresh = [...document.querySelectorAll('audio, video')].filter(
    el => !tracked.has(el)
  );
  if (fresh.length > 0 && desiredVolume !== 100) {
    applyVolume();
  }
});
observer.observe(document.documentElement, { subtree: true, childList: true });

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'set-volume') {
    desiredVolume = msg.volume;
    applyVolume();
    sendResponse({ ok: true, volume: desiredVolume });
  } else if (msg.action === 'get-volume') {
    sendResponse({ volume: getVolume() });
  }
  // Return true to keep the message channel open for async sendResponse
  return true;
});
