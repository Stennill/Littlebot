/**
 * Direct Notion Command Parser
 * Handles simple Notion operations without AI
 */

const notionManager = require('./notion-manager');

/**
 * Parse and execute Notion commands directly
 * Returns null if not a Notion command, otherwise returns result message
 */
async function parseNotionCommand(input) {
  const lower = input.toLowerCase().trim();
  
  // Pattern: "move [item name] (from [old date]) to [new date]"
  // More flexible - extracts item name intelligently
  const movePattern = /move\s+(.+?)\s+(?:from\s+(?:yesterday|today|tomorrow|last\s+\w+|next\s+\w+|\w+day)\s+)?to\s+(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
  const match = input.match(movePattern);
  
  if (match) {
    let itemName = match[1].trim();
    const dateWord = match[2];
    
    // Clean up item name - remove date qualifiers
    const dateQualifiers = ['from yesterday', 'from today', 'from tomorrow', 'for yesterday', 'for today', 'for tomorrow'];
    dateQualifiers.forEach(qualifier => {
      itemName = itemName.replace(new RegExp(qualifier, 'gi'), '').trim();
    });
    
    // Remove common noise words at the end
    itemName = itemName.replace(/\s+(meeting|task|event|item)$/i, '');
    
    console.log('   📝 Extracted item name:', itemName);
    
    // Calculate target date
    const targetDate = calculateDate(dateWord);
    
    try {
      // Get schema to find property names
      const schema = await notionManager.getDatabaseSchema();
      const titleProp = schema.properties.find(p => p.type === 'title');
      const dateProp = schema.properties.find(p => p.type === 'date');
      
      if (!titleProp || !dateProp) {
        return `Error: Could not find title or date properties in database`;
      }
      
      // Query for the item - just search by name, ignore dates
      const filter = {
        and: [
          {
            property: titleProp.name,
            title: {
              contains: itemName
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          }
        ]
      };
      
      const results = await notionManager.queryDatabase(filter);
      
      if (results.length === 0) {
        return `Could not find "${itemName}" in your Notion database`;
      }
      
      if (results.length > 1) {
        const list = results.map(r => `- ${r.properties[titleProp.name]}`).join('\n');
        return `Found multiple matches:\n${list}\n\nPlease be more specific.`;
      }
      
      // Update the item
      const page = results[0];
      const updateProps = {};
      updateProps[dateProp.name] = {
        type: 'date',
        date: {
          start: targetDate
        }
      };
      
      await notionManager.updatePage(page.id, updateProps);
      
      const itemTitle = page.properties[titleProp.name];
      return `✅ Moved "${itemTitle}" to ${formatDate(targetDate)}`;
      
    } catch (err) {
      console.error('Notion command error:', err);
      return `Error updating Notion: ${err.message}`;
    }
  }
  
  // Not a recognized Notion command
  return null;
}

/**
 * Calculate date from natural language
 */
function calculateDate(word) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const lower = word.toLowerCase();
  
  if (lower === 'today') {
    return formatDateISO(today);
  }
  
  if (lower === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateISO(tomorrow);
  }
  
  if (lower === 'next week') {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return formatDateISO(nextWeek);
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
    return formatDateISO(targetDay);
  }
  
  return formatDateISO(today);
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date for display
 */
function formatDate(isoDate) {
  const date = new Date(isoDate + 'T00:00:00');
  const options = { month: 'long', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

module.exports = {
  parseNotionCommand
};
