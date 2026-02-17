const apiKeyInput = document.getElementById('apiKeyInput');
const anthropicVersionInput = document.getElementById('anthropicVersionInput');
const anthropicModelInput = document.getElementById('anthropicModelInput');
const slackWebhookInput = document.getElementById('slackWebhookInput');
const notionApiKeyInput = document.getElementById('notionApiKeyInput');
const notionDatabaseIdInput = document.getElementById('notionDatabaseIdInput');
const themeSelect = document.getElementById('themeSelect');
const saveBtn = document.getElementById('saveBtn');
const probeApiBtn = document.getElementById('probeApiBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const closeBtn = document.getElementById('closeBtn');
const status = document.getElementById('status');
const probeResult = document.getElementById('probeResult');

let cachedSettings = null;

// Load settings on startup
async function loadSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    cachedSettings = s || {};
    if (s) {
      if (s.anthropicKey) apiKeyInput.value = s.anthropicKey;
      anthropicVersionInput.value = s.anthropicVersion || '2023-06-01';
      anthropicModelInput.value = s.anthropicModel || 'claude-3-haiku-20240307';
      if (s.slackWebhook) slackWebhookInput.value = s.slackWebhook;
      if (s.notionApiKey) notionApiKeyInput.value = s.notionApiKey;
      if (s.notionDatabaseId) notionDatabaseIdInput.value = s.notionDatabaseId;
      if (s.theme) themeSelect.value = s.theme;
    } else {
      anthropicVersionInput.value = '2023-06-01';
      anthropicModelInput.value = 'claude-3-haiku-20240307';
    }

    // Apply theme to the Settings window itself
    const theme = (s && s.theme) ? s.theme : 'dark';
    document.body.classList.toggle('theme-light', theme === 'light');
    
  } catch (e) {
    console.error('Failed to load settings:', e);
    anthropicVersionInput.value = '2023-06-01';
    anthropicModelInput.value = 'claude-3-haiku-20240307';
  }
}

themeSelect.addEventListener('change', () => {
  const theme = themeSelect.value || 'dark';
  document.body.classList.toggle('theme-light', theme === 'light');
});

// Save settings
saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim() || null;
  const version = anthropicVersionInput.value.trim() || null;
  const model = anthropicModelInput.value.trim() || null;
  const slackWebhook = slackWebhookInput.value.trim() || null;
  const notionKey = notionApiKeyInput.value.trim() || null;
  const notionDbId = notionDatabaseIdInput.value.trim() || null;
  const theme = themeSelect.value || 'dark';
  
  try {
    await window.electronAPI.setSettings({ 
      anthropicKey: key, 
      anthropicVersion: version, 
      anthropicModel: model,
      slackWebhook: slackWebhook,
      notionApiKey: notionKey,
      notionDatabaseId: notionDbId,
      theme: theme
    });
    cachedSettings = Object.assign({}, cachedSettings || {}, { anthropicKey: key, anthropicVersion: version, anthropicModel: model, slackWebhook, notionApiKey: notionKey, notionDatabaseId: notionDbId, theme });
    
    status.textContent = '✓ Settings saved successfully';
    status.className = 'status success';
    setTimeout(() => {
      status.className = 'status hidden';
    }, 2000);
  } catch (err) {
    status.textContent = '✗ Failed to save settings';
    status.className = 'status error';
  }
});

// Test API
probeApiBtn.addEventListener('click', async () => {
  probeResult.classList.remove('hidden');
  probeResult.textContent = 'Testing API connection...';
  
  try {
    const r = await window.electronAPI.probeAnthropic();
    probeResult.textContent = JSON.stringify(r, null, 2);
  } catch (e) {
    probeResult.textContent = 'Test failed: ' + e.message;
  }
});

// Clear history
clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all history?')) {
    try {
      await window.electronAPI.clearHistory();
      status.textContent = '✓ History cleared';
      status.className = 'status success';
      setTimeout(() => {
        status.className = 'status hidden';
      }, 2000);
    } catch (e) {
      status.textContent = '✗ Failed to clear history';
      status.className = 'status error';
    }
  }
});

// Close window
closeBtn.addEventListener('click', () => {
  window.close();
});

// ── Debug Log ──────────────────────────────────────────────
const debugLogEl = document.getElementById('debug-log');
const debugLastStatus = document.getElementById('debug-last-status');
const debugLastError = document.getElementById('debug-last-error');
const debugCopy = document.getElementById('debug-copy');
const debugClear = document.getElementById('debug-clear');

const DEBUG_LOG_MAX = 50;
const debugLogLines = [];

function appendDebugEntry(entry) {
  const line = `[${entry.ts.split('T')[1].slice(0, 12)}] ${entry.type}: ${entry.message}${entry.detail ? ' · ' + String(entry.detail).slice(0, 80) : ''}`;
  debugLogLines.push(line);
  if (debugLogLines.length > DEBUG_LOG_MAX) debugLogLines.shift();
  if (debugLogEl) {
    debugLogEl.textContent = debugLogLines.join('\n');
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }
  if (entry.type === 'status' && debugLastStatus) {
    debugLastStatus.textContent = `Last: ${entry.message}${entry.detail ? ' · ' + entry.detail : ''}`;
    if (debugLastError) { debugLastError.classList.add('hidden'); debugLastError.textContent = '—'; }
  }
  if (entry.type === 'error' && debugLastError) {
    debugLastError.textContent = entry.detail || entry.message;
    debugLastError.classList.remove('hidden');
    debugLastError.classList.add('error');
  }
}

// Load existing log buffer on startup
if (window.electronAPI.getDebugLog) {
  window.electronAPI.getDebugLog().then(entries => {
    if (Array.isArray(entries)) entries.forEach(e => appendDebugEntry(e));
  });
}

// Listen for new entries in real time
if (window.electronAPI.onArcDebug) {
  window.electronAPI.onArcDebug((data) => {
    appendDebugEntry(data);
  });
}

if (debugCopy) {
  debugCopy.addEventListener('click', () => {
    const text = debugLogLines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        debugCopy.textContent = 'Copied!';
        setTimeout(() => { debugCopy.textContent = 'Copy Logs'; }, 1500);
      });
    }
  });
}

if (debugClear) {
  debugClear.addEventListener('click', () => {
    debugLogLines.length = 0;
    if (debugLogEl) debugLogEl.textContent = '';
    if (debugLastStatus) debugLastStatus.textContent = '—';
    if (debugLastError) { debugLastError.textContent = '—'; debugLastError.classList.add('hidden'); }
  });
}

// Load settings on startup
loadSettings();
