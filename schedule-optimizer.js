const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class ScheduleOptimizer {
  constructor() {
    this.checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    this.lastCheckedItems = new Set();
  }

  /**
   * Start the schedule optimizer service
   */
  start() {
    // Initial check after 1 minute
    setTimeout(() => this.optimizeSchedule(), 60 * 1000);
    
    // Then check every 2 minutes
    setInterval(() => this.optimizeSchedule(), this.checkInterval);
    
    console.log('[Schedule Optimizer] Started - checking for early completions every 2 minutes');
  }

  /**
   * Check for early task completions and optimize schedule
   */
  async optimizeSchedule() {
    if (!notionManager.isConfigured()) {
      return;
    }

    try {
      console.log('[Schedule Optimizer] Checking for optimization opportunities...');
      
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      
      if (!dateProp) {
        return;
      }

      const now = new Date();
      const todayKey = this.formatDateISO(now);

      // Get all processed items from today
      const processedItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Status',
            status: {
              equals: 'Processed'
            }
          },
          {
            property: dateProp.name,
            date: {
              on_or_after: todayKey
            }
          }
        ]
      });

      // Find early completions (tasks that ended before scheduled end time)
      const gaps = [];
      const titleProp = schema.properties.find(p => p.type === 'title');

      for (const item of processedItems) {
        const dateValue = item.properties[dateProp.name];
        if (!dateValue || typeof dateValue !== 'object' || !dateValue.start) {
          continue; // Skip items without dates
        }

        const startTime = dateValue.start;
        const endTime = dateValue.end;
        
        if (!startTime || !startTime.includes('T') || !endTime) {
          continue; // Skip date-only items or items without end times
        }

        // Check if this is a new processed item we haven't checked yet
        const itemId = item.id;
        if (this.lastCheckedItems.has(itemId)) {
          continue;
        }

        const scheduledStart = new Date(startTime);
        const scheduledEnd = new Date(endTime);

        // If current time is before scheduled end, we have a gap
        if (now < scheduledEnd && now > scheduledStart) {
          const gapStart = now;
          const gapEnd = scheduledEnd;
          const gapMinutes = Math.floor((gapEnd - gapStart) / (1000 * 60));

          if (gapMinutes >= 5) { // Only consider gaps of 5+ minutes
            const title = item.properties[titleProp.name] || 'Untitled';
            console.log(`   ⏱️ Gap detected: ${gapMinutes} min after completing "${title}"`);
            
            gaps.push({
              start: gapStart,
              end: gapEnd,
              minutes: gapMinutes,
              dateKey: todayKey
            });

            this.lastCheckedItems.add(itemId);
          }
        }
      }

      // For each gap, try to fill it with future tasks
      for (const gap of gaps) {
        await this.fillGap(gap, schema, dateProp, titleProp);
      }

      // Check for stale "Needs Review" items that are overdue
      await this.checkStaleReviews(schema, dateProp, titleProp);

      // Check for overlapping items in the schedule and resolve conflicts
      await this.resolveOverlaps(schema, dateProp, titleProp);

      // Clean up old tracked items (keep last 100)
      if (this.lastCheckedItems.size > 100) {
        const items = Array.from(this.lastCheckedItems);
        this.lastCheckedItems = new Set(items.slice(-50));
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error:', error.message);
    }
  }

  /**
   * Fill a time gap with tasks from future dates
   */
  async fillGap(gap, schema, dateProp, titleProp) {
    try {
      // Get current day's schedule to check for overlaps
      const todaySchedule = await this.getTodaySchedule(dateProp);
      
      // Get all upcoming unprocessed tasks with times
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowKey = this.formatDateISO(tomorrow);

      const upcomingTasks = await notionManager.queryDatabase({
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
              on_or_after: tomorrowKey
            }
          }
        ]
      });

      // Filter for tasks with times and sort by date
      const tasksWithTimes = upcomingTasks
        .filter(task => {
          const dateValue = task.properties[dateProp.name];
          const taskType = task.properties['Type'];
          const taskStatus = task.properties['Status'];
          
          // Exclude Break, PTO, and Upcoming Meetings from being moved
          if (taskType === 'Break' || taskType === 'PTO') {
            return false;
          }
          
          // Meetings can only be moved if they're not in "Upcoming" status
          if (taskType === 'Meeting' && taskStatus === 'Upcoming') {
            return false;
          }
          
          return dateValue && typeof dateValue === 'object' && 
                 dateValue.start && dateValue.start.includes('T');
        })
        .sort((a, b) => {
          const dateA = new Date(a.properties[dateProp.name].start);
          const dateB = new Date(b.properties[dateProp.name].start);
          return dateA - dateB;
        });

      // Try to find a task that fits in the gap
      for (const task of tasksWithTimes) {
        const dateValue = task.properties[dateProp.name];
        const duration = task.properties['Estimated Mintues'] || 30;

        // Check if task fits in the gap (with 5 min buffer)
        if (duration <= gap.minutes - 5) {
          const title = task.properties[titleProp.name] || 'Untitled';
          
          // Check if this time slot overlaps with existing tasks
          const proposedStart = gap.start;
          const proposedEnd = new Date(gap.start.getTime() + (duration * 60 * 1000));
          
          if (this.hasOverlap(todaySchedule, proposedStart, proposedEnd)) {
            console.log(`   ⚠️ Cannot move "${title}" - would overlap with existing task`);
            continue; // Try next task
          }
          
          // Move task to the gap
          const newStart = this.toESTDatetime(proposedStart);
          const newEnd = this.toESTDatetime(proposedEnd);

          const updateProps = {};
          updateProps[dateProp.name] = {
            type: 'date',
            date: {
              start: newStart,
              end: newEnd
            }
          };

          await notionManager.updatePage(task.id, updateProps);
          
          console.log(`   ✅ Moved "${title}" (${duration} min) to fill gap at ${this.formatTime(gap.start)}`);
          
          // Add to today's schedule to prevent future overlaps in this run
          todaySchedule.push({ start: proposedStart, end: proposedEnd });
          
          // Update gap for remaining time
          gap.start = new Date(gap.start.getTime() + (duration * 60 * 1000));
          gap.minutes = Math.floor((gap.end - gap.start) / (1000 * 60));

          // If gap is too small now, stop
          if (gap.minutes < 5) {
            break;
          }
        }
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error filling gap:', error.message);
    }
  }

  /**
   * Check for items that are overdue (15 minutes past end time) and not "Processed"
   */
  async checkStaleReviews(schema, dateProp, titleProp) {
    try {
      const now = new Date();

      // Get all items that are NOT "Processed"
      const reviewItems = await notionManager.queryDatabase({
        property: 'Status',
        status: {
          does_not_equal: 'Processed'
        }
      });

      const staleItems = [];

      for (const item of reviewItems) {
        const dateValue = item.properties[dateProp.name];
        const itemType = item.properties['Type'];
        const itemStatus = item.properties['Status'];
        
        // Skip Break, PTO, and Upcoming Meetings - they should not be moved
        if (itemType === 'Break' || itemType === 'PTO') {
          continue;
        }
        
        // Meetings can only be moved if they're not in "Upcoming" status
        if (itemType === 'Meeting' && itemStatus === 'Upcoming') {
          continue;
        }
        
        if (!dateValue || !dateValue.start || !dateValue.end) {
          continue; // Skip items without complete date/time
        }

        const endTime = new Date(dateValue.end);
        const hoursSinceEnd = (now - endTime) / (1000 * 60 * 60);

        // If more than 15 minutes past end time, needs to be moved up
        if (hoursSinceEnd >= 0.25) {
          const title = item.properties[titleProp.name] || 'Untitled';
          const duration = item.properties['Estimated Mintues'] || 30;

          console.log(`   ⚠️ Stale review: "${title}" is ${Math.floor(hoursSinceEnd)} hours overdue`);

          staleItems.push({
            item,
            title,
            duration,
            hoursSinceEnd
          });
        }
      }

      // Reschedule stale items to next available slot
      if (staleItems.length > 0) {
        // Get today's schedule
        const todaySchedule = await this.getTodaySchedule(dateProp);
        const movedItems = [];
        
        for (const stale of staleItems) {
          // Find next available slot that doesn't overlap
          const slot = this.findNextAvailableTime(todaySchedule, stale.duration);
          
          if (!slot) {
            console.log(`   ⚠️ No available slot found for "${stale.title}"`);
            continue;
          }

          const updateProps = {};
          updateProps[dateProp.name] = {
            type: 'date',
            date: {
              start: this.toESTDatetime(slot.start),
              end: this.toESTDatetime(slot.end)
            }
          };

          await notionManager.updatePage(stale.item.id, updateProps);
          console.log(`   ✅ Moved "${stale.title}" to ${this.formatTime(slot.start)} for urgent review`);
          
          // Track for batched Slack notification
          const dateTimeStr = this.formatDateTime(slot.start);
          movedItems.push({ title: stale.title, dateTimeStr });
          
          // Add to schedule to prevent overlaps in this run
          todaySchedule.push({ start: slot.start, end: slot.end });
        }
        
        // Post batched Slack message if items were moved
        if (slackService.isConfigured() && movedItems.length > 0) {
          let slackMessage = `*Moved ${movedItems.length} overdue item${movedItems.length !== 1 ? 's' : ''}:*`;
          movedItems.forEach(item => {
            slackMessage += `\n• ${item.title} → ${item.dateTimeStr}`;
          });
          await slackService.postMessage(slackMessage);
        }
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error checking stale reviews:', error.message);
    }
  }

  /**
   * Check for overlapping items and resolve conflicts
   */
  async resolveOverlaps(schema, dateProp, titleProp) {
    try {
      console.log('[Schedule Optimizer] Checking for overlapping items...');
      
      // Get all items with dates and times (not processed)
      const allItems = await notionManager.queryDatabase({
        and: [
          {
            property: dateProp.name,
            date: {
              is_not_empty: true
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          }
        ]
      });

      // Filter for items with time components and sort by start time
      const timedItems = allItems
        .filter(item => {
          const dateValue = item.properties[dateProp.name];
          const itemType = item.properties['Type'];
          const itemStatus = item.properties['Status'];
          
          // Exclude Break, PTO, and Upcoming Meetings from being moved
          if (itemType === 'Break' || itemType === 'PTO') {
            return false;
          }
          
          // Meetings can only be moved if they're not in "Upcoming" status
          if (itemType === 'Meeting' && itemStatus === 'Upcoming') {
            return false;
          }
          
          return dateValue && dateValue.start && dateValue.start.includes('T') && dateValue.end;
        })
        .map(item => ({
          id: item.id,
          title: item.properties[titleProp.name] || 'Untitled',
          start: new Date(item.properties[dateProp.name].start),
          end: new Date(item.properties[dateProp.name].end),
          duration: item.properties['Estimated Mintues'] || 30
        }))
        .sort((a, b) => a.start - b.start);

      const conflicts = [];
      
      // Check each item against all subsequent items for overlaps
      for (let i = 0; i < timedItems.length; i++) {
        for (let j = i + 1; j < timedItems.length; j++) {
          const item1 = timedItems[i];
          const item2 = timedItems[j];
          
          // Check if they overlap (start1 < end2 AND start2 < end1)
          if (item1.start < item2.end && item2.start < item1.end) {
            // Mark the later item as conflicting (needs to be moved)
            if (!conflicts.find(c => c.id === item2.id)) {
              console.log(`   ⚠️ Overlap detected: "${item2.title}" conflicts with "${item1.title}"`);
              conflicts.push(item2);
            }
          }
        }
      }

      if (conflicts.length === 0) {
        console.log('   ✅ No overlapping items found');
        return;
      }

      console.log(`   Found ${conflicts.length} conflicting item(s), resolving...`);

      // Get current schedule to find available slots
      const schedule = timedItems.map(item => ({ start: item.start, end: item.end }));
      const movedItems = [];

      // Resolve each conflict
      for (const conflict of conflicts) {
        // Remove this conflict from schedule before finding a new slot
        const conflictIndex = schedule.findIndex(s => 
          s.start.getTime() === conflict.start.getTime() && 
          s.end.getTime() === conflict.end.getTime()
        );
        if (conflictIndex !== -1) {
          schedule.splice(conflictIndex, 1);
        }

        // Find next available slot
        const slot = this.findNextAvailableTime(schedule, conflict.duration);
        
        if (!slot) {
          console.log(`   ⚠️ No available slot found for "${conflict.title}"`);
          continue;
        }

        // Update the item
        const updateProps = {};
        updateProps[dateProp.name] = {
          type: 'date',
          date: {
            start: this.toESTDatetime(slot.start),
            end: this.toESTDatetime(slot.end)
          }
        };

        await notionManager.updatePage(conflict.id, updateProps);
        const movedTimeStr = this.formatTime(slot.start);
        const movedDateTimeStr = this.formatDateTime(slot.start);
        console.log(`   ✅ Moved "${conflict.title}" to ${movedTimeStr} to resolve conflict`);
        
        // Track for batched Slack notification
        movedItems.push({ title: conflict.title, dateTimeStr: movedDateTimeStr });
        
        // Add to schedule to prevent future overlaps in this run
        schedule.push({ start: slot.start, end: slot.end });
      }
      
      // Post batched Slack message if items were moved
      if (slackService.isConfigured() && movedItems.length > 0) {
        let slackMessage = `*Resolved ${movedItems.length} overlap${movedItems.length !== 1 ? 's' : ''}:*`;
        movedItems.forEach(item => {
          slackMessage += `\n• ${item.title} → ${item.dateTimeStr}`;
        });
        await slackService.postMessage(slackMessage);
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error resolving overlaps:', error.message);
    }
  }

  /**
   * Extract end time from Notion date string
   */
  extractEndTime(dateStr) {
    // Notion format can be "2026-02-04T08:30:00.000-05:00" or have a separate end
    // For now, assume we need to calculate from start + duration
    // This will be populated from the date property's end field
    return dateStr; // Placeholder - will use actual end from Notion
  }

  /**
   * Get today's schedule (all tasks with start/end times)
   */
  async getTodaySchedule(dateProp) {
    const today = this.formatDateISO(new Date());
    
    const items = await notionManager.queryDatabase({
      and: [
        {
          property: dateProp.name,
          date: {
            equals: today
          }
        },
        {
          property: 'Status',
          status: {
            does_not_equal: 'Processed'
          }
        }
      ]
    });

    const schedule = [];
    for (const item of items) {
      const dateValue = item.properties[dateProp.name];
      if (dateValue && dateValue.start && dateValue.end) {
        schedule.push({
          start: new Date(dateValue.start),
          end: new Date(dateValue.end)
        });
      }
    }

    return schedule;
  }

  /**
   * Check if a time range overlaps with existing scheduled items
   */
  hasOverlap(schedule, proposedStart, proposedEnd) {
    for (const item of schedule) {
      // Check if ranges overlap
      // Overlap occurs if: (start1 < end2) AND (start2 < end1)
      if (proposedStart < item.end && item.start < proposedEnd) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find next available time slot that doesn't overlap
   * Searches across multiple days (up to 30 days) to find a suitable slot
   */
  findNextAvailableTime(schedule, durationMinutes) {
    const now = new Date();
    const workStart = 8; // 8 AM
    const workEnd = 16.5; // 4:30 PM
    const workDays = [1, 2, 3, 4, 5]; // Monday - Friday
    
    // Start from current time, round up to next 5-minute mark
    let checkTime = new Date(now);
    checkTime.setMinutes(Math.ceil(checkTime.getMinutes() / 5) * 5, 0, 0);
    
    // Check for next 30 days (similar to scheduler)
    const maxDays = 30;
    let daysChecked = 0;
    
    while (daysChecked < maxDays) {
      const dayOfWeek = checkTime.getDay();
      
      // Only check work days
      if (workDays.includes(dayOfWeek)) {
        // Get work start/end for this day
        const dayStart = new Date(checkTime);
        dayStart.setHours(workStart, 0, 0, 0);
        
        const dayEnd = new Date(checkTime);
        dayEnd.setHours(Math.floor(workEnd), (workEnd % 1) * 60, 0, 0);
        
        // If we're checking current day, start from current time
        let startTime = checkTime.getTime() > dayStart.getTime() ? checkTime : dayStart;
        
        // Check 5-minute intervals throughout the work day
        let slotTime = new Date(startTime);
        while (slotTime < dayEnd) {
          const proposedEnd = new Date(slotTime.getTime() + (durationMinutes * 60 * 1000));
          
          // Make sure task ends within work hours
          if (proposedEnd <= dayEnd) {
            // Check for overlaps
            if (!this.hasOverlap(schedule, slotTime, proposedEnd)) {
              return {
                start: slotTime,
                end: proposedEnd
              };
            }
          }
          
          // Move to next 5-minute slot
          slotTime = new Date(slotTime.getTime() + (5 * 60 * 1000));
        }
      }
      
      // Move to next day at work start time
      checkTime.setDate(checkTime.getDate() + 1);
      checkTime.setHours(workStart, 0, 0, 0);
      daysChecked++;
    }
    
    console.log('   ⚠️ No available slot found in next 30 days for duration:', durationMinutes, 'minutes');
    return null; // No available slot found
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
   * Format date as ISO string (YYYY-MM-DD)
   */
  formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Format time for display
   */
  formatTime(date) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Format date and time for display
   */
  formatDateTime(date) {
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}

module.exports = new ScheduleOptimizer();
