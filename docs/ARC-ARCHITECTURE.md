# Arc Architecture Redesign

## The Problem

Previously, Arc's personality and task capabilities were mixed together:
- **system-prompt.txt**: Contains Arc's personality BUT ALSO detailed task instructions
- **main.js**: Hardcodes all tool definitions mixed with Arc's core logic
- Result: Every time we add/change a task, we risk changing Arc's personality

## The Solution

Clean separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                         ARC (Core)                          │
│                                                             │
│  • Personality (arc-persona.txt)                           │
│  • Identity & behavior rules                               │
│  • How Arc talks and thinks                                │
│  • NEVER CHANGES                                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ calls tasks through
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                    Task Registry                            │
│                  (arc-tasks.js)                             │
│                                                             │
│  • All capabilities as modular tools                       │
│  • File management tasks                                   │
│  • Notion integration tasks                                │
│  • Memory management tasks                                 │
│  • System tasks                                             │
│  • Can be added/modified/removed WITHOUT touching Arc      │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ executes through
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                       Services                              │
│                                                             │
│  • notion-service.js                                       │
│  • memory.js                                                │
│  • scheduler-service.js                                    │
│  • event-notifier.js                                       │
│  • etc.                                                     │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

### **arc-persona.txt** (NEW)
- Pure personality definition
- Arc's identity, tone, and behavior
- Communication guidelines
- High-level principles
- NO specific task instructions

### **arc-tasks.js** (NEW)
- Task registry system
- All tools/capabilities defined here
- Each task has:
  - Schema (what it does, what inputs it needs)
  - Handler (how it executes)
- Modular and testable

### **main.js** (MODIFIED)
- Loads Arc persona
- Initializes task registry
- Passes tool definitions to Claude API
- Routes tool calls to task registry
- NO hardcoded tool definitions anymore

### **system-prompt.txt** (DEPRECATED/REPLACED)
- Old file that mixed everything together
- Will be replaced by arc-persona.txt
- Can keep for reference during transition

## How It Works

### 1. Initialization (main.js)
```javascript
const arcTasks = require('./arc-tasks');

// Initialize task registry with services
arcTasks.initialize({
  notionService: notionService,
  memoryStore: memoryStore,
  versionInfo: versionInfo
});

// Load Arc's personality
const arcPersona = await loadArcPersona();

// Get all available tools
const tools = arcTasks.getAllTools();
```

### 2. User Interaction
```
User: "Find my resume file"
    ↓
Arc (using persona): Understands request with wit
    ↓
Arc: Calls search_file task from registry
    ↓
Task Registry: Executes file search handler
    ↓
Arc: Responds with personality and results
```

### 3. Adding New Tasks
```javascript
// In arc-tasks.js - add to registry
this.registerTask('new_task_name', {
  description: "What this task does",
  input_schema: {
    type: "object",
    properties: {
      param1: { type: "string", description: "..." }
    },
    required: ["param1"]
  }
}, async (input) => {
  // Handler logic here
  return result;
});
```

**Arc's personality NEVER needs to change!**

## Benefits

### ✅ Separation of Concerns
- Arc's personality is sacred and protected
- Tasks are modular plugins
- Services remain unchanged

### ✅ Easier Maintenance
- Want to add a new capability? Add it to task registry
- Want to remove a feature? Remove from task registry
- Want to change Arc's tone? Edit arc-persona.txt
- No risk of breaking one while changing the other

### ✅ Better Testing
- Test Arc's personality separately
- Test individual tasks in isolation
- Test service integrations independently

### ✅ Scalability
- Easy to add new task categories
- Easy to create task plugins
- Easy to version control changes

### ✅ Clarity
- Arc persona file is pure personality
- Task registry is pure functionality
- No confusion about what belongs where

## Migration Plan

### Phase 1: Create New Architecture ✅
- [x] Create arc-tasks.js with task registry
- [x] Create arc-persona.txt with clean personality
- [x] Document the architecture

### Phase 2: Update main.js
- [ ] Modify main.js to use arc-tasks registry
- [ ] Replace hardcoded tools with registry.getAllTools()
- [ ] Route tool execution through registry.executeTask()
- [ ] Load arc-persona.txt instead of system-prompt.txt

### Phase 3: Testing
- [ ] Test all file operations
- [ ] Test all Notion operations  
- [ ] Test memory operations
- [ ] Verify Arc's personality is consistent
- [ ] Verify no functionality is lost

### Phase 4: Cleanup
- [ ] Move system-prompt.txt to archive
- [ ] Update documentation
- [ ] Commit changes

## Example: Before vs After

### BEFORE (Mixed Together)
**system-prompt.txt:**
```
You are Arc, witty AI assistant...

File Management Tools:
- search_file: Search for files...
  [detailed instructions]
- open_file: Opens files...
  [detailed instructions]

Notion Integration:
- notion_query_database...
  [100 lines of detailed rules]
```

**main.js:**
```javascript
const tools = [
  {
    name: "search_file",
    description: "...",
    input_schema: {...}
  },
  {
    name: "open_file",
    description: "...",
    input_schema: {...}
  },
  // ... 20 more tools hardcoded here
];
```

### AFTER (Clean Separation)
**arc-persona.txt:**
```
You are Arc, witty AI assistant.

[Pure personality definition]
[Behavior guidelines]
[Communication style]

You have access to tools through a task registry.
Use them naturally to help the user.
```

**arc-tasks.js:**
```javascript
registerTask('search_file', schema, handler);
registerTask('open_file', schema, handler);
registerTask('notion_query_database', schema, handler);
// Clean, modular, testable
```

**main.js:**
```javascript
const tools = arcTasks.getAllTools(); // That's it!
```

## Future Possibilities

With this architecture, we can easily:

1. **Create task plugins**: Community-contributed tasks
2. **Version tasks independently**: Update file tasks without touching Notion tasks
3. **A/B test tasks**: Try different implementations
4. **Dynamic task loading**: Enable/disable tasks at runtime
5. **Task permissions**: User controls what Arc can access
6. **Task analytics**: Track which tasks are used most
7. **Task documentation**: Auto-generate docs from schemas

## Conclusion

This redesign makes Arc more maintainable, more extensible, and protects Arc's core personality from being accidentally modified when adding new features.

**Arc stays Arc. Tasks are just what Arc can do.**
