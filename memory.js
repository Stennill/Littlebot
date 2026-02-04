const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

/**
 * Memory System for LittleBot
 * Stores and retrieves contextual information from conversations
 */

class MemoryStore {
  constructor() {
    this.memoryPath = path.join(app.getPath('userData'), 'littlebot-memory.json');
    this.memories = {
      facts: [], // User facts: name, preferences, etc.
      topics: {}, // Topic-based knowledge
      conversations: [], // Recent conversation summaries
      lastUpdated: null // Timestamp of last memory update
    };
    this.loaded = false;
  }

  async load() {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      this.memories = JSON.parse(data);
      this.loaded = true;
      console.log('Memory loaded:', this.memories.facts.length, 'facts,', Object.keys(this.memories.topics).length, 'topics');
    } catch (err) {
      // File doesn't exist yet or is corrupted
      this.memories = {
        facts: [],
        topics: {},
        conversations: [],
        lastUpdated: null
      };
      this.loaded = true;
      console.log('Starting with empty memory store');
    }
  }

  async save() {
    try {
      // Update the lastUpdated timestamp whenever we save
      this.memories.lastUpdated = Date.now();
      await fs.writeFile(this.memoryPath, JSON.stringify(this.memories, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save memory:', err);
    }
  }

  /**
   * Add a fact about the user or their preferences
   */
  async addFact(fact, category = 'general') {
    if (!this.loaded) await this.load();
    
    const entry = {
      text: fact,
      category,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    };
    
    this.memories.facts.push(entry);
    
    // No limit - allow unlimited fact accumulation
    
    await this.save();
    return entry;
  }

  /**
   * Add knowledge about a topic
   */
  async addTopicKnowledge(topic, knowledge) {
    if (!this.loaded) await this.load();
    
    const topicKey = topic.toLowerCase().trim();
    
    if (!this.memories.topics[topicKey]) {
      this.memories.topics[topicKey] = {
        name: topic,
        entries: [],
        lastAccessed: Date.now()
      };
    }
    
    this.memories.topics[topicKey].entries.push({
      text: knowledge,
      timestamp: Date.now()
    });
    
    this.memories.topics[topicKey].lastAccessed = Date.now();
    
    // No limit - allow unlimited topic entries
    
    await this.save();
  }

  /**
   * Store a conversation summary for context
   */
  async addConversationSummary(summary) {
    if (!this.loaded) await this.load();
    
    this.memories.conversations.push({
      summary,
      timestamp: Date.now()
    });
    
    // No limit - keep all conversation summaries for full context
    
    await this.save();
  }

  /**
   * Get relevant memories for a given query
   * Uses intelligent filtering to find what's actually useful
   */
  async getRelevantMemories(query) {
    if (!this.loaded) await this.load();
    
    const queryLower = query.toLowerCase();
    const relevantMemories = {
      facts: [],
      topics: [],
      recentContext: []
    };
    
    // Always include critical identity facts
    const criticalFacts = this.memories.facts.filter(fact => {
      const factLower = fact.text.toLowerCase();
      const category = (fact.category || '').toLowerCase();
      return factLower.includes('name is') || 
             factLower.includes('i am') || 
             factLower.includes('i\'m') ||
             category === 'identity' ||
             category === 'user';
    });
    
    // Get keyword-matched facts
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const matchedFacts = this.memories.facts.filter(fact => {
      const factLower = fact.text.toLowerCase();
      return queryWords.some(word => factLower.includes(word));
    });
    
    // Get very recent facts (last 10 - recent context is valuable)
    const recentFacts = this.memories.facts.slice(-10);
    
    // Merge all facts, removing duplicates
    const allFacts = new Map();
    [...criticalFacts, ...matchedFacts, ...recentFacts].forEach(fact => {
      allFacts.set(fact.id, fact);
    });
    
    relevantMemories.facts = Array.from(allFacts.values());
    
    // Find relevant topics by keyword
    for (const [topicKey, topicData] of Object.entries(this.memories.topics)) {
      if (queryWords.some(word => topicKey.includes(word) || word.includes(topicKey))) {
        relevantMemories.topics.push({
          topic: topicData.name,
          entries: topicData.entries.slice(-5) // Recent entries only
        });
      }
    }
    
    // Recent conversation context (last 3)
    relevantMemories.recentContext = this.memories.conversations.slice(-3);
    
    return relevantMemories;
  }

  /**
   * Get all facts for display
   */
  async getAllFacts() {
    if (!this.loaded) await this.load();
    return this.memories.facts;
  }

  /**
   * Get all topics for display
   */
  async getAllTopics() {
    if (!this.loaded) await this.load();
    return this.memories.topics;
  }

  /**
   * Clear all memories
   */
  async clearAll() {
    this.memories = {
      facts: [],
      topics: {},
      conversations: [],
      lastUpdated: null
    };
    await this.save();
  }

  /**
   * Get the last updated timestamp
   */
  getLastUpdated() {
    if (!this.loaded) return null;
    return this.memories.lastUpdated;
  }

  /**
   * Get formatted last updated time
   */
  getLastUpdatedFormatted() {
    const timestamp = this.getLastUpdated();
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    
    return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString();
  }

  /**
   * Format memories as context string for Claude
   */
  formatMemoriesForContext(memories) {
    let context = '';
    
    if (memories.facts && memories.facts.length > 0) {
      context += '\n\nThings I know about you:\n';
      memories.facts.forEach(fact => {
        context += `- ${fact.text}\n`;
      });
    }
    
    if (memories.topics && memories.topics.length > 0) {
      context += '\n\nRelevant topic knowledge:\n';
      memories.topics.forEach(topic => {
        context += `\n${topic.topic}:\n`;
        topic.entries.forEach(entry => {
          context += `  - ${entry.text}\n`;
        });
      });
    }
    
    if (memories.recentContext && memories.recentContext.length > 0) {
      context += '\n\nRecent conversation context:\n';
      memories.recentContext.forEach(conv => {
        context += `- ${conv.summary}\n`;
      });
    }
    
    return context;
  }

  /**
   * Sync memory with GitHub repository
   */
  async syncWithGitHub(repoPath) {
    if (!this.loaded) await this.load();
    
    try {
      const { spawn } = require('child_process');
      const githubMemoryPath = path.join(repoPath, 'littlebot-memory.json');
      
      // Copy current memory to repo
      await fs.copyFile(this.memoryPath, githubMemoryPath);
      
      return { success: true, path: githubMemoryPath };
    } catch (err) {
      console.error('Failed to sync memory with GitHub:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Pull memory from GitHub repository
   */
  async pullFromGitHub(repoPath) {
    try {
      const githubMemoryPath = path.join(repoPath, 'littlebot-memory.json');
      
      // Check if file exists in repo
      try {
        await fs.access(githubMemoryPath);
      } catch {
        return { success: false, error: 'Memory file not found in repository' };
      }
      
      // Backup current memory
      const backupPath = this.memoryPath + '.backup';
      try {
        await fs.copyFile(this.memoryPath, backupPath);
      } catch {
        // No existing memory to backup
      }
      
      // Copy from repo to user data
      await fs.copyFile(githubMemoryPath, this.memoryPath);
      
      // Reload
      await this.load();
      
      return { success: true, message: 'Memory pulled from GitHub' };
    } catch (err) {
      console.error('Failed to pull memory from GitHub:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get the repository path
   */
  getRepoPath() {
    // Assuming the app is running from the repo directory
    return path.join(__dirname);
  }

  /**
   * Check if GitHub memory is newer than local memory
   */
  async isGitHubMemoryNewer() {
    try {
      const repoPath = this.getRepoPath();
      const githubMemoryPath = path.join(repoPath, 'littlebot-memory.json');
      
      // Check if both files exist
      try {
        await fs.access(this.memoryPath);
        await fs.access(githubMemoryPath);
      } catch {
        // One or both files don't exist
        return false;
      }
      
      // Get file stats
      const localStats = await fs.stat(this.memoryPath);
      const githubStats = await fs.stat(githubMemoryPath);
      
      // Compare modification times
      return githubStats.mtime > localStats.mtime;
    } catch (err) {
      console.error('Error checking memory file timestamps:', err);
      return false;
    }
  }

  /**
   * Auto-update from GitHub if repository version is newer
   */
  async autoUpdateIfNewer() {
    try {
      const isNewer = await this.isGitHubMemoryNewer();
      
      if (isNewer) {
        console.log('GitHub memory is newer - auto-updating...');
        const result = await this.pullFromGitHub(this.getRepoPath());
        
        if (result.success) {
          console.log('✓ Memory auto-updated from GitHub');
          return { updated: true, message: 'Memory updated from GitHub' };
        } else {
          console.error('Failed to auto-update memory:', result.error);
          return { updated: false, error: result.error };
        }
      }
      
      return { updated: false, message: 'Local memory is current' };
    } catch (err) {
      console.error('Error in auto-update check:', err);
      return { updated: false, error: err.message };
    }
  }
}

module.exports = new MemoryStore();
