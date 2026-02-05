# Speech Recognition Issue in Electron

## Problem
The Web Speech API (used for microphone input) requires Google's cloud service, which can fail in Electron with a "network" error. This is a known limitation.

## Current Status
- ✅ Text-to-Speech (bot speaking) works perfectly
- ❌ Speech-to-Text (microphone) has network issues in Electron
- ✅ Text input works perfectly as alternative

## Workaround: Use Text Input
The easiest solution is to **type your messages** in the input box instead of using the microphone. This works perfectly and LittleBot will still speak the responses.

## Alternative Solutions

### Option 1: Install a Local Speech Recognition Library
We can install `node-record-lpcm16` + `@google-cloud/speech` or `speech-to-text` for offline recognition.

**Pros:** Works offline, no cloud dependency
**Cons:** Requires npm packages, larger app size

### Option 2: Use Windows Speech Recognition API
We can call Windows' native speech recognition via Node.js child process.

**Pros:** Uses built-in Windows features
**Cons:** Windows-only, more complex implementation

### Option 3: Use the microphone in Chrome/Edge
Open LittleBot as a web app instead of Electron (would need a different architecture).

**Pros:** Web Speech API works better in browsers
**Cons:** Loses desktop app features

## Recommended Approach
For now, **use text input** by typing your messages. If you really need voice input, let me know and I can implement Option 1 (local speech recognition library).

## Why This Happens
- Web Speech API's `webkitSpeechRecognition` connects to Google's servers
- Electron's network restrictions can block this connection
- The API wasn't designed for Electron desktop apps
- Google may require special API keys for desktop use

## What I've Done
- ✅ Added microphone permission handlers
- ✅ Enabled speech-input Chromium flag
- ✅ Added network permission checks
- ✅ Added detailed error messages
- ✅ Text input remains fully functional
