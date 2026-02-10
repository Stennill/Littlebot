# Arc's Memory Tools - Quick Reference

## 🔧 Available Memory Tools

### `memory_search`
**Purpose:** Search memory for specific information  
**When to use:** Need to find specific facts, topics, or context  
**Example:**
```
memory_search({ query: "user's timezone preferences" })
```

### `memory_get_category`
**Purpose:** Get all facts from a specific category  
**Categories:** user, identity, general, preference  
**When to use:** Need comprehensive view of one category  
**Example:**
```
memory_get_category({ category: "user" })
```

### `memory_get_recent`
**Purpose:** Get most recent memories  
**When to use:** User asks about recent conversations or "what did we just discuss?"  
**Example:**
```
memory_get_recent({ limit: 10 })
```

### `memory_get_all_topics`
**Purpose:** Get complete list of all topics  
**When to use:** User asks "what topics do you know about?" or need topic overview  
**Example:**
```
memory_get_all_topics({})
```

## 🎯 When to Use Each Tool

### Use `memory_search` when:
- ✅ User asks specific question about stored information
- ✅ Need to verify a fact
- ✅ Auto-injected context might not be enough
- ✅ User says "search your memory" or "do you remember..."

### Use `memory_get_category` when:
- ✅ User asks "what do you know about me?"
- ✅ Need all identity facts
- ✅ Need all preference facts
- ✅ Want focused category view

### Use `memory_get_recent` when:
- ✅ User asks "what did we just talk about?"
- ✅ User says "earlier you mentioned..."
- ✅ Need recent conversation context
- ✅ User asks "what have you learned recently?"

### Use `memory_get_all_topics` when:
- ✅ User asks "what topics have we discussed?"
- ✅ Need overview of knowledge domains
- ✅ User asks "what do you know about?"

## 📋 Auto-Loaded Context (No Tools Needed!)

These are **automatically loaded** based on your message:

### ALWAYS in System Prompt:
- 🔑 User's name
- 🔑 Key identity facts
- 🔑 Critical preferences

### Auto-loaded on SCHEDULE queries:
- 📅 Notion preferences
- 🌍 Timezone information
- ⏰ Calendar preferences

### Auto-loaded on IDENTITY queries:
- 👤 All identity facts
- 👤 All user category facts

### Auto-loaded on PREFERENCE queries:
- ⭐ All preference facts
- ⭐ "Likes", "prefers", "favorite" facts

### Auto-loaded on RECENT queries:
- 🕐 Last 10 facts
- 🕐 Recent topics
- 🕐 Conversation summaries

### Auto-loaded on KEYWORD match:
- 🎯 Top 10 facts matching your message keywords
- 🎯 Topics related to keywords

## 💡 Best Practices

### DO:
✅ Check auto-loaded context FIRST before using tools  
✅ Use `memory_search` for specific, targeted queries  
✅ Use `memory_get_recent` when user asks about "earlier"  
✅ Let intent detection do the work for common queries  

### DON'T:
❌ Call tools for basic identity (already in system prompt)  
❌ Search memory when auto-injection already loaded relevant facts  
❌ Use multiple tools when one search would suffice  

## 🔍 How to Know What's Auto-Loaded

Check the console output after each message:
```
📊 Context Stats: {
  coreFacts: 8,           // In system prompt
  priorityFacts: 12,      // Intent-based auto-load
  relevantFacts: 10,      // Keyword-matched auto-load
  recentFacts: 5,         // Recent context
  relevantTopics: 3,      // Related topics
  detectedIntents: ['schedule', 'recent']  // What intents were detected
}
```

## 📝 Example Scenarios

### Scenario 1: Simple Question
```
User: "What's my name?"
Your Action: Answer from system prompt (no tools)
```

### Scenario 2: Schedule Question
```
User: "What's on my calendar?"
Your Action: Auto-loaded Notion facts, use notion_query_database tool
```

### Scenario 3: Specific Memory Query
```
User: "What do you remember about sweet tea?"
Your Action: Use memory_search({ query: "sweet tea" })
```

### Scenario 4: Recent Context
```
User: "What did we just discuss?"
Your Action: Auto-loaded recent facts (check context stats first)
           If not enough, use memory_get_recent({ limit: 10 })
```

### Scenario 5: Identity Overview
```
User: "What do you know about me?"
Your Action: Auto-loaded all identity facts
           Optionally use memory_get_category({ category: "user" })
           for comprehensive view
```

## 🎓 Remember

You have **THREE tiers** of memory access:

1. **TIER 1 (Instant):** System prompt - core identity, always available
2. **TIER 2 (Auto):** Smart injection - intent-based, keyword-matched
3. **TIER 3 (Tools):** On-demand retrieval - comprehensive search

**Start at TIER 1, move to TIER 2, use TIER 3 only when needed!**
