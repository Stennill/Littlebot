/**
 * CLOUDFLARE WORKER - NOTION ASSISTANT (READ-ONLY)
 * Query and schema only - no create, update, move, or archive.
 *
 * SETUP: Add NOTION_API_KEY and NOTION_DATABASE_ID as Worker secrets.
 * POST body: { "action": "queryDatabase" | "getSchema", "filters": {...}, "sorts": [...] }
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
      }

      const body = await request.json();
      const { action } = body;

      if (!action) {
        return jsonResponse({ error: 'Missing required field: "action" (queryDatabase or getSchema)' }, 400, corsHeaders);
      }

      const notion = new NotionClient(env.NOTION_API_KEY, env.NOTION_DATABASE_ID);
      const result = await handleAction(notion, action, body);
      return jsonResponse(result, 200, corsHeaders);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ success: false, error: error.message }, 500, corsHeaders);
    }
  }
};

async function handleAction(notion, action, body) {
  switch (action) {
    case 'queryDatabase':
      return await notion.queryDatabase(body.filters || null, body.sorts || null);
    case 'getSchema':
      return await notion.getDatabaseSchema();
    default:
      return { success: false, error: `Unknown action: ${action}. Supported: queryDatabase, getSchema.` };
  }
}

// ============================================================================
// NOTION CLIENT CLASS (read-only: query + getSchema only)
// ============================================================================
class NotionClient {
  constructor(apiKey, databaseId) {
    this.apiKey = apiKey;
    this.databaseId = databaseId;
  }

  /**
   * Make authenticated request to Notion API
   */
  async makeRequest(endpoint, method = 'GET', body = null) {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    };

    const options = { method, headers };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${NOTION_API_BASE}${endpoint}`, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  /**
   * Query database with filters and pagination
   * CRITICAL: Handles pagination to get ALL results (not just first 100)
   */
  async queryDatabase(filters = null, sorts = null) {
    const body = {};

    // Only add filter if it exists and has properties
    if (filters && Object.keys(filters).length > 0) {
      body.filter = filters;
    }

    if (sorts) {
      body.sorts = sorts;
    }

    // Handle pagination - get ALL results
    let allResults = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const requestBody = { ...body };
      if (startCursor) {
        requestBody.start_cursor = startCursor;
      }

      const data = await this.makeRequest(
        `/databases/${this.databaseId}/query`,
        'POST',
        Object.keys(requestBody).length > 0 ? requestBody : {}
      );

      allResults = allResults.concat(data.results);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    return this.formatResults(allResults);
  }

  /**
   * Get database schema/properties
   */
  async getDatabaseSchema() {
    const data = await this.makeRequest(`/databases/${this.databaseId}`);

    return {
      title: data.title[0]?.plain_text || 'Untitled Database',
      properties: Object.entries(data.properties).map(([name, prop]) => ({
        name,
        type: prop.type,
        id: prop.id
      }))
    };
  }

  /**
   * Format page data for easier consumption
   * Extracts values from Notion's complex property format
   */
  formatPage(page) {
    const formatted = {
      id: page.id,
      url: page.url,
      created: page.created_time,
      lastEdited: page.last_edited_time,
      properties: {}
    };

    // Extract property values
    for (const [key, prop] of Object.entries(page.properties)) {
      formatted.properties[key] = this.extractPropertyValue(prop);
    }

    return formatted;
  }

  /**
   * Format array of results
   */
  formatResults(results) {
    return results.map(page => this.formatPage(page));
  }

  /**
   * Extract value from Notion property based on type
   */
  extractPropertyValue(prop) {
    switch (prop.type) {
      case 'title':
        return prop.title.map(t => t.plain_text).join('');
      case 'rich_text':
        return prop.rich_text.map(t => t.plain_text).join('');
      case 'number':
        return prop.number;
      case 'select':
        return prop.select?.name || null;
      case 'multi_select':
        return prop.multi_select.map(s => s.name);
      case 'date':
        // Return full date object with start and end
        if (prop.date) {
          return {
            start: prop.date.start,
            end: prop.date.end
          };
        }
        return null;
      case 'checkbox':
        return prop.checkbox;
      case 'url':
        return prop.url;
      case 'email':
        return prop.email;
      case 'phone_number':
        return prop.phone_number;
      case 'status':
        return prop.status?.name || null;
      default:
        return null;
    }
  }
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}
