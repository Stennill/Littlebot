Arc Notion Sidebar
=================

Arc is a **right-side desktop sidebar** (Electron app) focused on **Notion schedule integration**.

### What you get

- **Always-visible sidebar window** (frameless) designed to live on the right edge of your screen
- **Settings UI** for API key and integrations

### Requirements

- **Node.js** (for development/building)
- Windows 10/11 recommended (installer targets Windows)

### Run from source (development)

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm start
```

### Configure your API key

You can set your Anthropic key either:

- **In-app**: open **Settings** (gear icon) → paste key → **Save**
- **Or via env var** (PowerShell):

```powershell
$env:ANTHROPIC_API_KEY = "your_key_here"
npm start
```

### Build an installable EXE (Windows)

This repo uses **electron-builder** to generate installable artifacts.

Build everything for Windows:

```powershell
npm install
npm run dist:win
```

After a successful build, outputs are in `dist\`:

- **`Arc Notion Sidebar Setup x.x.x.exe`**: NSIS installer (Start Menu + Desktop shortcuts)
- **`Arc Notion Sidebar x.x.x.exe`**: portable executable (no install)
- **`Arc Notion Sidebar x.x.x-win.zip`**: zip of the portable build

For more detail (and troubleshooting), see `docs/BUILD-INSTALLER.md`.

### Update the EXE after you make changes

1. Make your code/UI changes.
2. (Recommended) bump the version so the filename changes.
3. Rebuild the EXE/installer.

#### Bump version numbers (recommended)

The build filenames come from `package.json` **version**. The app also tracks version/changelog in `version.json`.

Use the helper to update **both** files at once:

```powershell
node update-version.js 1.3.1 "Release name" "Change one" "Change two"
```

Or via npm:

```powershell
npm run version:bump -- 1.3.1 "Release name" "Change one" "Change two"
```

Then rebuild:

```powershell
npm run dist:win
```

#### Rebuild without changing the version

If you don’t care about the versioned filename, just rebuild:

```powershell
npm run dist:win
```

### Troubleshooting builds (Windows symlink error)

If you see:

> `Cannot create symbolic link : A required privilege is not held by the client.`

Fix by doing **one** of these:

- Run the build terminal **as Administrator**, then run `npm run dist:win`
- Or enable Windows **Developer Mode**, then run `npm run dist:win`

### Notes

- Speech features use the **Web Speech API** and **SpeechSynthesis** (availability varies by OS/runtime).
