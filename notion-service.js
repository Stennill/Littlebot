/**
 * Notion Service - Read-only Notion helpers
 * Move/update operations disabled; only query support is used.
 */

const notionManager = require('./notion-manager');

const READ_ONLY_MESSAGE = 'Notion is configured for read-only access. I can only query your database, not move or update items.';

class NotionService {
  /**
   * Move all meetings from one date to another (DISABLED - read-only)
   */
  async moveMeetings(fromDate, toDate) {
    return { success: false, error: READ_ONLY_MESSAGE };
  }
  
  /**
   * Calculate date from natural language
   */
  calculateDate(word) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lower = word.toLowerCase().replace(/'s$/i, '');
    
    if (lower === 'today') {
      return this.formatDateISO(today);
    }
    
    if (lower === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.formatDateISO(tomorrow);
    }
    
    if (lower === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return this.formatDateISO(yesterday);
    }
    
    if (lower === 'next week') {
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return this.formatDateISO(nextWeek);
    }
    
    // Day names
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = days.indexOf(lower);
    
    if (dayIndex !== -1) {
      const currentDay = today.getDay();
      let daysToAdd = dayIndex - currentDay;
      
      if (daysToAdd <= 0) {
        daysToAdd += 7; // Next occurrence
      }
      
      const targetDay = new Date(today);
      targetDay.setDate(targetDay.getDate() + daysToAdd);
      return this.formatDateISO(targetDay);
    }
    
    return this.formatDateISO(today);
  }
  
  /**
   * Format date as ISO string (YYYY-MM-DD)
   */
  formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  /**
   * Format date for display
   */
  formatDate(isoDate) {
    const date = new Date(isoDate + 'T00:00:00');
    const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  /**
   * Move a specific item to a specific time (DISABLED - read-only)
   */
  async moveItemToTime(itemKeyword, targetTime, targetDate = null) {
    return { success: false, error: READ_ONLY_MESSAGE };
  }
}

module.exports = new NotionService();
