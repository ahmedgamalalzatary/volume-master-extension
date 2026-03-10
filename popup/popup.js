'use strict';

const slider = document.getElementById('volumeSlider');
const valueEl = document.getElementById('volumeValue');
const labelEl = document.getElementById('volumeLabel');
const noMediaMsg = document.getElementById('noMediaMsg');
const muteBtn = document.getElementById('muteBtn');
const resetBtn = document.getElementById('resetBtn');
const muteIcon = document.getElementById('muteIcon');
const mutedIcon = document.getElementById('mutedIcon');
const mediaDot = document.getElementById('mediaDot');
const mediaCountEl = document.getElementById('mediaCount');
const quickBtns = document.querySelectorAll('.quick-btn');

let tabId = null;
let isMuted = false;
let preMuteVolume = 100;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Descriptive label for the current volume. */
function volumeLabel(vol) {
    if (vol === 0) return 'Muted';
    if (vol <= 30) return 'Quiet';
    if (vol <= 70) return 'Moderate';
    if (vol <= 100) return 'Normal';
    if (vol <= 150) return 'Boosted';
    return 'Max boost';
}

/** Update the big number display, label, and button highlights. */
function renderVolume(vol) {
    valueEl.textContent = vol;
    labelEl.textContent = isMuted ? 'Muted' : volumeLabel(vol);

    // Color feedback
    valueEl.classList.toggle('is-muted', isMuted || vol === 0);
    valueEl.classList.toggle('is-warning', !isMuted && vol > 100 && vol <= 150);
    valueEl.classList.toggle('is-danger', !isMuted && vol > 150);

    // ARIA live value
    slider.setAttribute('aria-valuenow', vol);

    // Highlight matching quick-btn
    quickBtns.forEach(btn => {
        btn.classList.toggle('is-active', parseInt(btn.dataset.vol, 10) === vol);
    });
}

/** Update the mute button icon state. */
function renderMuteState() {
    muteBtn.classList.toggle('is-active', isMuted);
    muteIcon.classList.toggle('is-hidden', isMuted);
    mutedIcon.classList.toggle('is-hidden', !isMuted);
    muteBtn.setAttribute('aria-label', isMuted ? 'Unmute volume' : 'Mute volume');
    muteBtn.title = isMuted ? 'Unmute' : 'Mute';
}

/** Update the media count display. */
function renderMediaCount(count) {
    if (typeof count === 'number') {
        mediaCountEl.textContent = count === 0
            ? 'No media'
            : `${count} media`;
        mediaDot.classList.toggle('has-media', count > 0);
    }
}

/** Send a volume to the content script in the active tab. */
async function sendVolume(vol) {
    if (tabId === null) return;
    try {
        await browser.tabs.sendMessage(tabId, { action: 'set-volume', volume: VolumeState.normalizeVolume(vol) });
    } catch (_) {
        // Tab may have navigated or content script not ready — ignore
    }
}

/** Apply a volume value to all UI + send to content script. */
function applyVolume(vol) {
    slider.value = vol;
    renderVolume(vol);
    sendVolume(vol);
}

// ─── Initialise ────────────────────────────────────────────────────────────

async function init() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    tabId = tab.id;

    try {
        const res = await browser.tabs.sendMessage(tabId, { action: 'get-state' });
        const vol = (res && typeof res.volume !== 'undefined')
            ? VolumeState.normalizeVolume(res.volume)
            : 100;

        slider.value = vol;
        
        if (res && typeof res.isMuted === 'boolean') {
            isMuted = res.isMuted;
            preMuteVolume = typeof res.preMuteVolume === 'number' ? res.preMuteVolume : 100;
        }
        
        renderVolume(vol);
        renderMuteState();

        // Media count
        if (res && typeof res.mediaCount === 'number') {
            renderMediaCount(res.mediaCount);
        } else if (res && res.hasMedia) {
            renderMediaCount(1);
        }

        // Show the no-media hint if the page has no media yet
        if (res && res.hasMedia === false) {
            noMediaMsg.classList.remove('is-hidden');
        }
    } catch (_) {
        // Content script not reachable (e.g. about:, moz-extension:, pdf pages)
        slider.disabled = true;
        quickBtns.forEach(b => (b.disabled = true));
        muteBtn.disabled = true;
        resetBtn.disabled = true;
        noMediaMsg.classList.remove('is-hidden');
        noMediaMsg.textContent = 'Volume Control cannot run on this page.';
    }
}

// ─── Slider ────────────────────────────────────────────────────────────────

slider.addEventListener('input', async () => {
    const vol = parseInt(slider.value, 10);
    if (isMuted) {
        isMuted = false;
        try {
            await browser.tabs.sendMessage(tabId, { action: 'unmute' });
        } catch (_) {}
        renderMuteState();
    }
    renderVolume(vol);
    sendVolume(vol);
});

// ─── Quick-set buttons ─────────────────────────────────────────────────────

quickBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const vol = parseInt(btn.dataset.vol, 10);
        if (isMuted) {
            isMuted = false;
            try {
                await browser.tabs.sendMessage(tabId, { action: 'unmute' });
            } catch (_) {}
            renderMuteState();
        }
        applyVolume(vol);
    });
});

// ─── Mute / Unmute ─────────────────────────────────────────────────────────

muteBtn.addEventListener('click', async () => {
    if (tabId === null) return;
    try {
        const res = await browser.tabs.sendMessage(tabId, { action: 'toggle-mute' });
        if (res && typeof res.isMuted === 'boolean') {
            isMuted = res.isMuted;
            preMuteVolume = typeof res.volume === 'number' ? res.volume : 100;
            renderMuteState();
            if (isMuted) {
                slider.value = 0;
                renderVolume(preMuteVolume);
            } else {
                slider.value = preMuteVolume;
                renderVolume(preMuteVolume);
            }
        }
    } catch (_) {
        // Tab may have navigated or content script not ready — ignore
    }
});

// ─── Reset ─────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', async () => {
    if (tabId === null) {
        console.warn('Reset failed: no active tab');
        return;
    }
    try {
        await browser.tabs.sendMessage(tabId, { action: 'reset-volume' });
    } catch (e) {
        console.warn('Reset failed:', e);
        return;
    }
    isMuted = false;
    preMuteVolume = 100;
    renderMuteState();
    slider.value = 100;
    renderVolume(100);
});

// ─── Keyboard shortcuts ────────────────────────────────────────────────────
// Arrow keys: ±1%     Shift + Arrow: ±10%

document.addEventListener('keydown', async e => {
    if (e.target !== document.body && e.target !== document.documentElement) return;

    const step = e.shiftKey ? 10 : 1;
    const current = parseInt(slider.value, 10);
    let vol = null;

    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        vol = Math.min(200, current + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        vol = Math.max(0, current - step);
    } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        muteBtn.click();
        return;
    } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetBtn.click();
        return;
    }

    if (vol !== null) {
        if (isMuted) {
            isMuted = false;
            try {
                await browser.tabs.sendMessage(tabId, { action: 'unmute' });
            } catch (_) {}
            renderMuteState();
        }
        applyVolume(vol);
    }
});

// ─── Boot ──────────────────────────────────────────────────────────────────
init();
