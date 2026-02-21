'use strict';

// Map<HTMLMediaElement, GainNode>
const tracked = new Map();

let desiredVolume = 100;
let sharedCtx     = null;

// ─── AudioContext management ───────────────────────────────────────────────

function getOrCreateCtx() {
    if (!sharedCtx) {
        sharedCtx = new AudioContext();

        // If Firefox suspends the context (tab hidden, inactivity, etc.)
        // re-resume it automatically so already-connected elements don't mute.
        sharedCtx.addEventListener('statechange', () => {
            if (sharedCtx.state === 'suspended') {
                sharedCtx.resume().catch(() => {});
            }
        });
    }
    return sharedCtx;
}

// Pre-warm the context on any user interaction so it is more likely
// to be in 'running' state when the slider message arrives.
document.addEventListener('pointerdown', () => {
    getOrCreateCtx().resume().catch(() => {});
}, { capture: true, passive: true });

document.addEventListener('keydown', () => {
    getOrCreateCtx().resume().catch(() => {});
}, { capture: true, passive: true });

// ─── Apply volume ──────────────────────────────────────────────────────────

async function applyVolume() {
    const elements = [...document.querySelectorAll('audio, video')];
    if (!elements.length) return;

    if (desiredVolume <= 100) {
        // ≤ 100%: pure native volume, no Web Audio needed.
        // For already-tracked elements, update the gain and release tracking
        // so native volume takes over (simpler and safer).
        for (const el of elements) {
            if (tracked.has(el)) {
                // Keep the GainNode at 1.0 and use el.volume for the rest.
                tracked.get(el).gain.value = 1;
            }
            el.volume = desiredVolume / 100;
        }
        return;
    }

    // > 100%: need Web Audio.
    const ctx = getOrCreateCtx();

    // Always try to resume before connecting — safe to call even if already running.
    if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch (_) {}
    }

    for (const el of elements) {
        if (tracked.has(el)) {
            // Already connected — just update gain.
            // Set el.volume to 1 to make sure native vol doesn't attenuate us.
            tracked.get(el).gain.value = desiredVolume / 100;
            el.volume = 1;
            continue;
        }

        if (ctx.state !== 'running') {
            // Context not running yet (no user gesture has happened in the tab).
            // Do NOT touch el.volume here — leave native audio untouched.
            continue;
        }

        // Connect this element to the gain pipeline.
        try {
            const source = ctx.createMediaElementSource(el);
            const gain   = ctx.createGain();
            gain.gain.value = desiredVolume / 100;
            source.connect(gain);
            gain.connect(ctx.destination);
            // el.volume must be 1.0 — any lower value silently caps our gain.
            el.volume = 1;
            tracked.set(el, gain);
        } catch (_) {
            // Element already captured by the site's own AudioContext
            // (YouTube, SoundCloud, etc.) — we cannot re-route it.
            // Do NOT change el.volume so we don't accidentally mute the tab.
        }
    }
}

// ─── MutationObserver (debounced) ─────────────────────────────────────────

let mutationTimer = null;
new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(applyVolume, 200);
}).observe(document.documentElement, { subtree: true, childList: true });

// ─── Volume query ──────────────────────────────────────────────────────────

function getVolume() {
    if (tracked.size > 0) {
        return Math.round(tracked.values().next().value.gain.value * 100);
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
