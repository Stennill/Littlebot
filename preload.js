const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (msg) => ipcRenderer.send('assistant-message', msg),
  onReply: (cb) => ipcRenderer.on('assistant-reply', (event, data) => cb(data))
  ,getApiKey: () => ipcRenderer.invoke('get-api-key')
  ,setApiKey: (k) => ipcRenderer.invoke('set-api-key', k)
  ,getSettings: () => ipcRenderer.invoke('get-settings')
  ,setSettings: (s) => ipcRenderer.invoke('set-settings', s)
  ,probeAnthropic: () => ipcRenderer.invoke('probe-anthropic')
  ,getHistory: () => ipcRenderer.invoke('get-history')
  ,saveHistory: (h) => ipcRenderer.invoke('save-history', h)
  ,clearHistory: () => ipcRenderer.invoke('clear-history')
  ,getAllSessions: () => ipcRenderer.invoke('get-all-sessions')
  ,saveSession: (name) => ipcRenderer.invoke('save-session', name)
  ,loadSession: (id) => ipcRenderer.invoke('load-session', id)
  ,openHistory: () => ipcRenderer.invoke('open-history')
  ,openExternal: (url) => ipcRenderer.invoke('open-external', url)
  ,openSettings: () => ipcRenderer.invoke('open-settings')
  ,startWindowsSpeech: () => ipcRenderer.invoke('start-windows-speech')
  ,stopWindowsSpeech: () => ipcRenderer.invoke('stop-windows-speech')
  ,onSpeechResult: (cb) => ipcRenderer.on('speech-result', (event, data) => cb(data))
  ,onSpeechTimeout: (cb) => ipcRenderer.on('speech-timeout', () => cb())
  ,startWakeWord: () => ipcRenderer.invoke('start-wake-word')
  ,stopWakeWord: () => ipcRenderer.invoke('stop-wake-word')
  ,onWakeWordDetected: (cb) => ipcRenderer.on('wake-word-detected', () => cb())
  ,onWakeWordStatus: (cb) => ipcRenderer.on('wake-word-status', (event, data) => cb(data))
  ,stopSpeechOutput: () => ipcRenderer.invoke('stop-speech-output')
  ,onStopTTS: (cb) => ipcRenderer.on('stop-tts', () => cb())
  // System prompt management
  ,getSystemPrompt: () => ipcRenderer.invoke('get-system-prompt')
  ,setSystemPrompt: (prompt) => ipcRenderer.invoke('set-system-prompt', prompt)
  ,getPromptLockStatus: () => ipcRenderer.invoke('get-prompt-lock-status')
  ,setPromptLockStatus: (locked) => ipcRenderer.invoke('set-prompt-lock-status', locked)
  // Memory GitHub sync
  ,memorySyncGitHub: () => ipcRenderer.invoke('memory-sync-github')
  ,memoryPullGitHub: () => ipcRenderer.invoke('memory-pull-github')
});
