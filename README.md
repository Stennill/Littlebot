Arc Notion Sidebar
=================

A desktop assistant sidebar built with Electron, with Notion schedule integration.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Run in development:

```bash
npm start
```

Building an installable (Windows)

To create installers you can run on another machine:

```bash
npm install
npm run dist
```

Output goes to the `dist/` folder:

- **Arc Notion Sidebar Setup x.x.x.exe** – NSIS installer: run on another PC to install to Program Files, with desktop and Start Menu shortcuts. Choose install location during setup.
- **Arc Notion Sidebar x.x.x.exe** – Portable: copy the exe (and the rest of the folder) anywhere and run; no install step.
- **Arc Notion Sidebar x.x.x-win.zip** – Zip of the portable build for sharing.

On the other machine, run the installer or the portable exe, then open Settings (gear) to add your Anthropic API key and Notion details.

Notes

- Uses the Web Speech API for speech-to-text and SpeechSynthesis for TTS (works in Electron on supported platforms).
- The main process currently contains placeholder reply logic. Replace with an AI backend (OpenAI HTTP API or local model) as needed.
- To build a Windows installer, configure `electron-builder` and run `npm run dist`.
 - Anthropic: Arc Notion Sidebar can call Anthropic's API if you set an API key. Set the environment variable `ANTHROPIC_API_KEY` before running, for example on Windows PowerShell:
- Anthropic: Arc Notion Sidebar can call Anthropic's API. You can set the key either via the environment variable `ANTHROPIC_API_KEY`, or use the in-app Settings pane (gear icon) to save it locally.

Environment variable (PowerShell):

```powershell
$env:ANTHROPIC_API_KEY = 'your_key_here'
npm start
```

Or open the app, click the gear button, paste your Anthropic key, and click Save. The key is stored in the app's user data folder.

The app will send the user's text to Anthropic and speak the assistant's reply. If no API key is present, Arc Notion Sidebar uses a simple rule-based fallback.
