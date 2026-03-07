'use strict';

const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

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
        }
    },
    createAudioContext() {
        return new AudioContextCtor();
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
