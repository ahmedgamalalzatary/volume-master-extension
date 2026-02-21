'use strict';

/**
 * content-script.js — Volume Control Firefox Extension
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 *
 * For ≤100%: we use the native HTMLMediaElement.volume property directly.
 *   This always works, requires no permissions, no AudioContext, no gesture.
 *
 * For >100%: we need a Web Audio GainNode (browsers cap native volume at 1.0).
 *   A GainNode requires a running AudioContext.
 *   A running AudioContext in Firefox requires a USER GESTURE *in the tab*.
 *
 * ── The user gesture problem ────────────────────────────────────────────────
 *
 * The HTML spec defines "user activation events" as: click, contextmenu,
 * dblclick, mousedown/up, pointerdown/up, keydown/up, touchend, etc.
 * The `play` media event is NOT in this list — using it to call ctx.resume()
 * does NOT work in Firefox.
 *
 * Solution: attach pointerdown + keydown listeners (real user activation events)
 * to the page. The moment the user clicks *anything* on the page (including the
 * play button), we create + resume the shared AudioContext. The resume() promise
 * fires in a microtask, still within the user activation window.
 *
 * By the time the user opens the popup and moves the slider, the AudioContext
 * is already in 'running' state. We only need to call connectElement() and
 * update gain.gain.value — no async, no gesture required at that point.
 *
 * ── Why a single shared AudioContext ───────────────────────────────────────
 *
 * One AudioContext per page. All media elements share it via separate GainNodes.
 * This avoids the bug where multiple abandoned AudioContexts from prior runs or
 * rapid re-creation keep elements captured with no working audio output.
 */

// Single shared AudioContext for this page.
let sharedCtx = null;

// Map<HTMLMediaElement, GainNode> — elements wired into the gain pipeline.
const tracked = new Map();

// Last volume requested via the popup (0–400).
let desiredVolume = 100;

// ─── AudioContext bootstrap ────────────────────────────────────────────────

/**
 * Called synchronously inside real user-activation event handlers.
 * Creates + resumes the shared AudioContext using the user gesture window.
 * No await — fire-and-forget; the Promise resolves quickly as a microtask
 * while still within the activation window.
 */
function touchAudioContext() {
    if (!sharedCtx) {
        sharedCtx = new AudioContext();
    }
    if (sharedCtx.state === 'suspended') {
        sharedCtx.resume(); // intentionally not awaited
    }
}

// pointerdown fires before click, giving us the earliest possible gesture entry.
document.addEventListener('pointerdown', touchAudioContext, { capture: true, passive: true });
document.addEventListener('keydown', touchAudioContext, { capture: true, passive: true });

// ─── Element connection ────────────────────────────────────────────────────

/**
 * Wire el → GainNode → sharedCtx.destination.
 * Can only succeed after touchAudioContext() has run and the ctx is 'running'.
 * Fully synchronous — safe to call from message handlers.
 */
function connectElement(el) {
    if (tracked.has(el)) return true;
    if (!sharedCtx || sharedCtx.state !== 'running') return false;

    try {
        const source = sharedCtx.createMediaElementSource(el);
        const gain = sharedCtx.createGain();
        gain.gain.value = desiredVolume / 100;
        source.connect(gain);
        gain.connect(sharedCtx.destination);
        // el.volume MUST stay at 1.0 — if it's lower the GainNode output
        // is silently attenuated, making 200% sound like 100%.
        el.volume = 1;
        tracked.set(el, gain);
        return true;
    } catch (_) {
        // Thrown when the element is already captured by another AudioContext
        // (e.g., the site uses its own Web Audio API, or a zombie context from
        // a previous extension load). Nothing we can do — skip it.
        return false;
    }
}

// ─── Volume application ────────────────────────────────────────────────────

function applyVolume() {
    for (const el of document.querySelectorAll('audio, video')) {
        if (tracked.has(el)) {
            // Already in the gain pipeline — just update the gain value.
            tracked.get(el).gain.value = desiredVolume / 100;
            el.volume = 1; // keep native at max so gain is the only control
        } else if (desiredVolume > 100) {
            // Need amplification. Will work if ctx is already running
            // (user has clicked something on the page). If not yet running,
            // connectElement returns false and we fall back to native 100%
            // (audible, not muted — just not amplified yet).
            if (!connectElement(el)) {
                el.volume = 1;
            }
        } else {
            // ≤100%: pure native volume. Always works, no AudioContext needed.
            el.volume = desiredVolume / 100;
        }
    }
}

// ─── Watch for dynamically added media elements ────────────────────────────

new MutationObserver(applyVolume)
    .observe(document.documentElement, { subtree: true, childList: true });

// Apply on load for elements already on the page.
applyVolume();

// ─── Volume query ──────────────────────────────────────────────────────────

function getVolume() {
    if (tracked.size > 0) {
        // Report the gain value of the first tracked element.
        return Math.round(tracked.values().next().value.gain.value * 100);
    }
    const el = document.querySelector('audio, video');
    return el ? Math.round(el.volume * 100) : null;
}

// ─── Message listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'set-volume') {
        desiredVolume = msg.volume;
        applyVolume();
        sendResponse({ ok: true, volume: desiredVolume });
    } else if (msg.action === 'get-volume') {
        sendResponse({ volume: getVolume() });
    }
    return true;
});
