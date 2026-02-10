# Cloudflare Worker - Notion Assistant Setup Guide

## Complete Step-by-Step Implementation

This guide provides **extreme detail** for deploying your Notion assistant as a Cloudflare Worker.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Get Your Notion Credentials](#get-your-notion-credentials)
3. [Deploy to Cloudflare](#deploy-to-cloudflare)
4. [Configure Secrets](#configure-secrets)
5. [Test the Worker](#test-the-worker)
6. [API Reference](#api-reference)
7. [Database Schema Requirements](#database-schema-requirements)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Cloudflare Account** (free tier works): https://dash.cloudflare.com/sign-up
- **Notion Account**: https://www.notion.so
- **Notion Database** with specific properties (see [Database Schema](#database-schema-requirements))

---

## Get Your Notion Credentials

### Step 1: Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click **"+ New integration"**
3. Fill out the form:
   - **Name**: "LittleBot Assistant" (or any name)
   - **Associated workspace**: Select your workspace
   - **Type**: Internal
4. Click **Submit**
5. **COPY THE API KEY** - it looks like: `secret_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456`
6. Save this somewhere safe - you'll need it later

### Step 2: Get Database ID

1. Open your Notion database in a browser
2. Look at the URL - it looks like:
   ```
   https://www.notion.so/username/DATABASE_ID?v=VIEW_ID
                                  ^^^^^^^^^^^^^^^^
   ```
3. Copy the **32-character hexadecimal string** (the DATABASE_ID part)
4. Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Step 3: Share Database with Integration

**CRITICAL STEP** - Without this, the worker cannot access your database!

1. Open your Notion database
2. Click the **"•••"** (three dots) in the top right
3. Click **"Connections"** or **"Add connections"**
4. Find and select your integration ("LittleBot Assistant")
5. Click **Allow**

---

## Deploy to Cloudflare

### Option 1: Dashboard (Easiest)

1. Go to https://dash.cloudflare.com
2. Select **Workers & Pages** from left sidebar
3. Click **Create application**
4. Click **Create Worker**
5. Give it a name (e.g., `notion-assistant`)
6. Click **Deploy**
7. Click **Edit code**
8. **Delete all existing code**
9. **Copy and paste** the entire contents of `cloudflare-worker-notion.js`
10. Click **Save and deploy**

### Option 2: Wrangler CLI (Advanced)

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create new worker project
mkdir notion-worker
cd notion-worker

# Initialize
wrangler init

# Copy the worker code to src/index.js
# Then deploy
wrangler deploy
```

---

## Configure Secrets

### Via Dashboard (Recommended)

1. Go to your worker in Cloudflare Dashboard
2. Click **Settings** tab
3. Click **Variables** section
4. Under **Environment Variables**, click **Add variable**

**Add these TWO secrets:**

| Name | Value | Type |
|------|-------|------|
| `NOTION_API_KEY` | `secret_aBcDe...` (from Step 1) | Secret (encrypted) |
| `NOTION_DATABASE_ID` | `a1b2c3d4...` (from Step 2) | Secret (encrypted) |

**IMPORTANT:** Select **"Encrypt"** for both values!

5. Click **Save**

### Via Wrangler CLI

```bash
# Set API key
wrangler secret put NOTION_API_KEY
# Paste your key when prompted

# Set Database ID
wrangler secret put NOTION_DATABASE_ID
# Paste your database ID when prompted
```

---

## Test the Worker

### Get Your Worker URL

After deployment, your worker URL will be:
```
https://notion-assistant.YOUR-SUBDOMAIN.workers.dev
```

### Test Request 1: Move Today's Meetings

**Using cURL:**
```bash
curl -X POST https://notion-assistant.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move today'\''s meetings to tomorrow"
  }'
```

**Using JavaScript (fetch):**
```javascript
fetch('https://notion-assistant.YOUR-SUBDOMAIN.workers.dev', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    command: "move today's meetings to tomorrow"
  })
})
.then(r => r.json())
.then(data => console.log(data));
```

**Expected Response:**
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

### Test Request 2: Move Specific Item

```bash
curl -X POST https://notion-assistant.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move dentist appointment to friday"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "✅ Moved \"Dentist Appointment\" to Friday, February 14, 2026",
  "item": "Dentist Appointment",
  "newDate": "2026-02-14"
}
```

### Test Request 3: Move to Specific Time

```bash
curl -X POST https://notion-assistant.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move standup to 2pm"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "✅ Moved \"Daily Standup\" to 2:00 PM on Thursday, February 6, 2026",
  "item": "Daily Standup",
  "time": "2:00 PM",
  "date": "2026-02-06"
}
```

### Test Request 4: Get Database Schema

```bash
curl -X POST https://notion-assistant.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "action": "getSchema"
  }'
```

---

## API Reference

### Request Format

All requests are **POST** with JSON body:

```json
{
  "command": "natural language command",
  // OR
  "action": "directAction",
  "param1": "value1",
  "param2": "value2"
}
```

### Natural Language Commands

#### 1. Bulk Meeting Move
```json
{
  "command": "move today's meetings to tomorrow"
}
```

**Supported patterns:**
- `"move today's meetings to tomorrow"`
- `"reschedule tomorrow's meetings to friday"`
- `"move today's meetings to next week"`

**Date keywords:**
- `today`, `tomorrow`, `yesterday`
- `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`
- `next week`

#### 2. Single Item Move
```json
{
  "command": "move dentist appointment to friday"
}
```

**Examples:**
- `"move team sync to tomorrow"`
- `"reschedule coffee chat to monday"`
- `"move project review to next week"`

#### 3. Move to Specific Time
```json
{
  "command": "move standup to 2pm"
}
```

**Time formats:**
- `"2pm"`, `"2:30pm"`, `"14:00"`
- `"9am"`, `"9:30am"`, `"09:00"`

**With date:**
- `"move standup to 2pm tomorrow"`
- `"reschedule dentist to 3:30pm friday"`

---

### Direct Actions

#### Action: moveMeetings
```json
{
  "action": "moveMeetings",
  "fromDate": "2026-02-06",
  "toDate": "2026-02-07"
}
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "message": "✅ Moved 3 meeting(s)...",
  "items": ["Item 1", "Item 2", "Item 3"]
}
```

#### Action: moveItem
```json
{
  "action": "moveItem",
  "itemName": "dentist",
  "toDate": "2026-02-14"
}
```

#### Action: moveItemToTime
```json
{
  "action": "moveItemToTime",
  "itemName": "standup",
  "time": "2pm",
  "date": "today"
}
```

#### Action: queryDatabase
```json
{
  "action": "queryDatabase",
  "filters": {
    "and": [
      {
        "property": "Type",
        "select": {
          "equals": "Meeting"
        }
      }
    ]
  }
}
```

#### Action: createPage
```json
{
  "action": "createPage",
  "properties": {
    "Name": {
      "type": "title",
      "title": [{"text": {"content": "New Task"}}]
    },
    "Date": {
      "type": "date",
      "date": {"start": "2026-02-10"}
    },
    "Type": {
      "type": "select",
      "select": {"name": "Task"}
    }
  }
}
```

#### Action: updatePage
```json
{
  "action": "updatePage",
  "pageId": "abc123...",
  "properties": {
    "Status": {
      "type": "status",
      "status": {"name": "Completed"}
    }
  }
}
```

#### Action: archivePage
```json
{
  "action": "archivePage",
  "pageId": "abc123..."
}
```

#### Action: getSchema
```json
{
  "action": "getSchema"
}
```

**Response:**
```json
{
  "title": "Tasks & Meetings",
  "properties": [
    {"name": "Name", "type": "title", "id": "title"},
    {"name": "Date", "type": "date", "id": "abc123"},
    {"name": "Type", "type": "select", "id": "def456"},
    {"name": "Status", "type": "status", "id": "ghi789"}
  ]
}
```

---

## Database Schema Requirements

Your Notion database **MUST** have these properties:

| Property Name | Type | Required | Notes |
|---------------|------|----------|-------|
| **Name** or **Title** | Title | ✅ Yes | Primary identifier |
| **Date** (any name) | Date | ✅ Yes | Worker auto-detects |
| **Type** | Select | ✅ Yes | Must have "Meeting" option |
| **Status** | Status | ✅ Yes | Must have "Processed", "Resolved" options |
| **Estimated Minutes** or **Duration** | Number | ⚠️ Optional | Used for time-based moves (default: 30) |

### Example Database Setup

1. Create a new database in Notion
2. Add these properties:
   - **Name** (Title) - rename default "Name" column
   - **Date** (Date) - click "+" and add Date property
   - **Type** (Select) - add options: "Meeting", "Task", "Event", "Break", "PTO"
   - **Status** (Status) - add options: "Upcoming", "In Progress", "Processed", "Resolved"
   - **Estimated Minutes** (Number) - optional

3. Add sample data:
   ```
   | Name              | Date       | Type    | Status   | Estimated Minutes |
   |-------------------|------------|---------|----------|-------------------|
   | Team Standup      | 2026-02-06 | Meeting | Upcoming | 15                |
   | Client Call       | 2026-02-06 | Meeting | Upcoming | 60                |
   | Review Design     | 2026-02-07 | Task    | Upcoming | 30                |
   ```

---

## Advanced Features

### Pagination Handling

The worker **automatically handles pagination** - it fetches ALL results from your database, not just the first 100 pages.

**How it works:**
```javascript
// The queryDatabase function loops until all pages are fetched
while (hasMore) {
  const data = await this.makeRequest(...);
  allResults = allResults.concat(data.results);
  hasMore = data.has_more;
  startCursor = data.next_cursor;
}
```

### Timezone Support

The worker uses **US Eastern Time (EST/EDT)** with automatic DST detection:

```javascript
// Automatically determines if DST is in effect
const isDST = isDaylightSavingTime(date);
const offset = isDST ? '-04:00' : '-05:00';
```

**To change timezone:**
1. Find the `formatDateTimeISO` function
2. Change the offset calculation
3. Update `isDaylightSavingTime` logic for your timezone

### Error Handling

All errors return this format:
```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Notion API key not configured` | Missing secret | Add `NOTION_API_KEY` secret |
| `Notion database ID not configured` | Missing secret | Add `NOTION_DATABASE_ID` secret |
| `Notion API error: 401` | Invalid API key | Check your integration key |
| `Notion API error: 404` | Database not shared | Share database with integration |
| `No date property found` | Missing date property | Add Date property to database |
| `Could not find "X"` | Item doesn't exist | Check item name/spelling |
| `Multiple items found` | Ambiguous search | Be more specific in command |

---

## Integrations

### Slack Integration

Add a Slack webhook to get notifications when items are moved:

```javascript
// Add this to your worker after moveItemToTime function
if (env.SLACK_WEBHOOK_URL) {
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `✅ Moved "${itemTitle}" to ${targetTime}`
    })
  });
}
```

Then add `SLACK_WEBHOOK_URL` secret in Cloudflare dashboard.

### Webhook Triggers

Call your worker from external services:

**Zapier:**
1. Create a Zap with "Webhooks by Zapier"
2. Choose "POST" method
3. URL: Your worker URL
4. Data: `{"command": "move today's meetings to tomorrow"}`

**Make (formerly Integlia):**
1. Add HTTP module
2. Method: POST
3. URL: Your worker URL
4. Body: JSON with command

**IFTTT:**
1. Choose "Webhooks" service
2. Make a web request
3. Method: POST
4. Content Type: application/json
5. Body: `{"command": "{{TextField}}"}`

---

## Performance & Limits

### Cloudflare Free Tier Limits
- **100,000 requests/day** (more than enough)
- **10ms CPU time per request** (worker is well under this)
- **No cold starts** (workers are instant)

### Notion API Rate Limits
- **3 requests/second**
- The worker automatically batches operations to stay under limits

### Typical Response Times
- Simple query: **200-500ms**
- Bulk move (10 items): **2-5 seconds**
- Complex time-based move: **1-3 seconds**

---

## Troubleshooting

### "Notion API error: 401"
**Problem:** Unauthorized
**Solution:** 
- Check your `NOTION_API_KEY` is correct
- Make sure it starts with `secret_`
- Regenerate integration key if needed

### "Notion API error: 404"
**Problem:** Database not found
**Solution:**
- Verify `NOTION_DATABASE_ID` is correct (32 hex chars)
- **CRITICAL:** Share database with integration (see Step 3 above)

### "No meetings found"
**Problem:** Date doesn't match
**Solution:**
- Check that meetings have dates in YYYY-MM-DD format
- Verify Status is not "Processed" or "Resolved"
- Use `"action": "queryDatabase"` to inspect data

### "Multiple items found"
**Problem:** Ambiguous search
**Solution:**
- Be more specific: `"move team standup to friday"` instead of `"move standup to friday"`
- Use unique keywords from the item title

### Worker returns 500
**Problem:** Runtime error
**Solution:**
- Check Cloudflare Dashboard → Workers → Your Worker → Logs
- Look for JavaScript errors
- Verify all required properties exist in database

---

## Next Steps

### Customize for Your Use Case

1. **Add new commands:**
   - Edit the `handleCommand` function
   - Add new regex patterns
   - Create handler functions

2. **Add new properties:**
   - Modify filters to check additional fields
   - Update `formatProperties` if needed

3. **Add authentication:**
   ```javascript
   if (request.headers.get('Authorization') !== `Bearer ${env.SECRET_TOKEN}`) {
     return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
   }
   ```

4. **Add logging:**
   ```javascript
   // Logs appear in Cloudflare Dashboard
   console.log('User request:', command);
   console.log('Result:', result);
   ```

---

## Support

- **Cloudflare Docs:** https://developers.cloudflare.com/workers/
- **Notion API Docs:** https://developers.notion.com
- **GitHub Issues:** [Your repo URL here]

---

## License

MIT License - use however you want!
