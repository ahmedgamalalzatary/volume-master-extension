# Planned Features

## 1. Reset Volume Message Action

A new `"reset-volume"` message action that resets the current origin's volume to 100 and removes the stored entry. Paired with a Reset button in the popup.

**Files to change:**
- `src/volume-controller.js` — add `"reset-volume"` case in `handleMessage`
- `popup/popup.html` — add reset button element
- `popup/popup.js` — wire reset button click handler

**Tests to add** (`test/volume-controller.test.js`):
- `handleMessage reset-volume sets volume to 100 and removes the storage key`
- `handleMessage reset-volume returns { ok: true, volume: 100 }`
- `handleMessage reset-volume is a no-op when volume is already 100`

---

## 2. Media Element Count in getVolume Response

Extend the `"get-volume"` response to include a `mediaCount` integer alongside the existing `hasMedia` boolean. The popup can then display the exact number of media elements found on the page.

**Files to change:**
- `src/volume-controller.js` — update `getVolume()` return value to include `mediaCount`
- `popup/popup.js` — read and display `mediaCount` in the no-media / media notice area

**Tests to add** (`test/volume-controller.test.js`):
- `getVolume returns mediaCount: 0 when no elements exist`
- `getVolume returns correct mediaCount matching the number of media elements`
- `getVolume hasMedia is false when mediaCount is 0 and true otherwise`

---

## 3. Relative Step Volume

A `{ action: 'step-volume', delta: N }` message that increments or decrements the current volume by an arbitrary integer delta, clamped to [0, 200]. Exposed as `stepVolume(delta)` on the controller.

**Files changed:**
- `src/volume-controller.js` — added `stepVolume(delta)` and `'step-volume'` case in `handleMessage`

**Tests added** (`test/volume-controller.test.js`):
- `step-volume increments desiredVolume by the given positive delta`
- `step-volume decrements desiredVolume by the given negative delta`
- `step-volume clamps the result to [0, 200]`
- `step-volume with non-finite delta leaves volume unchanged`

---

## 4. Extended State Query

A `{ action: 'get-state' }` message that returns a richer snapshot: `{ volume, hasMedia, isMuted, preMuteVolume }`. Used by the popup on open to restore both the slider position and the mute button state in one round-trip.

**Files changed:**
- `src/volume-controller.js` — added `getState()` and `'get-state'` case in `handleMessage`
- `popup/popup.js` — `init()` now calls `get-state` instead of `get-volume` to also seed `renderMuteState`

**Tests added** (`test/volume-controller.test.js`):
- `get-state returns volume, hasMedia, isMuted and preMuteVolume when not muted`
- `get-state reflects muted=true and correct preMuteVolume after muting`
- `get-state reflects isMuted=false after unmuting`

---

## 5. Volume Fade

A `{ action: 'fade-volume', target, steps, intervalMs }` message that gradually transitions the active volume from the current level to `target` over `steps` scheduled ticks spaced `intervalMs` ms apart. Exposed as `fadeToVolume(target, options)` on the controller. The final volume is persisted once the fade completes.

**Files changed:**
- `src/volume-controller.js` — added `fadeToVolume(target, options)` and `'fade-volume'` case in `handleMessage`

**Tests added** (`test/volume-controller.test.js`):
- `fadeToVolume transitions to target volume and persists the final value`
- `fade-volume message routes to fadeToVolume with provided options`
- `fadeToVolume uses default steps and intervalMs when options are omitted`
- `fadeToVolume clamps target to [0, 200] via normalizeVolume`

---

## 6. Badge Volume Display

Show the current volume level as text on the extension's toolbar icon badge so users can see the active volume at a glance without opening the popup.

**Behaviour**

- When volume is set or restored, send a message to the background script with the current volume integer.
- The background script calls `browser.action.setBadgeText({ text: String(vol), tabId })`.
- Badge background color follows the same thresholds as the popup display: default accent for ≤ 100, warning for 101–150, danger for 151+.
- When no content script is active on a tab, the badge is cleared.

**Files to change**

- **New file** `src/background.js` — listen for `update-badge` messages; call badge API.
- `manifest.json` — add `"background": { "scripts": ["src/background.js"] }`.
- `src/volume-controller.js` — after every `setVolume` / `init` that resolves, emit an `update-badge` message via a new injected `notifyBadge(vol)` dependency.
- `src/content-script.js` — inject `notifyBadge` using `browser.runtime.sendMessage`.

**Tests to add** (`test/background.test.js`, new file)

| # | Test case |
|---|-----------|
| 1 | `update-badge sets badge text to the provided volume string` |
| 2 | `update-badge sets warning color when volume > 100 and ≤ 150` |
| 3 | `update-badge sets danger color when volume > 150` |
| 4 | `update-badge sets default accent color when volume ≤ 100` |
| 5 | `update-badge clears badge text when volume is undefined` |

---

## 7. Volume Lock

Prevent websites from programmatically overriding the volume on media elements. Some sites reset `el.volume` when ads play or on seek events, undoing the user's chosen level.

**Behaviour**

- When enabled, attach an `Object.defineProperty` override on each wired media element's `volume` setter so any external write is intercepted and silently replaced with the controller's `desiredVolume / 100`.
- Toggled via a new `{ action: 'toggle-lock' }` message. State is kept in-memory (not persisted).
- When locked, `getVolume()` / `getState()` responses include `isLocked: true`.
- Unlocking removes the property override and re-applies the current volume normally.

**Files to change**

- `src/volume-controller.js` — add `lockVolume()`, `unlockVolume()`, `isLocked()` methods; override `volume` setter inside `applyVolume` when lock is active; handle `toggle-lock` in `handleMessage`.

**Tests to add** (`test/volume-controller.test.js`)

| # | Test case |
|---|-----------|
| 1 | `lockVolume prevents external volume writes from changing effective volume` |
| 2 | `unlockVolume restores normal volume setter behaviour` |
| 3 | `toggle-lock message toggles the lock state and returns current isLocked` |
| 4 | `setVolume while locked still updates desiredVolume and re-applies the lock` |
| 5 | `getVolume includes isLocked field reflecting current lock state` |

---

## 8. Scroll Wheel Volume Control

Allow users to adjust volume by scrolling the mouse wheel over any `<audio>` or `<video>` element on the page.

**Behaviour**

- A `wheel` event listener is attached to `document` (capture phase).
- Only fires when the `event.target` is, or is inside, an `<audio>` or `<video>` element.
- Scroll up → +5 %, scroll down → −5 %, clamped to `[0, 200]`.
- Shift + scroll changes the step to ±1 % for fine control.
- Calls `setVolume()` on the controller and sends an `update-badge` notification.
- The feature is enabled by default and can be toggled via a stored preference `vc:scrollControl`.

**Files to change**

- `src/content-script.js` — attach the `wheel` listener after init; read preference from storage.
- **New file** `src/scroll-control.js` — pure helper: `computeScrollDelta(event)` returns the volume delta given a `WheelEvent`.

**Tests to add** (`test/scroll-control.test.js`, new file)

Unit tests for the pure `computeScrollDelta` helper — these only assert the **delta value returned** and must not call `setVolume` or touch the controller:

| # | Test case |
|---|-----------|
| 1 | `scroll up returns +5 delta` |
| 2 | `scroll down returns -5 delta` |
| 3 | `shift + scroll up returns +1 delta` |
| 4 | `shift + scroll down returns -1 delta` |

Integration tests for the full scroll-handler flow (the codepath that calls `setVolume`) — these verify clamping through the complete pipeline:

| # | Test case |
|---|-----------|
| 5 | `scroll up from 198 clamps final volume to 200` |
| 6 | `scroll down from 2 clamps final volume to 0` |

---
