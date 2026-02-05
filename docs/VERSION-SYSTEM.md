# LittleBot Version Tracking System

## Overview
LittleBot can now see its current version and all changes made to its program. This information is automatically loaded at startup and included in every conversation context.

## Files

### version.json
Contains the current version number, codename, build date, and complete changelog with technical details.

**Structure:**
```json
{
  "version": "1.2.0",
  "codename": "Arc Reactor",
  "buildDate": "2026-02-02",
  "changelog": [...]
}
```

### update-version.js
Helper script to update the version and add changelog entries.

**Usage:**
```bash
node update-version.js <version> <updateName> <change1> [change2] ...
```

**Example:**
```bash
node update-version.js 1.3.0 "Dark Mode Update" "Added dark theme toggle" "Updated color palette" "Added theme persistence"
```

## How It Works

1. **Startup**: `main.js` loads `version.json` via `loadVersionInfo()` function
2. **Context Injection**: Version info is automatically added to LittleBot's system prompt on every message
3. **Self-Awareness**: LittleBot can answer questions about its version, capabilities, and recent changes

## Version Context Format

LittleBot receives this information in every conversation:

```
Current Version: 1.2.0 "Arc Reactor" (Built: 2026-02-02)
Latest Changes (Arc Reactor Update):
- Replaced blinking eye orb with Arc Reactor HUD design
- Added spinning rings, pulsing core, and orbiting particles
- Updated panel to cyan theme matching Arc Reactor colors
- Implemented conversational memory learning system
- ... (and more)

Note: You can see your current version and all changes made to your program.
```

## User Questions LittleBot Can Answer

- "What version are you?"
- "What's your current version?"
- "What changes were made recently?"
- "What's new in this version?"
- "Tell me about your latest update"
- "What features do you have?"

LittleBot will respond with accurate information from version.json.

## Updating Version

### Manual Method
Edit `version.json` directly and update:
- `version` field
- `buildDate` field  
- Add new entry to `changelog` array (at the beginning)

### Script Method (Recommended)
Use the helper script:

```bash
node update-version.js 1.3.0 "Feature Name" "Change 1" "Change 2"
```

This automatically:
- Updates version number
- Sets current date
- Creates changelog entry with your changes
- Maintains changelog history

## Benefits

1. **Self-Documentation**: LittleBot knows what it can do
2. **User Transparency**: Users can ask about features and updates
3. **Development Tracking**: Clear history of changes
4. **Automated Awareness**: No manual prompt updates needed

## Example Interaction

**User:** "What version are you?"

**LittleBot:** "I'm running version 1.2.0 'Arc Reactor', built on February 2, 2026. This version includes the new Arc Reactor HUD design with spinning rings and pulsing core, cyan-themed panel, conversational memory learning, and system time integration."

**User:** "What's changed recently?"

**LittleBot:** "The latest Arc Reactor Update includes: Arc Reactor HUD orb design replacing the blinking eye, cyan color theme matching the orb, conversational memory system for learning and remembering facts, system time integration, and system prompt protection with auto-backup."
