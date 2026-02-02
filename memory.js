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
      conversations: [] // Recent conversation summaries
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
        conversations: []
      };
      this.loaded = true;
      console.log('Starting with empty memory store');
    }
  }

  async save() {
    try {
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
    
    // Keep only last 100 facts to prevent unbounded growth
    if (this.memories.facts.length > 100) {
      this.memories.facts = this.memories.facts.slice(-100);
    }
    
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
    
    // Keep only last 20 entries per topic
    if (this.memories.topics[topicKey].entries.length > 20) {
      this.memories.topics[topicKey].entries = this.memories.topics[topicKey].entries.slice(-20);
    }
    
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
    
    // Keep only last 10 conversation summaries
    if (this.memories.conversations.length > 10) {
      this.memories.conversations = this.memories.conversations.slice(-10);
    }
    
    await this.save();
  }

  /**
   * Get relevant memories for a given query
   */
  async getRelevantMemories(query) {
    if (!this.loaded) await this.load();
    
    const queryLower = query.toLowerCase();
    const relevantMemories = {
      facts: [],
      topics: [],
      recentContext: []
    };
    
    // Find relevant facts (simple keyword matching)
    relevantMemories.facts = this.memories.facts.filter(fact => {
      const factLower = fact.text.toLowerCase();
      // Check if any word in query matches any word in fact
      const queryWords = queryLower.split(/\s+/);
      return queryWords.some(word => word.length > 3 && factLower.includes(word));
    }).slice(-5); // Last 5 relevant facts
    
    // Find relevant topics
    for (const [topicKey, topicData] of Object.entries(this.memories.topics)) {
      if (queryLower.includes(topicKey) || topicKey.includes(queryLower.split(/\s+/)[0])) {
        relevantMemories.topics.push({
          topic: topicData.name,
          entries: topicData.entries.slice(-3) // Last 3 entries
        });
      }
    }
    
    // Include recent conversation context
    relevantMemories.recentContext = this.memories.conversations.slice(-2);
    
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
      conversations: []
    };
    await this.save();
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
}

module.exports = new MemoryStore();
