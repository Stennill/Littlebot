LittleBot
========

A minimal corner desktop assistant prototype built with Electron.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Run in development:

```bash
npm start
```

Notes

- Uses the Web Speech API for speech-to-text and SpeechSynthesis for TTS (works in Electron on supported platforms).
- The main process currently contains placeholder reply logic. Replace with an AI backend (OpenAI HTTP API or local model) as needed.
- To build a Windows installer, configure `electron-builder` and run `npm run dist`.
 - Anthropic: LittleBot can call Anthropic's API if you set an API key. Set the environment variable `ANTHROPIC_API_KEY` before running, for example on Windows PowerShell:
- Anthropic: LittleBot can call Anthropic's API. You can set the key either via the environment variable `ANTHROPIC_API_KEY`, or use the in-app Settings pane (gear icon) to save it locally.

Environment variable (PowerShell):

```powershell
$env:ANTHROPIC_API_KEY = 'your_key_here'
npm start
```

Or open the app, click the gear button, paste your Anthropic key, and click Save. The key is stored in the app's user data folder.

The app will send the user's text to Anthropic and speak the assistant's reply. If no API key is present, LittleBot uses a simple rule-based fallback.
