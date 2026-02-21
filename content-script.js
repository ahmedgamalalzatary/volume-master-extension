'use strict';

// 0-100%  -> native el.volume only. No AudioContext, no risk of muting.
// 101-200% -> Web Audio GainNode (gain > 1), but ONLY after context is 'running'.
//            createMediaElementSource() permanently reroutes audio through the
//            AudioContext pipeline; if that context is suspended the tab goes
//            completely silent at ALL volumes. So we never call it unless the
//            context is confirmed running.

let audioCtx = null;
let gainNode = null;
// WeakMap: el -> 'wired' (GainNode connected) | 'skipped' (cross-origin, failed)
const elementStatus = new WeakMap();
let desiredVolume = 100;

function canUseWebAudioBoost(el) {
    const src = el.currentSrc || el.src;
    if (!src) return false; // defer wiring until src is known; avoids permanent pipeline capture on a cross-origin element

    try {
        const url = new URL(src, location.href);
        if (url.protocol === 'data:') return true;
        if (url.protocol === 'blob:') return true;
        if (url.origin === location.origin) return true;
        // Cross-origin media can still be safe if loaded in CORS mode.
        return typeof el.crossOrigin === 'string' && el.crossOrigin.length > 0;
    } catch (_) {
        return false;
    }
}

function ensureContext() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);
}

function wireElement(el) {
    if (elementStatus.has(el)) return;
    // WebAudio boost is unsafe for many cross-origin media elements unless they
    // are loaded with CORS mode; skip those so audio never hard-mutes.
    if (!canUseWebAudioBoost(el)) {
        elementStatus.set(el, 'skipped');
        return;
    }
    try {
        const src = audioCtx.createMediaElementSource(el);
        src.connect(gainNode);
        elementStatus.set(el, 'wired');
    } catch (_) {
        // Cross-origin or already captured - leave on native path.
        elementStatus.set(el, 'skipped');
    }
}

async function applyVolume() {
    const vol = desiredVolume;

    if (vol <= 100) {
        // Native path:
        // Elements already wired (from a previous boost) stay in the AudioContext
        // chain - drive them via gain, keep el.volume at 1.0 so the pre-gain
        // signal is full. Un-wired elements just get el.volume directly.
        if (gainNode) gainNode.gain.value = vol / 100;
        document.querySelectorAll('audio, video').forEach(el => {
            if (elementStatus.get(el) === 'wired') {
                el.volume = 1.0; // gain handles the level
            } else {
                el.volume = vol / 100;
            }
        });
        return;
    }

    // Boost path (vol > 100):
    ensureContext();
    gainNode.gain.value = vol / 100;

    if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch (_) { }
    }

    if (audioCtx.state !== 'running') {
        // Context still suspended (no page-level user gesture yet).
        // Keep audio alive at native max; boost will kick in after page interaction.
        // Set el.volume = 1.0 on ALL elements including 'skipped' ones, so
        // cross-origin media is not left at a stale lower volume.
        document.querySelectorAll('audio, video').forEach(el => {
            el.volume = 1.0;
        });
        return;
    }

    // Context confirmed running - safe to wire elements now.
    document.querySelectorAll('audio, video').forEach(el => {
        wireElement(el);
        el.volume = 1.0;
    });
}

// Page-gesture fallback: if context was suspended when boost was requested,
// wire remaining elements and re-apply as soon as the user touches the page.
// An AbortController lets us remove all three listeners at once the moment
// the AudioContext transitions to 'running', so they never fire again.
const resumeAC = new AbortController();
['click', 'keydown', 'pointerdown'].forEach(evt =>
    document.addEventListener(evt, async () => {
        if (!audioCtx || audioCtx.state !== 'suspended') return;
        try { await audioCtx.resume(); } catch (_) { }
        if (audioCtx.state === 'running') {
            resumeAC.abort();   // unregisters all three listeners
            applyVolume();
        }
    }, { capture: true, signal: resumeAC.signal })
);

// Pick up dynamically added media elements.
// Debounced so that bursts of DOM mutations (e.g. SPA route changes, ad injection)
// result in a single applyVolume() call rather than one per mutation record.
let mutationDebounceTimer = null;
new MutationObserver(() => {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => Promise.resolve(applyVolume()).catch(() => { }), 150);
}).observe(document.documentElement, { subtree: true, childList: true });

function getVolume() {
    return document.querySelector('audio, video') ? desiredVolume : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'set-volume') {
        desiredVolume = Math.max(0, Math.min(200, msg.volume));
        applyVolume().finally(() => {
            sendResponse({ ok: true, volume: desiredVolume });
        });
    } else if (msg.action === 'get-volume') {
        sendResponse({ volume: getVolume() });
    }
    return true;
});
