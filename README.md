# Volume Control

A browser extension that controls the volume of any tab from 0% to 100%.

## Features

- **Volume Control**: Adjust volume from 0% to 100%
- **Fine-grained Control**: Smooth slider with 1% steps
- **Quick Presets**: One-click buttons for 10%, 20%, 50%, and 100%
- **Keyboard Shortcuts**: Arrow keys step ±5%
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

The extension directly sets the `volume` property on all `<audio>` and `<video>` elements in the page:

1. Content script listens for volume change messages from the popup
2. Volume is applied to all media elements via `el.volume = desiredVolume / 100`
3. A `MutationObserver` picks up dynamically added media elements

## Permissions

- `activeTab`: Access the current tab's content
- `tabs`: Query tab information and send messages to content scripts

