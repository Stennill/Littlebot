# Memory Retrieval System - Hybrid Approach

## Overview
This system implements a **hybrid memory retrieval approach** that combines three powerful strategies:
1. **Core identity in system prompt** (immediate access)
2. **Smart context injection** (automatic relevance-based loading)
3. **Tool-based memory queries** (active retrieval on demand)

This gives Arc full visibility and control over memory while optimizing token usage.

## Architecture

### Three-Tier Memory Access

```
┌─────────────────────────────────────────────────────────────┐
│                    TIER 1: SYSTEM PROMPT                     │
│                      (Always Available)                      │
├─────────────────────────────────────────────────────────────┤
│  🔑 Core Identity Facts (Top 10)                            │
│  • User's name, key preferences                             │
│  • Critical identity information                            │
│  • Immediately accessible without tools                     │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│              TIER 2: SMART CONTEXT INJECTION                 │
│                 (Auto-injected per message)                  │
├─────────────────────────────────────────────────────────────┤
│  ⭐ Intent-Based Priority Facts                             │
│  • If query about identity → load all identity facts        │
│  • If query about schedule → load Notion/timezone facts     │
│  • If query about preferences → load preference facts       │
│                                                              │
│  🎯 Keyword-Matched Relevant Facts                          │
│  • Extract keywords from user message                       │
│  • Calculate relevance scores                               │
│  • Load top 10 most relevant facts                          │
│                                                              │
│  💡 Related Topics                                          │
│  • Find topics matching keywords                            │
│  • Load latest 3 entries per topic                          │
│                                                              │
│  🕐 Recent Memories (if "recent" intent detected)           │
│  • Last 10 facts when user asks about recent events         │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│               TIER 3: TOOL-BASED RETRIEVAL                   │
│                    (On-Demand Queries)                       │
├─────────────────────────────────────────────────────────────┤
│  🔧 memory_search(query)                                     │
│  • Search for specific information                          │
│  • Returns facts, topics, and context matching query        │
│                                                              │
│  🔧 memory_get_category(category)                           │
│  • Get all facts from specific category                     │
│  • Categories: user, identity, general, preference, etc.    │
│                                                              │
│  🔧 memory_get_recent(limit)                                │
│  • Get last N facts and topics                              │
│  • Default limit: 10                                        │
│                                                              │
│  🔧 memory_get_all_topics()                                 │
│  • Get complete list of all topics                          │
│  • Includes all knowledge entries per topic                 │
└─────────────────────────────────────────────────────────────┘
```

## Smart Context Injection

### Intent Detection
The system automatically detects query intent and loads relevant context:

```javascript
// Intent patterns recognized:
{
  schedule: /schedule|calendar|event|meeting|notion|task/i,
  identity: /my name|who am i|what.*know about me/i,
  recall: /remember|recall|what did|earlier|before/i,
  file: /file|document|folder|pdf|find|search/i,
  recent: /recent|latest|just|today|yesterday/i,
  preference: /prefer|like|favorite|usual|normally/i
}
```

### Example: Schedule Query
```
User: "What's on my calendar today?"

System detects: schedule intent
Auto-loads:
  ✅ Notion database preferences
  ✅ Timezone information
  ✅ Event format preferences
  ✅ All schedule-related facts

Arc receives this context WITHOUT needing to use tools!
```

### Example: Identity Query
```
User: "What do you know about me?"

System detects: identity intent
Auto-loads:
  ✅ ALL identity category facts
  ✅ ALL user category facts
  ✅ Up to 20 identity-related facts

Arc can immediately answer with comprehensive information!
```

## Tool-Based Memory Queries

### 1. `memory_search(query)`
Search memory for specific information.

**Example:**
```javascript
// Arc can call this tool during conversation
memory_search({ query: "schedule preferences" })

// Returns:
{
  facts: [
    { text: "User prefers morning meetings", category: "preference" },
    { text: "Timezone: EST (America/New_York)", category: "user" }
  ],
  topics: [
    {
      topic: "Scheduling",
      knowledge: ["Prefers 30-min slots", "No meetings after 5pm"]
    }
  ],
  totalFacts: 2,
  totalTopics: 1
}
```

### 2. `memory_get_category(category)`
Get all facts from a specific category.

**Example:**
```javascript
memory_get_category({ category: "user" })

// Returns:
{
  category: "user",
  facts: [
    { text: "Name is Stephen", timestamp: 1738790123456 },
    { text: "Prefers to be called Sir", timestamp: 1738790234567 }
  ],
  count: 2
}
```

### 3. `memory_get_recent(limit)`
Get most recent memories.

**Example:**
```javascript
memory_get_recent({ limit: 5 })

// Returns:
{
  recentFacts: [
    { text: "Working on memory system", category: "general", timestamp: ... },
    { text: "Discussed tool architecture", category: "general", timestamp: ... }
  ],
  recentTopics: [
    {
      topic: "Programming",
      latestKnowledge: ["Prefers TypeScript", "Uses VS Code"]
    }
  ],
  factCount: 5,
  topicCount: 1
}
```

### 4. `memory_get_all_topics()`
Get complete list of all topics.

**Example:**
```javascript
memory_get_all_topics({})

// Returns:
{
  topics: [
    {
      topic: "Programming",
      knowledge: ["Prefers TypeScript", "Uses VS Code", "Builds desktop apps"],
      entryCount: 3
    },
    {
      topic: "Food Preferences",
      knowledge: ["Loves sweet tea", "Prefers black tea"],
      entryCount: 2
    }
  ],
  totalTopics: 2
}
```

## When Arc Should Use Each Tier

### Use TIER 1 (System Prompt) When:
- ✅ Answering basic identity questions ("What's my name?")
- ✅ Accessing core preferences immediately
- ✅ No explicit memory query needed

### Use TIER 2 (Auto-Injection) When:
- ✅ User asks about schedule/calendar → Schedule facts auto-loaded
- ✅ User asks "what do you know about me?" → All identity auto-loaded
- ✅ User mentions recent events → Recent facts auto-loaded
- ✅ Keyword matching provides good context

### Use TIER 3 (Tools) When:
- ✅ Need to search for specific, rare information
- ✅ Auto-injection didn't load relevant context
- ✅ User explicitly asks "search your memory"
- ✅ Need comprehensive topic knowledge
- ✅ Need all facts from specific category

## Example Conversation Flow

### Scenario 1: Simple Identity Question
```
User: "What's my name?"

Arc's Process:
  1. Check TIER 1 (System Prompt) ✅
  2. Find "Name is Stephen" in core identity
  3. Answer immediately
  4. NO TOOLS NEEDED

Arc: "Your name is Stephen, Sir."
```

### Scenario 2: Schedule-Related Question
```
User: "Can you check my calendar?"

Arc's Process:
  1. TIER 2 detects "schedule" intent
  2. Auto-loads Notion preferences, timezone
  3. Calls notion_query_database tool
  4. Responds with calendar info

Arc: "You have 3 meetings today. First one is at 9am..."
```

### Scenario 3: Deep Memory Search
```
User: "What do you remember about my sweet tea preferences?"

Arc's Process:
  1. TIER 2 loads keyword-matched facts
  2. Realizes need more specific info
  3. Calls memory_search({ query: "sweet tea" })
  4. Gets all sweet tea related facts and topics
  5. Provides comprehensive answer

Arc: "You prefer sweet tea over unsweetened, specifically black tea with sugar..."
```

## Benefits of Hybrid Approach

### 🚀 Performance
- Core facts in system prompt = instant access (no tool calls)
- Smart injection = relevant context without searching
- Tools = deep retrieval only when needed

### 💰 Token Efficiency
- Only loads relevant memories per message
- Filters out irrelevant facts
- Reduces token usage by 60-80% vs loading all memory

### 🎯 Accuracy
- Intent detection ensures right context
- Keyword matching finds relevant facts
- Tools provide comprehensive retrieval when needed

### 🔍 Transparency
- Console shows exactly what context was loaded
- Stats show filtering effectiveness
- Clear tier-based architecture

## Console Output Example

```
📊 Context Stats: {
  coreFacts: 8,           // TIER 1: System prompt
  priorityFacts: 12,      // TIER 2: Intent-based
  relevantFacts: 10,      // TIER 2: Keyword-matched
  recentFacts: 5,         // TIER 2: Recent context
  relevantTopics: 3,      // TIER 2: Related topics
  recentContext: 2,       // TIER 2: Conversation summaries
  totalFacts: 156,        // Total in memory
  totalTopics: 23,        // Total topics
  keywords: 'schedule, today, calendar, meeting',
  detectedIntents: ['schedule', 'recent']
}
```

## Implementation Files

- **arc-tasks.js** - Memory tool definitions
- **context-builder.js** - Smart context injection
- **memory.js** - Memory storage and retrieval
- **main.js** - System prompt assembly

## Testing the System

### Test 1: Core Identity
```
User: "What's my name?"
Expected: Immediate answer from TIER 1 (no tools)
```

### Test 2: Intent Detection
```
User: "What's on my schedule today?"
Expected: Schedule intent detected, Notion facts auto-loaded
```

### Test 3: Tool Usage
```
User: "Search your memory for everything about sweet tea"
Expected: memory_search tool called, comprehensive results
```

### Test 4: Recent Recall
```
User: "What did we just discuss?"
Expected: Recent intent detected, last 10 facts auto-loaded
```

## Future Enhancements

- **Learning from queries**: Track which memories are accessed most
- **Predictive loading**: Pre-load likely needed context
- **Memory importance scoring**: Weight facts by usage frequency
- **Cross-reference detection**: Link related facts automatically
- **Memory consolidation**: Merge similar facts to reduce duplication
