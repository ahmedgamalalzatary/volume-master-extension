'use strict';

// 0–100 only. Pure native el.volume. No AudioContext, no complexity.

let desiredVolume = 100;

function applyVolume() {
    document.querySelectorAll('audio, video').forEach(el => {
        el.volume = desiredVolume / 100;
    });
}

// Pick up dynamically added media elements.
new MutationObserver(applyVolume)
    .observe(document.documentElement, { subtree: true, childList: true });

function getVolume() {
    const el = document.querySelector('audio, video');
    return el ? Math.round(el.volume * 100) : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'set-volume') {
        desiredVolume = Math.max(0, Math.min(100, msg.volume));
        applyVolume();
        sendResponse({ ok: true, volume: desiredVolume });
    } else if (msg.action === 'get-volume') {
        sendResponse({ volume: getVolume() });
    }
    return true;
});
