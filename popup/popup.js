'use strict';

const slider = document.getElementById('volumeSlider');
const valueEl = document.getElementById('volumeValue');
const noMediaMsg = document.getElementById('noMediaMsg');
const quickBtns = document.querySelectorAll('.quick-btn');

let tabId = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Update the big number display. */
function renderVolume(vol) {
    valueEl.textContent = vol;
    // Color feedback: normal ≤100, warning 101–150, danger 151–200
    valueEl.classList.toggle('is-warning', vol > 100 && vol <= 150);
    valueEl.classList.toggle('is-danger', vol > 150);
    // Highlight matching quick-btn
    quickBtns.forEach(btn => {
        btn.classList.toggle('is-active', parseInt(btn.dataset.vol, 10) === vol);
    });
}

/** Send a volume to the content script in the active tab. */
async function sendVolume(vol) {
    if (tabId === null) return;
    try {
        await chrome.tabs.sendMessage(tabId, { action: 'set-volume', volume: vol });
    } catch (_) {
        // Tab may have navigated or content script not ready — ignore
    }
}

// ─── Initialise ────────────────────────────────────────────────────────────

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    tabId = tab.id;

    try {
        const res = await chrome.tabs.sendMessage(tabId, { action: 'get-volume' });
        const vol = (res && res.volume !== null) ? res.volume : 100;

        slider.value = vol;
        renderVolume(vol);

        // Show the no-media hint if the page has no media yet
        if (res && res.volume === null) {
            noMediaMsg.classList.remove('is-hidden');
        }
    } catch (_) {
        // Content script not reachable (e.g. about:, moz-extension:, pdf pages)
        slider.disabled = true;
        quickBtns.forEach(b => (b.disabled = true));
        noMediaMsg.classList.remove('is-hidden');
        noMediaMsg.textContent = 'Volume Control cannot run on this page.';
    }
}

// ─── Slider step-snap logic ────────────────────────────────────────────────
// 0–10  → step 1%   (fine control for quiet volumes)
// ─── Slider ────────────────────────────────────────────────────────────────

slider.addEventListener('input', () => {
    const vol = parseInt(slider.value, 10);
    renderVolume(vol);
    sendVolume(vol);
});

// ─── Quick-set buttons ─────────────────────────────────────────────────────

quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const vol = parseInt(btn.dataset.vol, 10);
        slider.value = vol;
        renderVolume(vol);
        sendVolume(vol);
    });
});

// ─── Keyboard shortcuts ────────────────────────────────────────────────────
// ↑/→ → +10%    ↓/← → -10%

document.addEventListener('keydown', e => {
    if (e.target !== document.body && e.target !== document.documentElement) return;
    const current = parseInt(slider.value, 10);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        const vol = Math.min(200, current + 10);
        slider.value = vol; renderVolume(vol); sendVolume(vol);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const vol = Math.max(0, current - 10);
        slider.value = vol; renderVolume(vol); sendVolume(vol);
    }
});

// ─── Boot ──────────────────────────────────────────────────────────────────
init();
