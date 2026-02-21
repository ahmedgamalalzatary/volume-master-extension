# Volume Control

A browser extension that boosts and controls the volume of any tab from 0% up to 400%.

## Features

- **Volume Boost**: Amplify audio up to 400% using Web Audio API
- **Fine-grained Control**: Slider with smart snapping (1% steps below 10%, 10% steps above)
- **Quick Presets**: One-click buttons for 10%, 20%, 50%, 100%, 200%, and 400%
- **Keyboard Shortcuts**: Press 0-4 for 0%-400%, arrow keys for stepping
- **Visual Feedback**: Color-coded volume display (purple → warning orange → danger red)
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
├── content-script.js    # Web Audio volume control logic
├── popup/
│   ├── popup.html       # Extension popup UI
│   ├── popup.css        # Styling (dark theme)
│   └── popup.js         # Popup interaction logic
├── icons/
│   └── icon.svg         # Extension icon
└── README.md
```

## How It Works

### Volume Amplification (>100%)

Browsers cap native `element.volume` at 1.0 (100%). To exceed this limit, the extension routes audio through a Web Audio `GainNode` which can amplify beyond 1.0:

1. When media plays, the content script connects the element to an `AudioContext` with a `GainNode`
2. The gain value is set to `desiredVolume / 100`
3. Native volume is kept at 1.0 — the GainNode handles all amplification

### User Gesture Requirement

Firefox's autoplay policy requires a user gesture in the tab to allow an `AudioContext` to run. The extension works around this by:

- Listening for the `play` event on media elements (a genuine user gesture)
- Creating and resuming the `AudioContext` inside that event handler
- By the time the popup is opened, the context is already running

## Permissions

- `activeTab`: Access the current tab's content
- `tabs`: Query tab information and send messages to content scripts

