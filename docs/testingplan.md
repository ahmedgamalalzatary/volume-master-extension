# Testing Plan

## Purpose

This document defines the testing strategy for the current implementation state of the extension as of March 9, 2026, and the expected coverage for the planned feature set in [`docs/Features.md`](/d:/Documents/current_work/volume-master/docs/Features.md).

The goal is comprehensive validation with minimal untested functional and edge-case risk. Low maintenance cost is not a priority. The plan instead optimizes for:

- functional correctness,
- edge-case coverage,
- message-contract safety acrovss extension layers,
- real Firefox behavior validation,
- performance and resource-regression detection.

## Current Project State

The repository is not limited to controller-only mute support. The actual current state is:

- automated tests currently pass with `node --test`,
- the suite currently has `28` passing tests,
- controller and state logic have meaningful automated coverage,
- popup logic already includes mute UI, reset UI behavior, keyboard stepping, and media-count rendering fallback,
- content-script behavior is only lightly tested,
- popup behavior has no automated coverage,
- background-script behavior does not exist yet in the manifest or source tree.

This means [`docs/Features.md`](/d:/Documents/current_work/volume-master/docs/Features.md) is partly ahead of the code and partly behind it:

- `Mute / Unmute Toggle` is implemented in the controller and popup,
- some popup-side behavior for future features is already present,
- many planned controller, content-script, and background capabilities are still unimplemented.

Current code and tests referenced by this plan:

- [`src/volume-controller.js`](/d:/Documents/current_work/volume-master/src/volume-controller.js)
- [`src/volume-state.js`](/d:/Documents/current_work/volume-master/src/volume-state.js)
- [`src/content-script.js`](/d:/Documents/current_work/volume-master/src/content-script.js)
- [`popup/popup.js`](/d:/Documents/current_work/volume-master/popup/popup.js)
- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- [`test/volume-state.test.js`](/d:/Documents/current_work/volume-master/test/volume-state.test.js)
- [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js)

## Testing Layers And Why

### 1. Unit / Helper Tests

Use unit tests for deterministic logic with dense edge-case coverage.

These tests should own:

- normalization and clamping,
- storage key generation,
- pure step and delta calculations,
- state transitions such as mute, unmute, lock, unlock,
- fade-step calculations and default-option behavior,
- payload shaping for getters and message responses,
- guard behavior for invalid input.

Why:

- this is the cheapest layer for edge cases,
- it gives the strongest confidence against logic regressions,
- it should contain most of the "near zero untested edge cases" coverage.

### 2. Module / Contract Tests

Use module-level tests for seams between popup, content script, controller, storage, and future background behavior.

These tests should own:

- popup DOM initialization and event wiring,
- controller message routing,
- content-script message relay after `init()`,
- storage success and failure behavior,
- payload contracts shared between popup and controller,
- background message handling once badge support exists.

Why:

- most extension regressions happen at boundaries, not inside pure logic,
- these tests catch mismatched payloads, wrong action names, and init-order failures,
- they are the right place to verify browser API usage with mocks/fakes.

### 3. Browser Automation

Use a small browser-driven suite only for stable, repeatable extension flows.

Recommended scope:

- popup opens on a supported tab,
- popup reflects the current volume state,
- slider changes send the expected update,
- mute toggle works,
- reset works,
- unsupported-page behavior is surfaced correctly.

Why:

- this gives higher confidence than mocks for the most important user flows,
- a small automation layer is justified,
- a large browser suite is not the primary strategy because the repo should still rely on `node:test` for most coverage.

Tooling note:

- keep the plan tool-agnostic unless a Firefox-compatible extension automation setup is adopted and proves reliable,
- do not make all release confidence depend on browser automation.

### 4. Manual Firefox Testing

Manual Firefox testing remains mandatory for browser-only behaviors that are awkward, flaky, or expensive to prove in Node.

This layer should own:

- AudioContext resume after actual user gesture,
- cross-origin media behavior,
- unsupported-page behavior on real Firefox pages,
- dynamically inserted media on real sites,
- temporary add-on loading and manifest wiring,
- visual and interaction behavior inside the real popup,
- future badge, lock, and wheel-control behavior on live pages.

Why:

- browser extensions interact with real tabs, real permission boundaries, and real media behavior,
- Node mocks cannot credibly replace these checks.

### 5. Performance / Resource Regression Testing

Performance is a separate required testing concern for higher-risk features.

This layer should cover three areas:

- many-media-element scenarios,
- event-storm resilience,
- memory and resource safety.

Use measurable automated checks where practical and scenario/manual checks where real Firefox behavior makes exact thresholds unreliable.

Why:

- correctness tests can still pass while the extension becomes slow, duplicates listeners, rewires media repeatedly, or leaks audio resources.

## Current Automated Coverage

### `volume-state`

Covered in [`test/volume-state.test.js`](/d:/Documents/current_work/volume-master/test/volume-state.test.js):

- stable storage key generation from origin,
- normalization into `0..200`,
- fallback to `100` for missing or invalid values.

### `volume-controller`

Covered in [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js):

- persisted volume load during `init()`,
- fallback to `100` for invalid persisted values,
- native apply path for `<=100`,
- Web Audio boost path for `>100`,
- suspended and interrupted audio-context resume behavior,
- safe vs unsafe cross-origin media handling,
- no rewiring of already wired media,
- `getVolume()` reporting of current state,
- `handleMessage()` routing for implemented actions,
- unknown-action behavior,
- dependency validation,
- storage write failure tolerance during `setVolume()`,
- debounced media mutation handling,
- `init()` idempotency,
- mute/unmute state transitions,
- mute-related message routing,
- `setVolume()` behavior while muted.

### `content-script`

Covered in [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js):

- `webkitAudioContext` fallback when `AudioContext` is unavailable.

### `popup`

Current automated coverage:

- none.

## Current Coverage Gaps And Risk Ranking

### Highest Risk

- popup initialization behavior and disabled-state behavior,
- popup event wiring for slider, quick buttons, mute, reset, and keyboard shortcuts,
- popup/controller payload contract drift,
- content-script message relay after `init()` completes,
- content-script handling when `init()` fails or tab messaging is unavailable.

### High Risk

- unsupported-page and unreachable-tab handling in popup,
- media-count rendering paths,
- reset behavior contract between popup and controller,
- controller handling for `storage.get` rejection in `init()`,
- manual verification of real Firefox audio-context resume behavior,
- real-page validation of dynamic media and cross-origin handling.

### Medium Risk

- visual-state synchronization in popup after mute/unmute,
- accessibility and keyboard behavior in popup,
- performance behavior under repeated mutations or repeated UI input,
- manifest wiring regressions when background support is added later.

## Default Release Gate

The default rule for implemented features is `mostly strict`:

- unit or helper tests are required for logic-heavy behavior,
- module or contract tests are required for extension seams,
- manual Firefox verification is required for browser-visible behavior,
- browser automation is required for stable, high-value flows when the feature crosses popup/content/background boundaries,
- performance or resource-regression checks are required for higher-risk features such as mutation-heavy, media-heavy, fade-based, or repeated-event behavior.

A feature should not be treated as complete if only one layer passes. The minimum acceptable standard is:

- logic covered,
- contract covered,
- real Firefox behavior manually checked,
- performance checked when the feature can regress under scale, event storms, or long-lived page usage.

## Planned Feature Coverage Matrix

### 1. Mute / Unmute Toggle

Current status:

- implemented in controller and popup,
- controller-side automated coverage exists,
- popup-side automated coverage is missing.

Required coverage:

- unit/module:
  - keep existing controller mute tests,
  - add popup tests for initial mute-state rendering,
  - add popup tests for toggle click behavior,
  - add popup tests for slider and quick-button interaction while muted,
  - add payload-contract tests for `isMuted` and `preMuteVolume`.
- browser automation:
  - optional but recommended for popup open plus mute toggle flow.
- manual Firefox:
  - mute sets effective output to zero,
  - unmute restores prior level,
  - reload restores persisted volume rather than transient muted state.
- performance:
  - no special performance lane required beyond regression checks.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- `test/popup.test.js`

### 2. Reset Volume Message Action

Current status:

- reset UI behavior exists in popup,
- controller message action is not implemented.

Required coverage:

- unit/module:
  - test `reset-volume` message routing,
  - test stored-key removal,
  - test reset no-op behavior when already `100`,
  - test popup reset button wiring,
  - test reset while muted,
  - test reset updates both UI and controller contract.
- browser automation:
  - recommended for popup reset flow if automation harness exists.
- manual Firefox:
  - reset returns tab volume to `100%`,
  - popup reflects `100`,
  - persisted value is cleared for the current origin.
- performance:
  - no dedicated performance lane.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- `test/popup.test.js`

### 3. Fine / Coarse Keyboard Step In Popup

Current status:

- behavior already exists in popup as inline logic,
- no automated tests exist.

Required coverage:

- unit/module:
  - extract or otherwise test step computation,
  - verify arrow key directions,
  - verify `Shift` modifies the step size,
  - verify clamp to `0..200`,
  - verify mute-state exit behavior when keys change volume,
  - verify `m` and `r` shortcut wiring.
- browser automation:
  - optional.
- manual Firefox:
  - keyboard shortcuts work when popup is focused,
  - controls remain consistent with slider and mute state.
- performance:
  - no dedicated lane.

Likely files:

- `test/popup-keyboard.test.js`
- `test/popup.test.js`

### 4. Media Element Count In `get-volume`

Current status:

- popup already expects `mediaCount` when present and falls back to `hasMedia`,
- controller does not currently expose `mediaCount`.

Required coverage:

- unit/module:
  - test exact `mediaCount` values,
  - test `hasMedia` consistency with count,
  - test popup rendering for `0`, `1`, and multiple media elements,
  - test pluralization or display wording consistency.
- browser automation:
  - optional.
- manual Firefox:
  - pages with no media, one media element, and several media elements display the correct state.
- performance:
  - verify media counting does not meaningfully regress pages with many media elements.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- `test/popup.test.js`

### 5. Storage Error Handling In `init()`

Current status:

- planned, not implemented.

Required coverage:

- unit/module:
  - test `storage.get` rejection fallback to `100`,
  - test `console.warn`,
  - test volume still applies after failure,
  - test content-script behavior when controller init fails then message handling continues safely.
- browser automation:
  - not required.
- manual Firefox:
  - optional targeted smoke check if storage failure can be reproduced in development.
- performance:
  - no dedicated lane.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js)

### 6. Relative Step Volume

Current status:

- planned in docs, not implemented in current code.

Required coverage:

- unit/module:
  - positive delta,
  - negative delta,
  - clamp behavior,
  - non-finite delta no-op behavior,
  - interaction with muted state if supported through the same controller state.
- browser automation:
  - not required.
- manual Firefox:
  - only if surfaced through popup or another real user interaction.
- performance:
  - verify repeated step messages do not desynchronize state.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)

### 7. Extended State Query

Current status:

- planned in docs, not implemented in current code.

Required coverage:

- unit/module:
  - payload shape and field presence,
  - muted and unmuted variants,
  - compatibility with popup initialization,
  - future compatibility for extra state fields such as `isLocked`.
- browser automation:
  - recommended if popup init migrates to `get-state`.
- manual Firefox:
  - popup opens with correct slider and mute state from a single round-trip.
- performance:
  - no dedicated lane.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)
- `test/popup.test.js`

### 8. Volume Fade

Current status:

- planned in docs, not implemented in current code.

Required coverage:

- unit/module:
  - staged progression,
  - default options,
  - target clamping,
  - final persistence only after completion,
  - interrupted or overlapping fade behavior,
  - muted-state interaction if supported.
- browser automation:
  - not required initially.
- manual Firefox:
  - audible progression behaves as expected on real media,
  - final slider state and effective output match.
- performance:
  - required,
  - verify no timer explosion,
  - verify repeated fades do not leave stale timers or duplicate work.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)

### 9. Badge Volume Display

Current status:

- planned, not implemented,
- no background script exists in [`manifest.json`](/d:/Documents/current_work/volume-master/manifest.json).

Required coverage:

- unit/module:
  - test badge text update,
  - test color thresholds,
  - test badge clearing,
  - test content-script or controller notification contract,
  - test manifest/background registration once added.
- browser automation:
  - recommended for one stable badge update flow.
- manual Firefox:
  - badge updates on supported tabs,
  - badge clears on unsupported or inactive-script cases,
  - color thresholds match design intent.
- performance:
  - verify rapid volume changes do not flood or lag badge updates.

Likely files:

- `test/background.test.js`
- [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js)
- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)

### 10. Volume Lock

Current status:

- planned, not implemented.

Required coverage:

- unit/module:
  - setter interception behavior,
  - unlock restore behavior,
  - toggle-message contract,
  - state exposure in getters,
  - interaction with `setVolume`,
  - rewiring behavior for newly discovered media.
- browser automation:
  - optional.
- manual Firefox:
  - site-driven volume resets are resisted while locked,
  - unlocking restores normal site control.
- performance:
  - required,
  - verify no repeated property redefinition leaks,
  - verify lock on many media elements remains stable over time.

Likely files:

- [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js)

### 11. Scroll Wheel Volume Control

Current status:

- planned, not implemented.

Required coverage:

- unit/module:
  - pure delta helper tests,
  - target filtering tests,
  - preference-enabled and preference-disabled behavior,
  - clamp-through integration tests,
  - badge-update contract if badge support exists.
- browser automation:
  - optional initially,
  - add only if wheel simulation in the chosen Firefox-capable tool is reliable.
- manual Firefox:
  - wheel over media changes volume,
  - non-media scrolling is ignored,
  - `Shift` modifies step size,
  - stored preference enables and disables the feature.
- performance:
  - required,
  - repeated wheel events must not lag,
  - many rapid events must not desynchronize volume,
  - no duplicate listeners.

Likely files:

- `test/scroll-control.test.js`
- [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js)

## Recommended Test File Layout

Keep the existing `node:test` layout and extend it by responsibility:

- keep controller tests in [`test/volume-controller.test.js`](/d:/Documents/current_work/volume-master/test/volume-controller.test.js),
- keep state tests in [`test/volume-state.test.js`](/d:/Documents/current_work/volume-master/test/volume-state.test.js),
- expand content-script tests in [`test/content-script.test.js`](/d:/Documents/current_work/volume-master/test/content-script.test.js),
- add `test/popup.test.js` for popup DOM, init, and event behavior,
- add `test/popup-keyboard.test.js` if keyboard step logic is extracted,
- add `test/background.test.js` when badge support lands,
- add `test/scroll-control.test.js` when scroll support lands.

Default rule:

- prefer `node:test` unless a browser-driven behavior cannot be credibly covered there.

## Manual Firefox Regression Checklist

Run this checklist whenever popup, content-script, controller wiring, or background behavior changes.

### Current Implemented Behavior

- popup opens and reflects the current volume,
- slider updates active-tab volume,
- quick preset buttons update active-tab volume,
- mute/unmute works and restores the previous level,
- reset button behavior returns the UI to `100%`,
- pages without media show the expected message,
- unsupported pages disable controls and show fallback messaging,
- boost above `100%` works after real user gesture resumes audio context,
- dynamically added media adopts the active volume,
- cross-origin media does not break playback.

### Planned Behavior To Add Once Implemented

- exact media count is displayed correctly,
- `reset-volume` clears persisted origin state,
- extended state initializes popup correctly in one request,
- badge text and color update correctly,
- lock resists site-driven volume resets,
- wheel control works only over media elements,
- fade reaches the target without visible UI or audio desync.

## Performance And Resource Checklist

### Automated Where Practical

- mutation notifications debounce to a bounded number of reapply operations,
- already wired media is not rewired repeatedly,
- repeated message handling does not corrupt controller state,
- repeated fades do not leave stale scheduled tasks,
- repeated wheel input does not create duplicate listeners or unbounded pending work,
- lock behavior does not repeatedly redefine media-element properties without cleanup.

### Manual Firefox Scenarios

- page with many media elements remains responsive,
- repeated slider dragging does not visibly lag the popup or page,
- repeated mute/unmute and reset actions do not desynchronize UI and actual output,
- long-lived tab usage does not show obvious resource growth or degraded responsiveness,
- repeated dynamic insertion of media elements does not cause duplicate audio effects or broken playback.

### Threshold Style

Use a hybrid threshold model:

- measurable assertions in automated tests where counts or state transitions can be checked directly,
- scenario-based acceptance in Firefox where exact timing numbers would be noisy or misleading.

## Verification Commands

- baseline suite: `node --test`
- targeted runs during development:
  - `node --test test/volume-controller.test.js`
  - `node --test test/content-script.test.js`
  - `node --test test/volume-state.test.js`
  - add targeted commands for future files such as `test/popup.test.js` and `test/background.test.js`
- final local gate before merge:
  - rerun full `node --test`
  - perform the manual Firefox smoke checklist
  - run browser automation smoke flows if that harness exists for the changed feature area

## Definition Of Done

A feature is not complete until all applicable items below are satisfied:

- logic and edge cases are covered by unit or helper tests,
- extension seams and payload contracts are covered by module or contract tests,
- `node --test` passes,
- manual Firefox validation passes for browser-visible behavior,
- browser automation passes for stable, high-value flows when that layer applies,
- performance and resource-regression checks pass when the feature can regress under scale, event storms, or long-lived usage.

If a payload changes between popup, content script, controller, storage, or background, contract coverage is mandatory.
