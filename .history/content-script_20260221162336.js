'use strict';

/**
 * content-script.js
 *
 * ── How >100% volume works ──────────────────────────────────────────────────
 * Browsers cap native el.volume at 1.0 (100%). To go higher we route the
 * element through a Web Audio GainNode which can amplify beyond 1.0.
 *
 * ── Why we connect on the 'play' event ─────────────────────────────────────
 * Firefox's autoplay policy requires a USER GESTURE IN THE TAB to allow an
 * AudioContext to run. Clicking the extension popup toolbar button does NOT
 * count as a gesture for the tab's content. So if we try to create and resume
 * an AudioContext inside a message handler, it stays 'suspended' → silence.
 *
 * Solution: listen for the 'play' event on media elements. That event fires
 * directly from the user clicking the play button on the page — a real gesture.
 * We create and resume the AudioContext there, wiring up the gain pipeline.
 * By the time the user opens the popup and moves the slider, the context is
 * already running; we only need to update gain.gain.value.
 *
 * Messages handled:
 *   { action: 'get-volume' }              → { volume: <number 0-400 | null> }
 *   { action: 'set-volume', volume: <n> } → { ok: true, volume: <n> }
 */

// Map<HTMLMediaElement, { ctx: AudioContext, gain: GainNode }>
const tracked = new Map();

// Last volume value requested (0–400).
let desiredVolume = 100;

// ─── Web Audio connection ──────────────────────────────────────────────────

/**
 * Wire a media element into a GainNode pipeline.
 * Best called within a user-gesture context (e.g. inside a 'play' handler)
 * so AudioContext.resume() is allowed by the browser autoplay policy.
 * Returns true on success, false if the element can't be captured.
 */
async function tryConnect(el) {
    if (tracked.has(el)) return true;

    const ctx = new AudioContext();
    try {
        // Resume first — succeeds when called within/near a user gesture.
        // If the browser blocks it (no gesture), ctx.state stays 'suspended'
        // and we bail out WITHOUT having captured the element, so native audio
        // keeps playing unaffected.
        await ctx.resume();
        if (ctx.state !== 'running') {
            await ctx.close();
            return false;
        }

        const source = ctx.createMediaElementSource(el);
        const gain   = ctx.createGain();
        gain.gain.value = desiredVolume / 100;
        source.connect(gain);
        gain.connect(ctx.destination);
        // Keep native volume at 1.0 — the GainNode is the only amplifier.
        // If el.volume were < 1, it would silently reduce our gain output.
        el.volume = 1;
        tracked.set(el, { ctx, gain });
        return true;
    } catch (_) {
        // Element already captured by another AudioContext (site's own Web Audio
        // or a previous extension load), or cross-origin restriction.
        await ctx.close().catch(() => {});
        return false;
    }
}

// ─── Volume application ────────────────────────────────────────────────────

async function applyVolume() {
    for (const el of document.querySelectorAll('audio, video')) {
        if (tracked.has(el)) {
            // Already in Web Audio pipeline — just update the gain value.
            const { ctx, gain } = tracked.get(el);
            if (ctx.state === 'suspended') await ctx.resume();
            gain.gain.value = desiredVolume / 100;
            el.volume = 1; // ensure native volume stays at max
        } else if (desiredVolume <= 100) {
            // No amplification needed — native volume suffices.
            el.volume = desiredVolume / 100;
        } else {
            // Need >100% but element not yet in Web Audio.
            // Try to connect now; likely fails here (no gesture) but will
            // succeed automatically on the next 'play' event via watchElement().
            const ok = await tryConnect(el);
            if (!ok) {
                // Can't amplify yet — at least restore to full native volume
                // so we don't leave the tab silenced.
                el.volume = 1;
            }
        }
    }
}

// ─── Media element watcher ─────────────────────────────────────────────────

/**
 * Attach a 'play' listener to a media element so we can connect it to the
 * Web Audio pipeline the moment the user presses play (= real user gesture).
 */
function watchElement(el) {
    if (el._vcWatched) return;
    el._vcWatched = true;

    el.addEventListener('play', async () => {
        const ok = await tryConnect(el);
        if (!ok && desiredVolume <= 100) {
            el.volume = desiredVolume / 100;
        }
        // tryConnect() already sets gain.gain.value + el.volume = 1 on success.
    }, { capture: true });

    // If the element is already playing when the content script loads or when
    // a new element appears mid-session, try to connect immediately.
    if (!el.paused) {
        tryConnect(el);
    }
}

function watchAllMedia() {
    document.querySelectorAll('audio, video').forEach(watchElement);
}

new MutationObserver(watchAllMedia)
    .observe(document.documentElement, { subtree: true, childList: true });

watchAllMedia();

// ─── Volume query ──────────────────────────────────────────────────────────

function getVolume() {
    if (tracked.size > 0) {
        const { gain } = tracked.values().next().value;
        return Math.round(gain.gain.value * 100);
    }
    const el = document.querySelector('audio, video');
    return el ? Math.round(el.volume * 100) : null;
}

// ─── Message listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'set-volume') {
        desiredVolume = msg.volume;
        applyVolume().then(() => sendResponse({ ok: true, volume: desiredVolume }));
        return true;
    }
    if (msg.action === 'get-volume') {
        sendResponse({ volume: getVolume() });
        return true;
    }
    return true;
});
