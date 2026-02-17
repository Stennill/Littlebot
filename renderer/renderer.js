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
const messagesWrap = document.getElementById('messages-wrap');
const scheduleDateEl = document.getElementById('schedule-date');
const scheduleMeetingsEl = document.getElementById('schedule-meetings');
const scheduleTasksEl = document.getElementById('schedule-tasks');
const scheduleMeetingsWrap = document.getElementById('schedule-meetings-wrap');
const scheduleTasksWrap = document.getElementById('schedule-tasks-wrap');
const scheduleProjectsSection = document.getElementById('schedule-projects-section');
const scheduleProjectsWrap = document.getElementById('schedule-projects-wrap');
const scheduleProjectsEl = document.getElementById('schedule-projects');
const scheduleCompletedSection = document.getElementById('schedule-completed-section');
const scheduleCompletedEl = document.getElementById('schedule-completed');
const scheduleEmptyEl = document.getElementById('schedule-empty');
const scheduleRefreshBtn = document.getElementById('schedule-refresh-btn');
const scheduleUpcomingWrap = document.getElementById('schedule-upcoming-wrap');
const scheduleUpcomingEl = document.getElementById('schedule-upcoming');
const conflictBannerEl = document.getElementById('conflict-banner');
const conflictBannerDetailEl = document.getElementById('conflict-banner-detail');
const conflictResolveBtn = document.getElementById('conflict-resolve-btn');
const conflictMeetingSelect = document.getElementById('conflict-meeting-select');
const isArcChatEnabled = Boolean(input && sendBtn && messages && messagesWrap);

let activeConflictState = null;
let preferredConflictMeetingId = null;
const APP_TIME_ZONE = 'America/New_York';

function formatTimeFromISO(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { timeZone: APP_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function hideMeetingConflictBanner() {
  activeConflictState = null;
  if (!conflictBannerEl) return;
  conflictBannerEl.classList.add('hidden');
}

function showMeetingConflictBanner(conflicts) {
  if (!conflictBannerEl || !conflictBannerDetailEl || !conflictResolveBtn || !conflictMeetingSelect) return;
  const meetingOptions = conflicts?.meetingOptions || [];
  if (!meetingOptions.length) {
    conflictBannerEl.classList.add('hidden');
    return;
  }
  activeConflictState = conflicts;

  conflictMeetingSelect.innerHTML = meetingOptions
    .map(m => {
      const typeRaw = String(m.type || '').toLowerCase();
      const typeLabel = m.type ? `[${typeRaw.toUpperCase()}] ` : '';
      const label = m.time ? `${typeLabel}${m.time} — ${m.title}` : `${typeLabel}${m.title}`;
      return `<option value="${escapeHtml(m.id)}">${escapeHtml(label)}</option>`;
    })
    .join('');

  if (preferredConflictMeetingId && meetingOptions.some(m => m.id === preferredConflictMeetingId)) {
    conflictMeetingSelect.value = preferredConflictMeetingId;
  }
  preferredConflictMeetingId = null;

  const selected = meetingOptions.find(m => m.id === conflictMeetingSelect.value) || meetingOptions[0];
  const suggested = selected?.suggestedStart ? formatTimeFromISO(selected.suggestedStart) : '';
  const total = conflicts?.count || 0;
  conflictBannerDetailEl.textContent = suggested
    ? `${total} overlap${total === 1 ? '' : 's'} found. Move “${selected.title}” to ${suggested}.`
    : `${total} overlap${total === 1 ? '' : 's'} found. Select a meeting and resolve.`;
  conflictResolveBtn.disabled = false;
  conflictResolveBtn.textContent = 'Resolve';
  conflictBannerEl.classList.remove('hidden');
}

async function resolveActiveMeetingConflict() {
  if (!activeConflictState?.meetingOptions?.length) return;
  if (!window.electronAPI.resolveNotionMeetingConflict) return;
  if (!conflictResolveBtn || !conflictMeetingSelect) return;
  const meetingId = conflictMeetingSelect.value;
  if (!meetingId) return;
  try {
    conflictResolveBtn.disabled = true;
    conflictResolveBtn.textContent = 'Resolving…';
    const res = await window.electronAPI.resolveNotionMeetingConflict({ meetingId });
    if (res?.error) {
      conflictResolveBtn.disabled = false;
      conflictResolveBtn.textContent = 'Resolve';
      if (conflictBannerDetailEl) {
        conflictBannerDetailEl.textContent = `Couldn’t resolve selected meeting: ${res.error}`;
      }
      return;
    }
    preferredConflictMeetingId = null;
    await loadUpcomingSchedule();
  } catch (e) {
    conflictResolveBtn.disabled = false;
    conflictResolveBtn.textContent = 'Resolve';
    if (conflictBannerDetailEl) conflictBannerDetailEl.textContent = `Couldn’t resolve: ${e?.message || 'Unknown error'}`;
  }
}

if (conflictResolveBtn) {
  conflictResolveBtn.addEventListener('click', () => resolveActiveMeetingConflict());
}
if (conflictMeetingSelect) {
  conflictMeetingSelect.addEventListener('change', () => {
    if (!activeConflictState?.meetingOptions?.length || !conflictBannerDetailEl) return;
    const selected = activeConflictState.meetingOptions.find(m => m.id === conflictMeetingSelect.value);
    if (!selected) return;
    const suggested = selected?.suggestedStart ? formatTimeFromISO(selected.suggestedStart) : '';
    const total = activeConflictState?.count || 0;
    conflictBannerDetailEl.textContent = suggested
      ? `${total} overlap${total === 1 ? '' : 's'} found. Move “${selected.title}” to ${suggested}.`
      : `${total} overlap${total === 1 ? '' : 's'} found. Select a meeting and resolve.`;
  });
}

function sendAssistantMessage(text, history = []) {
  if (!isArcChatEnabled) return;
  window.electronAPI.sendMessage(text, history);
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
    const status = (e.inProgress || e.minutesUntil === 0) ? 'Now' : `in ${e.minutesUntil}m`;
    const sectionClass = t === 'meeting' ? 'upcoming-meeting' : (t === 'task' ? 'upcoming-task' : 'upcoming-event');
    return `<li class="${sectionClass}"><span class="upcoming-status">${status}</span><span class="upcoming-label">${escapeHtml(e.title)}</span><span class="upcoming-time">${escapeHtml(e.timeStr)}</span></li>`;
  }).join('');
}

/**
 * Last highlight events received from the event notifier.
 * Each entry carries { id, startTime, endTime, ... } so we can keep
 * items highlighted for their full start-to-end duration even after
 * the schedule DOM is rebuilt by the poll.
 */
let lastHighlightEvents = [];

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

/**
 * Re-evaluate which cached highlight events are still active (upcoming or
 * in-progress based on their start/end times) and apply highlights.
 * Called after every schedule DOM rebuild so highlights survive re-renders.
 */
function reapplyActiveHighlights() {
  if (!lastHighlightEvents.length) return;
  const now = new Date();
  const stillActive = lastHighlightEvents.filter(e => {
    // Keep if in-progress (between start and end)
    const start = e.startTime ? new Date(e.startTime) : null;
    const end = e.endTime ? new Date(e.endTime) : null;
    if (start && end) return now <= end && now >= new Date(start.getTime() - 15 * 60000); // upcoming (15 min) or in-progress
    if (start) return now >= new Date(start.getTime() - 15 * 60000); // upcoming, no end known
    return false;
  });
  lastHighlightEvents = stillActive;
  highlightScheduleUpcoming(stillActive);
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
        if (scheduleCompletedSection) scheduleCompletedSection.classList.add('hidden');
        hideMeetingConflictBanner();
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
      const nowMs = Date.now();
      scheduleMeetingsEl.innerHTML = meetingsList.map(m => {
        const actionItems = m.actionItems || [];
        const actionList = actionItems.length === 0
          ? '<li class="schedule-none">None</li>'
          : actionItems.map(a => `<li>${escapeHtml(a.title)}</li>`).join('');
        // Compute "In Xm" / "Now" badge
        let badge = '';
        if (m.start && String(m.start).includes('T')) {
          const startMs = new Date(m.start).getTime();
          const endMs = (m.end && String(m.end).includes('T')) ? new Date(m.end).getTime() : startMs + 3600000;
          const minsUntil = Math.round((startMs - nowMs) / 60000);
          if (nowMs >= startMs && nowMs <= endMs) {
            badge = '<span class="meeting-badge meeting-badge-now">Now</span>';
          } else if (minsUntil > 0 && minsUntil <= 30) {
            badge = `<span class="meeting-badge">In ${minsUntil}m</span>`;
          }
        }
        // Highlight if in-progress or upcoming within 15 min
        let highlightClass = '';
        if (m.start && String(m.start).includes('T')) {
          const sMs = new Date(m.start).getTime();
          const eMs = (m.end && String(m.end).includes('T')) ? new Date(m.end).getTime() : sMs + 3600000;
          if (nowMs >= sMs && nowMs <= eMs) highlightClass = ' schedule-item-upcoming';
        }
        const meetingTimeHtml = `<span class="schedule-time-right">${m.time ? escapeHtml(m.time) : ''}${badge}</span>`;
        const meetingTitleHtml = `<span class="schedule-title">${escapeHtml(m.title)}</span>`;
        return `<div class="schedule-meeting-group${highlightClass}"${m.id ? ` data-id="${escapeHtml(m.id)}"` : ''}><div class="schedule-meeting-title">${meetingTitleHtml}${meetingTimeHtml}</div><ul class="schedule-meeting-action-items">${actionList}</ul></div>`;
      }).join('');
    }
    scheduleTasksEl.innerHTML = (data.tasks || []).map(t => {
      const bumpBtn = t.id ? `<button type="button" class="task-bump-btn" data-task-id="${escapeHtml(t.id)}" title="Bump to next open slot">↷</button>` : '';
      const timeHtml = `<span class="schedule-time">${t.time ? escapeHtml(t.time) : ''}</span>`;
      const titleHtml = `<span class="schedule-title">${escapeHtml(t.title)}</span>`;
      return `<li${t.id ? ` data-id="${escapeHtml(t.id)}"` : ''}>${timeHtml}${titleHtml}${bumpBtn}</li>`;
    }).join('') || '<li class="schedule-none">None</li>';
    // Attach bump-button click handlers
    scheduleTasksEl.querySelectorAll('.task-bump-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const taskId = btn.getAttribute('data-task-id');
        if (!taskId || !window.electronAPI.bumpTask) return;
        btn.disabled = true;
        btn.textContent = '…';
        const result = await window.electronAPI.bumpTask({ taskId });
        if (result.error) {
          btn.textContent = '✗';
          btn.title = result.error;
          setTimeout(() => { btn.textContent = '↷'; btn.disabled = false; btn.title = 'Bump to next open slot'; }, 2000);
        }
        // On success the schedule-refresh event will reload the list
      });
    });
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

    // Completed this week — natural language recap with toggle
    if (scheduleCompletedEl && scheduleCompletedSection) {
      const completed = data.completed || [];
      if (completed.length === 0) {
        scheduleCompletedSection.classList.add('hidden');
      } else {
        scheduleCompletedSection.classList.remove('hidden');
        const meetingCount = completed.filter(c => c.type === 'meeting').length;
        const taskCount = completed.filter(c => c.type !== 'meeting').length;
        const parts = [];
        if (meetingCount > 0) parts.push(`${meetingCount} meeting${meetingCount === 1 ? '' : 's'}`);
        if (taskCount > 0) parts.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`);
        const summary = `You completed ${parts.join(' and ')} this week.`;
        const itemsHtml = completed.map(c => `<li>${escapeHtml(c.title)}</li>`).join('');
        scheduleCompletedEl.innerHTML =
          `<p class="completed-summary">${summary}</p>` +
          `<ul class="completed-list hidden">${itemsHtml}</ul>`;
        const toggleBtn = document.getElementById('completed-toggle-btn');
        const listEl = scheduleCompletedEl.querySelector('.completed-list');
        if (toggleBtn && listEl) {
          const newBtn = toggleBtn.cloneNode(true);
          toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);
          newBtn.addEventListener('click', () => {
            const open = !listEl.classList.contains('hidden');
            listEl.classList.toggle('hidden');
            newBtn.textContent = open ? 'Show' : 'Hide';
            newBtn.setAttribute('aria-expanded', String(!open));
          });
        }
      }
    }

    if (data.conflicts && Array.isArray(data.conflicts.meetingOptions) && data.conflicts.meetingOptions.length > 0) {
      showMeetingConflictBanner(data.conflicts);
    } else {
      hideMeetingConflictBanner();
    }

    // Re-apply any active highlights after the DOM rebuild so items stay
    // highlighted for their full start-to-end duration
    reapplyActiveHighlights();
  } catch (e) {
    hideMeetingConflictBanner();
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
  if (!isArcChatEnabled || !input || !messages) return;
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
  sendAssistantMessage(text, history);
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

if (isArcChatEnabled) {
  window.electronAPI.onReply((reply) => {
    debugPanel('onReply received', { replyType: typeof reply, replyLen: typeof reply === 'string' ? reply.length : 0 });
    appendMessage('bot', reply);
  });
}

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

// Re-evaluate highlights every 30 seconds so items stay lit for their
// full start-to-end duration without waiting for the 5-min notifier cycle.
const HIGHLIGHT_REEVAL_MS = 30 * 1000;
setInterval(() => reapplyActiveHighlights(), HIGHLIGHT_REEVAL_MS);

if (scheduleRefreshBtn) {
  scheduleRefreshBtn.addEventListener('click', async () => {
    scheduleRefreshBtn.classList.add('refreshing');
    await loadUpcomingSchedule();
    setTimeout(() => scheduleRefreshBtn.classList.remove('refreshing'), 400);
  });
}

// Add to Notion: Meeting / Task / Project
function setDefaultMeetingDate() {
  const dateEl = document.getElementById('add-meeting-date');
  if (!dateEl) return;
  const d = new Date();
  if (d.getHours() >= 17) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  dateEl.value = d.toISOString().slice(0, 10);
}
function toggleAddForm(formId, show) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.classList.toggle('hidden', !show);
  const err = form.querySelector('.schedule-add-error');
  if (err) err.remove();
}
function showAddError(formId, message) {
  const form = document.getElementById(formId);
  if (!form) return;
  let err = form.querySelector('.schedule-add-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'schedule-add-error';
    form.appendChild(err);
  }
  err.textContent = message;
}

document.getElementById('add-meeting-btn')?.addEventListener('click', () => {
  setDefaultMeetingDate();
  toggleAddForm('add-meeting-form', true);
  document.getElementById('add-meeting-title')?.focus();
});
document.getElementById('add-meeting-cancel')?.addEventListener('click', () => {
  toggleAddForm('add-meeting-form', false);
});
document.getElementById('add-meeting-submit')?.addEventListener('click', async () => {
  const title = document.getElementById('add-meeting-title')?.value?.trim();
  const date = document.getElementById('add-meeting-date')?.value;
  const time = document.getElementById('add-meeting-time')?.value?.trim();
  const durationMinutes = parseInt(document.getElementById('add-meeting-duration')?.value, 10) || 60;
  if (!window.electronAPI.createNotionMeeting) return;
  const result = await window.electronAPI.createNotionMeeting({ title: title || 'New Meeting', date, time, durationMinutes });
  if (result.error) {
    showAddError('add-meeting-form', result.error);
    return;
  }
  if (result.conflict && result.conflict.type === 'meeting_overlap' && result.conflict.newMeetingId) {
    preferredConflictMeetingId = result.conflict.newMeetingId;
  }
  toggleAddForm('add-meeting-form', false);
  document.getElementById('add-meeting-title').value = '';
  document.getElementById('add-meeting-time').value = '';
  const durEl = document.getElementById('add-meeting-duration');
  if (durEl) durEl.value = '60';
  await loadUpcomingSchedule();
});

document.getElementById('add-task-btn')?.addEventListener('click', () => {
  toggleAddForm('add-task-form', true);
  document.getElementById('add-task-title')?.focus();
});
document.getElementById('add-task-cancel')?.addEventListener('click', () => {
  toggleAddForm('add-task-form', false);
});
document.getElementById('add-task-submit')?.addEventListener('click', async () => {
  const title = document.getElementById('add-task-title')?.value?.trim();
  if (!window.electronAPI.createNotionTask) return;
  const result = await window.electronAPI.createNotionTask({ title: title || 'New Task' });
  if (result.error) {
    showAddError('add-task-form', result.error);
    return;
  }
  toggleAddForm('add-task-form', false);
  document.getElementById('add-task-title').value = '';
  await loadUpcomingSchedule();
});

document.getElementById('add-project-btn')?.addEventListener('click', () => {
  toggleAddForm('add-project-form', true);
  document.getElementById('add-project-title')?.focus();
});
document.getElementById('add-project-cancel')?.addEventListener('click', () => {
  toggleAddForm('add-project-form', false);
});
document.getElementById('add-project-submit')?.addEventListener('click', async () => {
  const title = document.getElementById('add-project-title')?.value?.trim();
  if (!window.electronAPI.createNotionProject) return;
  const result = await window.electronAPI.createNotionProject({ title: title || 'New Project' });
  if (result.error) {
    showAddError('add-project-form', result.error);
    return;
  }
  toggleAddForm('add-project-form', false);
  document.getElementById('add-project-title').value = '';
  await loadUpcomingSchedule();
});

// Speech-to-text using Windows Speech Recognition (works offline!)
let recognizing = false;
let useWindowsSpeech = true; // Use Windows Speech by default

// Set up listener for Windows Speech results
window.electronAPI.onSpeechResult((result) => {
  if (result.text) {
    const confidenceLabel = result.confidence ? ` (${result.confidence}% confident)` : '';
    appendMessage('user', result.text + confidenceLabel);
    sendAssistantMessage(result.text);
    
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
    sendAssistantMessage(text);
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
        if (messages) messages.innerHTML = '';
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
    // Cache the full event data (with start/end times) so highlights
    // persist across schedule DOM rebuilds for the item's full duration
    if (events && events.length > 0) {
      lastHighlightEvents = events;
    }
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
