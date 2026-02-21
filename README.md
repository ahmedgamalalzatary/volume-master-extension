# Volume Control

A browser extension that controls the volume of any tab from 0% to 200%.

## Features

- **Volume Control**: Adjust volume from 0% to 200%
- **Fine-grained Control**: Smooth slider with 1% steps
- **Quick Presets**: One-click buttons for 10%, 20%, 30%, 50%, 100%, 150%, and 200%
- **Keyboard Shortcuts**: Arrow keys step ±10%
- **Cross-browser**: Works on both Chrome and Firefox

## Installation

### Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this extension folder

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file

## Project Structure

```
├── manifest.json        # Extension manifest (Manifest V3)
├── content-script.js    # Volume control logic
├── popup/
│   ├── popup.html       # Extension popup UI
│   ├── popup.css        # Styling (dark theme)
│   └── popup.js         # Popup interaction logic
├── icons/
│   └── icon.svg         # Extension icon
└── README.md
```

## How It Works

The extension uses a hybrid approach to control volume:

- **For volumes up to 100%**: Directly sets the `volume` property on all `<audio>` and `<video>` elements.
- **For volumes above 100% (boosting)**: Routes audio through a Web Audio `AudioContext` with a `GainNode`, which can amplify the signal beyond the browser's native 100% limit. Native `el.volume` is kept at 1.0 and the GainNode handles all amplification.

This approach includes safeguards to:

1. Avoid processing cross-origin media without CORS headers, which would permanently mute those elements.
2. Wait for a user gesture to resume a suspended `AudioContext`, preventing tabs from going silent on page load.
3. Pick up dynamically added media elements via a debounced `MutationObserver`.

## Permissions

- `activeTab`: Access the current tab's content
- `tabs`: Query tab information and send messages to content scripts

