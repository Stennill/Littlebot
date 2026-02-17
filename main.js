const { app, BrowserWindow, ipcMain, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const memoryStore = require('./memory');
const ContextBuilder = require('./context-builder');
const notionManager = require('./notion-manager');
const notionCommands = require('./notion-commands');
const notionService = require('./notion-service');
const schedulerService = require('./scheduler-service');
const eventNotifier = require('./event-notifier');
const scheduleOptimizer = require('./schedule-optimizer');
const slackService = require('./slack-service');
const arcTasks = require('./arc-tasks'); // NEW: Task registry system

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
let contextBuilder = null; // Smart context builder

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

// Strip italicized stage directions (e.g. *chuckles*, *nods*) from Arc's reply - user prefers plain dialogue only
function stripItalicizedActions(text) {
  if (typeof text !== 'string') return text;
  const actionWords = ['chuckles', 'chuckle', 'nods', 'nod', 'smirks', 'smirk', 'sighs', 'sigh', 'laughs', 'laugh', 'grins', 'grin', 'winks', 'wink', 'smiles', 'smile', 'shrugs', 'shrug', 'waves', 'wave', 'nods', 'frowns', 'frown', 'grunts', 'grunt', 'snickers', 'snicker', 'chortles', 'chortle', 'scoffs', 'scoff', 'clears throat', 'raises eyebrow', 'raises eyebrows', 'tilts head', 'rolls eyes', 'leans in', 'leans back'];
  let out = text;
  for (const word of actionWords) {
    const re = new RegExp(`\\*\\s*${word.replace(/\s+/g, '\\s+')}\\s*\\*`, 'gi');
    out = out.replace(re, '');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

// Load system prompt from file (Arc's persona)
async function loadSystemPrompt() {
  try {
    // Try loading new arc-persona.txt first, fallback to old system-prompt.txt
    let promptPath = path.join(__dirname, 'arc-persona.txt');
    try {
      systemPrompt = await fs.readFile(promptPath, 'utf8');
      console.log('Arc persona loaded successfully');
    } catch {
      // Fallback to old system-prompt.txt for backwards compatibility
      promptPath = path.join(__dirname, 'system-prompt.txt');
      systemPrompt = await fs.readFile(promptPath, 'utf8');
      console.log('System prompt loaded successfully (using legacy file)');
    }
    return systemPrompt;
  } catch (err) {
    console.error('Failed to load system prompt:', err);
    // Fallback to basic prompt
    systemPrompt = 'You are Arc, a helpful desktop assistant.';
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
    title: 'Arc Notion Sidebar - Memory',
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
    title: 'Arc Notion Sidebar - Settings',
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('schedule-refresh');
  });
}

const DEBUG_LOG_BUFFER_MAX = 100;
const debugLogBuffer = [];

function sendArcDebug(payload) {
  const p = typeof payload === 'string' ? { type: 'log', message: payload } : payload;
  const msg = {
    ts: new Date().toISOString(),
    type: p.type || 'log',
    message: p.message || '',
    detail: p.detail
  };
  debugLogBuffer.push(msg);
  if (debugLogBuffer.length > DEBUG_LOG_BUFFER_MAX) debugLogBuffer.shift();
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('arc-debug', msg);
  }
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.webContents) {
    settingsWindow.webContents.send('arc-debug', msg);
  }
}

function createWindow() {
  const SIDEBAR_WIDTH = 420;
  const win = new BrowserWindow({
    width: SIDEBAR_WIDTH,
    height: 800,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    resizable: true,
    minWidth: 320,
    maxWidth: 600,
    skipTaskbar: true,
    backgroundColor: '#1c2029',
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
  
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media' || permission === 'microphone') {
      return true;
    }
    return false;
  });

  mainWindow = win;

  win.on('focus', () => {
    if (win && !win.isDestroyed() && win.webContents) win.webContents.send('schedule-refresh');
  });

  const DEBUG_DEVTOOLS = false;
  win.webContents.on('did-finish-load', () => {
    if (DEBUG_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  });
  
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Position as full-height right sidebar
  try {
    const disp = screen.getPrimaryDisplay();
    const wa = disp.workArea;
    const x = Math.round(wa.x + wa.width - SIDEBAR_WIDTH);
    const y = Math.round(wa.y);
    const h = Math.round(wa.height);
    win.setBounds({ x, y, width: SIDEBAR_WIDTH, height: h });
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
    
    // Configure Notion if credentials exist
    if (storedConfig.notionApiKey && storedConfig.notionDatabaseId) {
      notionManager.configure(storedConfig.notionApiKey, storedConfig.notionDatabaseId);
      console.log('Notion integration configured');
    }
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
  
  // Initialize context builder
  contextBuilder = new ContextBuilder(memoryStore);
  console.log('Context builder initialized');
  
  // Initialize Arc Task Registry with all services and handlers
  arcTasks.initialize(
    {
      notionService: notionService,
      memoryStore: memoryStore,
      versionInfo: versionInfo
    },
    {
      // File management handlers
      searchForFile: searchForFile,
      getFileInfo: getFileInfo,
      openFile: openFile,
      getRecentFiles: getRecentFiles,
      getRemovableDrives: getRemovableDrives,
      moveFileToRemovable: moveFileToRemovable,
      copyFileToRemovable: copyFileToRemovable,
      // Notion handlers (read-only: query and schema only)
      notionQueryDatabase: (filters) => notionManager.queryDatabase(filters),
      notionGetSchema: () => notionManager.getDatabaseSchema()
    }
  );
  console.log('Arc task registry initialized');
  
  // Configure Slack if webhook is available
  if (storedConfig.slackWebhook) {
    slackService.configure(storedConfig.slackWebhook);
    console.log('Slack service configured');
  }
  
  // Check if GitHub memory is newer and auto-update
  const updateResult = await memoryStore.autoUpdateIfNewer();
  if (updateResult.updated) {
    console.log('Memory was updated from GitHub on startup');
  }
  
  // Set up memory notification callback to send updates to renderer
  memoryStore.setNotificationCallback((type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memory-write', { type, data });
    }
  });
  
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
  
  // Auto-scheduler disabled: Notion is read-only (query only, no updates)
  
  // Event Notifier: Check for upcoming events and notify user
  eventNotifier.start(
    (message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-notification', message);
      }
    },
    (events) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('upcoming-events', events || []);
      }
    }
  );
  
  // Schedule Optimizer: Move tasks to fill gaps when tasks complete early
  scheduleOptimizer.start();
  
  console.log('Auto-sync/update enabled: Checks GitHub every 30 minutes');
  console.log('Auto-scheduler enabled: Places unscheduled tasks every 2 hours');
  console.log('Event notifier enabled: Alerts for events 15 minutes before start');
  console.log('Schedule optimizer enabled: Fills gaps when tasks complete early');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// File search and inspection functions
async function searchForFile(filename) {
  try {
    console.log('🔍 Searching for file:', filename);
    
    // Extract base name and extension
    const parsed = path.parse(filename);
    let baseName = parsed.name;
    const extension = parsed.ext.toLowerCase();
    
    // Define file variant extensions
    const extensionVariants = {
      '.doc': ['.doc', '.docx', '.docm'],
      '.docx': ['.doc', '.docx', '.docm'],
      '.xls': ['.xls', '.xlsx', '.xlsm'],
      '.xlsx': ['.xls', '.xlsx', '.xlsm'],
      '.ppt': ['.ppt', '.pptx', '.pptm'],
      '.pptx': ['.ppt', '.pptx', '.pptm'],
      '.jpg': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
      '.jpeg': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
      '.png': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
      '.txt': ['.txt', '.md', '.log'],
      '.md': ['.txt', '.md', '.log'],
      '.js': ['.js', '.ts', '.jsx', '.tsx'],
      '.ts': ['.js', '.ts', '.jsx', '.tsx']
    };
    
    // Determine search patterns
    let searchPatterns = [];
    
    if (extension && extensionVariants[extension]) {
      // Specific extension with variants - exact match on base name
      const variants = extensionVariants[extension];
      searchPatterns = variants.map(ext => `${baseName}${ext}`);
      console.log(`   Looking for exact matches with variants:`, searchPatterns.join(', '));
    } else if (extension && !extensionVariants[extension]) {
      // Specific extension without variants - exact match
      searchPatterns = [filename];
      console.log(`   Looking for exact match:`, filename);
    } else if (!extension && baseName) {
      // No extension - use wildcard for partial matching
      // This handles cases like "resume" finding "My Resume.docx", "Stephen Tennill Resume.doc", etc.
      searchPatterns = [`*${baseName}*`];
      console.log(`   Searching for files containing: "${baseName}"`);
    }
    
    const searchPaths = [
      path.join(process.env.USERPROFILE, 'Desktop'),
      path.join(process.env.USERPROFILE, 'Documents'),
      path.join(process.env.USERPROFILE, 'Downloads'),
      process.env.USERPROFILE
    ];
    
    const results = new Map(); // Use Map to avoid duplicates
    
    // Search for each pattern using PowerShell Get-ChildItem
    for (const pattern of searchPatterns) {
      for (const searchPath of searchPaths) {
        try {
          // Use PowerShell Get-ChildItem for better wildcard and space handling
          const psCommand = `Get-ChildItem -Path "${searchPath}" -Filter "${pattern}" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 15 | ForEach-Object { $_.FullName }`;
          const command = `powershell.exe -Command "${psCommand}"`;
          
          const { stdout } = await execPromise(command, { 
            maxBuffer: 1024 * 1024,
            timeout: 4000 // 4 second timeout per path
          });
          
          if (stdout.trim()) {
            const paths = stdout.trim().split('\n').filter(p => p.trim());
            paths.forEach(p => {
              const normalized = p.trim();
              if (normalized) {
                results.set(normalized, {
                  path: normalized,
                  name: path.basename(normalized),
                  directory: path.dirname(normalized)
                });
              }
            });
          }
        } catch (err) {
          // Path not found or no results, continue
        }
        
        // If we found enough results, stop searching more paths
        if (results.size >= 15) break;
      }
      if (results.size >= 15) break;
    }
    
    const finalResults = Array.from(results.values());
    console.log(`   Found ${finalResults.length} result(s)`);
    
    // Return detailed results with name and location
    return finalResults.slice(0, 15); // Limit to 15 results
    
  } catch (error) {
    console.error('File search error:', error);
    return [];
  }
}

async function getFileInfo(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    const info = {
      path: filePath,
      name: path.basename(filePath),
      directory: path.dirname(filePath),
      size: stats.size,
      sizeFormatted: formatFileSize(stats.size),
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
      extension: ext
    };
    
    // Try to read text content for small text files
    if (!stats.isDirectory() && stats.size < 100000) { // Under 100KB
      const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.xml', '.log', '.csv'];
      if (textExts.includes(ext)) {
        try {
          info.content = await fs.readFile(filePath, 'utf8');
          info.lineCount = info.content.split('\n').length;
        } catch (err) {
          info.contentError = 'Could not read file content';
        }
      }
    }
    
    return info;
  } catch (error) {
    return { error: error.message };
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

async function openFile(filePath) {
  try {
    console.log('📂 Opening file:', filePath);
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true, message: 'File opened successfully' };
  } catch (error) {
    console.error('Error opening file:', error);
    return { success: false, error: error.message };
  }
}

async function getRecentFiles(limit = 10) {
  try {
    console.log('📋 Getting recently modified files...');
    
    const searchPaths = [
      path.join(process.env.USERPROFILE, 'Desktop'),
      path.join(process.env.USERPROFILE, 'Documents'),
      path.join(process.env.USERPROFILE, 'Downloads')
    ];
    
    const allFiles = [];
    
    for (const searchPath of searchPaths) {
      try {
        // Get all files modified in the last 7 days, sorted by last write time
        const psCommand = `Get-ChildItem -Path "${searchPath}" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) } | Sort-Object LastWriteTime -Descending | Select-Object -First ${limit * 2} | ForEach-Object { "$($_.FullName)|$($_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))|$($_.Length)" }`;
        const command = `powershell.exe -Command "${psCommand}"`;
        
        const { stdout } = await execPromise(command, { 
          maxBuffer: 1024 * 1024,
          timeout: 5000
        });
        
        if (stdout.trim()) {
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const [filePath, lastModified, size] = line.trim().split('|');
            if (filePath && lastModified) {
              allFiles.push({
                path: filePath,
                name: path.basename(filePath),
                directory: path.dirname(filePath),
                lastModified: lastModified,
                size: parseInt(size) || 0,
                sizeFormatted: formatFileSize(parseInt(size) || 0)
              });
            }
          });
        }
      } catch (err) {
        // Continue on error
      }
    }
    
    // Sort all files by last modified date and take the top N
    allFiles.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    const recentFiles = allFiles.slice(0, limit);
    
    console.log(`   Found ${recentFiles.length} recent files`);
    return recentFiles;
    
  } catch (error) {
    console.error('Error getting recent files:', error);
    return [];
  }
}

async function getRemovableDrives() {
  try {
    console.log('💾 Detecting removable drives...');
    
    // Use PowerShell with ConvertTo-Json to avoid escaping issues
    const psCommand = 'Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json';
    
    const { stdout } = await execPromise(`powershell.exe -NoProfile -Command "${psCommand}"`, { 
      maxBuffer: 1024 * 1024,
      timeout: 3000
    });
    
    const drives = [];
    if (stdout.trim()) {
      try {
        // Parse JSON response
        let diskData = JSON.parse(stdout);
        // If only one drive, PowerShell returns object instead of array
        if (!Array.isArray(diskData)) {
          diskData = [diskData];
        }
        
        diskData.forEach(disk => {
          if (disk.DeviceID) {
            drives.push({
              drive: disk.DeviceID,
              label: disk.VolumeName || 'Removable Drive',
              size: disk.Size || 0,
              sizeFormatted: formatFileSize(disk.Size || 0),
              freeSpace: disk.FreeSpace || 0,
              freeSpaceFormatted: formatFileSize(disk.FreeSpace || 0)
            });
          }
        });
      } catch (parseError) {
        console.error('   Error parsing drive data:', parseError);
      }
    }
    
    console.log(`   Found ${drives.length} removable drive(s)`);
    return drives;
    
  } catch (error) {
    console.error('Error detecting removable drives:', error);
    return [];
  }
}

async function moveFileToRemovable(filePath, targetDrive) {
  try {
    console.log(`📦 Moving file to removable drive: ${filePath} -> ${targetDrive}`);
    
    // Verify the file exists
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      return { success: false, error: 'File not found' };
    }
    
    // Verify the target drive exists
    const driveExists = await fs.access(targetDrive).then(() => true).catch(() => false);
    if (!driveExists) {
      return { success: false, error: 'Drive not found or not accessible' };
    }
    
    const fileName = path.basename(filePath);
    const targetPath = path.join(targetDrive, fileName);
    
    // Get original file stats before copying
    const originalStats = await fs.stat(filePath);
    const originalSize = originalStats.size;
    
    // Copy the file first
    await fs.copyFile(filePath, targetPath);
    
    // Verify the copy succeeded by checking if file exists and has correct size
    let targetStats;
    try {
      targetStats = await fs.stat(targetPath);
    } catch (err) {
      return { success: false, error: 'Failed to copy file to drive - file not found at destination' };
    }
    
    // Verify the file size matches
    if (targetStats.size !== originalSize) {
      return { 
        success: false, 
        error: `File size mismatch - Original: ${formatFileSize(originalSize)}, Copied: ${formatFileSize(targetStats.size)}` 
      };
    }
    
    // Delete the original file only after verification
    await fs.unlink(filePath);
    
    console.log(`   ✅ Successfully moved to: ${targetPath}`);
    console.log(`   📊 Verified file size: ${formatFileSize(targetStats.size)}`);
    console.log(`   🗑️ Original file deleted from: ${filePath}`);
    
    return { 
      success: true, 
      message: 'File moved and verified successfully',
      operation: 'move',
      originalPath: filePath,
      targetPath: targetPath,
      fileSize: targetStats.size,
      fileSizeFormatted: formatFileSize(targetStats.size),
      verified: true,
      originalDeleted: true
    };
    
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: error.message };
  }
}

async function copyFileToRemovable(filePath, targetDrive) {
  try {
    console.log(`📋 Copying file to removable drive: ${filePath} -> ${targetDrive}`);
    
    // Verify the file exists
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      return { success: false, error: 'File not found' };
    }
    
    // Verify the target drive exists
    const driveExists = await fs.access(targetDrive).then(() => true).catch(() => false);
    if (!driveExists) {
      return { success: false, error: 'Drive not found or not accessible' };
    }
    
    const fileName = path.basename(filePath);
    const targetPath = path.join(targetDrive, fileName);
    
    // Get original file stats before copying
    const originalStats = await fs.stat(filePath);
    const originalSize = originalStats.size;
    
    // Copy the file
    await fs.copyFile(filePath, targetPath);
    
    // Verify the copy succeeded by checking if file exists and has correct size
    let targetStats;
    try {
      targetStats = await fs.stat(targetPath);
    } catch (err) {
      return { success: false, error: 'Failed to copy file to drive - file not found at destination' };
    }
    
    // Verify the file size matches
    if (targetStats.size !== originalSize) {
      return { 
        success: false, 
        error: `File size mismatch - Original: ${formatFileSize(originalSize)}, Copied: ${formatFileSize(targetStats.size)}` 
      };
    }
    
    // DON'T delete the original - this is a copy operation
    
    console.log(`   ✅ Successfully copied to: ${targetPath}`);
    console.log(`   📊 Verified file size: ${formatFileSize(targetStats.size)}`);
    console.log(`   📁 Original file remains at: ${filePath}`);
    
    return { 
      success: true, 
      message: 'File copied and verified successfully',
      operation: 'copy',
      originalPath: filePath,
      targetPath: targetPath,
      fileSize: targetStats.size,
      fileSizeFormatted: formatFileSize(targetStats.size),
      verified: true
    };
    
  } catch (error) {
    console.error('Error copying file:', error);
    return { success: false, error: error.message };
  }
}

// IPC Handler for file search
ipcMain.handle('search-file', async (event, filename) => {
  const results = await searchForFile(filename);
  return results;
});

// IPC Handler for file info
ipcMain.handle('get-file-info', async (event, filePath) => {
  const info = await getFileInfo(filePath);
  return info;
});

// IPC Handler for opening files
ipcMain.handle('open-file', async (event, filePath) => {
  const result = await openFile(filePath);
  return result;
});

// IPC Handler for getting recent files
ipcMain.handle('get-recent-files', async (event, limit) => {
  const files = await getRecentFiles(limit || 10);
  return files;
});

// IPC Handler for getting removable drives
ipcMain.handle('get-removable-drives', async () => {
  const drives = await getRemovableDrives();
  return drives;
});

// IPC Handler for moving files to removable drive
ipcMain.handle('move-to-removable', async (event, filePath, targetDrive) => {
  const result = await moveFileToRemovable(filePath, targetDrive);
  return result;
});

// IPC Handler for copying files to removable drive
ipcMain.handle('copy-to-removable', async (event, filePath, targetDrive) => {
  const result = await copyFileToRemovable(filePath, targetDrive);
  return result;
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

ipcMain.handle('get-debug-log', async () => {
  return debugLogBuffer.slice();
});

ipcMain.handle('set-settings', async (event, settings) => {
  storedConfig = Object.assign({}, storedConfig, settings || {});
  storedApiKey = storedConfig.anthropicKey || null;
  
  // Configure Notion if credentials provided
  if (storedConfig.notionApiKey && storedConfig.notionDatabaseId) {
    notionManager.configure(storedConfig.notionApiKey, storedConfig.notionDatabaseId);
  }
  
  // Configure Slack if webhook provided
  if (storedConfig.slackWebhook) {
    slackService.configure(storedConfig.slackWebhook);
    console.log('Slack service configured via settings');
  }
  
  await writeConfig(storedConfig);

  // Notify main window to apply theme if it changed
  if (mainWindow && !mainWindow.isDestroyed() && settings && 'theme' in settings) {
    mainWindow.webContents.send('theme-changed', storedConfig.theme || 'dark');
  }

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
    title: 'Arc Notion Sidebar - History',
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

// Get topic count for orb particles
ipcMain.handle('get-topic-count', async () => {
  try {
    const memory = memoryStore.getMemory();
    return memory.topics ? Object.keys(memory.topics).length : 0;
  } catch (err) {
    return 0;
  }
});

// Notion integration handlers
ipcMain.handle('notion-query-database', async (event, filters) => {
  try {
    if (!notionManager.isConfigured()) {
      return { error: 'Notion not configured. Please add API key and database ID in settings.' };
    }
    const results = await notionManager.queryDatabase(filters);
    return { success: true, results };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('notion-get-schema', async () => {
  try {
    if (!notionManager.isConfigured()) {
      return { error: 'Notion not configured' };
    }
    const schema = await notionManager.getDatabaseSchema();
    return { success: true, schema };
  } catch (err) {
    return { error: err.message };
  }
});

// Notion create handlers (meeting with start/end; task/project available when infrastructure is ready)
const APP_TIME_ZONE = 'America/New_York';

function addDaysToISODate(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getESTNowParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

function getESTDateISO(now = new Date()) {
  const p = getESTNowParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function getESTHour(now = new Date()) {
  const p = getESTNowParts(now);
  return parseInt(p.hour || '0', 10) || 0;
}

function getESTWeekdayIndexFromISO(isoDate) {
  const probe = new Date(`${isoDate}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, weekday: 'short' }).format(probe);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? probe.getUTCDay();
}

function formatDateLabelEST(isoDate) {
  const probe = new Date(`${isoDate}T12:00:00Z`);
  return probe.toLocaleDateString('en-US', { timeZone: APP_TIME_ZONE, weekday: 'long', month: 'short', day: 'numeric' });
}

function formatTimeEST(isoDateTime) {
  if (!isoDateTime) return '';
  return new Date(isoDateTime).toLocaleTimeString('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
}

function getNextBusinessDay() {
  let iso = getESTDateISO();
  if (getESTHour() >= 17) iso = addDaysToISODate(iso, 1);
  while ([0, 6].includes(getESTWeekdayIndexFromISO(iso))) {
    iso = addDaysToISODate(iso, 1);
  }
  // Noon UTC anchor avoids accidental day rollover in conversions.
  return new Date(`${iso}T12:00:00Z`);
}

function formatDateISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Return ISO date-time string for a given date and optional time (e.g. "14:30" or "2:30 PM"). */
function toDateTimeISO(dateStr, timeStr) {
  const baseDate = String(dateStr || '').trim();
  if (!baseDate) return '';
  if (!timeStr || !timeStr.trim()) return toDateOnlyISO(baseDate);
  const t = String(timeStr).trim();
  let hours = 0, minutes = 0;
  const match12 = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (match12) {
    hours = parseInt(match12[1], 10);
    minutes = parseInt(match12[2], 10);
    if ((match12[3] || '').toLowerCase() === 'pm' && hours < 12) hours += 12;
    if ((match12[3] || '').toLowerCase() === 'am' && hours === 12) hours = 0;
  } else {
    const parts = t.split(':');
    hours = parseInt(parts[0], 10) || 0;
    minutes = parseInt(parts[1], 10) || 0;
  }

  const [y, m, d] = baseDate.split('-').map(v => parseInt(v, 10));
  if (!y || !m || !d) return baseDate;

  // Convert "local time in America/New_York" to UTC instant.
  const probe = new Date(`${baseDate}T12:00:00Z`);
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    timeZoneName: 'shortOffset'
  }).formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const mOff = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  const sign = mOff && mOff[1] === '-' ? -1 : 1;
  const offHours = mOff ? parseInt(mOff[2], 10) || 0 : 5;
  const offMinutes = mOff ? parseInt(mOff[3] || '0', 10) || 0 : 0;
  const offsetMinutes = sign * (offHours * 60 + offMinutes); // e.g. -300 or -240

  const utcMs = Date.UTC(y, m - 1, d, hours, minutes, 0, 0) - (offsetMinutes * 60 * 1000);
  return new Date(utcMs).toISOString().slice(0, 19) + 'Z';
}

/** Add minutes to an ISO date-time string; return new ISO string. Parses as UTC so duration is correct. */
function addMinutesToISO(isoStr, minutes) {
  const s = String(isoStr).trim();
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(s);
  const asUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !hasTimezone ? s + 'Z' : s;
  const d = new Date(asUtc);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19) + 'Z';
}

/** Get schema props used for schedule (title, date, type, status). */
async function getScheduleSchemaProps() {
  const schema = await notionManager.getDatabaseSchema();
  const dateProp = schema.properties.find(p => p.type === 'date');
  const titleProp = schema.properties.find(p => p.type === 'title');
  const typeProp = schema.properties.find(p => (p.type === 'select' || p.type === 'status') && typeof p.name === 'string' && (p.name === 'Type' || p.name.toLowerCase().includes('type')));
  const statusProp = schema.properties.find(p => p.type === 'status' && typeof p.name === 'string' && (p.name === 'Status' || p.name.toLowerCase().includes('status')));
  return { schema, dateProp, titleProp, typeProp, statusProp };
}

/** Work week: Mon–Fri, 8:00 AM–4:30 PM. Slots outside this are invalid. */
const WORK_WEEK_START_HOUR = 8;
const WORK_WEEK_START_MIN = 0;
const WORK_WEEK_END_HOUR = 16;
const WORK_WEEK_END_MIN = 30;
const TASK_SLOT_DURATION_MS = 30 * 60 * 1000;
const SLOT_GRANULARITY_MS = 15 * 60 * 1000;

/** Status values that free a slot (processed/resolved items can be filled with new tasks). */
function isSlotFreeStatus(status) {
  const s = (status || '').toString().trim().toLowerCase();
  return s === 'processed' || s === 'resolved';
}

/** Find next available slot for a task: work week only, avoid meetings/PTO/breaks/non-processed tasks; Processed/Resolved slots are fillable. */
async function findNextAvailableSlot(targetDate, dateProp, titleProp, typeProp, statusProp) {
  const isoDate = formatDateISO(targetDate);
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const isoNext = formatDateISO(nextDay);
  const filter = {
    and: [
      { property: dateProp.name, date: { on_or_after: isoDate } },
      { property: dateProp.name, date: { before: isoNext } }
    ]
  };
  const items = await notionManager.queryDatabase(filter, [{ property: dateProp.name, direction: 'ascending' }]);

  const busyRanges = [];
  for (const item of items) {
    if (statusProp) {
      const status = item.properties[statusProp.id] || item.properties[statusProp.name];
      if (isSlotFreeStatus(status)) continue;
    }
    const dateVal = item.properties[dateProp.id] || item.properties[dateProp.name];
    if (!dateVal || !dateVal.start) continue;
    const startMs = dateVal.start.includes('T') ? new Date(dateVal.start).getTime() : new Date(dateVal.start + 'T12:00:00').getTime();
    const endMs = dateVal.end && dateVal.end.includes('T') ? new Date(dateVal.end).getTime() : startMs + 60 * 60 * 1000;
    busyRanges.push({ start: startMs, end: endMs });
  }
  busyRanges.sort((a, b) => a.start - b.start);

  const dayStart = new Date(targetDate);
  dayStart.setHours(WORK_WEEK_START_HOUR, WORK_WEEK_START_MIN, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(WORK_WEEK_END_HOUR, WORK_WEEK_END_MIN, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();

  let candidate = Math.max(dayStartMs, Date.now() + 30 * 60 * 1000);
  candidate = Math.ceil(candidate / SLOT_GRANULARITY_MS) * SLOT_GRANULARITY_MS;

  while (candidate + TASK_SLOT_DURATION_MS <= dayEndMs) {
    const candidateEnd = candidate + TASK_SLOT_DURATION_MS;
    let overlaps = false;
    for (const { start, end } of busyRanges) {
      if (candidateEnd <= start) break;
      if (candidate < end) {
        overlaps = true;
        candidate = Math.ceil(end / SLOT_GRANULARITY_MS) * SLOT_GRANULARITY_MS;
        break;
      }
    }
    if (!overlaps) {
      const out = new Date(candidate);
      return out.toISOString().slice(0, 19) + 'Z';
    }
  }

  let nextWorkDay = new Date(targetDate);
  nextWorkDay.setDate(nextWorkDay.getDate() + 1);
  while (nextWorkDay.getDay() === 0 || nextWorkDay.getDay() === 6) nextWorkDay.setDate(nextWorkDay.getDate() + 1);
  return findNextAvailableSlot(nextWorkDay, dateProp, titleProp, typeProp, statusProp);
}

function buildTypeValue(typeProp, value) {
  if (!typeProp) return null;
  return typeProp.type === 'status' ? { status: { name: value } } : { select: { name: value } };
}

function toDateOnlyISO(isoOrDate) {
  const s = String(isoOrDate || '').trim();
  if (!s) return '';
  return s.includes('T') ? s.split('T')[0] : s;
}

function parseDateMs(iso) {
  if (!iso) return NaN;
  const s = String(iso).trim();
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(s);
  const asUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !hasTimezone ? s + 'Z' : s;
  const d = new Date(asUtc);
  return d.getTime();
}

function rangesOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  if (!Number.isFinite(aStartMs) || !Number.isFinite(aEndMs) || !Number.isFinite(bStartMs) || !Number.isFinite(bEndMs)) return false;
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

function normalizeTypeName(typeValue) {
  const raw = (typeof typeValue === 'string' ? typeValue : (typeValue?.name ?? '')).trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'meeting' || raw.includes('meeting')) return 'meeting';
  if (raw === 'break' || raw.includes('break')) return 'break';
  if (raw === 'pto' || raw.includes('pto') || raw.includes('holiday') || raw.includes('vacation')) return 'pto';
  return raw;
}

function isAllDayBlockType(typeName) {
  const t = normalizeTypeName(typeName);
  return t === 'pto';
}

function nextWorkingDaySameTimeMs(startMs) {
  const d = new Date(startMs);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); // Sun/Sat
  return d.getTime();
}

function getConflictRangeMs({ start, end, type }) {
  const s = String(start || '').trim();
  if (!s) return null;
  const t = normalizeTypeName(type);
  if (s.includes('T')) {
    const startMs = parseDateMs(s);
    const endMs = parseDateMs(end || addMinutesToISO(s, 60));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs };
  }

  // Date-only value (common for PTO) blocks the full day.
  const dayStartMs = parseDateMs(`${s}T00:00:00Z`);
  let dayEndMs = NaN;
  if (end && !String(end).includes('T')) {
    dayEndMs = parseDateMs(`${end}T00:00:00Z`);
  } else {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    dayEndMs = d.getTime();
  }
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs) || dayEndMs <= dayStartMs) return null;
  // Keep all-day behavior primarily for PTO, but also safely for other date-only blockers.
  if (t === 'pto' || !t) return { startMs: dayStartMs, endMs: dayEndMs };
  return { startMs: dayStartMs, endMs: dayEndMs };
}

async function queryConflictItemsForRange({ dateProp, titleProp, typeProp }, startIsoDate, endIsoDateExclusive) {
  const startDay = toDateOnlyISO(startIsoDate);
  const endDayExclusive = toDateOnlyISO(endIsoDateExclusive);
  if (!startDay || !endDayExclusive) return [];

  const filters = {
    and: [
      { property: dateProp.name, date: { on_or_after: startDay } },
      { property: dateProp.name, date: { before: endDayExclusive } }
    ]
  };

  const results = await notionManager.queryDatabase(filters);
  return results
    .map(item => {
      const title = item.properties[titleProp.name] || 'Untitled';
      const dateVal = item.properties[dateProp.name];
      const typeVal = typeProp ? item.properties[typeProp.name] : '';
      let type = normalizeTypeName(typeVal);
      // Fallback: infer from title when Type option names are inconsistent.
      if (!type) {
        const t = String(title || '').toLowerCase();
        if (t.includes('meeting')) type = 'meeting';
        else if (t.includes('break')) type = 'break';
        else if (t.includes('holiday') || t.includes('pto') || t.includes('vacation')) type = 'pto';
      }
      const start = dateVal?.start || null;
      const end = dateVal?.end || null;
      return { id: item.id, title, start, end, type };
    })
    .filter(item => !!item.start && ['meeting', 'break', 'pto'].includes(item.type));
}

async function queryConflictItemsForDay({ dateProp, titleProp, typeProp }, isoDate) {
  const day = toDateOnlyISO(isoDate);
  if (!day) return [];
  const next = new Date(day + 'T00:00:00');
  next.setDate(next.getDate() + 1);
  const isoNext = formatDateISO(next);
  return queryConflictItemsForRange({ dateProp, titleProp, typeProp }, day, isoNext);
}

ipcMain.handle('create-notion-meeting', async (event, { title, date, time, durationMinutes }) => {
  try {
    if (!notionManager.isConfigured()) return { error: 'Notion not configured' };
    const { dateProp, titleProp, typeProp, statusProp } = await getScheduleSchemaProps();
    if (!dateProp || !titleProp) return { error: 'Database missing Date or Title property' };
    let start = toDateTimeISO(date || formatDateISO(getNextBusinessDay()), time || '09:00');
    if (!/[Z+-]/.test(start.slice(-1))) start = start + 'Z';
    const mins = Math.max(1, Math.min(480, parseInt(durationMinutes, 10) || 60));
    const end = addMinutesToISO(start, mins);

     // Detect conflicts with existing meetings for that day (do not block creation; just report).
    let conflict = null;
    try {
      const existing = await queryConflictItemsForDay({ dateProp, titleProp, typeProp }, start);
      const newStartMs = parseDateMs(start);
      const newEndMs = parseDateMs(end);
      const overlaps = existing
        .filter(m => {
          const range = getConflictRangeMs(m);
          if (!range) return false;
          const sMs = range.startMs;
          const eMs = range.endMs;
          return rangesOverlap(newStartMs, newEndMs, sMs, eMs);
        })
        .sort((a, b) => {
          const aEnd = getConflictRangeMs(a)?.endMs || -Infinity;
          const bEnd = getConflictRangeMs(b)?.endMs || -Infinity;
          return bEnd - aEnd;
        });
      if (overlaps.length) {
        const c = overlaps[0];
        const cEndMs = getConflictRangeMs(c)?.endMs;
        const suggestedStartMs = isAllDayBlockType(c.type)
          ? nextWorkingDaySameTimeMs(newStartMs)
          : (Number.isFinite(cEndMs) ? cEndMs + 10 * 60 * 1000 : parseDateMs(addMinutesToISO(c.start, 30)));
        const cEnd = Number.isFinite(cEndMs) ? new Date(cEndMs).toISOString().slice(0, 19) + 'Z' : (c.end || addMinutesToISO(c.start, 30));
        conflict = {
          type: 'meeting_overlap',
          newMeetingTitle: (title || 'New Meeting').trim(),
          newMeetingStart: start,
          newMeetingEnd: end,
          conflictingMeetingId: c.id,
          conflictingMeetingTitle: c.title,
          conflictingMeetingType: c.type || 'meeting',
          conflictingMeetingEnd: cEnd,
          suggestedStart: Number.isFinite(suggestedStartMs) ? new Date(suggestedStartMs).toISOString().slice(0, 19) + 'Z' : addMinutesToISO(cEnd, 10)
        };
      }
    } catch (_) {
      // Conflict detection is best-effort; ignore failures.
    }

    const properties = {
      [titleProp.name]: { title: [{ text: { content: (title || 'New Meeting').trim() } }] },
      [dateProp.name]: { date: { start, end } },
      ...(typeProp && { [typeProp.name]: buildTypeValue(typeProp, 'Meeting') }),
      ...(statusProp && { [statusProp.name]: { status: { name: 'Not Started' } } })
    };
    const page = await notionManager.createPage(properties);
    if (conflict) {
      conflict.newMeetingId = page.id;
    }
    return { success: true, page, conflict };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('resolve-notion-meeting-conflict', async (event, { meetingId }) => {
  try {
    if (!notionManager.isConfigured()) return { error: 'Notion not configured' };
    if (!meetingId) return { error: 'Missing meetingId' };
    const { dateProp, titleProp, typeProp } = await getScheduleSchemaProps();
    if (!dateProp || !titleProp) return { error: 'Database missing Date or Title property' };

    const page = await notionManager.getPage(meetingId);
    if (!page?.properties) return { error: 'Meeting not found' };
    const pageType = normalizeTypeName(typeProp ? page.properties[typeProp.name] : '');
    if (isAllDayBlockType(pageType)) return { error: 'PTO blocks are fixed and cannot be auto-moved' };

    const dateVal = page.properties[dateProp.name];
    const currentStart = dateVal?.start;
    const currentEnd = dateVal?.end;
    if (!currentStart || !String(currentStart).includes('T')) return { error: 'Meeting has no start time to resolve' };

    const durationMs = (() => {
      const s = parseDateMs(currentStart);
      const e = parseDateMs(currentEnd || addMinutesToISO(currentStart, 60));
      const d = e - s;
      return Number.isFinite(d) && d > 0 ? d : 60 * 60 * 1000;
    })();

    let desiredStartMs = parseDateMs(currentStart);
    let desiredEndMs = desiredStartMs + durationMs;
    let iterations = 0;
    while (iterations++ < 30) {
      // Keep meetings off weekends.
      const weekday = new Date(desiredStartMs).getUTCDay();
      if (weekday === 0 || weekday === 6) {
        desiredStartMs = nextWorkingDaySameTimeMs(desiredStartMs);
        desiredEndMs = desiredStartMs + durationMs;
        continue;
      }

      const dayIso = new Date(desiredStartMs).toISOString().slice(0, 10);
      const dayItems = await queryConflictItemsForDay({ dateProp, titleProp, typeProp }, dayIso);
      const overlaps = dayItems.filter(m => {
        if (m.id === meetingId) return false;
        const range = getConflictRangeMs(m);
        if (!range) return false;
        const sMs = range.startMs;
        const eMs = range.endMs;
        return rangesOverlap(desiredStartMs, desiredEndMs, sMs, eMs);
      });
      if (overlaps.length === 0) break;

      // If blocked by PTO, move to next working day at same time.
      if (overlaps.some(m => isAllDayBlockType(m.type))) {
        desiredStartMs = nextWorkingDaySameTimeMs(desiredStartMs);
        desiredEndMs = desiredStartMs + durationMs;
        continue;
      }
      // Push after the latest conflicting end + 10 minutes.
      let maxEndMs = -Infinity;
      for (const m of overlaps) {
        const eMs = getConflictRangeMs(m)?.endMs;
        if (eMs > maxEndMs) maxEndMs = eMs;
      }
      desiredStartMs = maxEndMs + 10 * 60 * 1000;
      desiredEndMs = desiredStartMs + durationMs;
    }

    if (!Number.isFinite(desiredStartMs) || !Number.isFinite(desiredEndMs)) {
      return { error: 'Failed to compute resolved time' };
    }

    const newStartIso = new Date(desiredStartMs).toISOString().slice(0, 19) + 'Z';
    const newEndIso = new Date(desiredEndMs).toISOString().slice(0, 19) + 'Z';

    const updateProps = {
      [dateProp.name]: { date: { start: newStartIso, end: newEndIso } }
    };
    const updated = await notionManager.updatePage(meetingId, updateProps);
    return { success: true, meetingId, newStart: newStartIso, newEnd: newEndIso, page: updated };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('create-notion-task', async (event, { title }) => {
  try {
    if (!notionManager.isConfigured()) return { error: 'Notion not configured' };
    const { dateProp, titleProp, typeProp, statusProp } = await getScheduleSchemaProps();
    if (!dateProp || !titleProp) return { error: 'Database missing Date or Title property' };
    const targetDate = getNextBusinessDay();
    const start = await findNextAvailableSlot(targetDate, dateProp, titleProp, typeProp, statusProp);
    const end = addMinutesToISO(start, 30);
    const properties = {
      [titleProp.name]: { title: [{ text: { content: (title || 'New Task').trim() } }] },
      [dateProp.name]: { date: { start, end } },
      ...(typeProp && { [typeProp.name]: buildTypeValue(typeProp, 'Task') }),
      ...(statusProp && { [statusProp.name]: { status: { name: 'Needs Review' } } })
    };
    const page = await notionManager.createPage(properties);
    return { success: true, page };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('bump-task', async (event, { taskId }) => {
  try {
    if (!notionManager.isConfigured()) return { error: 'Notion not configured' };
    if (!taskId) return { error: 'Missing taskId' };
    const { dateProp, titleProp, typeProp, statusProp } = await getScheduleSchemaProps();
    if (!dateProp || !titleProp) return { error: 'Database missing Date or Title property' };

    // Fetch the current task so we know its duration
    const page = await notionManager.getPage(taskId);
    if (!page) return { error: 'Task not found' };
    const title = page.properties[titleProp.name] || 'Untitled';
    const dateVal = page.properties[dateProp.name];
    let durationMs = TASK_SLOT_DURATION_MS; // default 30 min
    if (dateVal && dateVal.start && dateVal.end) {
      const diff = new Date(dateVal.end).getTime() - new Date(dateVal.start).getTime();
      if (diff > 0) durationMs = diff;
    }
    const estimatedMin = page.properties['Estimated Mintues'];
    if (estimatedMin && estimatedMin > 0) {
      durationMs = estimatedMin * 60 * 1000;
    }

    // Find next open slot TODAY after the current time
    const now = new Date();
    const targetDate = new Date(now);
    // If it's past work hours or a weekend, bump to next business day
    const day = targetDate.getDay();
    const hour = targetDate.getHours() + targetDate.getMinutes() / 60;
    if (day === 0 || day === 6 || hour >= WORK_WEEK_END_HOUR + WORK_WEEK_END_MIN / 60) {
      targetDate.setDate(targetDate.getDate() + 1);
      while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
    }

    // Build busy ranges for the target day (same logic as findNextAvailableSlot)
    const isoDate = formatDateISO(targetDate);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const isoNext = formatDateISO(nextDay);
    const filter = {
      and: [
        { property: dateProp.name, date: { on_or_after: isoDate } },
        { property: dateProp.name, date: { before: isoNext } }
      ]
    };
    const items = await notionManager.queryDatabase(filter, [{ property: dateProp.name, direction: 'ascending' }]);
    const busyRanges = [];
    for (const item of items) {
      if (item.id === taskId) continue; // exclude the task being bumped
      if (statusProp) {
        const status = item.properties[statusProp.id] || item.properties[statusProp.name];
        if (isSlotFreeStatus(status)) continue;
      }
      const dv = item.properties[dateProp.id] || item.properties[dateProp.name];
      if (!dv || !dv.start) continue;
      const startMs = dv.start.includes('T') ? new Date(dv.start).getTime() : new Date(dv.start + 'T12:00:00').getTime();
      const endMs = dv.end && dv.end.includes('T') ? new Date(dv.end).getTime() : startMs + 60 * 60 * 1000;
      busyRanges.push({ start: startMs, end: endMs });
    }
    busyRanges.sort((a, b) => a.start - b.start);

    const dayStart = new Date(targetDate);
    dayStart.setHours(WORK_WEEK_START_HOUR, WORK_WEEK_START_MIN, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(WORK_WEEK_END_HOUR, WORK_WEEK_END_MIN, 0, 0);
    const dayEndMs = dayEnd.getTime();

    // Start searching from now (rounded up to next 15-min granularity), minimum 5 min from now
    let candidate = Math.max(dayStart.getTime(), Date.now() + 5 * 60 * 1000);
    candidate = Math.ceil(candidate / SLOT_GRANULARITY_MS) * SLOT_GRANULARITY_MS;

    let foundSlot = null;
    while (candidate + durationMs <= dayEndMs) {
      const candidateEnd = candidate + durationMs;
      let overlaps = false;
      for (const { start, end } of busyRanges) {
        if (candidateEnd <= start) break;
        if (candidate < end) {
          overlaps = true;
          candidate = Math.ceil(end / SLOT_GRANULARITY_MS) * SLOT_GRANULARITY_MS;
          break;
        }
      }
      if (!overlaps) {
        foundSlot = { start: candidate, end: candidate + durationMs };
        break;
      }
    }

    if (!foundSlot) {
      return { error: 'No open slot available today' };
    }

    // Update Notion
    const newStart = new Date(foundSlot.start).toISOString().slice(0, 19) + 'Z';
    const newEnd = new Date(foundSlot.end).toISOString().slice(0, 19) + 'Z';
    const updateProps = {};
    updateProps[dateProp.name] = { type: 'date', date: { start: newStart, end: newEnd } };
    await notionManager.updatePage(taskId, updateProps);

    // Register bump so the optimizer won't move it back
    scheduleOptimizer.registerBump(taskId);

    const newTimeStr = formatTimeEST(newStart);
    console.log(`[Bump] "${title}" bumped to ${newTimeStr}`);

    // Refresh schedule in sidebar
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedule-refresh');
    }

    return { success: true, title, newTime: newTimeStr };
  } catch (err) {
    console.error('[Bump] Error:', err.message);
    return { error: err.message };
  }
});

ipcMain.handle('create-notion-project', async (event, { title }) => {
  try {
    if (!notionManager.isConfigured()) return { error: 'Notion not configured' };
    const { dateProp, titleProp, typeProp, statusProp } = await getScheduleSchemaProps();
    if (!dateProp || !titleProp) return { error: 'Database missing Date or Title property' };
    const today = getNextBusinessDay();
    const dateOnly = formatDateISO(today);
    const properties = {
      [titleProp.name]: { title: [{ text: { content: (title || 'New Project').trim() } }] },
      [dateProp.name]: { date: { start: dateOnly } },
      ...(typeProp && { [typeProp.name]: buildTypeValue(typeProp, 'Project') }),
      ...(statusProp && { [statusProp.name]: { status: { name: 'Not Started' } } })
    };
    const page = await notionManager.createPage(properties);
    return { success: true, page };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-upcoming-schedule', async () => {
  try {
    if (!notionManager.isConfigured()) {
      return { error: 'Notion not configured', date: null, dateLabel: '', meetings: [], tasks: [], projects: [], conflicts: { count: 0, pairs: [], meetingOptions: [] } };
    }
    const schema = await notionManager.getDatabaseSchema();
    const dateProp = schema.properties.find(p => p.type === 'date');
    const titleProp = schema.properties.find(p => p.type === 'title');
    const typeProp = schema.properties.find(p => (p.type === 'select' || p.type === 'status') && typeof p.name === 'string' && (p.name === 'Type' || p.name.toLowerCase().includes('type')));
    const statusProp = schema.properties.find(p => p.type === 'status' && typeof p.name === 'string' && (p.name === 'Status' || p.name.toLowerCase().includes('status')));
    const projectRefProp = schema.properties.find(p => {
      if (typeof p.name !== 'string') return false;
      const nameMatch = p.name === 'project_ref' || p.name === 'Project' || p.name.toLowerCase().replace(/\s+/g, '_').includes('project');
      return nameMatch && (p.type === 'relation' || p.type === 'select' || p.type === 'multi_select');
    });
    // Find the relation property that links tasks back to meetings.
    // First try name-based matching, then fall back to any self-relation that isn't the project ref.
    const relationProps = schema.properties.filter(p => p.type === 'relation');
    console.log('[Schema] Relation properties:', relationProps.map(p => p.name).join(', ') || '(none)');
    let meetingRefProp = schema.properties.find(p => {
      if (typeof p.name !== 'string') return false;
      const n = p.name.toLowerCase().replace(/\s+/g, ' ');
      const nameMatch = n.includes('meeting') || n.includes('action item') || n === 'parent' || n === 'related meeting' || n === 'relation';
      return nameMatch && (p.type === 'relation' || p.type === 'select' || p.type === 'multi_select');
    });
    // Fallback: if no name match, pick the first relation prop that isn't the project ref
    if (!meetingRefProp && relationProps.length > 0) {
      const projectRefId = projectRefProp ? projectRefProp.id : null;
      meetingRefProp = relationProps.find(p => p.id !== projectRefId) || null;
      if (meetingRefProp) console.log('[Schema] Meeting ref fallback to relation:', meetingRefProp.name);
    }
    if (!dateProp || !titleProp) {
      return { error: 'Database missing Date or Title property', date: null, dateLabel: '', meetings: [], tasks: [], projects: [], conflicts: { count: 0, pairs: [], meetingOptions: [] } };
    }
    const targetDate = getNextBusinessDay();
    const isoDate = formatDateISO(targetDate);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const isoNext = formatDateISO(nextDay);
    const dateLabel = formatDateLabelEST(isoDate);
    const statusPropName = statusProp ? statusProp.name : 'Status';
    const baseFilter = {
      and: [
        { property: dateProp.name, date: { on_or_after: isoDate } },
        { property: dateProp.name, date: { before: isoNext } },
        { property: statusPropName, status: { does_not_equal: 'Processed' } },
        { property: statusPropName, status: { does_not_equal: 'Resolved' } }
      ]
    };
    const results = await notionManager.queryDatabase(baseFilter);
    const meetings = [];
    const tasks = [];
    const typePropName = typeProp ? typeProp.name : 'Type';
    for (const item of results) {
      const title = item.properties[titleProp.name] || 'Untitled';
      const typeRaw = item.properties[typePropName] || '';
      const type = (typeof typeRaw === 'string' ? typeRaw : (typeRaw?.name ?? '')).trim();
      const typeLower = type.toLowerCase();
      const dateVal = item.properties[dateProp.name];
      const sortKey = (dateVal && dateVal.start) || '';
      const startISO = dateVal?.start || null;
      const endISO = dateVal?.end || null;
      let timeStr = '';
      if (dateVal && dateVal.start && dateVal.start.includes('T')) {
        try {
          timeStr = formatTimeEST(dateVal.start);
        } catch (_) {}
      }
      if (typeLower === 'meeting') {
        meetings.push({ id: item.id, title, time: timeStr, start: startISO, end: endISO, _sort: sortKey });
      } else if (typeLower === 'project' || typeLower === 'pto') {
        // Explicitly excluded from the Tasks list (they have their own sections / are all-day blocks)
        continue;
      } else {
        // Tasks list shows everything except Meetings, Projects, and PTO
        tasks.push({ id: item.id, title, time: timeStr, _sort: sortKey });
      }
    }
    meetings.sort((a, b) => (a._sort || '').localeCompare(b._sort || ''));
    tasks.sort((a, b) => (a._sort || '').localeCompare(b._sort || ''));
    const stripSort = (arr) => arr.map(({ id, title, time }) => (id ? { id, title, time } : { title, time }));
    const tasksOut = stripSort(tasks);
    const taskTypeFilter = typeProp
      ? (typeProp.type === 'status'
          ? { property: typePropName, status: { equals: 'Task' } }
          : { property: typePropName, select: { equals: 'Task' } })
      : { property: typePropName, select: { equals: 'Task' } };
    const recentStart = new Date(targetDate);
    recentStart.setDate(recentStart.getDate() - 30);
    const recentStartISO = formatDateISO(recentStart);
    const recentSorts = [{ property: dateProp.name, direction: 'descending' }];

    function mapItemsToActionItems(items) {
      return items
        .map(item => {
          const t = item.properties[titleProp.name] || 'Untitled';
          const dv = item.properties[dateProp.name];
          let ts = '';
          let sortKey = '';
          if (dv && dv.start) {
            sortKey = dv.start;
            if (dv.start.includes('T')) {
              try { ts = formatTimeEST(dv.start); } catch (_) {}
            } else {
              try { ts = formatDateLabelEST(dv.start).replace(/^[A-Za-z]+,\s*/, ''); } catch (_) {}
            }
          }
          return { title: t, time: ts, _sort: sortKey || 'z' };
        })
        .sort((a, b) => (b._sort || '').localeCompare(a._sort || ''))
        .slice(0, 3)
        .map(({ title, time }) => ({ title, time }));
    }

    const meetingsOut = [];
    for (const m of meetings) {
      const entry = { id: m.id, title: m.title, time: m.time, start: m.start, end: m.end };
      entry.actionItems = [];
      if (meetingRefProp && m.id) {
        if (meetingRefProp.type === 'relation') {
          const filter = {
            and: [
              taskTypeFilter,
              { property: meetingRefProp.name, relation: { contains: m.id } },
              { property: dateProp.name, date: { on_or_after: recentStartISO } },
              { property: statusPropName, status: { does_not_equal: 'Processed' } },
              { property: statusPropName, status: { does_not_equal: 'Resolved' } }
            ]
          };
          const raw = await notionManager.queryDatabase(filter, recentSorts);
          entry.actionItems = mapItemsToActionItems(raw);
        } else if ((meetingRefProp.type === 'select' || meetingRefProp.type === 'multi_select') && Array.isArray(meetingRefProp.options)) {
          const optStr = (o) => (o && (o.name != null ? o.name : o)).toString().toLowerCase();
          const matchOpt = (meetingRefProp.options || []).find(o => optStr(o) === (m.title || '').toLowerCase());
          const optName = matchOpt ? (matchOpt.name != null ? matchOpt.name : matchOpt) : m.title;
          const refFilter = meetingRefProp.type === 'multi_select'
            ? { property: meetingRefProp.name, multi_select: { contains: optName } }
            : { property: meetingRefProp.name, select: { equals: optName } };
          const filter = {
            and: [
              taskTypeFilter,
              refFilter,
              { property: dateProp.name, date: { on_or_after: recentStartISO } },
              { property: statusPropName, status: { does_not_equal: 'Processed' } },
              { property: statusPropName, status: { does_not_equal: 'Resolved' } }
            ]
          };
          const raw = await notionManager.queryDatabase(filter, recentSorts);
          entry.actionItems = mapItemsToActionItems(raw);
        }
      }
      meetingsOut.push(entry);
    }

    // Build conflict metadata for overlapping Meetings/Breaks/PTO blocks.
    // IMPORTANT: use a dedicated query so conflicts are not hidden by schedule display filters.
    // Scan forward window so future conflicts (not just the current schedule day) still trigger banner.
    const conflictWindowStart = isoDate;
    const conflictWindowEndDate = new Date(targetDate);
    conflictWindowEndDate.setDate(conflictWindowEndDate.getDate() + 14);
    const conflictWindowEnd = formatDateISO(conflictWindowEndDate);
    const allConflictItems = await queryConflictItemsForRange(
      { dateProp, titleProp, typeProp },
      conflictWindowStart,
      conflictWindowEnd
    );
    const timedBlocks = allConflictItems
      .map(item => {
        const range = getConflictRangeMs(item);
        if (!range) return null;
        let time = '';
        if (item.start && String(item.start).includes('T')) {
          try { time = formatTimeEST(item.start); } catch (_) {}
        }
        return { ...item, time, _startMs: range.startMs, _endMs: range.endMs };
      })
      .filter(Boolean)
      .sort((a, b) => a._startMs - b._startMs);

    const conflictPairs = [];
    const conflictMap = new Map(); // id -> { latestEndMs, conflictsWith: Set<string>, title, time, type }
    for (let i = 0; i < timedBlocks.length; i++) {
      const a = timedBlocks[i];
      for (let j = i + 1; j < timedBlocks.length; j++) {
        const b = timedBlocks[j];
        if (b._startMs >= a._endMs) break;
        if (!rangesOverlap(a._startMs, a._endMs, b._startMs, b._endMs)) continue;
        conflictPairs.push({
          aId: a.id, aTitle: a.title, aType: a.type, aStart: a.start, aEnd: a.end || addMinutesToISO(a.start, 60),
          bId: b.id, bTitle: b.title, bType: b.type, bStart: b.start, bEnd: b.end || addMinutesToISO(b.start, 60)
        });

        const aPrev = conflictMap.get(a.id) || { id: a.id, title: a.title, time: a.time, type: a.type, latestEndMs: -Infinity, conflictsWith: new Set() };
        const bPrev = conflictMap.get(b.id) || { id: b.id, title: b.title, time: b.time, type: b.type, latestEndMs: -Infinity, conflictsWith: new Set() };
        aPrev.latestEndMs = Math.max(aPrev.latestEndMs, b._endMs);
        bPrev.latestEndMs = Math.max(bPrev.latestEndMs, a._endMs);
        aPrev.conflictsWith.add(b.id);
        bPrev.conflictsWith.add(a.id);
        conflictMap.set(a.id, aPrev);
        conflictMap.set(b.id, bPrev);
      }
    }

    const meetingOptions = Array.from(conflictMap.values())
      .filter(m => !isAllDayBlockType(m.type))
      .map(m => {
      const suggestedStart = Number.isFinite(m.latestEndMs)
        ? new Date(m.latestEndMs + 10 * 60 * 1000).toISOString().slice(0, 19) + 'Z'
        : null;
      return {
        id: m.id,
        title: m.title,
        time: m.time,
        type: m.type,
        conflictsWith: Array.from(m.conflictsWith),
        suggestedStart
      };
    });

    sendArcDebug({
      type: 'status',
      message: `Conflict scan: ${conflictPairs.length} overlap(s), ${meetingOptions.length} resolvable`,
      detail: `${conflictWindowStart} to ${conflictWindowEnd}`
    });

    const projectItems = [];
    const projectTypeFilter = typeProp
      ? (typeProp.type === 'status'
          ? { property: typePropName, status: { equals: 'Project' } }
          : { property: typePropName, select: { equals: 'Project' } })
      : { property: typePropName, select: { equals: 'Project' } };
    let allProjectRows = await notionManager.queryDatabase({ and: [projectTypeFilter] });
    if (allProjectRows.length === 0 && (!typeProp || typeProp.type === 'select')) {
      const projectTypeFilterLower = { property: typePropName, select: { equals: 'project' } };
      allProjectRows = await notionManager.queryDatabase({ and: [projectTypeFilterLower] });
    }
    for (const item of allProjectRows) {
      const title = item.properties[titleProp.name] || 'Untitled';
      projectItems.push({ id: item.id, title });
    }
    const projects = [];

    function mapItemsToTasks(items) {
      return items
        .map(item => {
          const t = item.properties[titleProp.name] || 'Untitled';
          const dv = item.properties[dateProp.name];
          let ts = '';
          let sortKey = '';
          if (dv && dv.start) {
            sortKey = dv.start;
            if (dv.start.includes('T')) {
              try { ts = formatTimeEST(dv.start); } catch (_) {}
            } else {
              try { ts = formatDateLabelEST(dv.start).replace(/^[A-Za-z]+,\s*/, ''); } catch (_) {}
            }
          }
          return { title: t, time: ts, _sort: sortKey || 'z' };
        })
        .sort((a, b) => (b._sort || '').localeCompare(a._sort || ''))
        .slice(0, 3)
        .map(({ title, time }) => ({ title, time }));
    }

    const projectRefExclude = new Set(['Knowledge Vault', "1:1's with Bruce", '1:1 with Bruce', 'Tech Services']);
    const statusExcludeFilter = [
      { property: statusPropName, status: { does_not_equal: 'Processed' } },
      { property: statusPropName, status: { does_not_equal: 'Resolved' } }
    ];
    if (projectRefProp && projectRefProp.type === 'relation') {
      for (const proj of projectItems) {
        const projectFilter = {
          and: [
            taskTypeFilter,
            { property: projectRefProp.name, relation: { contains: proj.id } },
            { property: dateProp.name, date: { on_or_after: recentStartISO } },
            ...statusExcludeFilter
          ]
        };
        const projectTasksRaw = await notionManager.queryDatabase(projectFilter, recentSorts);
        projects.push({ title: proj.title, tasks: mapItemsToTasks(projectTasksRaw) });
      }
    } else if (projectRefProp && (projectRefProp.type === 'select' || projectRefProp.type === 'multi_select') && Array.isArray(projectRefProp.options) && projectRefProp.options.length > 0) {
      const refFilter = projectRefProp.type === 'multi_select'
        ? (value) => ({ property: projectRefProp.name, multi_select: { contains: value } })
        : (value) => ({ property: projectRefProp.name, select: { equals: value } });
      const titleLower = (s) => (s || '').toLowerCase();
      for (const proj of projectItems) {
        const projTitleLower = titleLower(proj.title);
        const matchingOptions = (projectRefProp.options || []).filter(
          (opt) => !projectRefExclude.has(opt) && projTitleLower.includes(titleLower(opt))
        );
        let projectTasks = [];
        if (matchingOptions.length > 0) {
          const orFilters = matchingOptions.map((opt) => refFilter(opt));
          const projectFilter = {
            and: [
              taskTypeFilter,
              { or: orFilters },
              { property: dateProp.name, date: { on_or_after: recentStartISO } },
              ...statusExcludeFilter
            ]
          };
          const projectTasksRaw = await notionManager.queryDatabase(projectFilter, recentSorts);
          projectTasks = mapItemsToTasks(projectTasksRaw);
        }
        projects.push({ title: proj.title, tasks: projectTasks });
      }
    } else {
      for (const proj of projectItems) {
        projects.push({ title: proj.title, tasks: [] });
      }
    }
    // ── Completed this week ──────────────────────────────────────────
    // Items with Status = "Processed" whose date OR last-edited time falls within Mon–Sun of the current week.
    const nowLocal = new Date();
    const dayOfWeekLocal = nowLocal.getDay(); // 0=Sun..6=Sat
    const mondayOffset = dayOfWeekLocal === 0 ? -6 : 1 - dayOfWeekLocal;
    const weekStart = new Date(nowLocal);
    weekStart.setDate(weekStart.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7); // Sunday end

    // Use local-time components for the ISO date string (Notion date filters are TZ-naive)
    const pad2 = n => String(n).padStart(2, '0');
    const weekStartISO = `${weekStart.getFullYear()}-${pad2(weekStart.getMonth() + 1)}-${pad2(weekStart.getDate())}`;
    const weekEndISO = `${weekEnd.getFullYear()}-${pad2(weekEnd.getMonth() + 1)}-${pad2(weekEnd.getDate())}`;

    // Two separate queries to stay within Notion's 2-level nesting limit, then merge & deduplicate.
    const completedByDateFilter = {
      and: [
        { property: statusPropName, status: { equals: 'Processed' } },
        { property: dateProp.name, date: { on_or_after: weekStartISO } },
        { property: dateProp.name, date: { before: weekEndISO } }
      ]
    };
    const completedByEditFilter = {
      and: [
        { property: statusPropName, status: { equals: 'Processed' } },
        { timestamp: 'last_edited_time', last_edited_time: { on_or_after: weekStartISO } },
        { timestamp: 'last_edited_time', last_edited_time: { before: weekEndISO } }
      ]
    };
    const [completedByDate, completedByEdit] = await Promise.all([
      notionManager.queryDatabase(completedByDateFilter, [{ property: dateProp.name, direction: 'descending' }]),
      notionManager.queryDatabase(completedByEditFilter, [{ property: dateProp.name, direction: 'descending' }])
    ]);
    const seenIds = new Set();
    const completedItems = [];
    for (const item of [...completedByDate, ...completedByEdit]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        completedItems.push(item);
      }
    }
    const excludeTypes = new Set(['pto', 'break']);
    const completed = completedItems
      .filter(item => {
        const typeRaw = item.properties[typePropName] || '';
        const typeLower = (typeof typeRaw === 'string' ? typeRaw : (typeRaw?.name ?? '')).trim().toLowerCase();
        return !excludeTypes.has(typeLower);
      })
      .map(item => {
        const title = item.properties[titleProp.name] || 'Untitled';
        const typeRaw = item.properties[typePropName] || '';
        const type = (typeof typeRaw === 'string' ? typeRaw : (typeRaw?.name ?? '')).trim().toLowerCase();
        return { title, type };
      });

    return {
      date: isoDate,
      dateLabel,
      meetings: meetingsOut,
      tasks: tasksOut,
      projects,
      completed,
      conflicts: {
        count: conflictPairs.length,
        pairs: conflictPairs,
        meetingOptions
      },
      error: null
    };
  } catch (err) {
    const isNetworkError = /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(err.message || '');
    const detail = isNetworkError ? 'Network unreachable. Use ↻ to retry.' : err.message;
    sendArcDebug({ type: 'error', message: 'Schedule fetch failed', detail });
    return { error: err.message, date: null, dateLabel: '', meetings: [], tasks: [], projects: [], conflicts: { count: 0, pairs: [], meetingOptions: [] } };
  }
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
  const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-3-haiku-20240307';
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

ipcMain.on('assistant-message', (event, data) => {
  // Extract text and history from the data object
  const text = typeof data === 'string' ? data : (data.text || '');
  const conversationHistory = (typeof data === 'object' && data.history) ? data.history : [];
  
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

  async function callAnthropic(input, history = []) {
    try {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🧠 ARC THINKING PROCESS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📥 User Input:', input);
      console.log('📚 Conversation history length:', history.length, 'messages');
      console.log('💬 Conversation history length:', history.length, 'messages');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      const endpoint = 'https://api.anthropic.com/v1/messages';

      sendArcDebug('Building context...');
      console.log('🔍 Building intelligent context...');
      const contextData = await contextBuilder.buildContext(input, history);
      const memoryContext = contextBuilder.formatSystemContext(contextData);

      // Get memory last updated info
      const memoryLastUpdated = memoryStore.getLastUpdatedFormatted();
      const memoryTimestampInfo = `\n\n📅 Memory Last Updated: ${memoryLastUpdated}`;

      // Get current system time
      const currentTime = getSystemTime();
      console.log('🕐 System time:', currentTime);

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

      console.log('📋 Assembling final context...');
      
      // Get core identity facts for immediate access (Tier 1 - System Prompt Injection)
      const coreIdentity = await memoryStore.getCoreIdentityFacts();
      let coreIdentityContext = '';
      if (coreIdentity.length > 0) {
        coreIdentityContext = `\n\n🔑 CORE IDENTITY (Immediate Access):\n${coreIdentity.map(f => `• ${f.text}`).join('\n')}`;
      }
      
      // Build system prompt from loaded file plus dynamic context
      const system = `${systemPrompt}

Current system time: ${currentTime}${coreIdentityContext}${memoryContext}${memoryTimestampInfo}${versionContext}`;

      console.log('   - Base prompt length:', systemPrompt.length, 'chars');
      console.log('   - Core identity facts:', coreIdentity.length);
      console.log('   - Memory context length:', memoryContext.length, 'chars');
      console.log('   - TOTAL context length:', system.length, 'chars');
      console.log('   - Context reduction:', contextData.stats.totalFacts - (contextData.stats.coreFacts + contextData.stats.relevantFacts), 'facts filtered out');

      const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-3-haiku-20240307';
      const version = (storedConfig && storedConfig.anthropicVersion) || '2023-06-01';
      
      console.log('🤖 Using model:', modelToUse);
      
      // Strip out "Arc" name addressing from input (works for all commands)
      // Removes patterns like: "Hey Arc,", "Arc:", "Hi Arc", "Arc", etc.
      let processedInput = input.replace(/^(?:(?:hey|hi)\s+)?arc[,:]?\s*/i, '').trim();
      
      // Check if this is a direct Notion command first
      if (notionManager.isConfigured()) {
        console.log('🔍 Checking for direct Notion command...');
        console.log('   Input:', input);
        console.log('   Processed:', processedInput);
        console.log('   Notion configured: YES');
        
        // Pattern: schedule my tasks / auto-schedule (read-only: Notion cannot be updated)
        if (/schedule\s+(my\s+)?tasks|auto.?schedule/i.test(processedInput)) {
          return 'Notion is read-only. I can only view your schedule, not auto-place or move tasks.';
        }
        
        // Pattern: move [item] to [time] [optional: today/tomorrow]
        // Examples: "move my lunch to 1pm", "can you move lunch to 1:30pm", "please move meeting to 2pm tomorrow"
        const itemMovePattern = /(?:can you|could you|would you|please)?\s*move\s+(?:my\s+)?(.+?)\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(today|tomorrow)?/i;
        const itemMoveMatch = processedInput.match(itemMovePattern);
        
        if (itemMoveMatch) {
          console.log('   ✅ MATCHED ITEM MOVE TO TIME PATTERN!');
          const itemKeyword = itemMoveMatch[1].trim();
          const targetTime = itemMoveMatch[2].trim();
          const targetDate = itemMoveMatch[3] || null;
          
          console.log('   Item keyword:', itemKeyword);
          console.log('   Target time:', targetTime);
          console.log('   Target date:', targetDate || 'today (default)');
          console.log('   🚀 Calling notionService.moveItemToTime...');
          
          const result = await notionService.moveItemToTime(itemKeyword, targetTime, targetDate);
          console.log('   📦 Service result:', result);
          
          // Send notification to display in Arc panel
          if (result.success && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('show-notification', result.message);
          }
          
          console.log('   ✅ Returning directly (no Claude call)');
          return result.message || result.error;
        }
        
        // Pattern: move today's/tomorrow's meetings to [date]
        const meetingMovePattern = /(move|reschedule)\s+(today'?s?|tomorrow'?s?|yesterday'?s?)\s+meetings?\s+to\s+(today|tomorrow|yesterday|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
        const moveMatch = processedInput.match(meetingMovePattern);
        
        console.log('   Meeting move pattern match:', moveMatch ? 'YES' : 'NO');
        
        if (moveMatch) {
          console.log('   ✅ MATCHED MEETING MOVE PATTERN!');
          console.log('   Pattern details:', moveMatch);
          const fromDateWord = moveMatch[2];
          const toDateWord = moveMatch[3];
          
          console.log('   From word:', fromDateWord);
          console.log('   To word:', toDateWord);
          
          const fromDate = notionService.calculateDate(fromDateWord);
          const toDate = notionService.calculateDate(toDateWord);
          
          console.log('   From ISO:', fromDate);
          console.log('   To ISO:', toDate);
          console.log('   🚀 Calling notionService.moveMeetings...');
          
          const result = await notionService.moveMeetings(fromDate, toDate);
          console.log('   📦 Service result:', result);
          console.log('   ✅ Returning directly (no Claude call)');
          const returnValue = result.message || result.error;
          console.log('   📤 Return value:', returnValue);
          return returnValue;
        }
        
        // Try other Notion commands
        console.log('   Trying other notion-commands patterns...');
        const notionResult = await notionCommands.parseNotionCommand(processedInput);
        if (notionResult) {
          console.log('✅ Direct Notion command executed');
          console.log('   Result:', notionResult);
          return notionResult;
        }
        console.log('   No notion-commands pattern matched');
      } else {
        console.log('🔍 Notion NOT configured - skipping direct commands');
      }
      
      sendArcDebug('Sending to Anthropic API...');
      console.log('📡 Sending to Anthropic API...\n');
      
      // Build conversation messages from history + current input
      const messages = [];
      
      // Add previous conversation (limit to last 20 messages to keep context manageable)
      // History from renderer is newest-first; API expects oldest-first for correct context
      const recentHistory = history.slice(-20);
      recentHistory.forEach(msg => {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      });
      messages.reverse();
      // Add current message
      messages.push({ role: 'user', content: input });
      
      console.log('   - Total messages in conversation:', messages.length);
      
      // Using configured model (default: Haiku 3)
      
      // Get available tools from Arc Task Registry
      const tools = arcTasks.getAllTools();
      
      const payload = {
        model: modelToUse,
        max_tokens: 2048,  // Increased for tool use scenarios
        system: system,
        messages: messages,
        tools: tools
      };

      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': version
      };

      let res = null;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.error('Network error calling Anthropic', e);
        sendArcDebug({ type: 'error', message: 'Network error', detail: e.message });
        return `Network error: ${e.message}`;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error('Anthropic error', res.status, txt);
        sendArcDebug({ type: 'error', message: `HTTP ${res.status}`, detail: txt.slice(0, 200) });
        if (process.env.LITTLEBOT_DEBUG === '1') {
          return `Anthropic error ${res.status}: ${txt}`;
        }
        return `Sorry, I couldn't reach the AI (status ${res.status}).`;
      }

      sendArcDebug({ type: 'status', message: '200', detail: modelToUse });
      const data = await res.json();
      
      // Check if Claude wants to use tools
      if (data.stop_reason === 'tool_use') {
        console.log('🔧 Claude requested tool use...');
        
        // Find tool use blocks
        const toolUses = data.content.filter(block => block.type === 'tool_use');
        const toolResults = [];
        
        for (const toolUse of toolUses) {
          console.log(`   - Tool: ${toolUse.name}`);
          console.log(`   - Input:`, JSON.stringify(toolUse.input));
          
          let result;
          try {
            // Execute task through Arc Task Registry
            result = await arcTasks.executeTask(toolUse.name, toolUse.input);
            console.log(`   ✅ Task executed successfully`);
          } catch (err) {
            console.error(`   ❌ Task execution error:`, err.message);
            result = { error: err.message };
          }
          
          console.log(`   - Result:`, JSON.stringify(result).substring(0, 200) + '...');
          
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }
        
        // Make a follow-up API call with the tool results
        console.log('🔄 Sending tool results back to Claude...');
        
        // Add assistant's response (with tool use) to messages
        messages.push({
          role: 'assistant',
          content: data.content
        });
        
        // Add tool results
        messages.push({
          role: 'user',
          content: toolResults
        });
        
        const followUpPayload = {
          model: modelToUse,
          max_tokens: 2048,  // Increased for complex operations
          system: system,
          messages: messages,
          tools: tools
        };
        
        const followUpRes = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(followUpPayload)
        });
        
        if (!followUpRes.ok) {
          const txt = await followUpRes.text().catch(() => '');
          console.error('Follow-up API error', followUpRes.status, txt);
          return `Sorry, I had trouble processing the file search results.`;
        }
        
        const followUpData = await followUpRes.json();
        
        // Check if the follow-up response also wants to use tools (recursive tool use)
        if (followUpData.stop_reason === 'tool_use') {
          console.log('🔧 Claude requested additional tool use...');
          
          // Extract any text content before the tool use
          let intermediateText = '';
          if (followUpData.content && Array.isArray(followUpData.content)) {
            intermediateText = followUpData.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('')
              .trim();
          }
          
          if (intermediateText) {
            console.log('📝 Intermediate message:', intermediateText);
          }
          
          // Process additional tools
          const additionalToolUses = followUpData.content.filter(block => block.type === 'tool_use');
          const additionalToolResults = [];
          
          for (const toolUse of additionalToolUses) {
            console.log(`   - Tool: ${toolUse.name}`);
            console.log(`   - Input:`, JSON.stringify(toolUse.input));
            
            let result;
            try {
              // Execute task through Arc Task Registry
              result = await arcTasks.executeTask(toolUse.name, toolUse.input);
              console.log(`   ✅ Task executed successfully`);
            } catch (err) {
              console.error(`   ❌ Task execution error:`, err.message);
              result = { error: err.message };
            }
            
            console.log(`   - Result:`, JSON.stringify(result).substring(0, 200) + '...');
            
            additionalToolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result)
            });
          }
          
          // Add this response to messages
          messages.push({
            role: 'assistant',
            content: followUpData.content
          });
          
          // Add tool results
          messages.push({
            role: 'user',
            content: additionalToolResults
          });
          
          // Final API call
          console.log('🔄 Sending additional tool results back to Claude...');
          
          const finalPayload = {
            model: modelToUse,
            max_tokens: 2048,  // Increased for final response
            system: system,
            messages: messages,
            tools: tools
          };
          
          const finalRes = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(finalPayload)
          });
          
          if (!finalRes.ok) {
            const txt = await finalRes.text().catch(() => '');
            console.error('Final API error', finalRes.status, txt);
            return intermediateText || `Sorry, I had trouble completing the operation.`;
          }
          
          const finalData = await finalRes.json();
          
          // Extract final response
          let completion = '';
          if (finalData.content && Array.isArray(finalData.content)) {
            completion = finalData.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('')
              .trim();
          }
          
          // Calculate cost
          let costInfo = '';
          if (finalData.usage) {
            const inputCost = (finalData.usage.input_tokens / 1000000) * 0.25;
            const outputCost = (finalData.usage.output_tokens / 1000000) * 1.25;
            const totalCost = inputCost + outputCost;
            costInfo = `\n   - Cost: $${totalCost.toFixed(6)} (in: $${inputCost.toFixed(6)} + out: $${outputCost.toFixed(6)})`;
          }
          
          console.log('✅ Response received from Claude (after additional tool use)');
          console.log('   - Response length:', completion.length, 'chars');
          console.log('   - Usage:', finalData.usage ? `${finalData.usage.input_tokens} in / ${finalData.usage.output_tokens} out` : 'N/A');
          if (costInfo) console.log(costInfo);
          console.log('\n📤 Arc Response:', completion.substring(0, 200) + (completion.length > 200 ? '...' : ''));
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('END OF THINKING PROCESS');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          
          // If no completion text, return intermediate text or a generic message
          if (!completion) {
            return intermediateText || 'Done! I completed the task.';
          }
          
          return completion;
        }
        
        // Extract the final response (no additional tool use)
        let completion = '';
        if (followUpData.content && Array.isArray(followUpData.content)) {
          completion = followUpData.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('')
            .trim();
        }
        
        // Calculate cost
        let costInfo = '';
        if (followUpData.usage) {
          const inputCost = (followUpData.usage.input_tokens / 1000000) * 0.25;
          const outputCost = (followUpData.usage.output_tokens / 1000000) * 1.25;
          const totalCost = inputCost + outputCost;
          costInfo = `\n   - Cost: $${totalCost.toFixed(6)} (in: $${inputCost.toFixed(6)} + out: $${outputCost.toFixed(6)})`;
        }
        
        console.log('✅ Response received from Claude (after tool use)');
        console.log('   - Response length:', completion.length, 'chars');
        console.log('   - Usage:', followUpData.usage ? `${followUpData.usage.input_tokens} in / ${followUpData.usage.output_tokens} out` : 'N/A');
        if (costInfo) console.log(costInfo);
        console.log('\n📤 Arc Response:', completion.substring(0, 200) + (completion.length > 200 ? '...' : ''));
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('END OF THINKING PROCESS');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        return completion;
      }
      
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
      
      // Calculate cost (Claude Haiku 3 pricing: $0.25/M input, $1.25/M output)
      let costInfo = '';
      if (data.usage) {
        const inputCost = (data.usage.input_tokens / 1000000) * 0.25;
        const outputCost = (data.usage.output_tokens / 1000000) * 1.25;
        const totalCost = inputCost + outputCost;
        costInfo = `\n   - Cost: $${totalCost.toFixed(6)} (in: $${inputCost.toFixed(6)} + out: $${outputCost.toFixed(6)})`;
      }
      
      console.log('✅ Response received from Claude');
      console.log('   - Response length:', completion.length, 'chars');
      console.log('   - Usage:', data.usage ? `${data.usage.input_tokens} in / ${data.usage.output_tokens} out` : 'N/A');
      if (costInfo) console.log(costInfo);
      console.log('\n📤 Arc Response:', completion.substring(0, 200) + (completion.length > 200 ? '...' : ''));
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('END OF THINKING PROCESS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      // No artificial length cap - let Arc respond naturally
      
      return completion;
    } catch (err) {
      console.error('Anthropic request failed', err);
      sendArcDebug({ type: 'error', message: 'Request failed', detail: err.message });
      return `Error contacting AI: ${err.message}`;
    }
  }

  (async () => {
    event.sender.send('assistant-reply', 'Thinking...');
    sendArcDebug('User message received');

    const lowerText = text.toLowerCase();
    const clearMemoryTriggers = [
      /\b(delete|clear|remove|erase|wipe)\s+(?:that|your?\s?memory|memory|it)\b/i,
      /\b(delete|clear|remove|erase)\s+(?:that\s+)?(?:from\s+)?(?:your?\s?)?memory\b/i,
      /\bclear\s+(?:your?\s?)?memory\b/i,
      /\bforget\s+(?:that|it|everything)\b/i,
      /\b(?:you\s+)?need\s+to\s+delete\s+that\b/i,
      /\bdon'?t\s+(?:use\s+)?(?:your?\s?)?memory\b/i
    ];
    const shouldClearMemory = clearMemoryTriggers.some(r => r.test(text));
    if (shouldClearMemory) {
      await memoryStore.clearAll();
      console.log('Memory cleared per user request');
    }

    let reply;
    if (anthropicKey) {
      reply = await callAnthropic(text, conversationHistory);
      
      // Check for explicit memory commands (expanded patterns for natural language)
      // More flexible memory save triggers
      const memoryTriggers = [
        /remember (?:that )?(.+)/i,
        /save (?:to (?:your )?(?:memory|memory core) )?(?:that )?(.+)/i,
        /keep (?:in mind |track of )?(?:that )?(.+)/i,
        /(?:make a |take a )?note (?:that )?(.+)/i,
        /don'?t forget (?:that )?(.+)/i,
        /write (?:down |this down )?(?:that )?(.+)/i,
        /store (?:in memory |this )?(?:that )?(.+)/i,
        /log (?:that )?(.+)/i,
        /add to (?:your )?(?:memory|notes) (?:that )?(.+)/i
      ];
      
      let savedToMemory = false;
      for (const pattern of memoryTriggers) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const factToSave = match[1].trim();
          // Avoid saving if it's too short or just a question
          if (factToSave.length > 3 && !factToSave.endsWith('?')) {
            await memoryStore.addFact(factToSave, 'user');
            console.log('Explicitly saved to memory:', factToSave);
            savedToMemory = true;
            break;
          }
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

    sendArcDebug('Reply sent');
    reply = stripItalicizedActions(reply);
    event.sender.send('assistant-reply', reply);
  })();
});

// Extract and store learnings from conversation
async function extractLearnings(userMessage, assistantReply, apiKey) {
  try {
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const modelToUse = (storedConfig && storedConfig.anthropicModel) || 'claude-3-haiku-20240307';
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

    // Clean up potential JSON issues (trailing commas, etc.)
    let jsonString = jsonMatch[0];
    
    // Remove trailing commas before closing brackets/braces
    jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
    
    let learnings;
    try {
      learnings = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse learning JSON:', parseError.message);
      console.log('Problematic JSON:', jsonString.substring(0, 200));
      return;
    }
    
    // Store facts
    if (learnings.facts && learnings.facts.length > 0) {
      for (const fact of learnings.facts) {
        await memoryStore.addFact(fact, 'user');
        console.log('📝 MEMORY WRITE [FACT]:', fact);
      }
    }
    
    // Store topic knowledge
    if (learnings.topics && learnings.topics.length > 0) {
      for (const topicData of learnings.topics) {
        await memoryStore.addTopicKnowledge(topicData.topic, topicData.knowledge);
        console.log('📚 MEMORY WRITE [TOPIC]:', topicData.topic, '-', topicData.knowledge);
        
        // Notify renderer to add particle
        if (mainWindow && !mainWindow.isDestroyed()) {
          const allTopics = await memoryStore.getAllTopics();
          const topicCount = Object.keys(allTopics).length;
          mainWindow.webContents.send('topic-learned', { topic: topicData.topic, totalTopics: topicCount });
        }
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
