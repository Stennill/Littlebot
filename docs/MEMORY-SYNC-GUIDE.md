# LittleBot Memory GitHub Sync Guide

## Overview
LittleBot can now sync its memory file with GitHub, allowing you to:
- Backup your memory data to the repository
- Share memory across multiple devices
- Version control your knowledge base
- Pull updates from GitHub after changes

## Files

### littlebot-memory.json (in repository)
The memory file stored in your GitHub repository. Contains:
- **Facts**: Personal information about the user (up to 100 entries)
- **Topics**: Knowledge organized by subject
- **Conversations**: Recent conversation summaries

⚠️ **Privacy Note**: This file contains personal information. If using a public repository, consider adding it to `.gitignore` and using a private repository instead.

## How to Use

### Push Memory to GitHub

1. Open LittleBot settings (⚙️ button)
2. Scroll to "Memory GitHub Sync" section
3. Click "Push to GitHub"
4. The current memory file will be copied to the repository folder
5. Commit and push to GitHub manually:
   ```powershell
   git add littlebot-memory.json
   git commit -m "Update memory"
   git push origin main
   ```

### Pull Memory from GitHub

1. First, pull the latest from GitHub:
   ```powershell
   git pull origin main
   ```
2. Open LittleBot settings (⚙️ button)
3. Scroll to "Memory GitHub Sync" section
4. Click "Pull from GitHub"
5. Your current memory will be backed up automatically
6. Memory from the repository will be loaded

## Workflow for Multiple Devices

### On Device A (e.g., PC):
1. Use LittleBot normally - it learns and stores facts
2. Click "Push to GitHub" in settings
3. Commit and push:
   ```powershell
   git add littlebot-memory.json
   git commit -m "Update memory from PC"
   git push origin main
   ```

### On Device B (e.g., Laptop):
1. Pull latest from GitHub:
   ```powershell
   git pull origin main
   ```
2. Click "Pull from GitHub" in LittleBot settings
3. LittleBot now has all the knowledge from Device A!

## Automatic Backup

When you pull memory from GitHub, your current memory is automatically backed up to:
```
%APPDATA%\littlebot\littlebot-memory.json.backup
```

You can restore this backup if needed by copying it back:
```powershell
Copy-Item "$env:APPDATA\littlebot\littlebot-memory.json.backup" "$env:APPDATA\littlebot\littlebot-memory.json" -Force
```

## Technical Details

### Memory Paths

**Local Memory (Active):**
```
C:\Users\[YourName]\AppData\Roaming\littlebot\littlebot-memory.json
```

**Repository Memory:**
```
D:\Projects\LittleBot\littlebot-memory.json
```

**Backup:**
```
C:\Users\[YourName]\AppData\Roaming\littlebot\littlebot-memory.json.backup
```

### Functions Added

**In memory.js:**
- `syncWithGitHub(repoPath)` - Copy memory to repository
- `pullFromGitHub(repoPath)` - Load memory from repository
- `getRepoPath()` - Get the repository path

**In main.js (IPC handlers):**
- `memory-sync-github` - Push to repo
- `memory-pull-github` - Pull from repo

**In preload.js (exposed API):**
- `memorySyncGitHub()` - Trigger sync
- `memoryPullGitHub()` - Trigger pull

## Privacy Considerations

The memory file may contain:
- Your name and personal preferences
- Topics you've discussed
- Facts about your work, interests, hobbies
- Conversation context

**Recommendations:**
1. Use a **private** GitHub repository
2. Or add `littlebot-memory.json` to `.gitignore`:
   ```gitignore
   littlebot-memory.json
   ```
3. Only sync if you need cross-device functionality
4. Review the memory file before committing

## Troubleshooting

**"Memory file not found in repository"**
- Make sure you've pushed the file to GitHub first
- Check that `littlebot-memory.json` exists in the repo

**"Failed to sync"**
- Ensure you have write permissions to the repository folder
- Check that the LittleBot app is running from the repo directory

**Memory didn't update**
- After pulling, restart LittleBot to ensure everything is loaded
- Check the backup file to see what was replaced

## Example Commands

**Quick sync workflow:**
```powershell
# In LittleBot, click "Push to GitHub"
git add littlebot-memory.json
git commit -m "Update memory $(Get-Date -Format 'yyyy-MM-dd')"
git push origin main
```

**Pull on another device:**
```powershell
git pull origin main
# In LittleBot, click "Pull from GitHub"
```

## Future Enhancements

Potential improvements for the memory sync system:
- Automatic git commit/push from within the app
- Merge strategies for conflicts
- Selective sync (choose which facts/topics to sync)
- Encryption for sensitive data
- Cloud storage integration (OneDrive, Google Drive)
