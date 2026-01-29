const apiKeyInput = document.getElementById('apiKeyInput');
const anthropicVersionInput = document.getElementById('anthropicVersionInput');
const anthropicModelInput = document.getElementById('anthropicModelInput');
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

// Load settings on startup
async function loadSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    if (s) {
      if (s.anthropicKey) apiKeyInput.value = s.anthropicKey;
      anthropicVersionInput.value = s.anthropicVersion || '2023-06-01';
      anthropicModelInput.value = s.anthropicModel || 'claude-sonnet-4-5-20250929';
      
      if (s.voice) {
        if (s.voice.rate) rateInput.value = s.voice.rate;
        if (s.voice.pitch) pitchInput.value = s.voice.pitch;
        if (s.voice.volume) volumeInput.value = s.voice.volume;
        updateRangeValues();
      }
    } else {
      anthropicVersionInput.value = '2023-06-01';
      anthropicModelInput.value = 'claude-sonnet-4-5-20250929';
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    anthropicVersionInput.value = '2023-06-01';
    anthropicModelInput.value = 'claude-sonnet-4-5-20250929';
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

// Close window
closeBtn.addEventListener('click', () => {
  window.close();
});

// Load settings on startup
loadSettings();
