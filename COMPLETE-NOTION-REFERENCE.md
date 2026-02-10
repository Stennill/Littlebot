# COMPLETE NOTION FUNCTIONALITY REFERENCE

## What Your LittleBot Does with Notion - Extreme Detail

This document describes **EXACTLY** what your LittleBot does with Notion and how to replicate it in a Cloudflare Worker.

---

## Core Architecture

### Data Flow

```
User Command
    ↓
Command Parser (Pattern Matching)
    ↓
Business Logic Layer
    ↓
Notion API Client
    ↓
Notion Database
```

---

## Complete Function Breakdown

### 1. MOVE MEETINGS (Bulk Date Change)

**What it does:**
- Finds ALL meetings on a specific date
- Changes their date to a new date
- Returns count of moved meetings

**Step-by-step process:**

```javascript
// STEP 1: Get database schema
// Why: Need to find which property is the date field (could be named anything)
const schema = await notion.getDatabaseSchema();
// Returns: { properties: [{ name: "Date", type: "date" }, ...] }

// STEP 2: Find date property
const dateProp = schema.properties.find(p => p.type === 'date');
// Result: { name: "Due Date", type: "date", id: "abc123" }

// STEP 3: Query for ALL unprocessed meetings
const filter = {
  and: [
    {
      property: 'Type',           // Must have "Type" property
      select: {
        equals: 'Meeting'         // Must be a Meeting
      }
    },
    {
      property: 'Status',         // Must have "Status" property
      status: {
        does_not_equal: 'Processed'  // Not already processed
      }
    },
    {
      property: 'Status',
      status: {
        does_not_equal: 'Resolved'   // Not already resolved
      }
    }
  ]
};

const allMeetings = await notion.queryDatabase(filter);
// Returns: Array of ALL meeting pages (handles pagination automatically)

// STEP 4: Filter by source date (client-side)
// Why client-side: Notion API's date filters are unreliable
const meetingsToMove = allMeetings.filter(meeting => {
  const meetingDate = meeting.properties[dateProp.name];
  
  // Extract date portion from ISO datetime
  // Input: { start: "2026-02-06T14:00:00.000-05:00", end: null }
  // Output: "2026-02-06"
  const normalizedDate = (meetingDate && meetingDate.start) 
    ? meetingDate.start.split('T')[0] 
    : null;
  
  return normalizedDate === fromDate;  // e.g., "2026-02-06"
});

// STEP 5: Update each meeting
for (const meeting of meetingsToMove) {
  await notion.updatePage(meeting.id, {
    [dateProp.name]: {        // Use dynamic property name
      type: 'date',
      date: {
        start: toDate         // e.g., "2026-02-07"
      }
    }
  });
}

// STEP 6: Return result
return {
  success: true,
  count: 3,
  message: "✅ Moved 3 meeting(s) from Thursday, Feb 6 to Friday, Feb 7",
  items: ["Team Standup", "Client Call", "Design Review"]
};
```

**API Calls Made:**
1. `GET /databases/{id}` - Get schema
2. `POST /databases/{id}/query` - Query meetings (with pagination)
3. `PATCH /pages/{id}` - Update each meeting (N calls for N meetings)

**Performance:**
- 10 meetings: ~2-3 seconds
- 50 meetings: ~10-15 seconds
- Bottleneck: Notion API (3 req/sec limit)

---

### 2. MOVE SINGLE ITEM (By Name Search)

**What it does:**
- Searches for item by partial name match
- Changes its date
- Handles ambiguous results

**Step-by-step process:**

```javascript
// STEP 1: Get schema
const schema = await notion.getDatabaseSchema();
const titleProp = schema.properties.find(p => p.type === 'title');
const dateProp = schema.properties.find(p => p.type === 'date');

// STEP 2: Search by title (case-insensitive partial match)
const filter = {
  and: [
    {
      property: titleProp.name,  // Usually "Name" or "Title"
      title: {
        contains: "dentist"      // Partial match - case insensitive
      }
    },
    {
      property: 'Status',
      status: {
        does_not_equal: 'Processed'
      }
    },
    {
      property: 'Status',
      status: {
        does_not_equal: 'Resolved'
      }
    }
  ]
};

const results = await notion.queryDatabase(filter);

// STEP 3: Handle multiple matches
if (results.length === 0) {
  return { error: 'Could not find "dentist"' };
}

if (results.length > 1) {
  // Found: "Dentist Appointment", "Dentist Follow-up"
  return { error: 'Multiple matches found. Be more specific.' };
}

// STEP 4: Update the single match
const item = results[0];
await notion.updatePage(item.id, {
  [dateProp.name]: {
    type: 'date',
    date: {
      start: "2026-02-14"
    }
  }
});

// STEP 5: Return success
return {
  success: true,
  message: "✅ Moved \"Dentist Appointment\" to Friday, February 14, 2026",
  item: "Dentist Appointment",
  newDate: "2026-02-14"
};
```

**API Calls Made:**
1. `GET /databases/{id}` - Get schema
2. `POST /databases/{id}/query` - Search by title
3. `PATCH /pages/{id}` - Update the page

**Performance:**
- Typical: 500ms - 1 second

---

### 3. MOVE TO SPECIFIC TIME (Time-based Scheduling)

**What it does:**
- Moves item to specific time on specific date
- Sets both start AND end time (based on duration)
- Uses timezone-aware datetime strings

**Step-by-step process:**

```javascript
// STEP 1: Parse time input
// Input: "2pm", "2:30pm", "14:00"
const timeMatch = "2pm".match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
// Result: ["2pm", "2", undefined, "pm"]

let hours = 2;
const minutes = 0;
const meridiem = "pm";

// Convert to 24-hour
if (meridiem === 'pm' && hours !== 12) {
  hours += 12;  // 2pm → 14
}
// Result: hours = 14, minutes = 0

// STEP 2: Calculate date
const dateISO = calculateDate("today");  // "2026-02-06"

// STEP 3: Find the item (same as Move Single Item)
const results = await notion.queryDatabase({ /* filters */ });
const item = results[0];

// STEP 4: Get duration from item properties
const duration = item.properties['Estimated Minutes'] || 30;
// Result: 30 minutes

// STEP 5: Create datetime objects
const startDateTime = new Date("2026-02-06T14:00:00");
const endDateTime = new Date("2026-02-06T14:30:00");

// STEP 6: Format with timezone
// Determine if DST is in effect
const isDST = isDaylightSavingTime(startDateTime);
const offset = isDST ? '-04:00' : '-05:00';

const startISO = "2026-02-06T14:00:00.000-05:00";
const endISO = "2026-02-06T14:30:00.000-05:00";

// STEP 7: Update with both start and end times
await notion.updatePage(item.id, {
  [dateProp.name]: {
    type: 'date',
    date: {
      start: startISO,
      end: endISO
    }
  }
});

// STEP 8: Return success
return {
  success: true,
  message: "✅ Moved \"Daily Standup\" to 2:00 PM on Thursday, February 6, 2026",
  item: "Daily Standup",
  time: "2:00 PM",
  date: "2026-02-06"
};
```

**Timezone Handling Details:**

```javascript
// Detect DST (Daylight Saving Time)
function isDaylightSavingTime(date) {
  // Get timezone offset for January (always standard time)
  const jan = new Date(date.getFullYear(), 0, 1);
  const janOffset = jan.getTimezoneOffset();
  
  // Get timezone offset for July (always DST if applicable)
  const jul = new Date(date.getFullYear(), 6, 1);
  const julOffset = jul.getTimezoneOffset();
  
  // Standard offset is the larger one (more negative = further west)
  const stdOffset = Math.max(janOffset, julOffset);
  
  // If current offset is less than standard, DST is in effect
  return date.getTimezoneOffset() < stdOffset;
}

// Example for EST/EDT:
// January offset: 300 minutes (UTC-5)
// July offset: 240 minutes (UTC-4)
// stdOffset: 300
// If date.getTimezoneOffset() = 240, then DST is active
```

**Date Property Format Examples:**

```javascript
// Date only (no time)
{
  type: 'date',
  date: {
    start: "2026-02-06"
  }
}

// Date with time (no end)
{
  type: 'date',
  date: {
    start: "2026-02-06T14:00:00.000-05:00"
  }
}

// Date with time range
{
  type: 'date',
  date: {
    start: "2026-02-06T14:00:00.000-05:00",
    end: "2026-02-06T14:30:00.000-05:00"
  }
}

// Date range (multi-day)
{
  type: 'date',
  date: {
    start: "2026-02-06",
    end: "2026-02-08"
  }
}
```

---

## Natural Language Processing

### Date Calculation

```javascript
function calculateDate(word) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);  // Normalize to midnight
  
  const lower = word.toLowerCase().replace(/'s$/i, '');
  
  // Direct matches
  if (lower === 'today') return formatDateISO(today);
  if (lower === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateISO(tomorrow);
  }
  if (lower === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateISO(yesterday);
  }
  if (lower === 'next week') {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return formatDateISO(nextWeek);
  }
  
  // Day names - always returns NEXT occurrence
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 
                'thursday', 'friday', 'saturday'];
  const dayIndex = days.indexOf(lower);
  
  if (dayIndex !== -1) {
    const currentDay = today.getDay();  // 0 = Sunday, 6 = Saturday
    let daysToAdd = dayIndex - currentDay;
    
    // If target day already passed this week, go to next week
    if (daysToAdd <= 0) {
      daysToAdd += 7;
    }
    
    const targetDay = new Date(today);
    targetDay.setDate(targetDay.getDate() + daysToAdd);
    return formatDateISO(targetDay);
  }
  
  return formatDateISO(today);  // Default to today
}

// Examples (assuming today is Thursday, Feb 6, 2026):
calculateDate('today')      // "2026-02-06" (Thu)
calculateDate('tomorrow')   // "2026-02-07" (Fri)
calculateDate('friday')     // "2026-02-07" (Fri - tomorrow)
calculateDate('thursday')   // "2026-02-13" (Thu - next week)
calculateDate('monday')     // "2026-02-10" (Mon - next Mon)
calculateDate('next week')  // "2026-02-13" (Thu - 7 days)
```

### Command Pattern Matching

```javascript
// Pattern 1: Bulk meetings
const pattern1 = /(move|reschedule)\s+(today'?s?|tomorrow'?s?)\s+meetings?\s+to\s+(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;

// Matches:
"move today's meetings to tomorrow"
"reschedule tomorrow's meetings to friday"
"Move Today's Meetings to Next Week"

// Captures:
// [1] = "move" or "reschedule"
// [2] = "today's" or "tomorrow's"
// [3] = target date keyword

// Pattern 2: Single item move
const pattern2 = /(?:move|reschedule)\s+(.+?)\s+to\s+(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;

// Matches:
"move dentist appointment to friday"
"reschedule team sync to tomorrow"
"Move Client Call to Next Week"

// Captures:
// [1] = item name (non-greedy)
// [2] = target date keyword

// Pattern 3: Time-based move
const pattern3 = /(?:move|reschedule)\s+(.+?)\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?/i;

// Matches:
"move standup to 2pm"
"move standup to 2pm tomorrow"
"reschedule dentist to 3:30pm friday"

// Captures:
// [1] = item name
// [2] = time (e.g., "2pm", "3:30pm")
// [3] = date keyword (optional, defaults to "today")
```

---

## Pagination Handling

**Critical Feature:** Notion API returns max 100 results per request. Your system handles this automatically.

```javascript
async queryDatabase(filters) {
  let allResults = [];
  let hasMore = true;
  let startCursor = undefined;
  
  // Loop until all pages fetched
  while (hasMore) {
    const requestBody = { filter: filters };
    
    // Add cursor for subsequent requests
    if (startCursor) {
      requestBody.start_cursor = startCursor;
    }
    
    // Make API request
    const data = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    }).then(r => r.json());
    
    // Accumulate results
    allResults = allResults.concat(data.results);
    
    // Check if more pages exist
    hasMore = data.has_more;
    startCursor = data.next_cursor;
    
    // Loop continues if hasMore is true
  }
  
  return allResults;  // All pages, not just first 100
}

// Example with 250 items:
// Request 1: Returns 100 items, has_more = true, next_cursor = "abc123"
// Request 2: Returns 100 items, has_more = true, next_cursor = "def456"
// Request 3: Returns 50 items, has_more = false, next_cursor = null
// Total: 250 items returned
```

---

## Property Type Extraction

**Problem:** Notion returns complex nested objects for properties.
**Solution:** Extract the actual value based on property type.

```javascript
extractPropertyValue(prop) {
  switch (prop.type) {
    case 'title':
      // Input: { type: "title", title: [{ plain_text: "Task Name" }] }
      // Output: "Task Name"
      return prop.title.map(t => t.plain_text).join('');
    
    case 'rich_text':
      // Input: { type: "rich_text", rich_text: [{ plain_text: "Description" }] }
      // Output: "Description"
      return prop.rich_text.map(t => t.plain_text).join('');
    
    case 'number':
      // Input: { type: "number", number: 30 }
      // Output: 30
      return prop.number;
    
    case 'select':
      // Input: { type: "select", select: { name: "Meeting", color: "blue" } }
      // Output: "Meeting"
      return prop.select?.name || null;
    
    case 'multi_select':
      // Input: { type: "multi_select", multi_select: [{ name: "Tag1" }, { name: "Tag2" }] }
      // Output: ["Tag1", "Tag2"]
      return prop.multi_select.map(s => s.name);
    
    case 'date':
      // Input: { type: "date", date: { start: "2026-02-06T14:00:00.000-05:00", end: null } }
      // Output: { start: "2026-02-06T14:00:00.000-05:00", end: null }
      if (prop.date) {
        return {
          start: prop.date.start,
          end: prop.date.end
        };
      }
      return null;
    
    case 'checkbox':
      // Input: { type: "checkbox", checkbox: true }
      // Output: true
      return prop.checkbox;
    
    case 'status':
      // Input: { type: "status", status: { name: "In Progress", color: "blue" } }
      // Output: "In Progress"
      return prop.status?.name || null;
    
    default:
      return null;
  }
}
```

---

## Error Handling

### Common Error Scenarios

```javascript
// 1. API Key Missing
if (!env.NOTION_API_KEY) {
  return {
    success: false,
    error: "Notion API key not configured"
  };
}

// 2. Database Not Shared with Integration
// API Response: 404 Not Found
{
  "object": "error",
  "status": 404,
  "code": "object_not_found",
  "message": "Could not find database with ID: abc123..."
}

// 3. Invalid API Key
// API Response: 401 Unauthorized
{
  "object": "error",
  "status": 401,
  "code": "unauthorized",
  "message": "API token is invalid."
}

// 4. No Results Found
if (results.length === 0) {
  return {
    success: false,
    error: "Could not find \"dentist\" in your Notion database"
  };
}

// 5. Ambiguous Search
if (results.length > 1) {
  const list = results.map(r => r.properties.Name).join(', ');
  return {
    success: false,
    error: `Found multiple matches: ${list}. Please be more specific.`
  };
}

// 6. Missing Required Property
const dateProp = schema.properties.find(p => p.type === 'date');
if (!dateProp) {
  return {
    success: false,
    error: "No date property found in database"
  };
}

// 7. Rate Limit Exceeded (rare with batching)
// API Response: 429 Too Many Requests
{
  "object": "error",
  "status": 429,
  "code": "rate_limited",
  "message": "Rate limit exceeded. Please retry after..."
}
```

---

## Complete Request/Response Examples

### Example 1: Successful Bulk Move

**Request:**
```json
POST https://worker.dev
{
  "command": "move today's meetings to tomorrow"
}
```

**Internal Processing:**
```
1. Parse command → source="today", target="tomorrow"
2. Calculate dates → from="2026-02-06", to="2026-02-07"
3. Get schema → dateProp = "Due Date"
4. Query meetings → 3 results
5. Filter by date → 3 matches
6. Update 3 pages
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "message": "✅ Moved 3 meeting(s) from Thursday, February 6, 2026 to Friday, February 7, 2026",
  "items": [
    "Team Standup",
    "Client Call",
    "Design Review"
  ]
}
```

### Example 2: Item Not Found

**Request:**
```json
{
  "command": "move unicorn meeting to tomorrow"
}
```

**Response:**
```json
{
  "success": false,
  "error": "Could not find \"unicorn\" in your Notion database"
}
```

### Example 3: Time-Based Move

**Request:**
```json
{
  "command": "move standup to 2:30pm tomorrow"
}
```

**Internal Processing:**
```
1. Parse → item="standup", time="2:30pm", date="tomorrow"
2. Calculate → date="2026-02-07", hours=14, minutes=30
3. Search → 1 match: "Daily Standup"
4. Get duration → 15 minutes
5. Create times → start="2026-02-07T14:30:00.000-05:00"
                  end="2026-02-07T14:45:00.000-05:00"
6. Update page
```

**Response:**
```json
{
  "success": true,
  "message": "✅ Moved \"Daily Standup\" to 2:30 PM on Friday, February 7, 2026",
  "item": "Daily Standup",
  "time": "2:30 PM",
  "date": "2026-02-07"
}
```

---

## Files Created for You

1. **cloudflare-worker-notion.js**
   - Complete worker implementation
   - 1,000+ lines of fully documented code
   - All functions from your LittleBot

2. **CLOUDFLARE-WORKER-SETUP.md**
   - Step-by-step setup guide
   - API reference
   - Troubleshooting
   - Integration examples

3. **test-worker-examples.sh** (Bash)
   - 10 test scenarios
   - cURL commands
   - Interactive testing

4. **test-worker-examples.ps1** (PowerShell)
   - Same tests for Windows
   - Uses Invoke-RestMethod

5. **COMPLETE-NOTION-REFERENCE.md** (this file)
   - Deep dive into every function
   - Algorithm explanations
   - Code examples

---

## Quick Start Checklist

- [ ] Create Notion integration at https://www.notion.so/my-integrations
- [ ] Copy API key (starts with `secret_`)
- [ ] Get database ID from URL (32-char hex)
- [ ] Share database with integration
- [ ] Create Cloudflare Worker at dash.cloudflare.com
- [ ] Paste code from cloudflare-worker-notion.js
- [ ] Add secrets: NOTION_API_KEY and NOTION_DATABASE_ID
- [ ] Deploy worker
- [ ] Test with: `curl -X POST <worker-url> -H "Content-Type: application/json" -d '{"action":"getSchema"}'`
- [ ] Celebrate! 🎉

---

## Support & Resources

- **Notion API Docs**: https://developers.notion.com
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Your Files**:
  - Implementation: `cloudflare-worker-notion.js`
  - Setup Guide: `CLOUDFLARE-WORKER-SETUP.md`
  - Tests: `test-worker-examples.sh` / `.ps1`

---

**You now have EVERYTHING you need to deploy your Notion assistant to Cloudflare Workers!**
