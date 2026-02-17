/**
 * Notion Database Manager for Arc
 * Manages integration with user's Notion workspace
 */

class NotionManager {
  constructor() {
    this.apiKey = null;
    this.databaseId = null;
    this.baseUrl = 'https://api.notion.com/v1';
    this.notionVersion = '2022-06-28';
  }

  /**
   * Configure Notion credentials
   */
  configure(apiKey, databaseId) {
    this.apiKey = apiKey;
    this.databaseId = databaseId;
  }

  /**
   * Check if Notion is configured
   */
  isConfigured() {
    return !!(this.apiKey && this.databaseId);
  }

  /**
   * Make a request to Notion API (with one retry on network failure)
   */
  async makeRequest(endpoint, method = 'GET', body = null, retried = false) {
    if (!this.apiKey) {
      throw new Error('Notion API key not configured');
    }

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': this.notionVersion,
      'Content-Type': 'application/json'
    };

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${error}`);
      }
      return await response.json();
    } catch (err) {
      const isNetworkError = /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(err.message || '');
      if (isNetworkError && !retried) {
        await new Promise(r => setTimeout(r, 2000));
        return this.makeRequest(endpoint, method, body, true);
      }
      throw err;
    }
  }

  /**
   * Query database with filters
   */
  async queryDatabase(filters = null, sorts = null) {
    if (!this.databaseId) {
      throw new Error('Notion database ID not configured');
    }

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
   * Get all pages from database
   */
  async getAllPages() {
    return await this.queryDatabase();
  }

  /**
   * Search database by title
   */
  async searchByTitle(title) {
    const filters = {
      property: 'Name',
      title: {
        contains: title
      }
    };

    return await this.queryDatabase(filters);
  }

  /**
   * Create a new page in the database.
   * @param {Object} properties - Keyed by property name; values in Notion API shape (e.g. { title: [{ text: { content: "..." } }] }, { date: { start: "ISO" } }, { select: { name: "Meeting" } }, { status: { name: "In Progress" } })
   */
  async createPage(properties) {
    if (!this.databaseId) {
      throw new Error('Notion database ID not configured');
    }
    const body = {
      parent: { database_id: this.databaseId },
      properties
    };
    const data = await this.makeRequest('/pages', 'POST', body);
    return this.formatPage(data);
  }

  /**
   * Update an existing page
   */
  async updatePage(pageId, properties) {
    if (!this.apiKey) {
      throw new Error('Notion API key not configured');
    }
    if (!pageId) {
      throw new Error('Missing pageId');
    }
    const body = { properties: properties || {} };
    const data = await this.makeRequest(`/pages/${pageId}`, 'PATCH', body);
    return this.formatPage(data);
  }

  /**
   * Get a specific page by ID
   */
  async getPage(pageId) {
    const data = await this.makeRequest(`/pages/${pageId}`);
    return this.formatPage(data);
  }

  /**
   * Archive/delete a page (DISABLED - read-only mode)
   */
  async archivePage(pageId) {
    throw new Error('Notion is configured for read-only access. Archive/delete is disabled.');
  }

  /**
   * Get database schema/properties
   */
  async getDatabaseSchema() {
    if (!this.databaseId) {
      throw new Error('Notion database ID not configured');
    }

    const data = await this.makeRequest(`/databases/${this.databaseId}`);
    
    return {
      title: data.title[0]?.plain_text || 'Untitled Database',
      properties: Object.entries(data.properties).map(([name, prop]) => {
        const out = { name, type: prop.type, id: prop.id };
        if (prop.select?.options?.length) {
          out.options = prop.select.options.map(o => o.name);
        }
        if (prop.multi_select?.options?.length) {
          out.options = prop.multi_select.options.map(o => o.name);
        }
        return out;
      })
    };
  }

  /**
   * Format properties for API request
   */
  formatProperties(properties) {
    const formatted = {};

    for (const [key, value] of Object.entries(properties)) {
      if (typeof value === 'string') {
        // Default to title for strings
        formatted[key] = {
          title: [
            {
              text: {
                content: value
              }
            }
          ]
        };
      } else if (typeof value === 'object' && value.type) {
        // Use specified type
        formatted[key] = value;
      }
    }

    return formatted;
  }

  /**
   * Format page data for easier consumption
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
   * Format results array
   */
  formatResults(results) {
    return results.map(page => this.formatPage(page));
  }

  /**
   * Extract value from property based on type
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
      case 'relation':
        return (prop.relation || []).map(r => r.id);
      default:
        return null;
    }
  }

  /**
   * Build a simple text property
   */
  static textProperty(text) {
    return {
      type: 'rich_text',
      rich_text: [
        {
          text: {
            content: text
          }
        }
      ]
    };
  }

  /**
   * Build a title property
   */
  static titleProperty(text) {
    return {
      type: 'title',
      title: [
        {
          text: {
            content: text
          }
        }
      ]
    };
  }

  /**
   * Build a select property
   */
  static selectProperty(value) {
    return {
      type: 'select',
      select: {
        name: value
      }
    };
  }

  /**
   * Build a checkbox property
   */
  static checkboxProperty(checked) {
    return {
      type: 'checkbox',
      checkbox: checked
    };
  }

  /**
   * Build a date property
   */
  static dateProperty(date) {
    return {
      type: 'date',
      date: {
        start: date
      }
    };
  }
}

module.exports = new NotionManager();
