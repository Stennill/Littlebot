/**
 * Arc Task Registry System
 * 
 * This module manages all of Arc's task capabilities as modular, callable services.
 * Arc's personality and core identity stays in system-prompt.txt and main.js,
 * while ALL task capabilities are defined here as tools that Arc can call.
 * 
 * Benefits:
 * - Arc's personality never changes
 * - Tasks can be added/removed/modified without touching Arc's core
 * - Clean separation of concerns
 * - Easy to test and maintain individual tasks
 */

class ArcTaskRegistry {
  constructor() {
    this.tasks = new Map();
    this.services = {};
  }

  /**
   * Initialize the task registry with all available services and handlers
   */
  initialize(services, handlers) {
    this.services = services;
    this.handlers = handlers || {};
    this.registerAllTasks();
  }

  /**
   * Register all available tasks
   */
  registerAllTasks() {
    // File Management Tasks
    this.registerFileManagementTasks();
    
    // Notion Integration Tasks
    this.registerNotionTasks();
    
    // Memory Management Tasks
    this.registerMemoryTasks();
    
    // System Tasks
    this.registerSystemTasks();
  }

  /**
   * Register a single task with its handler
   */
  registerTask(name, schema, handler) {
    this.tasks.set(name, {
      schema,
      handler
    });
  }

  /**
   * Get all tasks as Claude API tool definitions
   */
  getAllTools() {
    const tools = [];
    for (const [name, task] of this.tasks) {
      tools.push({
        name,
        description: task.schema.description,
        input_schema: task.schema.input_schema
      });
    }
    return tools;
  }

  /**
   * Execute a task by name
   */
  async executeTask(name, input) {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Task '${name}' not found in registry`);
    }
    return await task.handler(input);
  }

  // ========================================
  // FILE MANAGEMENT TASKS
  // ========================================
  
  registerFileManagementTasks() {
    this.registerTask('search_file', {
      description: "Search for a file by name in common locations (Desktop, Documents, Downloads). Returns matching file paths. Use wildcards if needed (e.g., '*.pdf' for all PDFs, 'resume*' for files starting with 'resume'). This is the first step - after finding the file, ask the user if they want to open it or get more info.",
      input_schema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The filename or pattern to search for (e.g., 'resume.pdf' or 'report*' or '*.xlsx')"
          }
        },
        required: ["filename"]
      }
    }, async (input) => {
      const files = await this.handlers.searchForFile(input.filename);
      return files.length > 0 
        ? { found: true, files: files, count: files.length }
        : { found: false, message: `No files named "${input.filename}" found in common locations.` };
    });

    this.registerTask('get_file_info', {
      description: "Get detailed information about a specific file (size, creation date, modification date, file type). Requires the full path to the file.",
      input_schema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file (e.g., 'C:\\Users\\Name\\Documents\\file.txt')"
          }
        },
        required: ["file_path"]
      }
    }, async (input) => {
      return await this.handlers.getFileInfo(input.file_path);
    });

    this.registerTask('open_file', {
      description: "Opens a file using the default system application. Use this when the user confirms they want to open a specific file. The file will open in its associated program (Word for .docx, Adobe for .pdf, etc.).",
      input_schema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to open (e.g., 'C:\\Users\\Name\\Documents\\resume.docx')"
          }
        },
        required: ["file_path"]
      }
    }, async (input) => {
      return await this.handlers.openFile(input.file_path);
    });

    this.registerTask('get_recent_files', {
      description: "Gets a list of recently modified files from the user's Desktop, Documents, and Downloads folders. Shows files modified in the last 7 days, sorted by most recent first. Useful when users ask about recent work or what files they were working on.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of files to return (default: 10)"
          }
        }
      }
    }, async (input) => {
      const files = await this.handlers.getRecentFiles(input.limit || 10);
      return { files: files, count: files.length };
    });

    this.registerTask('get_removable_drives', {
      description: "Detects all removable drives (USB drives, thumb drives, external drives) currently connected to the computer. Returns drive letters, labels, and available space. Use this when user mentions moving files to a thumb drive, USB drive, or external drive.",
      input_schema: {
        type: "object",
        properties: {}
      }
    }, async (input) => {
      const drives = await this.handlers.getRemovableDrives();
      return { drives: drives, count: drives.length };
    });

    this.registerTask('move_file_to_drive', {
      description: "MOVES a file from its current location to a removable drive. The file is copied to the drive and then DELETED from the original location. After the move, the file will ONLY exist on the removable drive. Use this when the user specifically asks to 'move' a file.",
      input_schema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path of the file to move (e.g., 'C:\\Users\\Name\\Documents\\file.pdf')"
          },
          target_drive: {
            type: "string",
            description: "The drive letter with backslash (e.g., 'E:\\' or 'F:\\')"
          }
        },
        required: ["file_path", "target_drive"]
      }
    }, async (input) => {
      return await this.handlers.moveFileToRemovable(input.file_path, input.target_drive);
    });

    this.registerTask('copy_file_to_drive', {
      description: "COPIES a file to a removable drive. The file is copied to the drive but the original is KEPT in its current location. After the copy, the file will exist in BOTH places. Use this when the user asks to 'copy' a file or wants to keep the original.",
      input_schema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path of the file to copy (e.g., 'C:\\Users\\Name\\Documents\\file.pdf')"
          },
          target_drive: {
            type: "string",
            description: "The drive letter with backslash (e.g., 'E:\\' or 'F:\\')"
          }
        },
        required: ["file_path", "target_drive"]
      }
    }, async (input) => {
      return await this.handlers.copyFileToRemovable(input.file_path, input.target_drive);
    });
  }

  // ========================================
  // NOTION INTEGRATION TASKS
  // ========================================
  
  registerNotionTasks() {
    this.registerTask('notion_query_database', {
      description: "Query the user's Notion database. Can search for pages, filter results, or get all pages. Returns page data with properties. IMPORTANT: Use notion_get_schema first to find the correct title property name (could be 'Title', 'Name', 'Task', etc). Example filter: {property: 'Title', title: {contains: 'search term'}}. Leave filters empty {} to get all pages.",
      input_schema: {
        type: "object",
        properties: {
          filters: {
            type: "object",
            description: "Optional Notion filter object. Format: {property: 'PropertyName', type: {condition: value}}. Example: {property: 'Title', title: {contains: 'Tech Services'}}. Can be empty {} to get all pages."
          }
        }
      }
    }, async (input) => {
      return await this.handlers.notionQueryDatabase(input.filters || null);
    });

    this.registerTask('notion_get_schema', {
      description: "Get the structure/schema of the Notion database - shows what properties and fields are available.",
      input_schema: {
        type: "object",
        properties: {}
      }
    }, async (input) => {
      return await this.handlers.notionGetSchema();
    });

    this.registerTask('notion_create_page', {
      description: "Create a new page in the Notion database with properties. IMPORTANT: Call notion_get_schema first to see available properties and their types. Use exact property names and valid values from the schema.",
      input_schema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description: "Page properties as key-value pairs. Example: {Title: 'Task name', Status: 'In Progress', Priority: 'High'}"
          }
        },
        required: ["properties"]
      }
    }, async (input) => {
      return await this.handlers.notionCreatePage(input.properties);
    });

    this.registerTask('notion_update_page', {
      description: "Update an existing Notion page. Use this to modify properties, change status, reschedule times, etc. IMPORTANT: Get the page_id from a notion_query_database call first.",
      input_schema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to update (from query results)"
          },
          properties: {
            type: "object",
            description: "Properties to update. Example: {Status: 'Done', 'Event Date': '2026-02-10T14:00:00'}"
          }
        },
        required: ["page_id", "properties"]
      }
    }, async (input) => {
      return await this.handlers.notionUpdatePage(input.page_id, input.properties);
    });

    this.registerTask('notion_archive_page', {
      description: "Archive (delete) a page from the Notion database. Use this when the user asks to delete, remove, or clean up an item. IMPORTANT: Get the page_id from a notion_query_database call first.",
      input_schema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to archive/delete"
          }
        },
        required: ["page_id"]
      }
    }, async (input) => {
      return await this.handlers.notionArchivePage(input.page_id);
    });
  }

  // ========================================
  // MEMORY MANAGEMENT TASKS
  // ========================================
  
  registerMemoryTasks() {
    // Memory tasks can be added later if needed
    // For now, memory is managed through the memoryStore service directly in main.js
  }

  // ========================================
  // SYSTEM TASKS
  // ========================================
  
  registerSystemTasks() {
    // System tasks (time, version) are handled inline for now
    // Can be added to registry later if needed
  }

  // ========================================
  // UTILITY METHODS
  // ========================================
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// Export singleton instance
module.exports = new ArcTaskRegistry();
