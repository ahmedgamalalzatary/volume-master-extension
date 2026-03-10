'use strict';

const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
const SCROLL_PREF_KEY = 'vc:scrollControl';

const controller = VolumeController.createVolumeController({
    volumeState: VolumeState,
    origin: location.origin,
    getMediaElements() {
        return document.querySelectorAll('audio, video');
    },
    storage: {
        get(key) {
            return browser.storage.local.get(key);
        },
        set(payload) {
            return browser.storage.local.set(payload);
        },
        remove(key) {
            return browser.storage.local.remove(key);
        }
    },
    createAudioContext() {
        return new AudioContextCtor();
    },
    notifyBadge(vol) {
        return browser.runtime.sendMessage({ action: 'update-badge', volume: vol });
    },
    scheduleTask(callback, delay) {
        return setTimeout(() => {
            Promise.resolve(callback()).catch(() => { });
        }, delay);
    },
    cancelTask(timerId) {
        clearTimeout(timerId);
    }
});

const initPromise = controller.init();

function isMediaTarget(target) {
    if (!target || typeof target.closest !== 'function') {
        return false;
    }
    return !!target.closest('audio, video');
}

function setupScrollControl() {
    document.addEventListener('wheel', async event => {
        if (!isMediaTarget(event.target)) {
            return;
        }

        const delta = ScrollControl.computeScrollDelta(event);
        if (delta === 0) {
            return;
        }

        event.preventDefault();
        await controller.stepVolume(delta);
    }, { capture: true, passive: false });
}

async function initScrollControl() {
    try {
        const pref = await browser.storage.local.get(SCROLL_PREF_KEY);
        if (pref[SCROLL_PREF_KEY] === false) {
            return;
        }
    } catch (_) {
        // Ignore storage failures and keep defaults.
    }

    setupScrollControl();
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    initPromise
        .catch(() => { })
        .then(() => controller.handleMessage(msg))
        .then(response => {
            if (typeof response !== 'undefined') {
                sendResponse(response);
            }
        })
        .catch(() => { });
    return true;
});

const resumeAC = new AbortController();
['click', 'keydown', 'pointerdown'].forEach(evt =>
    document.addEventListener(evt, async () => {
        const resumed = await controller.resumeIfSuspended();
        if (resumed) {
            resumeAC.abort();
        }
    }, { capture: true, signal: resumeAC.signal })
);

new MutationObserver(() => {
    controller.notifyMediaMutation();
}).observe(document.documentElement, { subtree: true, childList: true });

initPromise.then(() => initScrollControl()).catch(() => {});
