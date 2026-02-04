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
   * Make a request to Notion API
   */
  async makeRequest(endpoint, method = 'GET', body = null) {
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

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${error}`);
    }

    return await response.json();
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

    const data = await this.makeRequest(
      `/databases/${this.databaseId}/query`,
      'POST',
      Object.keys(body).length > 0 ? body : {}
    );

    return this.formatResults(data.results);
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
   * Create a new page in database
   */
  async createPage(properties) {
    if (!this.databaseId) {
      throw new Error('Notion database ID not configured');
    }

    const body = {
      parent: {
        database_id: this.databaseId
      },
      properties: this.formatProperties(properties)
    };

    const data = await this.makeRequest('/pages', 'POST', body);
    return this.formatPage(data);
  }

  /**
   * Update an existing page
   */
  async updatePage(pageId, properties) {
    const body = {
      properties: this.formatProperties(properties)
    };

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
   * Archive/delete a page
   */
  async archivePage(pageId) {
    const body = {
      archived: true
    };

    const data = await this.makeRequest(`/pages/${pageId}`, 'PATCH', body);
    return { success: true, pageId: data.id };
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
      properties: Object.entries(data.properties).map(([name, prop]) => ({
        name,
        type: prop.type,
        id: prop.id
      }))
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
        return prop.date?.start || null;
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
