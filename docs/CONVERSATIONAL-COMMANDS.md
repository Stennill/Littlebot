# LittleBot Conversational Commands Quick Reference

## Memory Commands

### Save Information (Many Ways!)
You can save information naturally using any of these phrases:

**Traditional:**
- **"Remember that I like coffee"**
- **"Save to your memory that I prefer dark mode"**

**Casual/Natural:**
- **"Keep in mind that I work from home"**
- **"Make a note that I'm left-handed"**
- **"Don't forget I have two cats"**
- **"Write down that my birthday is June 5th"**
- **"Store this: I'm allergic to peanuts"**
- **"Log that I use Linux"**
- **"Add to your notes that I like jazz"**

All of these work! Just speak naturally - LittleBot understands many variations.

### Retrieve Information  
- **"What do you remember about me?"** - Lists relevant facts
- **"What do you know about coffee?"** - Topic-based retrieval

### GitHub Sync Commands

#### Push Memory to GitHub
- **"Sync my memory to GitHub"**
- **"Send my memory to GitHub"**
- **"Push my memory to the repository"**

LittleBot acknowledges and syncs in the background.

#### Pull Memory from GitHub
- **"Pull my memory from GitHub"**
- **"Update my memory from GitHub"**
- **"Load my memory from GitHub"**

LittleBot acknowledges and loads the repository memory.

## Automatic Features

### Auto-Sync (Every 30 Minutes)
Your memory automatically syncs to the GitHub repository every 30 minutes. You'll see this in the console:
```
[Auto-sync] Memory synced to GitHub at 3:45:30 PM
```

### Auto-Learning
LittleBot automatically learns from conversations without explicit commands. It extracts:
- Facts about you
- Topics you discuss
- Preferences you mention

## Manual Controls (Settings UI)

In Settings (⚙️ button):
- **Push to GitHub** button - Manual sync
- **Pull from GitHub** button - Manual pull
- Both provide visual feedback

## How It Works

1. **You talk to LittleBot** naturally
2. **LittleBot learns** automatically in the background
3. **Every 30 minutes** - Memory syncs to repository folder
4. **You manually commit/push** when ready:
   ```powershell
   git add littlebot-memory.json
   git commit -m "Update memory"
   git push
   ```

## Example Conversations

### Saving Information
**You:** "Remember that my name is Stephen"  
**LittleBot:** "Got it! I'll remember that your name is Stephen."

### Syncing
**You:** "Sync my memory to GitHub"  
**LittleBot:** "I'll sync your memory to GitHub right now."

### Retrieving
**You:** "What do you remember about me?"  
**LittleBot:** "I remember that your name is Stephen, you prefer to be addressed as 'Sir', and you're working on LittleBot..."

## Version

Current: **v1.2.1 "Arc Reactor"**
- Auto-sync every 30 minutes ✅
- Conversational sync commands ✅
- Background learning ✅
