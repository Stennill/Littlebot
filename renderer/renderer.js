const input = document.getElementById('input');
const orb = document.getElementById('orb');
const barWrap = document.getElementById('bar-wrap');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('mic');
const stopBtn = document.getElementById('stopBtn');
const wakeWordBtn = document.getElementById('wakeWord');
const messages = document.getElementById('messages');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const anthropicVersionInput = document.getElementById('anthropicVersionInput');
const anthropicModelInput = document.getElementById('anthropicModelInput');
const slackWebhookInput = document.getElementById('slackWebhookInput');
const saveApiKey = document.getElementById('saveApiKey');
const closeSettings = document.getElementById('closeSettings');
const clearHistory = document.getElementById('clearHistory');
const settingsStatus = document.getElementById('settingsStatus');
const probeApiBtn = document.getElementById('probeApi');
const probeResult = document.getElementById('probeResult');
const voiceSelect = document.getElementById('voiceSelect');
const rateInput = document.getElementById('rateInput');
const pitchInput = document.getElementById('pitchInput');
const volumeInput = document.getElementById('volumeInput');
const rateVal = document.getElementById('rateVal');
const pitchVal = document.getElementById('pitchVal');
const volumeVal = document.getElementById('volumeVal');
const testVoice = document.getElementById('testVoice');
const panel = document.getElementById('panel');
const debugToggle = document.getElementById('debugToggle');
const debugPanelEl = document.getElementById('debug-panel');
const messagesWrap = document.getElementById('messages-wrap');
const debugLog = document.getElementById('debug-log');
const debugLastStatus = document.getElementById('debug-last-status');
const debugLastError = document.getElementById('debug-last-error');
const debugCopy = document.getElementById('debug-copy');
const debugClear = document.getElementById('debug-clear');
const scheduleDateEl = document.getElementById('schedule-date');
const scheduleMeetingsEl = document.getElementById('schedule-meetings');
const scheduleTasksEl = document.getElementById('schedule-tasks');
const scheduleMeetingsWrap = document.getElementById('schedule-meetings-wrap');
const scheduleTasksWrap = document.getElementById('schedule-tasks-wrap');
const scheduleProjectsSection = document.getElementById('schedule-projects-section');
const scheduleProjectsWrap = document.getElementById('schedule-projects-wrap');
const scheduleProjectsEl = document.getElementById('schedule-projects');
const scheduleEmptyEl = document.getElementById('schedule-empty');
const scheduleRefreshBtn = document.getElementById('schedule-refresh-btn');
const scheduleUpcomingWrap = document.getElementById('schedule-upcoming-wrap');
const scheduleUpcomingEl = document.getElementById('schedule-upcoming');
const arcPanel = document.getElementById('arc-panel');
const arcPanelHeader = document.getElementById('arc-panel-header');

if (arcPanelHeader && arcPanel) {
  arcPanelHeader.addEventListener('click', () => arcPanel.classList.toggle('collapsed'));
}

function renderUpcomingEvents(events) {
  if (!scheduleUpcomingEl || !scheduleUpcomingWrap) return;
  if (!events || events.length === 0) {
    scheduleUpcomingWrap.classList.add('hidden');
    return;
  }
  scheduleUpcomingWrap.classList.remove('hidden');
  scheduleUpcomingEl.innerHTML = events.map(e => {
    const t = (e.type || '').toLowerCase();
    const label = t === 'meeting' ? 'Meeting' : (t === 'task' ? 'Task' : 'Event');
    const meta = (e.inProgress || e.minutesUntil === 0) ? `Now · ${e.timeStr}` : `in ${e.minutesUntil} min · ${e.timeStr}`;
    return `<li><span class="schedule-upcoming-time">${escapeHtml(e.timeStr)}</span>${escapeHtml(e.title)}<span class="schedule-upcoming-meta">${label} — ${meta}</span></li>`;
  }).join('');
}

/** Highlight schedule items that are in the upcoming-events list (by data-id). Clears highlight when events is empty. */
function highlightScheduleUpcoming(events) {
  const ids = (events || []).map(e => e.id).filter(Boolean);
  if (scheduleMeetingsEl) {
    scheduleMeetingsEl.querySelectorAll('.schedule-meeting-group[data-id]').forEach(el => {
      const id = el.getAttribute('data-id');
      if (ids.includes(id)) el.classList.add('schedule-item-upcoming');
      else el.classList.remove('schedule-item-upcoming');
    });
  }
  if (scheduleTasksEl) {
    scheduleTasksEl.querySelectorAll('li[data-id]').forEach(li => {
      const id = li.getAttribute('data-id');
      if (ids.includes(id)) li.classList.add('schedule-item-upcoming');
      else li.classList.remove('schedule-item-upcoming');
    });
  }
}

async function loadUpcomingSchedule() {
  if (!scheduleDateEl || !scheduleMeetingsEl || !scheduleTasksEl || !scheduleEmptyEl) return;
  if (!window.electronAPI.getUpcomingSchedule) return;
  try {
    const data = await window.electronAPI.getUpcomingSchedule();
    if (data.error) {
      if (data.error === 'Notion not configured') {
        scheduleDateEl.textContent = '';
        scheduleMeetingsEl.innerHTML = '';
        scheduleTasksEl.innerHTML = '';
        if (scheduleProjectsEl) scheduleProjectsEl.innerHTML = '';
        scheduleEmptyEl.textContent = 'Connect Notion in Settings to see your schedule.';
        scheduleEmptyEl.classList.remove('hidden');
        if (scheduleMeetingsWrap) scheduleMeetingsWrap.classList.add('hidden');
        if (scheduleTasksWrap) scheduleTasksWrap.classList.add('hidden');
        if (scheduleProjectsSection) scheduleProjectsSection.classList.add('hidden');
      }
      return;
    }
    scheduleEmptyEl.classList.add('hidden');
    if (scheduleMeetingsWrap) scheduleMeetingsWrap.classList.remove('hidden');
    if (scheduleTasksWrap) scheduleTasksWrap.classList.remove('hidden');
    scheduleDateEl.textContent = data.dateLabel || '';
    const meetingsList = data.meetings || [];
    if (meetingsList.length === 0) {
      scheduleMeetingsEl.innerHTML = '<li class="schedule-none">None</li>';
    } else {
      scheduleMeetingsEl.innerHTML = meetingsList.map(m => {
        const actionItems = m.actionItems || [];
        const actionList = actionItems.length === 0
          ? '<li class="schedule-none">None</li>'
          : actionItems.map(a => `<li>${a.time ? `<span class="schedule-time">${a.time}</span>` : ''}${escapeHtml(a.title)}</li>`).join('');
        return `<div class="schedule-meeting-group"${m.id ? ` data-id="${escapeHtml(m.id)}"` : ''}><div class="schedule-meeting-title">${m.time ? `<span class="schedule-time">${m.time}</span>` : ''}${escapeHtml(m.title)}</div><ul class="schedule-meeting-action-items">${actionList}</ul></div>`;
      }).join('');
    }
    scheduleTasksEl.innerHTML = (data.tasks || []).map(t => `<li${t.id ? ` data-id="${escapeHtml(t.id)}"` : ''}>${t.time ? `<span class="schedule-time">${t.time}</span>` : ''}${escapeHtml(t.title)}</li>`).join('') || '<li class="schedule-none">None</li>';
    if (scheduleProjectsEl && scheduleProjectsSection) {
      const projects = data.projects || [];
      scheduleProjectsSection.classList.remove('hidden');
      if (projects.length === 0) {
        scheduleProjectsEl.innerHTML = '<div class="schedule-project-none">None</div>';
      } else {
        scheduleProjectsEl.innerHTML = projects.map(p => {
          const taskList = (p.tasks || []).map(t => `<li>${escapeHtml(t.title)}</li>`).join('') || '<li class="schedule-none">None</li>';
          return `<div class="schedule-project-group"><div class="schedule-project-title">${escapeHtml(p.title)}</div><ul class="schedule-project-tasks">${taskList}</ul></div>`;
        }).join('');
      }
    }
  } catch (e) {
  }
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// DEBUG: set to true to log panel/reply flow to console (DevTools: Ctrl+Shift+I)
const DEBUG_PANEL = true;
function debugPanel(msg, data = {}) {
  if (!DEBUG_PANEL) return;
  const info = { time: new Date().toISOString(), ...data };
  console.log('[Panel] ' + msg, info);
}

// Theme: from settings; apply and listen for changes
function applyTheme(isLight) {
  document.body.classList.toggle('theme-light', isLight);
  document.body.classList.toggle('theme-dark', !isLight);
}
function loadThemeFromSettings() {
  window.electronAPI.getSettings().then(s => {
    applyTheme((s && s.theme) === 'light');
  }).catch(() => {});
}
loadThemeFromSettings();
window.electronAPI.onThemeChanged((theme) => {
  applyTheme(theme === 'light');
});

let wakeWordActive = false;
let isSpeaking = false;
let currentUtterance = null;
let hideTimer = null;
let collapseTimer = null;
let chatClearTimer = null;
const COLLAPSE_DELAY_MS = 60000; // collapse to orb after 60s idle
const PANEL_HIDE_AFTER_MS = 10 * 60 * 1000; // hide panel after 10 mins idle
const CHAT_CLEAR_AFTER_MS = 2 * 60 * 1000; // clear chat 2 min after last message

function isCollapsed() {
  return barWrap && barWrap.classList.contains('collapsed');
}

function expandBar() {
  if (!barWrap) return;
  barWrap.classList.remove('collapsed');
  if (input) input.focus();
  startCollapseTimer();
}

function collapseToOrb() {
  if (!barWrap) return;
  barWrap.classList.add('collapsed');
  if (input) input.blur();
  if (panel) panel.classList.add('hidden');
  clearTimeout(collapseTimer);
  collapseTimer = null;
}

function startCollapseTimer() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseToOrb();
  }, COLLAPSE_DELAY_MS);
}

// Auto-hide reply panel after 10 min idle
function startHideTimer() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (panel) panel.classList.add('hidden');
  }, PANEL_HIDE_AFTER_MS);
}

// Clear chat messages 2 min after last message (user or bot)
function startChatClearTimer() {
  clearTimeout(chatClearTimer);
  chatClearTimer = setTimeout(() => {
    if (messages) messages.innerHTML = '';
    chatClearTimer = null;
  }, CHAT_CLEAR_AFTER_MS);
}

function showPanel() {
  if (panel) {
    panel.classList.remove('hidden');
    startHideTimer();
  }
}

function closePanel() {
  if (input) input.blur();
  if (panel) panel.classList.add('hidden');
}

function reopenPanelIfHasMessages() {
  if (!panel || !messages) return;
  if (!panel.classList.contains('hidden')) return;
  if (messages.querySelectorAll('.message').length === 0) return;
  showPanel();
}

if (input && panel) {
  input.addEventListener('focus', () => {
    reopenPanelIfHasMessages();
    if (barWrap) startCollapseTimer();
  });
}

if (orb) {
  orb.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCollapsed()) {
      expandBar();
      reopenPanelIfHasMessages();
    } else {
      closePanel();
    }
  });
  orb.addEventListener('mousedown', (e) => e.stopPropagation());
}

if (sendBtn && input) {
  sendBtn.addEventListener('click', () => {
    if (input.value.trim()) doSend();
  });
}

const DEBUG_LOG_MAX = 50;
const debugLogLines = [];
const debugLogEl = document.getElementById('debug-log');
function appendDebugEntry(entry) {
  const line = `[${entry.ts.split('T')[1].slice(0, 12)}] ${entry.type}: ${entry.message}${entry.detail ? ' · ' + String(entry.detail).slice(0, 80) : ''}`;
  debugLogLines.push(line);
  if (debugLogLines.length > DEBUG_LOG_MAX) debugLogLines.shift();
  if (debugLogEl) {
    debugLogEl.textContent = debugLogLines.join('\n');
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }
  if (entry.type === 'status' && debugLastStatus) {
    debugLastStatus.textContent = `Last request: ${entry.message}${entry.detail ? ' · ' + entry.detail : ''}`;
    if (debugLastError) { debugLastError.classList.add('hidden'); debugLastError.textContent = '—'; }
  }
  if (entry.type === 'error') {
    if (debugLastError) {
      debugLastError.textContent = entry.detail || entry.message;
      debugLastError.classList.remove('hidden');
      debugLastError.classList.add('error');
    }
  }
}
if (window.electronAPI.onArcDebug) {
  window.electronAPI.onArcDebug((data) => {
    appendDebugEntry(data);
  });
}
if (debugToggle && debugPanelEl) {
  debugToggle.addEventListener('click', () => {
    const collapsed = debugPanelEl.classList.toggle('collapsed');
    debugToggle.textContent = collapsed ? '▼ Debug' : '▲ Debug';
  });
}
if (debugCopy) {
  debugCopy.addEventListener('click', () => {
    const text = debugLogLines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { debugCopy.textContent = 'Copied!'; setTimeout(() => { debugCopy.textContent = 'Copy logs'; }, 1500); });
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

// Simple markdown parser for bot messages
function parseMarkdown(text) {
  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Bullet lists: • or -
    .replace(/^[•\-]\s+(.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n/g, '<br>');
}

function appendMessage(who, text) {
  debugPanel('appendMessage', { who, textLen: typeof text === 'string' ? text.length : 0, messagesExists: !!messages, panelExists: !!panel, preview: typeof text === 'string' ? text.slice(0, 50) + '...' : String(text).slice(0, 50) });
  if (!messages) {
    debugPanel('appendMessage ABORT - no #messages element');
    return;
  }
  const el = document.createElement('div');
  el.className = 'message ' + who;
  
  if (who === 'bot') {
    // Parse markdown for bot messages
    let html = parseMarkdown(text);
    // Wrap consecutive <li> items in <ul>
    html = html.replace(/(<li>.*<\/li>\s*)+/gs, match => '<ul>' + match + '</ul>');
    el.innerHTML = html;
  } else {
    // Plain text for user messages
    el.textContent = text;
  }
  
  messages.appendChild(el);
  const scrollEl = messagesWrap || messages;
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  
  const count = messages.querySelectorAll('.message').length;
  debugPanel('message appended', { messageCount: count });
  
  if (who === 'bot') showPanel();
  startHideTimer();
  startChatClearTimer();
}

// Parse markdown in bot messages
async function saveHistory() {
  const history = [];
  const messageEls = messages.querySelectorAll('.message');
  messageEls.forEach(el => {
    const who = el.classList.contains('user') ? 'user' : 'bot';
    const text = who === 'user' ? el.textContent : el.innerHTML;
    history.push({ who, text, isHtml: who === 'bot', timestamp: Date.now() });
  });
  // Reverse because messages are stored in reverse order in DOM
  history.reverse();
  try {
    await window.electronAPI.saveHistory(history);
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

let lastFileSearchResults = [];

// Local command handler for file operations (no API call needed)
async function handleLocalCommand(text) {
  const lower = text.toLowerCase();
  const trimmed = text.trim();

  // "1", "2", "open 1", "open 2" after a file list - open that file
  const openNumMatch = trimmed.match(/^(?:open\s+)?(\d+)$/);
  if (openNumMatch && lastFileSearchResults.length > 0) {
    const idx = parseInt(openNumMatch[1], 10) - 1;
    if (idx >= 0 && idx < lastFileSearchResults.length) {
      const file = lastFileSearchResults[idx];
      const filePath = file.path || `${file.directory}\\${file.name}`;
      try {
        await window.electronAPI.openFile(filePath);
        appendMessage('bot', `Opened: ${file.name}`);
      } catch (e) {
        appendMessage('bot', `Couldn't open that file.`);
      }
      return true;
    }
  }

  // File search commands
  if (lower.includes('find') || lower.includes('search') || lower.includes('look for')) {
    // Extract filename from common patterns
    const patterns = [
      /find (?:my |the )?(.+)/i,
      /search for (.+)/i,
      /look for (.+)/i,
      /where(?:'s| is) (?:my |the )?(.+)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const filename = match[1].trim();
        appendMessage('bot', `Searching for "${filename}"...`);
        
        const results = await window.electronAPI.searchFile(filename);
        
        if (results && results.length > 0) {
          let response = `Found ${results.length} file(s):\n\n`;
          results.forEach((file, i) => {
            response += `${i + 1}. **${file.name}**\n   ${file.directory}\n\n`;
          });
          response += 'Which one would you like to open?';
          appendMessage('bot', response);
        } else {
          lastFileSearchResults = [];
          appendMessage('bot', `No files found matching "${filename}".`);
        }
        return true;
      }
    }
  }

  lastFileSearchResults = [];

  // Recent files (only when clearly asking for files, not "recently talk about" etc.)
  const recentFilesPattern = /\b(?:recent\s+files?|what\s+was\s+i\s+working\s+on|(?:show|get|list)\s+recent\s+files?|recent\s+documents?|files?\s+i\s+(?:was\s+)?working\s+on)\b/i;
  if (recentFilesPattern.test(lower)) {
    appendMessage('bot', 'Getting your recent files...');
    const files = await window.electronAPI.getRecentFiles(10);
    
    if (files && files.length > 0) {
      let response = `Here's what you've been working on:\n\n`;
      files.forEach((file, i) => {
        response += `${i + 1}. **${file.name}** - ${file.lastModified}\n   ${file.directory} (${file.sizeFormatted})\n\n`;
      });
      appendMessage('bot', response);
    } else {
      appendMessage('bot', 'No recent files found.');
    }
    return true;
  }
  
  return false; // Not a local command
}

async function doSend() {
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  appendMessage('user', text);
  input.value = '';

  const handledLocally = await handleLocalCommand(text);
  if (handledLocally) return;

  const history = [];
  const messageEls = messages.querySelectorAll('.message');
  messageEls.forEach(el => {
    const who = el.classList.contains('user') ? 'user' : 'bot';
    const content = el.textContent.trim();
    if (content) history.push({ role: who, content });
  });
  history.reverse();
  window.electronAPI.sendMessage(text, history);
  startCollapseTimer();
}

// Allow Enter key to send message
if (input) {
  input.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      doSend();
    }
  });
}

window.electronAPI.onReply((reply) => {
  debugPanel('onReply received', { replyType: typeof reply, replyLen: typeof reply === 'string' ? reply.length : 0 });
  appendMessage('bot', reply);
});

let voiceSettings = { voiceURI: null, rate: 1.0, pitch: 1.0, volume: 1.0 };

async function loadSettings() {
  try {
    const s = await window.electronAPI.getSettings();
    if (s) {
      if (s.anthropicKey) apiKeyInput.value = s.anthropicKey;
      if (s.slackWebhook) slackWebhookInput.value = s.slackWebhook;
        voiceSettings = Object.assign(voiceSettings, s.voice || {});
        // Set default version if not present
        anthropicVersionInput.value = s.anthropicVersion || '2023-06-01';
        anthropicModelInput.value = s.anthropicModel || 'claude-3-haiku-20240307';
    } else {
      // Set defaults for first run
      anthropicVersionInput.value = '2023-06-01';
      anthropicModelInput.value = 'claude-3-haiku-20240307';
    }
  } catch (e) {
    // Set defaults on error
    anthropicVersionInput.value = '2023-06-01';
    anthropicModelInput.value = 'claude-3-haiku-20240307';
  }
}

// populate voices
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  // select stored voice if available
  if (voiceSettings.voiceURI) {
    voiceSelect.value = voiceSettings.voiceURI;
  }
}

if ('speechSynthesis' in window) {
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

loadSettings().then(() => {
  if (voiceSettings.rate) { rateInput.value = voiceSettings.rate; rateVal.textContent = voiceSettings.rate; }
  if (voiceSettings.pitch) { pitchInput.value = voiceSettings.pitch; pitchVal.textContent = voiceSettings.pitch; }
  if (voiceSettings.volume) { volumeInput.value = voiceSettings.volume; volumeVal.textContent = voiceSettings.volume; }
  if (voiceSettings.voiceURI) voiceSelect.value = voiceSettings.voiceURI;
  loadUpcomingSchedule();
}).catch(()=>{});
if (window.electronAPI.onScheduleRefresh) {
  window.electronAPI.onScheduleRefresh(() => loadUpcomingSchedule());
}
const SCHEDULE_POLL_MS = 2 * 60 * 1000;
let schedulePollTimer = null;
function startSchedulePoll() {
  if (schedulePollTimer) return;
  schedulePollTimer = setInterval(() => loadUpcomingSchedule(), SCHEDULE_POLL_MS);
}
function stopSchedulePoll() {
  if (schedulePollTimer) { clearInterval(schedulePollTimer); schedulePollTimer = null; }
}
startSchedulePoll();

if (scheduleRefreshBtn) {
  scheduleRefreshBtn.addEventListener('click', async () => {
    scheduleRefreshBtn.classList.add('refreshing');
    await loadUpcomingSchedule();
    setTimeout(() => scheduleRefreshBtn.classList.remove('refreshing'), 400);
  });
}

// Speech-to-text using Windows Speech Recognition (works offline!)
let recognizing = false;
let useWindowsSpeech = true; // Use Windows Speech by default

// Set up listener for Windows Speech results
window.electronAPI.onSpeechResult((result) => {
  if (result.text) {
    const confidenceLabel = result.confidence ? ` (${result.confidence}% confident)` : '';
    appendMessage('user', result.text + confidenceLabel);
    window.electronAPI.sendMessage(result.text);
    
    // Alert user if confidence is low
    if (result.confidence && result.confidence < 40) {
      appendMessage('bot', '⚠️ Low confidence - speech may not be accurate. Try training Windows Speech Recognition.');
    }
  }
  recognizing = false;
  micBtn.textContent = '🎤';
});

// Handle speech timeout (no speech detected or silence)
window.electronAPI.onSpeechTimeout(() => {
  recognizing = false;
  micBtn.textContent = '🎤';
  appendMessage('bot', 'No speech detected or stopped listening.');
});

// Also keep Web Speech API as fallback
let recognition;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;
  
  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    appendMessage('user', text);
    window.electronAPI.sendMessage(text);
  };
  
  recognition.onend = () => { 
    recognizing = false; 
    micBtn.textContent = '🎤'; 
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error, event);
    recognizing = false;
    micBtn.textContent = '🎤';
    
    if (event.error === 'network') {
      appendMessage('bot', 'Switching to Windows Speech Recognition (offline mode)...');
      useWindowsSpeech = true;
    } else if (event.error === 'not-allowed' || event.error === 'permission-denied') {
      alert('Microphone permission denied. Please allow microphone access in your browser/OS settings.');
    } else if (event.error === 'no-speech') {
      appendMessage('bot', 'No speech detected. Please try again.');
    } else if (event.error === 'audio-capture') {
      alert('No microphone found. Please connect a microphone and try again.');
    } else {
      appendMessage('bot', `Speech error: ${event.error}. Please type your message instead.`);
    }
  };
}

if (micBtn) {
  micBtn.addEventListener('click', async () => {
  if (recognizing) {
    // Stop current recognition
    if (useWindowsSpeech) {
      await window.electronAPI.stopWindowsSpeech();
    } else if (recognition) {
      recognition.stop();
    }
    recognizing = false;
    micBtn.textContent = '🎤';
  } else {
    // Start recognition
    recognizing = true;
    micBtn.textContent = '⏹';
    
    if (useWindowsSpeech) {
      // Use Windows Speech Recognition (offline, no Google required)
      const result = await window.electronAPI.startWindowsSpeech();
      if (!result.success) {
        recognizing = false;
        micBtn.textContent = '🎤';
        appendMessage('bot', 'Speech recognition failed. Please type your message instead.');
      }
    } else {
      // Try Web Speech API (requires internet/Google)
      if (!recognition) {
        recognizing = false;
        micBtn.textContent = '🎤';
        alert('Speech recognition not available.');
        return;
      }
      
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        recognition.start();
      } catch (err) {
        console.error('Microphone access error:', err);
        recognizing = false;
        micBtn.textContent = '🎤';
        alert('Cannot access microphone. Please grant permission in your browser settings.');
      }
    }
  }
});
} else {
  console.log('Mic button not found (speech features disabled)');
}

// Text-to-speech DISABLED
/*
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  
  // Cancel any ongoing speech
  speechSynthesis.cancel();
  
  const u = new SpeechSynthesisUtterance(text);
  currentUtterance = u;
  
  // apply voice settings
  if (voiceSelect && voiceSelect.value) {
    const v = speechSynthesis.getVoices().find(x => (x.voiceURI || x.name) === voiceSelect.value || x.name === voiceSelect.value);
    if (v) u.voice = v;
  }
  u.rate = parseFloat(rateInput.value || 1);
  u.pitch = parseFloat(pitchInput.value || 1);
  u.volume = parseFloat(volumeInput.value || 1);
  
  u.onstart = () => {
    isSpeaking = true;
    stopBtn.classList.remove('hidden');
  };
  
  u.onend = () => {
    isSpeaking = false;
    stopBtn.classList.add('hidden');
    currentUtterance = null;
  };
  
  u.onerror = () => {
    isSpeaking = false;
    stopBtn.classList.add('hidden');
    currentUtterance = null;
  };
  
  speechSynthesis.speak(u);
}
*/

// Stop button handler - DISABLED
/*
if (stopBtn) {
  stopBtn.addEventListener('click', () => {
  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
    stopBtn.classList.add('hidden');
    currentUtterance = null;
    appendMessage('bot', '(Speech interrupted)');
  }
});

// Listen for stop TTS command
window.electronAPI.onStopTTS(() => {
  if (isSpeaking) {
    speechSynthesis.cancel();
    isSpeaking = false;
    stopBtn.classList.add('hidden');
    currentUtterance = null;
  }
});
*/

// Settings modal behavior
if (settingsBtn) {
  console.log('Attaching click listener to settings button');
  settingsBtn.addEventListener('click', async (e) => {
    console.log('=== Settings Button Clicked ===');
    e.stopPropagation();
    await window.electronAPI.openSettings();
    console.log('Settings window opened');
  });
} else {
  console.error('Settings button not found!');
}

if (closeSettings) {
  closeSettings.addEventListener('click', () => {
    console.log('Closing settings modal');
    settingsModal.classList.add('hidden');
    settingsModal.style.display = 'none';
    settingsStatus.textContent = '';
  });
} else {
  console.error('Close settings button not found!');
}

if (clearHistory) {
  clearHistory.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all chat history?')) {
      try {
        await window.electronAPI.clearHistory();
        // Clear UI
        messages.innerHTML = '';
        settingsStatus.textContent = 'History cleared!';
        settingsStatus.style.color = '#48bb78';
        setTimeout(() => {
          settingsStatus.textContent = '';
        }, 2000);
      } catch (e) {
        settingsStatus.textContent = 'Failed to clear history';
        settingsStatus.style.color = '#f56565';
      }
    }
  });
} else {
  console.error('Clear History button not found!');
}

if (saveApiKey) {
  saveApiKey.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim() || null;
    const slackWebhook = slackWebhookInput.value.trim() || null;
    try {
      const version = anthropicVersionInput.value.trim() || null;
      const model = anthropicModelInput.value.trim() || null;
      await window.electronAPI.setSettings({ anthropicKey: key, anthropicVersion: version, anthropicModel: model, slackWebhook: slackWebhook });
      settingsStatus.textContent = 'Saved.';
      setTimeout(() => settingsStatus.textContent = '', 2000);
    } catch (err) {
      settingsStatus.textContent = 'Save failed.';
    }
  });
} else {
  console.error('Save API Key button not found!');
}

if (probeApiBtn) {
  probeApiBtn.addEventListener('click', async () => {
    probeResult.classList.remove('hidden');
    probeResult.textContent = 'Probing...';
    try {
      const r = await window.electronAPI.probeAnthropic();
      probeResult.textContent = JSON.stringify(r, null, 2);
    } catch (e) {
      probeResult.textContent = 'Probe failed: ' + e.message;
    }
  });
} else {
  console.error('Probe API button not found!');
}

// Voice controls
if (rateInput) rateInput.addEventListener('input', () => { rateVal.textContent = rateInput.value; });
if (pitchInput) pitchInput.addEventListener('input', () => { pitchVal.textContent = pitchInput.value; });
if (volumeInput) volumeInput.addEventListener('input', () => { volumeVal.textContent = volumeInput.value; });

if (testVoice) {
  testVoice.addEventListener('click', () => { speak('This is a voice test from LittleBot.'); });
}

// Save voice settings when closing settings or when Test/Save pressed
closeSettings.addEventListener('click', async () => {
  settingsModal.classList.add('hidden');
  settingsStatus.textContent = '';
  await saveVoiceSettings();
});

async function saveVoiceSettings() {
  const cfg = {
    voice: {
      voiceURI: voiceSelect.value || null,
      rate: parseFloat(rateInput.value || 1),
      pitch: parseFloat(pitchInput.value || 1),
      volume: parseFloat(volumeInput.value || 1)
    }
  };
  try {
    await window.electronAPI.setSettings(cfg);
    settingsStatus.textContent = 'Saved.';
    setTimeout(() => settingsStatus.textContent = '', 1500);
  } catch (e) {
    settingsStatus.textContent = 'Save failed.';
  }
}

// Wake word functionality
if (wakeWordBtn) {
  wakeWordBtn.addEventListener('click', async () => {
  if (wakeWordActive) {
    await window.electronAPI.stopWakeWord();
    wakeWordActive = false;
    wakeWordBtn.textContent = '👂';
    wakeWordBtn.style.opacity = '0.5';
    wakeWordBtn.style.color = '#fff';
    appendMessage('bot', 'Wake word disabled. Click the 🎤 button to use voice.');
  } else {
    appendMessage('bot', 'Starting wake word detection...');
    const result = await window.electronAPI.startWakeWord();
    if (result.success) {
      wakeWordActive = true;
      wakeWordBtn.textContent = '👂';
      wakeWordBtn.style.opacity = '1';
      wakeWordBtn.style.color = '#4CAF50';
      appendMessage('bot', '✅ Wake word active! Say "Hey LittleBot" to activate voice input.');
    } else {
      appendMessage('bot', '❌ Failed to start wake word: ' + (result.error || 'Unknown error'));
    }
  }
});
} else {
  console.log('Wake word button not found (speech features disabled)');
}

// Listen for wake word detection
window.electronAPI.onWakeWordDetected(async () => {
  appendMessage('bot', '👂 Listening...');
  
  // Automatically start speech recognition
  const result = await window.electronAPI.startWindowsSpeech();
  if (!result.success) {
    appendMessage('bot', 'Speech recognition failed.');
  }
  
  // Restart wake word listening after a short delay
  setTimeout(async () => {
    if (wakeWordActive) {
      await window.electronAPI.startWakeWord();
    }
  }, 1000);
});

// Listen for wake word status updates
window.electronAPI.onWakeWordStatus((status) => {
  if (status.status === 'listening' && wakeWordActive) {
    wakeWordBtn.style.opacity = '1';
  } else if (status.status === 'stopped') {
    if (wakeWordActive) {
      wakeWordBtn.style.opacity = '0.7';
    }
  }
});

// Auto-start wake word on load if previously enabled
setTimeout(() => {
  // Can add persistence here if desired
  // For now, user must manually enable it each time
}, 500);

// Load settings on startup
loadSettings();

// ===== Dynamic Particles Based on Topics Learned =====
const particlesGroup = document.getElementById('particles');

// Starting positions around the edge (in degrees)
const startingAngles = [0, 60, 120, 180, 240, 300, 45, 135, 225, 315];

function createParticle(index) {
  const angle = startingAngles[index % startingAngles.length];
  const radius = 2.5 + (index % 3) * 0.8; // Varying sizes
  const duration = 2 + (index % 4) * 0.5; // Varying speeds
  const delay = (index % 6) * 0.3; // Stagger the animations
  
  // Convert angle to starting position on edge of clipping area
  const startRadius = 110;
  const startX = 256 + startRadius * Math.cos(angle * Math.PI / 180);
  const startY = 256 + startRadius * Math.sin(angle * Math.PI / 180);
  
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('r', radius);
  circle.setAttribute('fill', index % 2 === 0 ? 'url(#gParticle)' : '#ffffff');
  circle.setAttribute('opacity', 0.6 + (index % 3) * 0.15);
  
  // Animate from edge to center
  const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animate.setAttribute('attributeName', 'cx');
  animate.setAttribute('from', startX);
  animate.setAttribute('to', '256');
  animate.setAttribute('dur', `${duration}s`);
  animate.setAttribute('repeatCount', 'indefinite');
  animate.setAttribute('begin', `${delay}s`);
  
  const animateY = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animateY.setAttribute('attributeName', 'cy');
  animateY.setAttribute('from', startY);
  animateY.setAttribute('to', '256');
  animateY.setAttribute('dur', `${duration}s`);
  animateY.setAttribute('repeatCount', 'indefinite');
  animateY.setAttribute('begin', `${delay}s`);
  
  // Fade out as it approaches center
  const animateOpacity = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animateOpacity.setAttribute('attributeName', 'opacity');
  animateOpacity.setAttribute('from', 0.8);
  animateOpacity.setAttribute('to', '0');
  animateOpacity.setAttribute('dur', `${duration}s`);
  animateOpacity.setAttribute('repeatCount', 'indefinite');
  animateOpacity.setAttribute('begin', `${delay}s`);
  
  circle.appendChild(animate);
  circle.appendChild(animateY);
  circle.appendChild(animateOpacity);
  particlesGroup.appendChild(circle);
}

function updateParticles(topicCount) {
  // Clear existing particles (except the background circle)
  while (particlesGroup.children.length > 1) {
    particlesGroup.removeChild(particlesGroup.lastChild);
  }
  
  // Create particles based on topic count
  for (let i = 0; i < topicCount; i++) {
    createParticle(i);
  }
  
  console.log(`Orb particles updated: ${topicCount} particles for ${topicCount} topics`);
}

// Initialize particles on load
(async () => {
  const topicCount = await window.electronAPI.getTopicCount();
  // Always show at least 6 particles for visual interest
  const particlesToShow = Math.max(topicCount, 6);
  updateParticles(particlesToShow);
  console.log(`Initialized with ${particlesToShow} particles (${topicCount} topics)`);
})();

// Listen for new topics learned
window.electronAPI.onTopicLearned((data) => {
  console.log('New topic learned:', data.topic, '- Total topics:', data.totalTopics);
  // Always show at least 6 particles
  const particlesToShow = Math.max(data.totalTopics, 6);
  updateParticles(particlesToShow);
});

// Listen for event notifications
window.electronAPI.onNotification((message) => {
  if (typeof message === 'string' && message.startsWith('⏰') && /Upcoming (Task|Meeting|Event)/i.test(message)) {
    return;
  }
  console.log('[Event Notification]:', message);
  appendMessage('bot', message);
});
if (window.electronAPI.onUpcomingEvents) {
  window.electronAPI.onUpcomingEvents((events) => {
    renderUpcomingEvents(events);
    highlightScheduleUpcoming(events);
  });
}

// Listen for memory writes
window.electronAPI.onMemoryWrite((data) => {
  const { type, data: memoryData } = data;
  
  if (type === 'fact') {
    console.log('📝 MEMORY WRITE [FACT]:', memoryData.text);
    console.log('   Category:', memoryData.category);
    console.log('   ID:', memoryData.id);
    
    // Don't show in chat - only log to console for debugging
  } else if (type === 'topic') {
    console.log('📚 MEMORY WRITE [TOPIC]:', memoryData.topic);
    console.log('   Knowledge:', memoryData.knowledge);
    
    // Don't show in chat - only log to console for debugging
  }
});
