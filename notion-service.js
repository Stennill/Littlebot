/**
 * Notion Service - Direct Notion operations without AI
 * Handles meeting reschedules and other calendar operations
 */

const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class NotionService {
  /**
   * Move all meetings from one date to another
   */
  async moveMeetings(fromDate, toDate) {
    console.log(`\n🗓️  NOTION SERVICE: Moving meetings`);
    console.log(`   From: ${fromDate}`);
    console.log(`   To: ${toDate}`);
    
    try {
      // Get schema
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      
      if (!dateProp) {
        throw new Error('No date property found in database');
      }
      
      console.log(`   Using date property: "${dateProp.name}"`);
      
      // Query for all unprocessed meetings
      const filter = {
        and: [
          {
            property: 'Type',
            select: {
              equals: 'Meeting'
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
      
      console.log(`   Querying Notion...`);
      const allMeetings = await notionManager.queryDatabase(filter);
      console.log(`   Found ${allMeetings.length} total unprocessed meetings`);
      
      if (allMeetings.length > 0) {
        console.log(`\n   📋 RAW MEETING DATA FROM NOTION:`);
        allMeetings.forEach((m, i) => {
          console.log(`   Meeting ${i + 1}:`, JSON.stringify(m.properties, null, 2));
        });
        console.log('');
      }
      
      // Filter by source date
      const meetingsToMove = allMeetings.filter(meeting => {
        const meetingDate = meeting.properties[dateProp.name];
        const titleProp = schema.properties.find(p => p.type === 'title');
        const title = meeting.properties[titleProp.name] || 'Untitled';
        
        // Normalize date - handle new date object format
        const normalizedDate = (meetingDate && meetingDate.start) ? 
          meetingDate.start.split('T')[0] : null;
        
        console.log(`      📅 ${title}: ${meetingDate ? meetingDate.start : 'no date'} (normalized: ${normalizedDate})`);
        return normalizedDate === fromDate;
      });
      
      console.log(`   ✅ ${meetingsToMove.length} meeting(s) match date ${fromDate}`);
      
      if (meetingsToMove.length === 0) {
        return {
          success: true,
          count: 0,
          message: `No meetings found on ${this.formatDate(fromDate)}`
        };
      }
      
      // Update each meeting
      const updateProps = {};
      updateProps[dateProp.name] = {
        type: 'date',
        date: {
          start: toDate
        }
      };
      
      let updated = 0;
      const titleProp = schema.properties.find(p => p.type === 'title');
      
      for (const meeting of meetingsToMove) {
        const title = meeting.properties[titleProp.name] || 'Untitled';
        console.log(`   ⏩ Moving: ${title}`);
        await notionManager.updatePage(meeting.id, updateProps);
        updated++;
      }
      
      const message = `✅ Moved ${updated} meeting(s) from ${this.formatDate(fromDate)} to ${this.formatDate(toDate)}`;
      console.log(`   ${message}\n`);
      
      return {
        success: true,
        count: updated,
        message
      };
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
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
   * Move a specific item to a specific time
   * Handles overlap resolution by moving conflicting items
   */
  async moveItemToTime(itemKeyword, targetTime, targetDate = null) {
    console.log(`\n🎯 NOTION SERVICE: Moving item to specific time`);
    console.log(`   Item keyword: "${itemKeyword}"`);
    console.log(`   Target time: ${targetTime}`);
    console.log(`   Target date: ${targetDate || 'today'}`);
    
    try {
      const scheduleOptimizer = require('./schedule-optimizer');
      
      // Get schema
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      const titleProp = schema.properties.find(p => p.type === 'title');
      
      if (!dateProp || !titleProp) {
        throw new Error('Missing required properties in database');
      }
      
      // Calculate target date
      const dateISO = targetDate ? this.calculateDate(targetDate) : this.formatDateISO(new Date());
      
      // Parse target time (e.g., "1pm", "1:30pm", "13:00")
      const timeMatch = targetTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (!timeMatch) {
        throw new Error('Could not parse time. Use format like "1pm" or "1:30pm"');
      }
      
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const meridiem = timeMatch[3]?.toLowerCase();
      
      // Convert to 24-hour format
      if (meridiem === 'pm' && hours !== 12) {
        hours += 12;
      } else if (meridiem === 'am' && hours === 12) {
        hours = 0;
      }
      
      // Search for item by keyword in title on the target date
      console.log(`   Searching for items matching "${itemKeyword}" on ${dateISO}...`);
      const allItems = await notionManager.queryDatabase({
        property: dateProp.name,
        date: {
          on_or_after: dateISO
        }
      });
      
      const matchingItems = allItems.filter(item => {
        const title = item.properties[titleProp.name] || '';
        const itemDate = item.properties[dateProp.name];
        
        // Check if title matches and date is on the target date (not just after)
        const titleMatches = title.toLowerCase().includes(itemKeyword.toLowerCase());
        
        if (!titleMatches || !itemDate || !itemDate.start) {
          return false;
        }
        
        // Extract date part (YYYY-MM-DD) from the item's date
        const itemDateISO = itemDate.start.split('T')[0];
        return itemDateISO === dateISO;
      });
      
      console.log(`   Found ${matchingItems.length} matching item(s)`);
      
      if (matchingItems.length === 0) {
        return { success: false, error: `No items found matching "${itemKeyword}"` };
      }
      
      if (matchingItems.length > 1) {
        const titles = matchingItems.map(i => i.properties[titleProp.name]).join('", "');
        return { success: false, error: `Multiple items found: "${titles}". Please be more specific.` };
      }
      
      const item = matchingItems[0];
      const itemTitle = item.properties[titleProp.name];
      const duration = item.properties['Estimated Mintues'] || 30;
      
      console.log(`   Moving: "${itemTitle}"`);
      console.log(`   Duration: ${duration} minutes`);
      
      // Create target datetime in EST
      const targetStart = new Date(`${dateISO}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
      const targetEnd = new Date(targetStart.getTime() + (duration * 60 * 1000));
      
      console.log(`   Target slot: ${targetStart.toLocaleString()} - ${targetEnd.toLocaleString()}`);
      
      // Get today's schedule to check for overlaps
      const todaySchedule = await scheduleOptimizer.getTodaySchedule(dateProp);
      
      // Check if target time overlaps with existing items
      const overlaps = [];
      for (const scheduled of todaySchedule) {
        if (targetStart < scheduled.end && scheduled.start < targetEnd) {
          overlaps.push(scheduled);
        }
      }
      
      console.log(`   Found ${overlaps.length} overlapping item(s)`);
      
      // Move the item to target time
      const startEST = this.toESTDatetime(targetStart);
      const endEST = this.toESTDatetime(targetEnd);
      
      await notionManager.updatePage(item.id, {
        [dateProp.name]: {
          type: 'date',
          date: {
            start: startEST,
            end: endEST
          }
        }
      });
      
      console.log(`   ✅ Moved "${itemTitle}" to ${targetStart.toLocaleTimeString()}`);
      
      // Resolve overlaps by moving conflicting items
      if (overlaps.length > 0) {
        console.log(`   🔄 Resolving ${overlaps.length} overlap(s)...`);
        
        // Update schedule with the newly moved item
        const updatedSchedule = await scheduleOptimizer.getTodaySchedule(dateProp);
        const movedConflicts = [];
        
        for (const overlap of overlaps) {
          // Query to find the conflicting item
          const conflictItems = await notionManager.queryDatabase({
            and: [
              {
                property: dateProp.name,
                date: {
                  equals: overlap.start.toISOString().split('.')[0] + '.000-05:00'
                }
              }
            ]
          });
          
          for (const conflictItem of conflictItems) {
            const conflictTitle = conflictItem.properties[titleProp.name];
            const conflictDuration = conflictItem.properties['Estimated Mintues'] || 30;
            const conflictType = conflictItem.properties['Type'];
            const conflictStatus = conflictItem.properties['Status'];
            
            // Don't move protected items
            if (conflictType === 'Break' || conflictType === 'PTO' || 
                (conflictType === 'Meeting' && conflictStatus === 'Upcoming')) {
              console.log(`   ⚠️ Cannot move "${conflictTitle}" - protected type`);
              continue;
            }
            
            // Find next available slot
            const nextSlot = scheduleOptimizer.findNextAvailableTime(updatedSchedule, conflictDuration);
            
            if (nextSlot) {
              const newStartEST = this.toESTDatetime(nextSlot.start);
              const newEndEST = this.toESTDatetime(nextSlot.end);
              
              await notionManager.updatePage(conflictItem.id, {
                [dateProp.name]: {
                  type: 'date',
                  date: {
                    start: newStartEST,
                    end: newEndEST
                  }
                }
              });
              
              console.log(`   ✅ Moved conflicting "${conflictTitle}" to ${nextSlot.start.toLocaleTimeString()}`);
              
              // Track for batched Slack notification
              const dateTimeStr = nextSlot.start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
              movedConflicts.push({ title: conflictTitle, dateTimeStr });
              
              // Add to schedule to prevent cascading overlaps
              updatedSchedule.push({ start: nextSlot.start, end: nextSlot.end });
            } else {
              console.log(`   ⚠️ No available slot for "${conflictTitle}"`);
            }
          }
        }
      }
      
      const message = `✅ Moved "${itemTitle}" to ${targetStart.toLocaleTimeString()}${overlaps.length > 0 ? ` and resolved ${overlaps.length} conflict(s)` : ''}`;
      
      // Post to Slack if configured - batch all moves into one message
      if (slackService.isConfigured()) {
        const dateTimeStr = targetStart.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        let slackMessage = `*Moved* ${itemTitle} to ${dateTimeStr}`;
        
        if (movedConflicts.length > 0) {
          slackMessage += `\n\n*Resolved ${movedConflicts.length} conflict${movedConflicts.length !== 1 ? 's' : ''}:*`;
          movedConflicts.forEach(c => {
            slackMessage += `\n• ${c.title} → ${c.dateTimeStr}`;
          });
        }
        
        await slackService.postMessage(slackMessage);
      }
      
      return { success: true, message };
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Format datetime in EST/EDT timezone
   */
  toESTDatetime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    // Determine if DST is in effect
    const isDST = this.isDaylightSavingTime(date);
    const offset = isDST ? '-04:00' : '-05:00';
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.000${offset}`;
  }

  /**
   * Check if a date is in daylight saving time
   */
  isDaylightSavingTime(date) {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    return date.getTimezoneOffset() < stdOffset;
  }
}

module.exports = new NotionService();
