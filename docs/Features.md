# Planned Features

## 1. Mute / Unmute Toggle

A mute button in the popup that sets volume to 0 and restores the previous level on unmute. The muted state is tracked in memory (not persisted) so a page reload always restores the real persisted volume.

**Files to change:**
- `src/volume-controller.js` — add `mute()`, `unmute()`, `isMuted()` methods
- `popup/popup.html` — add mute button element
- `popup/popup.js` — wire mute button click handler

**Tests to add** (`test/volume-controller.test.js`):
- `mute() sets volume to 0 and retains pre-mute level`
- `unmute() restores pre-mute volume without touching storage`
- `calling mute() twice does not overwrite the saved pre-mute level`
- `setVolume() while muted updates the pre-mute level, not the active gain`

---

## 2. Reset Volume Message Action

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

## 3. Fine / Coarse Keyboard Step in Popup

Plain Arrow keys step ±1%; Shift+Arrow keys step ±10%. Replaces the current fixed ±10 behavior.

**Files to change:**
- `popup/popup.js` — update `keydown` handler; extract a pure helper `computeStep(key, shiftKey, currentVolume)`

**Tests to add** (`test/popup-keyboard.test.js`, new file):
- `Arrow without Shift increments by 1`
- `Arrow without Shift decrements by 1`
- `Arrow with Shift increments by 10`
- `Arrow with Shift decrements by 10`
- `clamps at 0 and 200`

---

## 4. Media Element Count in getVolume Response

Extend the `"get-volume"` response to include a `mediaCount` integer alongside the existing `hasMedia` boolean. The popup can then display the exact number of media elements found on the page.

**Files to change:**
- `src/volume-controller.js` — update `getVolume()` return value to include `mediaCount`
- `popup/popup.js` — read and display `mediaCount` in the no-media / media notice area

**Tests to add** (`test/volume-controller.test.js`):
- `getVolume returns mediaCount: 0 when no elements exist`
- `getVolume returns correct mediaCount matching the number of media elements`
- `getVolume hasMedia is false when mediaCount is 0 and true otherwise`

---

## 5. Storage Error Handling in init()

Add `.catch()` in `init()` so a rejected `storage.get` call falls back to volume 100 and emits a `console.warn` instead of silently breaking the controller.

**Files to change:**
- `src/volume-controller.js` — wrap `storage.get` promise in `init()` with a `.catch` fallback

**Tests to add** (`test/volume-controller.test.js`):
- `init falls back to 100 when storage.get rejects`
- `init emits a console.warn when storage.get rejects`
- `init still applies volume to existing media elements after a storage failure`

---

## 6. Relative Step Volume

A `{ action: 'step-volume', delta: N }` message that increments or decrements the current volume by an arbitrary integer delta, clamped to [0, 200]. Exposed as `stepVolume(delta)` on the controller.

**Files changed:**
- `src/volume-controller.js` — added `stepVolume(delta)` and `'step-volume'` case in `handleMessage`

**Tests added** (`test/volume-controller.test.js`):
- `step-volume increments desiredVolume by the given positive delta`
- `step-volume decrements desiredVolume by the given negative delta`
- `step-volume clamps the result to [0, 200]`
- `step-volume with non-finite delta leaves volume unchanged`

---

## 7. Extended State Query

A `{ action: 'get-state' }` message that returns a richer snapshot: `{ volume, hasMedia, isMuted, preMuteVolume }`. Used by the popup on open to restore both the slider position and the mute button state in one round-trip.

**Files changed:**
- `src/volume-controller.js` — added `getState()` and `'get-state'` case in `handleMessage`
- `popup/popup.js` — `init()` now calls `get-state` instead of `get-volume` to also seed `renderMuteState`

**Tests added** (`test/volume-controller.test.js`):
- `get-state returns volume, hasMedia, isMuted and preMuteVolume when not muted`
- `get-state reflects muted=true and correct preMuteVolume after muting`
- `get-state reflects isMuted=false after unmuting`

---

## 8. Volume Fade

A `{ action: 'fade-volume', target, steps, intervalMs }` message that gradually transitions the active volume from the current level to `target` over `steps` scheduled ticks spaced `intervalMs` ms apart. Exposed as `fadeToVolume(target, options)` on the controller. The final volume is persisted once the fade completes.

**Files changed:**
- `src/volume-controller.js` — added `fadeToVolume(target, options)` and `'fade-volume'` case in `handleMessage`

**Tests added** (`test/volume-controller.test.js`):
- `fadeToVolume transitions to target volume and persists the final value`
- `fade-volume message routes to fadeToVolume with provided options`
- `fadeToVolume uses default steps and intervalMs when options are omitted`
- `fadeToVolume clamps target to [0, 200] via normalizeVolume`
