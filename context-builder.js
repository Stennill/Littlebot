/**
 * Context Builder for Arc
 * Intelligently assembles minimal context for Claude API calls
 * Reduces token usage by loading only relevant memories
 */

class ContextBuilder {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
  }

  /**
   * Detect query intent for smart context injection
   */
  detectIntent(userMessage) {
    const msgLower = userMessage.toLowerCase();
    
    const intents = {
      schedule: /\b(schedule|calendar|event|meeting|appointment|notion|task|todo)\b/i.test(msgLower),
      identity: /\b(my name|who am i|what.*know about me|remember.*me)\b/i.test(msgLower),
      recall: /\b(remember|recall|what did|earlier|before|previous|last time)\b/i.test(msgLower),
      file: /\b(file|document|folder|pdf|docx|find|search|open)\b/i.test(msgLower),
      recent: /\b(recent|latest|just|today|yesterday|this week)\b/i.test(msgLower),
      preference: /\b(prefer|like|favorite|usual|normally|typically)\b/i.test(msgLower)
    };
    
    return intents;
  }

  /**
   * Extract keywords from user input
   */
  extractKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'my', 'your', 'their', 'our',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
      'what', 'when', 'where', 'why', 'how', 'this', 'that', 'these', 'those'
    ]);

    // Extract words, lowercase, remove stop words
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Return unique keywords
    return [...new Set(words)];
  }

  /**
   * Calculate relevance score for a memory item
   */
  calculateRelevance(item, keywords) {
    const itemText = (item.text || item.summary || '').toLowerCase();
    const itemCategory = (item.category || '').toLowerCase();
    
    let score = 0;
    
    // Exact keyword matches
    keywords.forEach(keyword => {
      const count = (itemText.match(new RegExp(keyword, 'g')) || []).length;
      score += count * 10;
    });
    
    // Category match bonus
    if (keywords.some(kw => itemCategory.includes(kw))) {
      score += 15;
    }
    
    // Recency bonus (newer items get slight boost)
    if (item.timestamp) {
      const daysSince = (Date.now() - item.timestamp) / (1000 * 60 * 60 * 24);
      if (daysSince < 1) score += 5;
      else if (daysSince < 7) score += 3;
      else if (daysSince < 30) score += 1;
    }
    
    return score;
  }

  /**
   * Get core identity facts (Tier 1 - always load)
   */
  getCoreIdentity(allFacts) {
    const coreKeywords = [
      'name', 'stephen', 'tennill', 'sir',
      'littlebot', 'arc', 'building',
      'developer', 'generalist', 'day job',
      'sweet tea', 'iced tea', 'black tea'
    ];

    return allFacts.filter(fact => {
      const text = fact.text.toLowerCase();
      return coreKeywords.some(kw => text.includes(kw)) ||
             fact.category === 'identity' ||
             fact.category === 'user';
    }).slice(0, 15); // Max 15 core facts
  }

  /**
   * Build optimized context for Claude API
   */
  async buildContext(userMessage, conversationHistory = []) {
    await this.memoryStore.load();
    const memory = this.memoryStore.memories;
    
    // Extract keywords from user message
    const keywords = this.extractKeywords(userMessage);
    
    // Detect intent for smart context injection
    const intent = this.detectIntent(userMessage);
    
    // TIER 1: Core identity (always load)
    const coreFacts = this.getCoreIdentity(memory.facts || []);
    
    // TIER 2: Intent-based facts (prioritize based on query type)
    let priorityFacts = [];
    
    if (intent.identity) {
      // Load all user/identity facts
      priorityFacts = (memory.facts || [])
        .filter(f => ['user', 'identity'].includes(f.category))
        .slice(0, 20);
    } else if (intent.preference) {
      // Load preference-related facts
      priorityFacts = (memory.facts || [])
        .filter(f => {
          const text = f.text.toLowerCase();
          return text.includes('prefer') || text.includes('like') || 
                 text.includes('favorite') || f.category === 'preference';
        })
        .slice(0, 15);
    } else if (intent.schedule) {
      // Load Notion/schedule-related facts
      priorityFacts = (memory.facts || [])
        .filter(f => {
          const text = f.text.toLowerCase();
          return text.includes('notion') || text.includes('schedule') || 
                 text.includes('timezone') || text.includes('calendar');
        })
        .slice(0, 15);
    }
    
    // TIER 3: Relevant facts (based on keywords)
    const relevantFacts = (memory.facts || [])
      .filter(fact => !coreFacts.includes(fact) && !priorityFacts.includes(fact))
      .map(fact => ({
        fact,
        score: this.calculateRelevance(fact, keywords)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10) // Top 10 relevant facts
      .map(item => item.fact);
    
    // TIER 2: Relevant topics (based on keywords)
    const relevantTopics = [];
    for (const [topicKey, topicData] of Object.entries(memory.topics || {})) {
      const score = this.calculateRelevance(
        { text: topicKey + ' ' + topicData.name },
        keywords
      );
      
      if (score > 0) {
        relevantTopics.push({
          topic: topicData.name,
          entries: topicData.entries.slice(-3), // Last 3 entries only
          score
        });
      }
    }
    
    relevantTopics.sort((a, b) => b.score - a.score);
    const topTopics = relevantTopics.slice(0, 5); // Top 5 relevant topics
    
    // TIER 4: Recent facts if "recent" intent detected
    let recentFacts = [];
    if (intent.recent || intent.recall) {
      recentFacts = (memory.facts || [])
        .filter(f => !coreFacts.includes(f) && !priorityFacts.includes(f) && !relevantFacts.includes(f))
        .slice(-10) // Last 10 facts
        .reverse();
    }
    
    // TIER 5: Recent conversation context (last 3)
    const recentContext = (memory.conversations || []).slice(-3);
    
    // Format context string
    let context = '';
    
    // Core identity
    if (coreFacts.length > 0) {
      context += '\n📌 CORE IDENTITY:\n';
      coreFacts.forEach(fact => {
        context += `• ${fact.text}\n`;
      });
    }
    
    // Priority facts (intent-based)
    if (priorityFacts.length > 0) {
      context += '\n⭐ PRIORITY CONTEXT:\n';
      priorityFacts.forEach(fact => {
        context += `• ${fact.text}\n`;
      });
    }
    
    // Relevant facts
    if (relevantFacts.length > 0) {
      context += '\n🎯 RELEVANT FACTS:\n';
      relevantFacts.forEach(fact => {
        context += `• ${fact.text}\n`;
      });
    }
    
    // Recent facts
    if (recentFacts.length > 0) {
      context += '\n🕐 RECENT MEMORIES:\n';
      recentFacts.forEach(fact => {
        context += `• ${fact.text}\n`;
      });
    }
    
    // Relevant topics
    if (topTopics.length > 0) {
      context += '\n💡 RELEVANT TOPICS:\n';
      topTopics.forEach(({ topic, entries }) => {
        context += `\n${topic}:\n`;
        entries.forEach(entry => {
          context += `  - ${entry.text}\n`;
        });
      });
    }
    
    // Recent context
    if (recentContext.length > 0) {
      context += '\n⏱️ RECENT CONTEXT:\n';
      recentContext.forEach(conv => {
        context += `• ${conv.summary}\n`;
      });
    }
    
    // Add statistics for transparency
    const stats = {
      coreFacts: coreFacts.length,
      priorityFacts: priorityFacts.length,
      relevantFacts: relevantFacts.length,
      recentFacts: recentFacts.length,
      relevantTopics: topTopics.length,
      recentContext: recentContext.length,
      totalFacts: (memory.facts || []).length,
      totalTopics: Object.keys(memory.topics || {}).length,
      keywords: keywords.slice(0, 5).join(', '),
      detectedIntents: Object.entries(intent).filter(([k, v]) => v).map(([k]) => k)
    };
    
    console.log('📊 Context Stats:', stats);
    
    return {
      context,
      stats,
      keywords
    };
  }

  /**
   * Format context for Claude system message
   */
  formatSystemContext(contextData) {
    return contextData.context;
  }
}

module.exports = ContextBuilder;
