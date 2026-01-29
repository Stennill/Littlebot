const sessionsList = document.getElementById('sessionsList');
const closeBtn = document.getElementById('closeBtn');
const sessionViewer = document.getElementById('sessionViewer');
const viewerTitle = document.getElementById('viewerTitle');
const viewerMessages = document.getElementById('viewerMessages');
const closeViewerBtn = document.getElementById('closeViewerBtn');

async function loadSessions() {
  try {
    console.log('Loading sessions...');
    const sessions = await window.electronAPI.getAllSessions();
    console.log('Sessions loaded:', sessions);
    
    if (!sessions || sessions.length === 0) {
      sessionsList.innerHTML = '<div class="empty-state">No saved conversations yet<br><br>Conversations are automatically saved after 5 minutes of inactivity or when you close LittleBot</div>';
      return;
    }
    
    sessionsList.innerHTML = '';
    
    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'session-item';
      
      const name = document.createElement('div');
      name.className = 'session-name';
      name.textContent = session.name;
      
      const date = document.createElement('div');
      date.className = 'session-date';
      date.textContent = new Date(session.timestamp).toLocaleString();
      
      const preview = document.createElement('div');
      preview.className = 'session-preview';
      if (session.messages && session.messages.length > 0) {
        const firstMsg = session.messages[0];
        preview.textContent = firstMsg.who === 'user' ? `You: ${firstMsg.text}` : `Bot: ${firstMsg.text.replace(/<[^>]*>/g, '')}`;
      }
      
      item.appendChild(name);
      item.appendChild(date);
      item.appendChild(preview);
      
      item.addEventListener('click', () => viewSession(session));
      
      sessionsList.appendChild(item);
    });
  } catch (e) {
    console.error('Failed to load sessions:', e);
    sessionsList.innerHTML = '<div class="empty-state">Error loading conversations</div>';
  }
}

function viewSession(session) {
  viewerTitle.textContent = session.name;
  viewerMessages.innerHTML = '';
  
  if (session.messages && session.messages.length > 0) {
    session.messages.forEach(msg => {
      const msgEl = document.createElement('div');
      msgEl.className = 'msg ' + msg.who;
      
      if (msg.isHtml && msg.who === 'bot') {
        msgEl.innerHTML = msg.text;
      } else {
        msgEl.textContent = msg.text;
      }
      
      viewerMessages.appendChild(msgEl);
    });
  }
  
  sessionViewer.classList.add('active');
}

closeViewerBtn.addEventListener('click', () => {
  sessionViewer.classList.remove('active');
});

sessionViewer.addEventListener('click', (e) => {
  if (e.target === sessionViewer) {
    sessionViewer.classList.remove('active');
  }
});

closeBtn.addEventListener('click', () => {
  window.close();
});

// Load sessions on startup
loadSessions();
