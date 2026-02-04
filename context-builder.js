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
    
    // TIER 1: Core identity (always load)
    const coreFacts = this.getCoreIdentity(memory.facts || []);
    
    // TIER 2: Relevant facts (based on keywords)
    const relevantFacts = (memory.facts || [])
      .filter(fact => !coreFacts.includes(fact)) // Exclude core facts
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
    
    // TIER 3: Recent conversation context (last 3)
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
    
    // Relevant facts
    if (relevantFacts.length > 0) {
      context += '\n🎯 RELEVANT FACTS:\n';
      relevantFacts.forEach(fact => {
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
      relevantFacts: relevantFacts.length,
      relevantTopics: topTopics.length,
      recentContext: recentContext.length,
      totalFacts: (memory.facts || []).length,
      totalTopics: Object.keys(memory.topics || {}).length,
      keywords: keywords.slice(0, 5).join(', ')
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
