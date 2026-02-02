const { app, BrowserWindow, ipcMain, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const memoryStore = require('./memory');

let speechProcess = null;
let wakeWordProcess = null;
let mainWindow = null;
let settingsWindow = null;
let historyWindow = null;
let memoryWindow = null;
let storedConfig = {};
let storedApiKey = null;
let activeSessionId = null; // Track current active session ID
let systemPrompt = null; // Cached system prompt
let versionInfo = null; // Cached version information

// Load version information from file
async function loadVersionInfo() {
  try {
    const versionPath = path.join(__dirname, 'version.json');
    const versionData = await fs.readFile(versionPath, 'utf8');
    versionInfo = JSON.parse(versionData);
    console.log(`LittleBot ${versionInfo.version} (${versionInfo.codename}) loaded`);
    return versionInfo;
  } catch (err) {
    console.error('Failed to load version info:', err);
    // Fallback version
    versionInfo = { version: '1.0.0', codename: 'Unknown', changelog: [] };
    return versionInfo;
  }
}

// Load system prompt from file
async function loadSystemPrompt() {
  try {
    const promptPath = path.join(__dirname, 'system-prompt.txt');
    systemPrompt = await fs.readFile(promptPath, 'utf8');
    console.log('System prompt loaded successfully');
    return systemPrompt;
  } catch (err) {
    console.error('Failed to load system prompt:', err);
    // Fallback to basic prompt
    systemPrompt = 'You are LittleBot, a helpful desktop assistant.';
    return systemPrompt;
  }
}

// Save system prompt to file (with backup)
async function saveSystemPrompt(newPrompt) {
  try {
    const promptPath = path.join(__dirname, 'system-prompt.txt');
    const backupPath = path.join(__dirname, 'system-prompt.backup');
    
    // Create backup if file exists
    try {
      const currentPrompt = await fs.readFile(promptPath, 'utf8');
      await fs.writeFile(backupPath, currentPrompt, 'utf8');
    } catch (err) {
      // No existing file, skip backup
    }
    
    // Validate prompt contains key markers
    const lowerPrompt = newPrompt.toLowerCase();
    if (!lowerPrompt.includes('littlebot') || !lowerPrompt.includes('arc reactor')) {
      throw new Error('System prompt validation failed: missing key identity markers');
    }
    
    // Save new prompt
    await fs.writeFile(promptPath, newPrompt, 'utf8');
    systemPrompt = newPrompt;
    return true;
  } catch (err) {
    console.error('Failed to save system prompt:', err);
    throw err;
  }
}

// Get current system time formatted
function getSystemTime() {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[now.getDay()];
  const monthName = months[now.getMonth()];
  const date = now.getDate();
  const year = now.getFullYear();
  
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  return `${dayName}, ${monthName} ${date}, ${year} - ${hours}:${minutes} ${ampm} ${timezone}`;
}

function createMemoryWindow() {
  if (memoryWindow) {
    memoryWindow.focus();
    return;
  }

  memoryWindow = new BrowserWindow({
    width: 750,
    height: 700,
    frame: true,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    title: 'LittleBot Memory',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    }
  });

  memoryWindow.loadFile(path.join(__dirname, 'renderer', 'memory.html'));
  memoryWindow.center();

  memoryWindow.on('closed', () => {
    memoryWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 700,
    frame: true,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    title: 'LittleBot Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.center();

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 600,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    }
  });

  // Grant microphone permission automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') {
      callback(true); // Allow microphone access
    } else {
      callback(false);
    }
  });
  
  // Also handle permission checks
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media' || permission === 'microphone') {
      return true;
    }
    return false;
  });

  mainWindow = win;
  
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Position at bottom-right corner (no margin)
  try {
    const bounds = win.getBounds();
    const disp = screen.getPrimaryDisplay();
    const wa = disp.workArea;
    const x = wa.x + wa.width - bounds.width;
    const y = wa.y + wa.height - bounds.height;
    win.setPosition(x, y);
  } catch (e) {
    // ignore if screen APIs not available
  }
}

const configFileName = 'littlebot-config.json';
const historyFileName = 'littlebot-history.json';

function getConfigPath() {
  return path.join(app.getPath('userData'), configFileName);
}

function getHistoryPath() {
  return path.join(app.getPath('userData'), historyFileName);
}

async function readConfig() {
  try {
    const p = getConfigPath();
    const txt = await fs.readFile(p, 'utf8');
    const cfg = JSON.parse(txt);
    storedConfig = cfg || {};
    storedApiKey = storedConfig?.anthropicKey || null;
  } catch (err) {
    storedConfig = {};
    storedApiKey = null;
  }
}

async function writeConfig(cfg) {
  try {
    const p = getConfigPath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write config', err);
  }
}

// Enable features needed for Web Speech API
app.commandLine.appendSwitch('enable-speech-input');
app.commandLine.appendSwitch('enable-features', 'NetworkService');

app.whenReady().then(async () => {
  await readConfig();
  await loadSystemPrompt();
  await loadVersionInfo();
  console.log('=== LittleBot Starting ===');
  console.log(`Version: ${versionInfo?.version} (${versionInfo?.codename})`);
  console.log('Config path:', getConfigPath());
  console.log('History path:', getHistoryPath());
  console.log('========================');
  
  // Check if GitHub memory is newer and auto-update
  const updateResult = await memoryStore.autoUpdateIfNewer();
  if (updateResult.updated) {
    console.log('Memory was updated from GitHub on startup');
  }
  
  createWindow();
  
  // Auto-sync and auto-update check every 30 minutes
  const AUTO_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds
  setInterval(async () => {
    try {
      // First check if we should pull updates
      const updateCheck = await memoryStore.autoUpdateIfNewer();
      if (updateCheck.updated) {
        console.log(`[Auto-update] Memory updated from GitHub at ${new Date().toLocaleTimeString()}`);
      } else {
        // Only sync if we didn't just pull
        const repoPath = memoryStore.getRepoPath();
        const result = await memoryStore.syncWithGitHub(repoPath);
        if (result.success) {
          console.log(`[Auto-sync] Memory synced to GitHub at ${new Date().toLocaleTimeString()}`);
        }
      }
    } catch (err) {
      console.error('[Auto-sync/update] Failed:', err);
    }
  }, AUTO_SYNC_INTERVAL);
  
  console.log('Auto-sync/update enabled: Checks GitHub every 30 minutes');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-api-key', async () => {
  return storedApiKey || null;
});

ipcMain.handle('set-api-key', async (event, key) => {
  storedApiKey = key || null;
  storedConfig.anthropicKey = storedApiKey;
  await writeConfig(storedConfig);
  return true;
});

ipcMain.handle('get-settings', async () => {
  return storedConfig || {};
});

ipcMain.handle('set-settings', async (event, settings) => {
  storedConfig = Object.assign({}, storedConfig, settings || {});
  storedApiKey = storedConfig.anthropicKey || null;
  await writeConfig(storedConfig);
  return storedConfig;
});

ipcMain.handle('get-history', async () => {
  try {
    const p = getHistoryPath();
    const txt = await fs.readFile(p, 'utf8');
    const data = JSON.parse(txt);
    // Return only current session if it exists and is recent (within 5 minutes)
    if (data.currentSession && data.currentSession.length > 0) {
      const lastMsg = data.currentSession[data.currentSession.length - 1];
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      if (lastMsg.timestamp && lastMsg.timestamp > fiveMinutesAgo) {
        // Session is recent, continue using it
        activeSessionId = data.activeSessionId || null;
        return data.currentSession;
      } else {
        // Session expired, will start fresh
        activeSessionId = null;
      }
    }
    return [];
  } catch (err) {
    activeSessionId = null;
    return [];
  }
});

ipcMain.handle('get-all-sessions', async () => {
  try {
    const p = getHistoryPath();
    const txt = await fs.readFile(p, 'utf8');
    const data = JSON.parse(txt);
    console.log('get-all-sessions - Found sessions:', data.sessions ? data.sessions.length : 0);
    return data.sessions || [];
  } catch (err) {
    console.log('get-all-sessions - No history file found');
    return [];
  }
});

ipcMain.handle('save-history', async (event, history) => {
  try {
    const p = getHistoryPath();
    console.log('Saving history to:', p);
    console.log('History items:', history.length);
    await fs.mkdir(path.dirname(p), { recursive: true });
    
    // Read existing data
    let data = { currentSession: [], sessions: [], activeSessionId: null };
    try {
      const txt = await fs.readFile(p, 'utf8');
      data = JSON.parse(txt);
      if (!data.sessions) data.sessions = [];
    } catch (e) {
      console.log('Creating new history file');
    }
    
    if (history.length === 0) {
      // Empty history, clear everything
      data.currentSession = [];
      data.activeSessionId = null;
      activeSessionId = null;
    } else {
      // Check if this is a new conversation (5+ minutes since last message)
      const lastSavedMsg = data.currentSession && data.currentSession.length > 0 
        ? data.currentSession[data.currentSession.length - 1] 
        : null;
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const isNewConversation = !lastSavedMsg || (lastSavedMsg.timestamp && lastSavedMsg.timestamp < fiveMinutesAgo);
      
      if (isNewConversation && history.length > 0) {
        // Start a new session
        activeSessionId = Date.now();
        data.activeSessionId = activeSessionId;
        console.log('Starting new session:', activeSessionId);
      }
      
      // Update current session
      data.currentSession = history;
      
      // Create or update the session in the sessions array
      if (activeSessionId) {
        const sessionIndex = data.sessions.findIndex(s => s.id === activeSessionId);
        const sessionData = {
          id: activeSessionId,
          name: `Conversation ${new Date(activeSessionId).toLocaleString()}`,
          timestamp: activeSessionId,
          messages: history
        };
        
        if (sessionIndex >= 0) {
          // Update existing session
          data.sessions[sessionIndex] = sessionData;
          console.log('Updated existing session:', activeSessionId);
        } else {
          // Add new session to the beginning
          data.sessions.unshift(sessionData);
          console.log('Created new session in history:', activeSessionId);
        }
      }
    }
    
    await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
    console.log('History saved successfully');
    return true;
  } catch (err) {
    console.error('Error saving history:', err);
    return false;
  }
});

ipcMain.handle('save-session', async (event, sessionName) => {
  try {
    const p = getHistoryPath();
    let data = { currentSession: [], sessions: [] };
    
    try {
      const txt = await fs.readFile(p, 'utf8');
      data = JSON.parse(txt);
      // Ensure sessions array exists
      if (!data.sessions) {
        data.sessions = [];
      }
      if (!data.currentSession) {
        data.currentSession = [];
      }
    } catch (e) {
      // File doesn't exist, use defaults
      console.log('No existing history file, using defaults');
    }
    
    console.log('Current session length:', data.currentSession ? data.currentSession.length : 0);
    
    if (data.currentSession && data.currentSession.length > 0) {
      // Save current session to sessions array
      const session = {
        id: Date.now(),
        name: sessionName || `Conversation ${new Date().toLocaleString()}`,
        timestamp: Date.now(),
        messages: data.currentSession
      };
      
      data.sessions.unshift(session); // Add to beginning
      data.currentSession = []; // Clear current session
      
      await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
      console.log('Session saved successfully');
      return true;
    }
    console.log('No current session to save');
    return false;
  } catch (err) {
    console.error('Failed to save session', err);
    return false;
  }
});

ipcMain.handle('load-session', async (event, sessionId) => {
  try {
    const p = getHistoryPath();
    const txt = await fs.readFile(p, 'utf8');
    const data = JSON.parse(txt);
    const session = data.sessions.find(s => s.id === sessionId);
    return session ? session.messages : [];
  } catch (err) {
    return [];
  }
});

ipcMain.handle('clear-history', async () => {
  try {
    const p = getHistoryPath();
    await fs.unlink(p).catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('open-settings', async () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle('open-history', async () => {
  if (historyWindow) {
    historyWindow.focus();
    return true;
  }

  historyWindow = new BrowserWindow({
    width: 600,
    height: 700,
    frame: true,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    title: 'LittleBot History',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    }
  });

  historyWindow.loadFile(path.join(__dirname, 'renderer', 'history.html'));
  historyWindow.center();

  historyWindow.on('closed', () => {
    historyWindow = null;
  });
  
  return true;
});

// Memory management handlers (internal use only)
ipcMain.handle('memory-add-fact', async (event, fact, category) => {
  return await memoryStore.addFact(fact, category);
});

ipcMain.handle('memory-add-topic', async (event, topic, knowledge) => {
  return await memoryStore.addTopicKnowledge(topic, knowledge);
});

ipcMain.handle('memory-clear', async () => {
  return await memoryStore.clearAll();
});

// GitHub memory sync handlers
ipcMain.handle('memory-sync-github', async () => {
  const repoPath = memoryStore.getRepoPath();
  const result = await memoryStore.syncWithGitHub(repoPath);
  return result;
});

ipcMain.handle('memory-pull-github', async () => {
  const repoPath = memoryStore.getRepoPath();
  const result = await memoryStore.pullFromGitHub(repoPath);
  return result;
});

// System prompt management handlers
ipcMain.handle('get-system-prompt', async () => {
  return systemPrompt;
});

ipcMain.handle('set-system-prompt', async (event, newPrompt) => {
  try {
    await saveSystemPrompt(newPrompt);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-prompt-lock-status', async () => {
  return storedConfig.systemPromptLocked || false;
});

ipcMain.handle('set-prompt-lock-status', async (event, locked) => {
  storedConfig.systemPromptLocked = locked;
  await writeConfig(storedConfig);
  return true;
});


ipcMain.handle('probe-anthropic', async (event) => {
  // Probe the Anthropic Messages API with the correct version
  const anthropicKey = storedApiKey || process.env.ANTHROPIC_API_KEY || null;
  if (!anthropicKey) return { error: 'no_api_key' };

  const endpoint = 'https://api.anthropic.com/v1/messages';
  const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-sonnet-4-5-20250929';
  const version = (storedConfig && storedConfig.anthropicVersion) || '2023-06-01';
  
  const payload = {
    model: modelToUse,
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Hello' }
    ]
  };

  const attempts = [];
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': version
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text().catch(() => '');
    attempts.push({ version, status: res.status, body: text });
    if (res.ok) {
      return { success: true, version, status: res.status, body: text, attempts };
    }
  } catch (err) {
    attempts.push({ version, status: 'network_error', body: err.message });
  }

  return { success: false, attempts };
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (e) {
    console.error('open-external failed', e);
    return false;
  }
});

// Windows Speech Recognition handlers
ipcMain.handle('start-windows-speech', async () => {
  if (speechProcess) {
    return { success: false, error: 'Already listening' };
  }

  try {
    const psScript = `
Add-Type -AssemblyName System.Speech

try {
    # Try to get trained recognizers first (more accurate)
    $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
    $recognizer = $null
    
    # Use the default recognizer (usually English-US)
    foreach ($recInfo in $recognizers) {
        if ($recInfo.Culture.Name -eq "en-US") {
            $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recInfo)
            break
        }
    }
    
    if (-not $recognizer) {
        $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    }
    
    $recognizer.SetInputToDefaultAudioDevice()
    
    # Load dictation grammar for free-form speech
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $recognizer.LoadGrammar($grammar)
    
    # Longer timeouts for more comfortable speaking
    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(5)
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(10)
    $recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(3)
    
    Write-Output "LISTENING"
    
    # Recognize with 45 second maximum timeout
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(45))
    
    if ($result -and $result.Text) {
        $confidence = [math]::Round($result.Confidence * 100, 0)
        Write-Output "TEXT:$($result.Text)"
        Write-Output "CONFIDENCE:$confidence"
    } else {
        Write-Output "NO_SPEECH"
    }
    
    $recognizer.Dispose()
} catch {
    Write-Error "Speech error: $($_.Exception.Message)"
}
    `.trim();

    speechProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
    
    let output = '';
    let text = '';
    let confidence = 0;
    
    speechProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('TEXT:')) {
          text = trimmed.substring(5);
        } else if (trimmed.startsWith('CONFIDENCE:')) {
          confidence = parseInt(trimmed.substring(11)) || 0;
        } else if (trimmed === 'LISTENING') {
          console.log('Speech recognition listening...');
        } else if (trimmed === 'NO_SPEECH') {
          console.log('No speech detected');
        }
      });
      output += data.toString();
    });
    
    speechProcess.stderr.on('data', (data) => {
      console.error('Speech error:', data.toString());
    });
    
    speechProcess.on('close', (code) => {
      if (text && mainWindow) {
        mainWindow.webContents.send('speech-result', { text, confidence });
      } else if (mainWindow) {
        mainWindow.webContents.send('speech-timeout');
      }
      speechProcess = null;
    });
    
    return { success: true };
  } catch (err) {
    console.error('Failed to start speech recognition:', err);
    speechProcess = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-windows-speech', async () => {
  if (speechProcess) {
    speechProcess.kill();
    speechProcess = null;
  }
  return { success: true };
});

// Wake word detection - continuously listens for "Hey LittleBot"
ipcMain.handle('start-wake-word', async () => {
  if (wakeWordProcess) {
    return { success: false, error: 'Wake word already active' };
  }

  try {
    const psScript = `
Add-Type -AssemblyName System.Speech

try {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $recognizer.SetInputToDefaultAudioDevice()

    # Use dictation grammar and check for wake word in the text
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $recognizer.LoadGrammar($grammar)

    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(0)
    $recognizer.InitialSilenceTimeout = [TimeSpan]::MaxValue

    Write-Output "READY"
    
    while ($true) {
        try {
            $result = $recognizer.Recognize()
            if ($result -and $result.Text) {
                $text = $result.Text.ToLower()
                # Check if wake word is present
                if ($text -match "hey.*little.*bot|hi.*little.*bot|hey.*bot") {
                    Write-Output "WAKE_WORD_DETECTED"
                    break
                }
            }
        } catch {
            Write-Error $_.Exception.Message
            break
        }
    }
    $recognizer.Dispose()
} catch {
    Write-Error "Failed to initialize: $($_.Exception.Message)"
}
    `.trim();

    wakeWordProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
    
    let ready = false;
    
    wakeWordProcess.stdout.on('data', (data) => {
      const text = data.toString().trim();
      console.log('Wake word output:', text);
      
      if (text === 'READY') {
        ready = true;
        console.log('Wake word listener ready');
        if (mainWindow) {
          mainWindow.webContents.send('wake-word-status', { status: 'listening' });
        }
      } else if (text === 'WAKE_WORD_DETECTED') {
        console.log('Wake word detected!');
        if (mainWindow) {
          mainWindow.webContents.send('wake-word-detected');
        }
        // Restart listening after detection
        wakeWordProcess.kill();
        wakeWordProcess = null;
        setTimeout(() => {
          if (mainWindow) {
            // Auto-restart wake word listening
            ipcMain.emit('restart-wake-word');
          }
        }, 100);
      }
    });
    
    wakeWordProcess.stderr.on('data', (data) => {
      console.error('Wake word error:', data.toString());
    });
    
    wakeWordProcess.on('close', (code) => {
      console.log('Wake word process closed with code:', code);
      wakeWordProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('wake-word-status', { status: 'stopped' });
      }
    });
    
    return { success: true };
  } catch (err) {
    console.error('Failed to start wake word detection:', err);
    wakeWordProcess = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-wake-word', async () => {
  if (wakeWordProcess) {
    wakeWordProcess.kill();
    wakeWordProcess = null;
  }
  return { success: true };
});

// Helper to restart wake word
ipcMain.on('restart-wake-word', async () => {
  if (!wakeWordProcess && mainWindow) {
    const result = await ipcMain.emit('start-wake-word');
  }
});

ipcMain.handle('stop-speech-output', async () => {
  // Send signal to renderer to stop TTS
  if (mainWindow) {
    mainWindow.webContents.send('stop-tts');
  }
  return { success: true };
});

ipcMain.on('assistant-message', (event, text) => {
  // If an Anthropic API key is available, call the Anthropic completion API.
  // Otherwise fall back to simple rule-based replies.
  const anthropicKey = storedApiKey || process.env.ANTHROPIC_API_KEY || null;

  async function fallbackReply(input) {
    const text = input.trim();
    const l = text.toLowerCase();

    // Greetings
    if (/^(hi|hello|hey)\b/.test(l)) return "Hello — I'm LittleBot! Ask me something.";

    // Time and date
    if (/\b(time|clock)\b/.test(l)) return `The time is ${new Date().toLocaleTimeString()}`;
    if (/\b(date|day)\b/.test(l)) return `Today is ${new Date().toLocaleDateString()}`;

    // Help
    if (/\bhelp\b/.test(l)) return "I can tell the time, open websites, perform basic calculations, and run web searches. Try: 'open github.com', 'search weather London', or 'calc 12*(3+4)'.";

    // Calculator: allow only numbers, operators and parentheses
    if (/^(calc|calculate)\s+(.+)/i.test(text)) {
      const m = text.match(/^(?:calc|calculate)\s+(.+)/i);
      const expr = (m && m[1]) || '';
      const safe = expr.replace(/\^/g, '**').trim();
      if (!/^[0-9+\-*/(). %*\n\s\^]+$/.test(safe)) return "Sorry, I can only calculate basic numeric expressions.";
      try {
        const result = Function(`"use strict";return (${safe})`)();
        return `Result: ${result}`;
      } catch (e) {
        return "I couldn't calculate that expression.";
      }
    }

    // Direct arithmetic without 'calc'
    if (/^[0-9\s()+\-*/.%^]+$/.test(text) && /[0-9].*[+\-*/%]/.test(text)) {
      const safe = text.replace(/\^/g, '**').trim();
      try {
        const result = Function(`"use strict";return (${safe})`)();
        return `Result: ${result}`;
      } catch (e) {
        // fallthrough
      }
    }

    // Open URL or site
    if (/^open\s+(.+)/i.test(text)) {
      const target = text.match(/^open\s+(.+)/i)[1].trim();
      let url = target;
      if (!/^https?:\/\//i.test(url)) {
        if (/\./.test(url)) url = 'https://' + url;
        else url = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
      try {
        shell.openExternal(url);
        return `Opened: ${url}`;
      } catch (e) {
        return `Failed to open ${url}`;
      }
    }

    // Search
    if (/^(search|find)\s+(.+)/i.test(text) || /^(what is|who is|define)\b/.test(l)) {
      const q = (text.match(/^(?:search|find)\s+(.+)/i) || [null, text])[1];
      const query = (q || text).trim();
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      try { shell.openExternal(url); } catch (e) {}
      return `Opened a web search for: ${query}`;
    }

    // Name and identity
    if (/\bwhat('?s| is) your name\b/.test(l)) return "I'm LittleBot — your corner assistant.";

    // Default echo
    return "I heard: " + input;
  }

  async function callAnthropic(input) {
    try {
      const endpoint = 'https://api.anthropic.com/v1/messages';

      // Get relevant memories for this query
      const relevantMemories = await memoryStore.getRelevantMemories(input);
      const memoryContext = memoryStore.formatMemoriesForContext(relevantMemories);

      // Get current system time
      const currentTime = getSystemTime();

      // Build version context
      let versionContext = '';
      if (versionInfo) {
        const latestChanges = versionInfo.changelog[0];
        versionContext = `

Current Version: ${versionInfo.version} "${versionInfo.codename}" (Built: ${versionInfo.buildDate})
Latest Changes (${latestChanges.name}):
${latestChanges.changes.map(c => `- ${c}`).join('\n')}

Note: You can see your current version and all changes made to your program. If asked about your version, capabilities, or recent updates, refer to this information.`;
      }

      // Build system prompt from loaded file plus dynamic context
      const system = `${systemPrompt}

Current system time: ${currentTime}${memoryContext}${versionContext}`;

      const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-sonnet-4-5-20250929';
      const version = (storedConfig && storedConfig.anthropicVersion) || '2023-06-01';
      
      const payload = {
        model: modelToUse,
        max_tokens: 400,
        system: system,
        messages: [
          { role: 'user', content: input }
        ]
      };

      let res = null;
      try {
        const headers = {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': version
        };

        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.error('Network error calling Anthropic', e);
        return `Network error: ${e.message}`;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error('Anthropic error', res.status, txt);
        if (process.env.LITTLEBOT_DEBUG === '1') {
          return `Anthropic error ${res.status}: ${txt}`;
        }
        return `Sorry, I couldn't reach the AI (status ${res.status}).`;
      }

      const data = await res.json();
      // Messages API response contains content array with text blocks
      let completion = '';
      if (data.content && Array.isArray(data.content)) {
        completion = data.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
          .trim();
      } else {
        completion = JSON.stringify(data);
      }
      
      // Cap length to avoid extremely long reads; keep voice-friendly.
      if (completion.length > 1200) completion = completion.slice(0, 1200) + '...';
      
      return completion;
    } catch (err) {
      console.error('Anthropic request failed', err);
      return `Error contacting AI: ${err.message}`;
    }
  }

  (async () => {
    // Inform renderer that we're processing (optional)
    event.sender.send('assistant-reply', 'Thinking...');

    let reply;
    if (anthropicKey) {
      reply = await callAnthropic(text);
      
      // Check for explicit memory commands
      const lowerText = text.toLowerCase();
      if (lowerText.includes('remember') || lowerText.includes('save to') || lowerText.includes('memory core')) {
        // Extract what to remember
        const rememberMatch = text.match(/remember (?:that )?(.+)/i) || text.match(/save to (?:your )?memory (?:core )?(?:that )?(.+)/i);
        if (rememberMatch) {
          const factToSave = rememberMatch[1].trim();
          await memoryStore.addFact(factToSave, 'user');
          console.log('Explicitly saved to memory:', factToSave);
        }
      }
      
      // Check for memory sync commands
      if (lowerText.includes('sync') && (lowerText.includes('memory') || lowerText.includes('github'))) {
        const repoPath = memoryStore.getRepoPath();
        const result = await memoryStore.syncWithGitHub(repoPath);
        if (result.success) {
          console.log('Memory synced to GitHub:', result.path);
        }
      }
      
      if (lowerText.includes('pull') && (lowerText.includes('memory') || lowerText.includes('github'))) {
        const repoPath = memoryStore.getRepoPath();
        const result = await memoryStore.pullFromGitHub(repoPath);
        if (result.success) {
          console.log('Memory pulled from GitHub');
        }
      }
      
      // After getting the reply, extract learnings in the background
      extractLearnings(text, reply, anthropicKey).catch(err => {
        console.error('Failed to extract learnings:', err);
      });
    } else {
      reply = await fallbackReply(text);
    }

    event.sender.send('assistant-reply', reply);
  })();
});

// Extract and store learnings from conversation
async function extractLearnings(userMessage, assistantReply, apiKey) {
  try {
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-sonnet-4-5-20250929';
    const version = (storedConfig && storedConfig.anthropicVersion) || '2023-06-01';
    
    const extractionPrompt = `Analyze this conversation exchange and extract any learnable information:

User: ${userMessage}
Assistant: ${assistantReply}

Extract:
1. Any facts about the user (name, preferences, location, job, interests, etc.)
2. Any topics the user wants to learn about or discuss
3. Any specific knowledge or information shared

Format your response as JSON:
{
  "facts": ["fact1", "fact2"],
  "topics": [{"topic": "topic name", "knowledge": "what was discussed"}],
  "summary": "brief conversation summary"
}

If nothing significant to learn, return empty arrays and null summary.`;

    const payload = {
      model: modelToUse,
      max_tokens: 300,
      messages: [
        { role: 'user', content: extractionPrompt }
      ]
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': version
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('Learning extraction failed:', res.status);
      return;
    }

    const data = await res.json();
    let extractedText = '';
    if (data.content && Array.isArray(data.content)) {
      extractedText = data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim();
    }

    // Parse JSON response
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('No structured learning data found');
      return;
    }

    const learnings = JSON.parse(jsonMatch[0]);
    
    // Store facts
    if (learnings.facts && learnings.facts.length > 0) {
      for (const fact of learnings.facts) {
        await memoryStore.addFact(fact, 'user');
        console.log('Learned fact:', fact);
      }
    }
    
    // Store topic knowledge
    if (learnings.topics && learnings.topics.length > 0) {
      for (const topicData of learnings.topics) {
        await memoryStore.addTopicKnowledge(topicData.topic, topicData.knowledge);
        console.log('Learned about topic:', topicData.topic);
      }
    }
    
    // Store conversation summary
    if (learnings.summary) {
      await memoryStore.addConversationSummary(learnings.summary);
    }
    
  } catch (err) {
    console.error('Error in extractLearnings:', err);
  }
}
