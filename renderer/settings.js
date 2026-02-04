const apiKeyInput = document.getElementById('apiKeyInput');
const anthropicVersionInput = document.getElementById('anthropicVersionInput');
const anthropicModelInput = document.getElementById('anthropicModelInput');
const slackWebhookInput = document.getElementById('slackWebhookInput');
const notionApiKeyInput = document.getElementById('notionApiKeyInput');
const notionDatabaseIdInput = document.getElementById('notionDatabaseIdInput');
const voiceSelect = document.getElementById('voiceSelect');
const rateInput = document.getElementById('rateInput');
const pitchInput = document.getElementById('pitchInput');
const volumeInput = document.getElementById('volumeInput');
const rateVal = document.getElementById('rateVal');
const pitchVal = document.getElementById('pitchVal');
const volumeVal = document.getElementById('volumeVal');
const saveBtn = document.getElementById('saveBtn');
const probeApiBtn = document.getElementById('probeApiBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const closeBtn = document.getElementById('closeBtn');
const status = document.getElementById('status');
const probeResult = document.getElementById('probeResult');
const systemPromptInput = document.getElementById('systemPromptInput');
const promptLockToggle = document.getElementById('promptLockToggle');
const savePromptBtn = document.getElementById('savePromptBtn');
const syncMemoryBtn = document.getElementById('syncMemoryBtn');
const pullMemoryBtn = document.getElementById('pullMemoryBtn');
const memoryStatus = document.getElementById('memoryStatus');

// Load settings on startup
async function loadSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    if (s) {
      if (s.anthropicKey) apiKeyInput.value = s.anthropicKey;
      anthropicVersionInput.value = s.anthropicVersion || '2023-06-01';
      anthropicModelInput.value = s.anthropicModel || 'claude-3-haiku-20240307';
      if (s.slackWebhook) slackWebhookInput.value = s.slackWebhook;
      if (s.notionApiKey) notionApiKeyInput.value = s.notionApiKey;
      if (s.notionDatabaseId) notionDatabaseIdInput.value = s.notionDatabaseId;
      
      if (s.voice) {
        if (s.voice.rate) rateInput.value = s.voice.rate;
        if (s.voice.pitch) pitchInput.value = s.voice.pitch;
        if (s.voice.volume) volumeInput.value = s.voice.volume;
        updateRangeValues();
      }
    } else {
      anthropicVersionInput.value = '2023-06-01';
      anthropicModelInput.value = 'claude-3-haiku-20240307';
    }
    
    // Load system prompt
    const prompt = await window.electronAPI.getSystemPrompt();
    if (prompt) systemPromptInput.value = prompt;
    
    // Load prompt lock status
    const locked = await window.electronAPI.getPromptLockStatus();
    promptLockToggle.checked = locked;
    updatePromptLock(locked);
    
  } catch (e) {
    console.error('Failed to load settings:', e);
    anthropicVersionInput.value = '2023-06-01';
    anthropicModelInput.value = 'claude-3-haiku-20240307';
  }
}

function updatePromptLock(locked) {
  systemPromptInput.disabled = locked;
  savePromptBtn.disabled = locked;
  if (locked) {
    systemPromptInput.style.opacity = '0.6';
    systemPromptInput.style.cursor = 'not-allowed';
    savePromptBtn.style.opacity = '0.6';
    savePromptBtn.style.cursor = 'not-allowed';
  } else {
    systemPromptInput.style.opacity = '1';
    systemPromptInput.style.cursor = 'text';
    savePromptBtn.style.opacity = '1';
    savePromptBtn.style.cursor = 'pointer';
  }
}

// Populate voices
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
}

if (speechSynthesis) {
  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
}

// Update range value displays
function updateRangeValues() {
  rateVal.textContent = rateInput.value;
  pitchVal.textContent = pitchInput.value;
  volumeVal.textContent = volumeInput.value;
}

rateInput.addEventListener('input', updateRangeValues);
pitchInput.addEventListener('input', updateRangeValues);
volumeInput.addEventListener('input', updateRangeValues);

// Save settings
saveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim() || null;
  const version = anthropicVersionInput.value.trim() || null;
  const model = anthropicModelInput.value.trim() || null;
  const slackWebhook = slackWebhookInput.value.trim() || null;
  const notionKey = notionApiKeyInput.value.trim() || null;
  const notionDbId = notionDatabaseIdInput.value.trim() || null;
  const voice = {
    voiceURI: voiceSelect.value,
    rate: parseFloat(rateInput.value),
    pitch: parseFloat(pitchInput.value),
    volume: parseFloat(volumeInput.value)
  };
  
  try {
    await window.electronAPI.setSettings({ 
      anthropicKey: key, 
      anthropicVersion: version, 
      anthropicModel: model,
      slackWebhook: slackWebhook,
      notionApiKey: notionKey,
      notionDatabaseId: notionDbId,
      voice: voice
    });
    
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
  if (confirm('Are you sure you want to clear all chat history?')) {
    try {
      await window.electronAPI.clearHistory();
      status.textContent = '✓ Chat history cleared';
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

// Save system prompt
savePromptBtn.addEventListener('click', async () => {
  if (promptLockToggle.checked) {
    status.textContent = '✗ System prompt is locked';
    status.className = 'status error';
    setTimeout(() => {
      status.className = 'status hidden';
    }, 2000);
    return;
  }
  
  try {
    const result = await window.electronAPI.setSystemPrompt(systemPromptInput.value);
    if (result.success) {
      status.textContent = '✓ System prompt saved (backup created)';
      status.className = 'status success';
    } else {
      status.textContent = '✗ ' + result.error;
      status.className = 'status error';
    }
    setTimeout(() => {
      status.className = 'status hidden';
    }, 3000);
  } catch (e) {
    status.textContent = '✗ Failed to save system prompt';
    status.className = 'status error';
  }
});

// Prompt lock toggle
promptLockToggle.addEventListener('change', async () => {
  const locked = promptLockToggle.checked;
  await window.electronAPI.setPromptLockStatus(locked);
  updatePromptLock(locked);
  
  status.textContent = locked ? '🔒 System prompt locked' : '🔓 System prompt unlocked';
  status.className = 'status success';
  setTimeout(() => {
    status.className = 'status hidden';
  }, 2000);
});

// Memory GitHub sync
syncMemoryBtn.addEventListener('click', async () => {
  try {
    memoryStatus.textContent = 'Syncing memory to GitHub repository...';
    memoryStatus.className = 'status';
    
    const result = await window.electronAPI.memorySyncGitHub();
    
    if (result.success) {
      memoryStatus.textContent = `✓ Memory synced to repository: ${result.path}`;
      memoryStatus.className = 'status success';
    } else {
      memoryStatus.textContent = `✗ Failed to sync: ${result.error}`;
      memoryStatus.className = 'status error';
    }
    
    setTimeout(() => {
      memoryStatus.className = 'status hidden';
    }, 5000);
  } catch (e) {
    memoryStatus.textContent = '✗ Failed to sync memory';
    memoryStatus.className = 'status error';
  }
});

pullMemoryBtn.addEventListener('click', async () => {
  try {
    memoryStatus.textContent = 'Pulling memory from GitHub repository...';
    memoryStatus.className = 'status';
    
    const result = await window.electronAPI.memoryPullGitHub();
    
    if (result.success) {
      memoryStatus.textContent = '✓ Memory pulled from GitHub and loaded';
      memoryStatus.className = 'status success';
    } else {
      memoryStatus.textContent = `✗ Failed to pull: ${result.error}`;
      memoryStatus.className = 'status error';
    }
    
    setTimeout(() => {
      memoryStatus.className = 'status hidden';
    }, 5000);
  } catch (e) {
    memoryStatus.textContent = '✗ Failed to pull memory';
    memoryStatus.className = 'status error';
  }
});

// Close window
closeBtn.addEventListener('click', () => {
  window.close();
});

// Load settings on startup
loadSettings();
