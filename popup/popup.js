'use strict';

const slider      = document.getElementById('volumeSlider');
const valueEl     = document.getElementById('volumeValue');
const noMediaMsg  = document.getElementById('noMediaMsg');
const quickBtns   = document.querySelectorAll('.quick-btn');

let tabId = null;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Update the big number and its colour based on the level. */
function renderVolume(vol) {
  valueEl.textContent = vol;
  valueEl.classList.remove('is-warning', 'is-danger');
  if (vol > 300)      valueEl.classList.add('is-danger');
  else if (vol > 100) valueEl.classList.add('is-warning');

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
// 0–6  → set volume to 0%, 100%, 200%, … 600%
// ↑/→  → +10%
// ↓/←  → −10%

document.addEventListener('keydown', e => {
  // Ignore if focus is inside an input
  if (e.target !== document.body && e.target !== document.documentElement) return;

  const digit = parseInt(e.key, 10);
  if (!isNaN(digit) && digit >= 0 && digit <= 6) {
    const vol = digit * 100;
    slider.value = vol;
    renderVolume(vol);
    sendVolume(vol);
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault();
    const vol = Math.min(600, parseInt(slider.value, 10) + 10);
    slider.value = vol;
    renderVolume(vol);
    sendVolume(vol);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const vol = Math.max(0, parseInt(slider.value, 10) - 10);
    slider.value = vol;
    renderVolume(vol);
    sendVolume(vol);
  }
});

// ─── Boot ──────────────────────────────────────────────────────────────────
init();
