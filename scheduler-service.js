/**
 * Intelligent Task Scheduler for Notion
 * Auto-schedules unprocessed items into available time slots
 */

const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class SchedulerService {
  constructor() {
    // Work hours: Monday-Friday, 8:30 AM - 4:30 PM EST
    this.workStartHour = 8;
    this.workStartMinute = 30;
    this.workEndHour = 16;
    this.workEndMinute = 30;
    this.workDays = [1, 2, 3, 4, 5]; // Monday-Friday
  }

  /**
   * Main scheduling function - run periodically
   */
  async autoSchedule() {
    console.log('\n📅 SCHEDULER SERVICE: Auto-scheduling tasks...');
    
    try {
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      const typeProp = schema.properties.find(p => p.name === 'Type');
      const statusProp = schema.properties.find(p => p.name === 'Status');
      
      if (!dateProp || !typeProp || !statusProp) {
        console.log('   ⚠️  Missing required properties in database');
        return { success: false, error: 'Missing required properties' };
      }
      
      // Get all items that need scheduling (Status != Processed AND Status != "Needs Review" with old dates)
      const unprocessedItems = await notionManager.queryDatabase({
        or: [
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          },
          {
            property: 'Status',
            status: {
              equals: 'Needs Review'
            }
          }
        ]
      });
      
      console.log(`   Found ${unprocessedItems.length} unprocessed items`);
      
      // Items that need (re)scheduling - all unprocessed items regardless of date
      const tasks = unprocessedItems;
      
      // Separate items needing times from items that are date-only
      const titleProp = schema.properties.find(p => p.type === 'title');
      const needsTime = [];
      const needsReschedule = [];
      const projectsToMove = [];
      
      tasks.forEach(item => {
        const itemDate = item.properties[dateProp.name];
        const itemType = item.properties['Type'];
        const title = item.properties[titleProp.name] || 'Untitled';
        
        // Projects only need dates, not times - move to current day if not already today
        if (itemType === 'Project') {
          // Check if project already has today's date
          const today = this.formatDateISO(new Date());
          if (itemDate && itemDate.start) {
            const projectDate = itemDate.start.split('T')[0]; // Get just the date part
            if (projectDate !== today) {
              projectsToMove.push(item);
            }
          } else {
            // No date at all, needs to be moved to today
            projectsToMove.push(item);
          }
          return;
        }
        
        if (itemDate && itemDate.start) {
          // Has a date - check if it has a time component
          if (!itemDate.start.includes('T')) {
            console.log(`   🕐 ${title}: Has date but no time`);
            needsTime.push(item);
          }
        } else {
          // No date at all
          needsReschedule.push(item);
        }
      });
      
      console.log(`   ${needsReschedule.length} items need full scheduling`);
      console.log(`   ${needsTime.length} items need time added to existing date`);
      console.log(`   ${projectsToMove.length} projects to move to current day`);
      
      if (tasks.length === 0) {
        return { success: true, scheduled: 0, message: 'No items to schedule' };
      }
      
      // Get current schedule (all dated items)
      const scheduledItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          },
          {
            property: dateProp.name,
            date: {
              is_not_empty: true
            }
          }
        ]
      });
      
      console.log(`   ${scheduledItems.length} items already scheduled`);
      
      // Build schedule map
      const schedule = this.buildScheduleMap(scheduledItems, dateProp, schema);
      
      let scheduled = 0;
      const scheduledDetails = []; // Track scheduled items for notification
      
      // First, process items that need times added to existing dates
      console.log(`\n   🕐 Adding times to ${needsTime.length} date-only items...`);
      for (const item of needsTime) {
        const title = item.properties[titleProp.name] || 'Untitled';
        const existingDateObj = item.properties[dateProp.name];
        const existingDate = existingDateObj.start; // "2026-02-04"
        const duration = item.properties['Estimated Mintues'] || 30;
        const itemType = item.properties['Type'];
        
        console.log(`\n   📋 ${title} (${existingDate})`);
        
        // Get schedule for this specific date
        const dateKey = existingDate;
        const dateSchedule = schedule[dateKey] || { isPTO: false, tasks: [] };
        
        // Check if date is in the past or a weekend/PTO
        const targetDate = new Date(existingDate);
        const now = new Date();
        const dayOfWeek = targetDate.getDay();
        
        let slot = null;
        
        if (targetDate >= now && !dateSchedule.isPTO && this.workDays.includes(dayOfWeek)) {
          // Try to find a time slot on the existing date
          slot = this.findTimeSlotOnDay(targetDate, dateSchedule, duration);
        }
        
        if (slot) {
          // Update with time on existing date
          const updateProps = {};
          const endDatetime = this.calculateEndTime(slot.datetime, duration);
          updateProps[dateProp.name] = { type: 'date', date: { start: slot.datetime, end: endDatetime } };
          
          // Only set status if item doesn't already have one
          const currentStatus = item.properties['Status'];
          if (!currentStatus || currentStatus === 'Unprocessed') {
            updateProps['Status'] = { type: 'status', status: { name: 'Needs Review' } };
          }
          
          await notionManager.updatePage(item.id, updateProps);
          
          // Add to schedule map
          this.addToSchedule(schedule, dateKey, slot.datetime, duration);
          
          console.log(`      ✅ Added time: ${slot.display}`);
          scheduled++;
        } else {
          // Date is full, past, or unavailable - find next available slot
          console.log(`      ⚠️ ${existingDate} unavailable, finding new slot...`);
          const newSlot = this.findNextAvailableSlot(schedule, itemType, duration);
          
          if (newSlot) {
            const updateProps = {};
            const endDatetime = this.calculateEndTime(newSlot.datetime, duration);
            updateProps[dateProp.name] = { type: 'date', date: { start: newSlot.datetime, end: endDatetime } };
            
            // Only set status if item doesn't already have one
            const currentStatus = item.properties['Status'];
            if (!currentStatus || currentStatus === 'Unprocessed') {
              updateProps['Status'] = { type: 'status', status: { name: 'Needs Review' } };
            }
            
            await notionManager.updatePage(item.id, updateProps);
            
            // Add to schedule
            const newDateKey = newSlot.datetime.split('T')[0];
            this.addToSchedule(schedule, newDateKey, newSlot.datetime, duration);
            
            console.log(`      ✅ Rescheduled to: ${newSlot.display}`);
            scheduledDetails.push(`${title} at ${newSlot.display}`);
            scheduled++;
          } else {
            console.log(`      ❌ No available slots found`);
          }
        }
      }
      
      // Now schedule items that need full reschedule (no date at all)
      console.log(`\n   📅 Scheduling ${needsReschedule.length} items with no dates...`);
      for (const task of needsReschedule) {
        const title = task.properties[titleProp.name] || 'Untitled';
        const taskType = task.properties['Type'];
        const estimatedMinutes = task.properties['Estimated Mintues'] || 30; // Default 30 min
        
        console.log(`\n   📋 Scheduling: ${title}`);
        console.log(`      Type: ${taskType}, Duration: ${estimatedMinutes} minutes`);
        
        const slot = this.findNextAvailableSlot(schedule, taskType, estimatedMinutes);
        
        if (slot) {
          // Update the task with the assigned date/time
          const updateProps = {};
          const endDatetime = this.calculateEndTime(slot.datetime, estimatedMinutes);
          updateProps[dateProp.name] = {
            type: 'date',
            date: {
              start: slot.datetime,
              end: endDatetime
            }
          };
          
          // Only set status to "Needs Review" if item doesn't already have one
          const currentStatus = task.properties['Status'];
          if (!currentStatus || currentStatus === 'Unprocessed') {
            updateProps['Status'] = {
              type: 'status',
              status: {
                name: 'Needs Review'
              }
            };
          }
          
          await notionManager.updatePage(task.id, updateProps);
          console.log(`      ✅ Scheduled for ${slot.display}`);
          if (updateProps['Status']) {
            console.log(`      📌 Status set to "Needs Review"`);
          }
          // Add to schedule map
          this.addToSchedule(schedule, slot.date, slot.datetime, estimatedMinutes);
          scheduledDetails.push(`${title} at ${slot.display}`);
          scheduled++;
        } else {
          console.log(`      ⚠️  No available slot found`);
        }
      }
      
      // Finally, move Projects to current day (date-only, no time)
      console.log(`\n   📁 Moving ${projectsToMove.length} projects to current day...`);
      const today = this.formatDateISO(new Date());
      for (const project of projectsToMove) {
        const title = project.properties[titleProp.name] || 'Untitled';
        
        console.log(`\n   📋 Project: ${title}`);
        
        const updateProps = {};
        updateProps[dateProp.name] = {
          type: 'date',
          date: {
            start: today
          }
        };
        
        await notionManager.updatePage(project.id, updateProps);
        console.log(`      ✅ Moved to ${today}`);
        scheduled++;
      }
      
      console.log(`\n   ✅ Auto-scheduling complete: ${scheduled} items scheduled\n`);
      
      // Post to Slack if configured
      if (slackService.isConfigured() && scheduled > 0) {
        await slackService.postScheduledTasks(scheduled, scheduledDetails);
      }
      
      return {
        success: true,
        scheduled,
        message: `Scheduled ${scheduled} item(s)`
      };
      
    } catch (error) {
      console.error('   ❌ Scheduler error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build a map of scheduled items by date
   */
  buildScheduleMap(items, dateProp, schema) {
    const schedule = {};
    
    items.forEach(item => {
      const dateValue = item.properties[dateProp.name];
      if (!dateValue || !dateValue.start) return;
      
      const startTime = dateValue.start;
      const date = startTime.split('T')[0]; // Get YYYY-MM-DD
      const type = item.properties['Type'];
      const minutes = item.properties['Estimated Mintues'] || 30;
      
      if (!schedule[date]) {
        schedule[date] = {
          isPTO: false,
          tasks: []
        };
      }
      
      // Mark PTO days
      if (type === 'PTO') {
        schedule[date].isPTO = true;
      }
      
      // Add task with time slot
      schedule[date].tasks.push({
        datetime: startTime,
        duration: minutes,
        type: type
      });
    });
    
    return schedule;
  }

  /**
   * Find next available time slot
   */
  findNextAvailableSlot(schedule, taskType, durationMinutes) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check next 30 days
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() + i);
      
      const dayOfWeek = checkDate.getDay();
      
      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      const dateKey = this.formatDateISO(checkDate);
      const daySchedule = schedule[dateKey] || { isPTO: false, tasks: [] };
      
      // Skip PTO days
      if (daySchedule.isPTO) continue;
      
      // For Project types, just need a date
      if (taskType === 'Project') {
        return {
          date: dateKey,
          datetime: dateKey,
          display: this.formatDate(dateKey)
        };
      }
      
      // For other types, find specific time slot
      const slot = this.findTimeSlotOnDay(checkDate, daySchedule, durationMinutes);
      if (slot) {
        return slot;
      }
      
      // Handle Friday rollover: if it's Friday, continue to Monday/Tuesday
      if (dayOfWeek === 5) {
        continue; // Will naturally check Monday next
      }
    }
    
    return null;
  }

  /**
   * Find available time slot on a specific day
   */
  findTimeSlotOnDay(date, daySchedule, durationMinutes) {
    const dateKey = this.formatDateISO(date);
    
    // Sort existing tasks by time
    const sortedTasks = daySchedule.tasks
      .filter(t => t.datetime.includes('T')) // Only timed tasks
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
    
    // Check from work start
    let currentTime = new Date(date);
    currentTime.setHours(this.workStartHour, this.workStartMinute, 0, 0);
    
    const workEndTime = new Date(date);
    workEndTime.setHours(this.workEndHour, this.workEndMinute, 0, 0);
    
    // Check each potential slot
    for (const task of sortedTasks) {
      const taskStart = new Date(task.datetime);
      
      // If there's a gap before this task
      const gapMinutes = (taskStart - currentTime) / (1000 * 60);
      
      if (gapMinutes >= durationMinutes) {
        // Found a slot!
        return {
          date: dateKey,
          datetime: this.toESTDatetime(currentTime),
          display: this.formatDateTime(currentTime)
        };
      }
      
      // Move past this task (with 10-minute buffer)
      currentTime = new Date(taskStart);
      currentTime.setMinutes(currentTime.getMinutes() + task.duration + 10);
    }
    
    // Check if there's time at the end of the day
    const remainingMinutes = (workEndTime - currentTime) / (1000 * 60);
    
    if (remainingMinutes >= durationMinutes) {
      return {
        date: dateKey,
        datetime: this.toESTDatetime(currentTime),
        display: this.formatDateTime(currentTime)
      };
    }
    
    return null;
  }

  /**
   * Add scheduled item to schedule map
   */
  addToSchedule(schedule, dateKey, datetime, durationMinutes) {
    if (!schedule[dateKey]) {
      schedule[dateKey] = { isPTO: false, tasks: [] };
    }
    
    schedule[dateKey].tasks.push({
      datetime: datetime,
      duration: durationMinutes,
      type: 'scheduled'
    });
  }

  /**
   * Format datetime in EST/EDT timezone (ISO 8601 format)
   */
  toESTDatetime(date) {
    // Format: YYYY-MM-DDTHH:MM:SS.000-05:00 (EST) or -04:00 (EDT)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    // Determine if DST is in effect (rough approximation)
    // DST: Second Sunday in March to First Sunday in November
    const isDST = this.isDaylightSavingTime(date);
    const offset = isDST ? '-04:00' : '-05:00';
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.000${offset}`;
  }

  /**
   * Check if date is in Daylight Saving Time
   */
  isDaylightSavingTime(date) {
    const year = date.getFullYear();
    const jan = new Date(year, 0, 1).getTimezoneOffset();
    const jul = new Date(year, 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) !== date.getTimezoneOffset();
  }

  /**
   * Calculate end time based on start time and duration
   */
  calculateEndTime(startDatetime, durationMinutes) {
    const startDate = new Date(startDatetime);
    const endDate = new Date(startDate.getTime() + (durationMinutes * 60 * 1000));
    return this.toESTDatetime(endDate);
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
   * Format datetime for display
   */
  formatDateTime(date) {
    const options = { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    };
    return date.toLocaleDateString('en-US', options);
  }
}

module.exports = new SchedulerService();
