const memoryStore = require('./memory');
const neuroplasticity = require('./neuroplasticity');

/**
 * Intelligence Layer for LittleBot
 * LittleBot's "brain" that decides what to say and how to respond
 * Claude is just used to convert decisions into natural language
 */

class IntelligenceCore {
  constructor() {
    this.lastTopic = null;
    this.conversationState = {
      messageCount: 0,
      topics: [],
      userMood: 'neutral',
      needsFollowUp: false
    };
  }

  /**
   * Main decision-making function
   * Analyzes input and decides what to say
   */
  async analyzeAndDecide(userMessage) {
    this.conversationState.messageCount++;
    
    const analysis = {
      intent: this.detectIntent(userMessage),
      topic: this.detectTopic(userMessage),
      entities: this.extractEntities(userMessage),
      sentiment: this.analyzeSentiment(userMessage),
      needsMemory: this.shouldCheckMemory(userMessage),
      needsAction: this.detectActionRequest(userMessage)
    };

    // Gather relevant information
    const context = await this.gatherContext(userMessage, analysis);
    
    // Make decisions about the response
    const responseStrategy = await this.decideResponse(analysis, context);
    
    // Build the instruction prompt for Claude
    const claudePrompt = this.buildClaudePrompt(userMessage, responseStrategy, context);
    
    return {
      analysis,
      context,
      strategy: responseStrategy,
      claudePrompt
    };
  }

  /**
   * Detect user's intent
   */
  detectIntent(message) {
    const lower = message.toLowerCase();
    
    const intents = {
      question: /^(what|who|where|when|why|how|can you|could you|will you|do you)\b/i,
      command: /^(remember|save|store|sync|pull|update|clear|delete|show me|tell me)\b/i,
      statement: /^(i |my |i'm |i've |i am)\b/i,
      greeting: /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i,
      gratitude: /\b(thank|thanks|appreciate|grateful)\b/i,
      correction: /^(no|not |actually|that's wrong|incorrect)\b/i,
      casual: /^(yeah|yep|ok|okay|cool|nice|sure)\b/i
    };

    for (const [intent, pattern] of Object.entries(intents)) {
      if (pattern.test(lower)) {
        return intent;
      }
    }

    return message.endsWith('?') ? 'question' : 'statement';
  }

  /**
   * Detect topic from message
   */
  detectTopic(message) {
    const lower = message.toLowerCase();
    
    const topics = {
      coding: /\b(code|coding|program|javascript|python|java|c\+\+|function|variable|bug|debug|api|library|framework)\b/i,
      memory: /\b(remember|memory|recall|forget|saved|stored)\b/i,
      personal: /\b(i am|i'm|my name|i live|i work|i like|i prefer|about me)\b/i,
      help: /\b(help|assist|how to|tutorial|guide|explain|show me)\b/i,
      time: /\b(time|date|when|schedule|calendar|clock)\b/i,
      system: /\b(version|update|settings|config|status|info about you)\b/i,
      learning: /\b(learn|teach|understand|study|know)\b/i,
      task: /\b(do|create|make|build|generate|write|draft)\b/i
    };

    for (const [topic, pattern] of Object.entries(topics)) {
      if (pattern.test(lower)) {
        this.lastTopic = topic;
        return topic;
      }
    }

    return 'general';
  }

  /**
   * Extract entities (names, dates, numbers, etc.)
   */
  extractEntities(message) {
    const entities = {
      names: [],
      numbers: [],
      dates: [],
      locations: []
    };

    // Extract capitalized words (potential names)
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let match;
    while ((match = namePattern.exec(message)) !== null) {
      if (!this.isCommonWord(match[1])) {
        entities.names.push(match[1]);
      }
    }

    // Extract numbers
    const numberPattern = /\b\d+(?:\.\d+)?\b/g;
    entities.numbers = message.match(numberPattern) || [];

    // Extract dates (simple patterns)
    const datePattern = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
    entities.dates = message.match(datePattern) || [];

    return entities;
  }

  isCommonWord(word) {
    const common = ['I', 'The', 'What', 'When', 'Where', 'Why', 'How', 'Can', 'Could', 'Would', 'Should'];
    return common.includes(word);
  }

  /**
   * Analyze sentiment/mood
   */
  analyzeSentiment(message) {
    const lower = message.toLowerCase();
    
    const positive = /\b(great|good|awesome|excellent|love|happy|wonderful|perfect|thanks|amazing)\b/i;
    const negative = /\b(bad|wrong|terrible|hate|angry|frustrated|annoying|problem|issue|broken)\b/i;
    const urgent = /\b(urgent|asap|quickly|immediately|now|emergency)\b/i;
    
    if (urgent.test(lower)) return 'urgent';
    if (positive.test(lower)) return 'positive';
    if (negative.test(lower)) return 'negative';
    
    return 'neutral';
  }

  /**
   * Decide if we should check memory
   */
  shouldCheckMemory(message) {
    const lower = message.toLowerCase();
    return /\b(remember|recall|told you|mentioned|said|know about|what do you know)\b/i.test(lower) ||
           /\b(my|i'm|i am|i have|i like|i prefer)\b/i.test(lower);
  }

  /**
   * Detect if user wants an action
   */
  detectActionRequest(message) {
    const lower = message.toLowerCase();
    
    const actions = {
      memorySave: /\b(remember|save|store|keep track|don't forget|write down|note that)\b/i,
      memoryRecall: /\b(what do you (remember|know)|recall|tell me what you know)\b/i,
      memoryClear: /\b(forget|clear|delete|remove) (everything|all|memory)\b/i,
      memorySync: /\b(sync|push|upload).*(memory|github)\b/i,
      memoryPull: /\b(pull|download|update).*(memory|github)\b/i,
      explain: /\b(explain|describe|tell me about|what is)\b/i,
      create: /\b(create|make|build|generate|write)\b/i,
      help: /\b(help|assist|guide|show|how to)\b/i
    };

    for (const [action, pattern] of Object.entries(actions)) {
      if (pattern.test(lower)) {
        return action;
      }
    }

    return null;
  }

  /**
   * Gather relevant context for response
   */
  async gatherContext(userMessage, analysis) {
    const context = {
      memories: null,
      preferences: null,
      expertise: null,
      predictions: null,
      corrections: null
    };

    // Get relevant memories if needed
    if (analysis.needsMemory || analysis.topic === 'personal' || analysis.intent === 'question') {
      context.memories = await memoryStore.getRelevantMemories(userMessage);
      console.log(`Retrieved ${context.memories.facts.length} relevant facts from memory`);
    }

    // Get communication preferences
    context.preferences = neuroplasticity.getCommunicationProfile();

    // Get topic expertise
    if (analysis.topic && analysis.topic !== 'general') {
      context.expertise = neuroplasticity.getTopicExpertise(analysis.topic);
    }

    // Get likely next topics
    if (this.lastTopic) {
      context.predictions = neuroplasticity.getLikelyNextTopics(this.lastTopic);
    }

    // Get frequent corrections to avoid
    context.corrections = neuroplasticity.getFrequentCorrections();

    return context;
  }

  /**
   * Decide the response strategy
   */
  async decideResponse(analysis, context) {
    const strategy = {
      approach: 'conversational',
      includeMemories: false,
      includeFacts: [],
      tone: 'neutral',
      length: 'medium',
      shouldLearn: false,
      learnWhat: null,
      confidence: 0.8
    };

    // Adjust based on intent
    switch (analysis.intent) {
      case 'question':
        strategy.approach = 'informative';
        strategy.includeMemories = true;
        break;
      case 'command':
        strategy.approach = 'action-response';
        break;
      case 'statement':
        strategy.approach = 'acknowledging';
        strategy.shouldLearn = true;
        strategy.learnWhat = 'fact-from-statement';
        break;
      case 'greeting':
        strategy.approach = 'friendly';
        strategy.length = 'short';
        strategy.includeMemories = true; // ALWAYS use memory for greetings to remember name, etc.
        break;
      case 'correction':
        strategy.approach = 'apologetic';
        strategy.shouldLearn = true;
        strategy.learnWhat = 'correction';
        break;
    }

    // Adjust tone based on sentiment
    strategy.tone = analysis.sentiment === 'urgent' ? 'efficient' :
                    analysis.sentiment === 'positive' ? 'friendly' :
                    analysis.sentiment === 'negative' ? 'helpful' : 'professional';

    // Adjust length based on learned preferences
    if (context.preferences) {
      strategy.length = context.preferences.verbosity;
    }

    // Include relevant memories
    if (context.memories && context.memories.facts && context.memories.facts.length > 0) {
      strategy.includeMemories = true;
      strategy.includeFacts = context.memories.facts.map(f => f.text);
      console.log(`Including ${strategy.includeFacts.length} relevant facts in response`);
    } else {
      console.log('No relevant facts found for this query');
    }

    // Adjust confidence based on topic expertise
    if (context.expertise && context.expertise.confidence) {
      strategy.confidence = context.expertise.confidence;
    }

    return strategy;
  }

  /**
   * Build the instruction prompt for Claude
   * This is where LittleBot tells Claude exactly what to say
   */
  buildClaudePrompt(userMessage, strategy, context) {
    let prompt = `The user said: "${userMessage}"\n\n`;
    
    // CRITICAL: Include memory context FIRST so Claude knows who the user is
    if (context.memories && context.memories.facts && context.memories.facts.length > 0) {
      prompt += `IMPORTANT CONTEXT - What you know about the user:\n`;
      context.memories.facts.forEach(fact => {
        prompt += `- ${fact.text}\n`;
      });
      prompt += `\n`;
    }
    
    prompt += `YOUR TASK: Generate a response with these EXACT specifications:\n\n`;

    // Approach
    prompt += `1. APPROACH: ${strategy.approach}\n`;
    switch (strategy.approach) {
      case 'informative':
        prompt += `   - Provide clear, accurate information\n`;
        prompt += `   - Be direct and helpful\n`;
        break;
      case 'action-response':
        prompt += `   - Confirm the action\n`;
        prompt += `   - Brief acknowledgment\n`;
        break;
      case 'acknowledging':
        prompt += `   - Acknowledge what they shared\n`;
        prompt += `   - Show you're listening\n`;
        break;
      case 'friendly':
        prompt += `   - Warm and welcoming\n`;
        prompt += `   - Keep it brief\n`;
        break;
      case 'apologetic':
        prompt += `   - Acknowledge the correction\n`;
        prompt += `   - Thank them for the feedback\n`;
        break;
    }

    // Tone
    prompt += `\n2. TONE: ${strategy.tone}\n`;
    
    // Length
    prompt += `\n3. LENGTH: ${strategy.length}\n`;
    if (strategy.length === 'short' || strategy.length === 'concise') {
      prompt += `   - Maximum 2-3 sentences\n`;
    } else if (strategy.length === 'detailed' || strategy.length === 'verbose') {
      prompt += `   - Provide thorough explanation (4-6 sentences)\n`;
    } else {
      prompt += `   - Medium length (2-4 sentences)\n`;
    }

    // Include specific information
    if (strategy.includeMemories && strategy.includeFacts.length > 0) {
      prompt += `\n4. INCLUDE THESE FACTS (naturally woven in):\n`;
      strategy.includeFacts.slice(0, 3).forEach((fact, i) => {
        prompt += `   - ${fact}\n`;
      });
    }

    // Confidence level
    if (strategy.confidence < 0.6) {
      prompt += `\n5. CONFIDENCE: Low - express appropriate uncertainty\n`;
      prompt += `   - Use phrases like "I think", "possibly", "it seems"\n`;
    } else if (strategy.confidence > 0.8) {
      prompt += `\n5. CONFIDENCE: High - be direct and assured\n`;
    }

    // Avoid corrections
    if (context.corrections && context.corrections.length > 0) {
      prompt += `\n6. AVOID THESE PATTERNS (previously corrected):\n`;
      context.corrections.forEach(corr => {
        prompt += `   - Don't: ${corr.type}\n`;
      });
    }

    // Communication preferences
    if (context.preferences) {
      prompt += `\n7. STYLE PREFERENCES:\n`;
      prompt += `   - Technical depth: ${context.preferences.technicalDepth}\n`;
      prompt += `   - Formality: ${context.preferences.formality}\n`;
      if (context.preferences.emojiUsage === 'none') {
        prompt += `   - NO emojis\n`;
      } else if (context.preferences.emojiUsage === 'frequent') {
        prompt += `   - Include relevant emojis\n`;
      }
    }

    prompt += `\n---\n`;
    prompt += `Generate ONLY the response text. No meta-commentary. No explanations. Just the natural response following these exact instructions.`;

    return prompt;
  }

  /**
   * Detect if something should be learned from the exchange
   */
  shouldLearnFromExchange(userMessage, assistantResponse) {
    const lower = userMessage.toLowerCase();
    
    // Learn from personal statements
    if (/\b(i am|i'm|my name|i live|i work|i like|i prefer)\b/i.test(lower)) {
      return {
        shouldLearn: true,
        type: 'personal-fact',
        content: userMessage
      };
    }

    // Learn from corrections
    if (/\b(no|not|actually|wrong|incorrect)\b/i.test(lower)) {
      return {
        shouldLearn: true,
        type: 'correction',
        content: userMessage
      };
    }

    // Learn from explicit requests
    if (/\b(remember|save|store|keep track|don't forget)\b/i.test(lower)) {
      return {
        shouldLearn: true,
        type: 'explicit-save',
        content: userMessage
      };
    }

    return {
      shouldLearn: false,
      type: null,
      content: null
    };
  }

  /**
   * Update conversation state
   */
  updateState(topic, outcome) {
    if (topic) {
      this.conversationState.topics.push(topic);
      // Keep last 10 topics
      if (this.conversationState.topics.length > 10) {
        this.conversationState.topics.shift();
      }
    }
  }
}

module.exports = new IntelligenceCore();
