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
 *
 * ── Why async connect? ────────────────────────────────────────────────────────
 * Firefox (and Chrome) start every new AudioContext in 'suspended' state due to
 * autoplay policy. If we call createMediaElementSource() on a suspended context
 * the element is immediately detached from the native audio pipeline but produces
 * no sound — the tab appears muted. The fix: always await ctx.resume() and only
 * capture the element once the context is confirmed 'running'. If resume fails we
 * leave the element on native audio (capped at 100% by the browser).
 */

// Map<HTMLMediaElement, { ctx: AudioContext, gain: GainNode }>
const tracked = new Map();

// Last volume requested (0–600).
let desiredVolume = 100;

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Connect a media element to a GainNode.
 * Returns true when fully wired up, false when we should fall back to el.volume.
 *
 * IMPORTANT: createMediaElementSource() is called ONLY after the context is
 * confirmed running, so native audio is never silently cut off.
 */
async function connect(el) {
    // Already wired — nothing to do.
    if (tracked.has(el)) return true;

    const ctx = new AudioContext();

    // Step 1: ensure the context can actually produce audio before we capture
    // the element and disconnect its native output.
    try {
        await ctx.resume();
    } catch (_) {
        // resume() itself threw — browser is blocking audio entirely.
        await ctx.close();
        return false;
    }

    if (ctx.state !== 'running') {
        // Context still suspended (browser policy / no user gesture on page).
        // Close it and fall back to native volume — do NOT capture the element.
        await ctx.close();
        return false;
    }

    // Step 2: wire up element → GainNode → destination.
    try {
        const source = ctx.createMediaElementSource(el);
        const gain   = ctx.createGain();
        source.connect(gain);
        gain.connect(ctx.destination);
        tracked.set(el, { ctx, gain });
        return true;
    } catch (_) {
        // Element already captured by another context (e.g. the site itself
        // uses Web Audio API, or a previous extension instance grabbed it).
        await ctx.close();
        return false;
    }
}

/**
 * Apply desiredVolume to every media element on the page.
 * For ≤100% without an existing connection we use native el.volume (safe, no
 * AudioContext needed). For >100% or already-connected elements we go through
 * the GainNode.
 */
async function applyVolume() {
    const elements = [...document.querySelectorAll('audio, video')];

    for (const el of elements) {
        // Fast path: if not yet tracked and volume ≤ 100%, skip AudioContext
        // entirely — just set native volume and keep audio flowing.
        if (!tracked.has(el) && desiredVolume <= 100) {
            el.volume = desiredVolume / 100;
            continue;
        }

        const ok = await connect(el);
        if (ok) {
            const { ctx, gain } = tracked.get(el);
            // Paranoia check — resume if something suspended it since we connected.
            if (ctx.state === 'suspended') await ctx.resume();
            gain.gain.value = desiredVolume / 100;
        } else {
            // Fallback: native volume, capped at 1.0 (100%) by the browser.
            el.volume = Math.min(desiredVolume / 100, 1);
        }
    }
}

/**
 * Return the current effective volume % for the first media element found,
 * or null when the page has no media yet.
 */
function getVolume() {
    if (tracked.size > 0) {
        const { gain } = tracked.values().next().value;
        return Math.round(gain.gain.value * 100);
    }
    const el = document.querySelector('audio, video');
    if (el) return Math.round(el.volume * 100);
    return null;
}

// ─── MutationObserver ─────────────────────────────────────────────────────────
// Catch dynamically added <audio>/<video> (SPAs, lazy-loaded players, etc.).
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
        applyVolume().then(() => sendResponse({ ok: true, volume: desiredVolume }));
        return true; // Keep channel open for async sendResponse
    }
    if (msg.action === 'get-volume') {
        sendResponse({ volume: getVolume() });
        return true;
    }
    return true;
});
