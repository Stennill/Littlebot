# Building an Installable Arc Sidebar

The Arc Notion Sidebar can be built into installable packages for Windows so others can run it without Node.js or a dev environment.

## Prerequisites

- Node.js installed
- Dependencies installed: `npm install`

## Build commands

| Command | Output |
|--------|--------|
| `npm run dist` | Build for current OS (Windows: installer + portable + zip) |
| `npm run dist:win` | Windows only: NSIS installer, portable exe, and zip |
| `npm run pack` | Unpacked app in `dist/` (faster, for testing) |

## If the build fails with "Cannot create symbolic link"

electron-builder downloads a code-signing helper that contains symlinks. On Windows, creating symlinks needs either:

1. **Run the build as Administrator**  
   Right‑click PowerShell or Terminal → "Run as administrator", then:
   ```powershell
   cd "c:\my\Arc\Littlebot"
   npm run dist:win
   ```
2. **Or enable Developer Mode** (allows symlinks without admin)  
   Settings → Update & Security → For developers → **Developer Mode** → On. Then run `npm run dist:win` in a normal terminal.

The project has **code signing disabled** (`electron-builder.yml`: `signAndEditExecutable: false`), so the built app will use the default Electron icon and will not be signed. It will still run and install normally.

## Where to find the installable files

After a successful `npm run dist` or `npm run dist:win`, look in the **`dist/`** folder:

- **`Arc Notion Sidebar Setup 1.3.0.exe`** — NSIS installer (recommended for most users)
  - Optional install location, Start Menu and Desktop shortcuts
- **`Arc Notion Sidebar 1.3.0.exe`** — Portable executable (no install; run from any folder)
- **`Arc Notion Sidebar 1.3.0-win.zip`** — Zip of the app (unzip and run the exe inside)

## First run after install

1. Run the app (from Start Menu, Desktop shortcut, or the portable exe).
2. Open **Settings** (gear icon) and enter an **Anthropic API key**.
3. Save; the sidebar is ready to use.

Version numbers in filenames come from **both** `version.json` and `package.json`; they must match so the built .exe/installer names are correct.

### Bumping the version before a new build

Run the version helper (then build):

```powershell
node update-version.js <version> "<release name>" "<change1>" "<change2>" ...
npm run dist:win
```

Example — release 1.3.1 "Bug fixes":

```powershell
node update-version.js 1.3.1 "Bug fixes" "Fixed sidebar resize" "Updated settings UI"
npm run dist:win
```

This updates **version.json** (version, buildDate, changelog) and **package.json** (version). The next `dist:win` will produce e.g. `Arc Notion Sidebar Setup 1.3.1.exe` and `Arc Notion Sidebar 1.3.1.exe`.
