# Arc Sidebar – Plan & Design

## Goal
Turn Arc into a **full-height sidebar on the right side of the screen**: always visible, chat-first layout, with a built-in **debug/troubleshoot** panel to see API state, errors, and logs without opening DevTools.

---

## How It Will Look

```
┌─────────────────────────────────────┐
│ Arc                          [⚙][▼]│  ← Header: title, Settings, Debug toggle
├─────────────────────────────────────┤
│                                     │
│  [Bot] Got it, Sir. Your schedule   │
│        is clear tomorrow.           │
│                                     │
│  [You] What's on my calendar?      │
│                                     │
│  [Bot] Checking... You have 3      │  ← Messages: scrollable, full width
│        meetings today.              │
│                                     │
├─────────────────────────────────────┤
│ [ask me anything...............] [▶]│  ← Input bar: text + send (no collapse)
├─────────────────────────────────────┤
│ ▼ Debug                             │
│   Last request: 200 · claude-3-5-.. │
│   Error: (none)                     │  ← Collapsible debug: status, errors,
│   [12:34] Building context...       │     recent log lines, Copy / Clear
│   [12:34] Sending to API...          │
└─────────────────────────────────────┘
```

- **Width:** ~380–420px (fixed or resizable).
- **Height:** Full work area (top to just above taskbar).
- **Position:** Right edge of primary display.
- **Background:** Solid dark panel (no transparency) so it reads as a real sidebar.

---

## What It Needs

### 1. Window (main.js)
- **Dimensions:** `SIDEBAR_WIDTH = 420`, height = `workArea.height`.
- **Position:** `x = workArea.x + workArea.width - SIDEBAR_WIDTH`, `y = workArea.y`.
- **Options:** `transparent: false`, `frame: false` (custom drag region), `alwaysOnTop: true` optional, `resizable: true` optional for width.
- **Drag:** `-webkit-app-region: drag` on header so the window can still be moved.

### 2. Layout (HTML + CSS)
- **Structure:** One column, full height.
  - **Header:** “Arc” title, Settings (gear), Debug panel toggle (chevron/button).
  - **Messages:** `flex: 1`, `overflow-y: auto`, scrollable; messages keep current bubble styling.
  - **Input:** Fixed at bottom; single text field + send button (orb or ▶).
- **No collapse/orb-only mode** – sidebar is always expanded.
- **Panel always visible** – no “panel hidden until bot replies”; messages area is the main content.

### 3. Debug / Troubleshoot Panel
- **Collapsible** (e.g. “Debug” with ▼/▲).
- **Content:**
  - **Status line:** Last API result (e.g. “200 OK” or “Error: …”), model name, optional token counts if we have them.
  - **Last error:** Single line or short block; clear when next request succeeds.
  - **Log stream:** Last N lines (e.g. 50) of debug messages from main process (e.g. “Building context…”, “Sending to API…”, “Response received”).
- **Actions:** “Copy logs”, “Clear logs”.
- **IPC:** Main process sends `arc-debug` (or similar) with `{ type: 'log' | 'error' | 'status', message, detail? }`; renderer appends to the debug panel.

### 4. Main Process (main.js)
- **Log/debug channel:** When doing API work (build context, send request, get response, extract learnings, memory clear, etc.), call a small helper that:
  - `console.log`s as today, and
  - Sends the same (or a short summary) to the renderer via `webContents.send('arc-debug', payload)`.
- **Structured payloads:** e.g. `{ ts, type: 'log'|'error'|'status', message, detail? }` so the UI can show “Last request: 200”, “Error: …”, and a scrolling log.

### 5. Preload
- Expose `onArcDebug(callback)` so the renderer can subscribe to `arc-debug` events.

### 6. Renderer Logic (renderer.js)
- **Remove:** Collapse/expand bar, “panel hidden” (panel is the main content), hide timer for panel (optional: keep a simple “clear after 10 min” for messages only if desired).
- **Keep:** Message append, send to main, local commands (file search, “open 1”, recent files with stricter pattern), history building, settings modal.
- **Input:** Always visible at bottom; Enter or send button sends.
- **Debug:** On `arc-debug` events, append to debug panel; update “Last error” / “Last request” from payload; implement Copy/Clear.

### 7. Styling
- Sidebar: solid background (e.g. dark `#1c2029`), border-left or none.
- Header: compact, drag region, buttons for Settings and Debug toggle.
- Messages: same message/bubble styles as now, full width of sidebar.
- Debug: monospace, smaller font, muted background, clear separation from chat.

---

## Implementation Order
1. Plan (this doc).
2. main.js: window size/position for full-height right sidebar; send debug events on API path.
3. preload: expose `onArcDebug`.
4. index.html: new sidebar structure (header, messages, input, debug panel).
5. styles.css: sidebar layout, header, messages, input, debug panel.
6. renderer.js: sidebar behavior (no collapse), wire debug panel (subscribe, append, Copy/Clear).

---

## Debug Events (Suggested)

| type    | When                         | message / detail |
|---------|------------------------------|-------------------|
| `log`   | Context build, send, response | Short one-liner   |
| `status`| After reply received         | e.g. "200" or "Error" |
| `error` | On catch / API failure       | Error message + optional stack |

This gives a single place to see “what Arc is doing” and “what went wrong” without opening DevTools.
