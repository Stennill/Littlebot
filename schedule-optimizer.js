const notionManager = require('./notion-manager');
const slackService = require('./slack-service');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class ScheduleOptimizer {
  constructor() {
    this.checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    this.lastCheckedItems = new Set();
  }

  /**
   * Generate a conversational message using Claude
   */
  async generateClaudeMessage(context, data) {
    try {
      const configPath = path.join(app.getPath('userData'), 'littlebot-config.json');
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      if (!config.anthropicKey) {
        console.log('[Schedule Optimizer] No Anthropic key configured, using simple message');
        return null;
      }

      const prompt = context === 'overlap_resolution' 
        ? `You are Arc. Write a SHORT Slack notification (NOT AN EMAIL). Items moved:\n\n${data.items.map(i => `• ${i.title} → ${i.dateTimeStr}`).join('\n')}\n\nRULES:\n- NO greetings ("Hey there", "I hope this finds you well")\n- NO sign-offs ("- Arc", "Best regards", "Cheers")\n- NO "I wanted to let you know"\n- Just state what you did directly\n- Max 1-2 sentences\n\nExample: "Sorted out those overlapping events, Sir." or "Moved a few conflicting items around."`
        : context === 'gap_filled'
        ? `You are Arc. Write a SHORT Slack notification (NOT AN EMAIL). Item: "${data.title}" moved to ${data.time}.\n\nRULES:\n- NO greetings or sign-offs\n- NO "I wanted to let you know"\n- Just state the fact\n- Max 1 sentence\n\nExample: "Moved that task to ${data.time}, Sir."`
        : context === 'stale_review'
        ? `You are Arc. Write a SHORT Slack notification (NOT AN EMAIL). Item: "${data.title}" rescheduled to ${data.time}.\n\nRULES:\n- NO greetings or sign-offs\n- NO "I hope" or "I wanted to"\n- Just state what you did\n- Max 1 sentence\n\nExample: "Rescheduled that overdue review to ${data.time}, Sir."`
        : context === 'conflict_resolution'
        ? `You are Arc. Write a SHORT Slack notification (NOT AN EMAIL). Items moved:\n\n${data.items.map(i => `• ${i.title} → ${i.newDate}`).join('\n')}\n\nRULES:\n- NO "Hey there", "I hope this finds you well", or ANY greetings\n- NO "- Arc", "Best regards", "Cheers", or ANY sign-offs\n- NO "I wanted to let you know" or "just wanted to"\n- Just state what you did, period\n- Max 1-2 sentences\n\nExample: "Caught a few scheduling conflicts and sorted them out, Sir." or "Fixed those overlapping events."`
        : null;

      if (!prompt) return null;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',  // Always use Haiku 3 for cost efficiency
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        console.error('[Schedule Optimizer] Claude API error:', response.status);
        return null;
      }

      const result = await response.json();
      const message = result.content?.[0]?.text?.trim();
      return message || null;

    } catch (error) {
      console.error('[Schedule Optimizer] Error generating Claude message:', error.message);
      return null;
    }
  }

  /**
   * Start the schedule optimizer service
   */
  start() {
    // Initial conflict check after 30 seconds
    setTimeout(() => this.checkScheduleConflicts(), 30 * 1000);
    
    // Initial optimize check after 1 minute
    setTimeout(() => this.optimizeSchedule(), 60 * 1000);
    
    // Check for conflicts every 30 minutes
    setInterval(() => this.checkScheduleConflicts(), 30 * 60 * 1000);
    
    // Check for optimization every 2 minutes
    setInterval(() => this.optimizeSchedule(), this.checkInterval);
    
    console.log('[Schedule Optimizer] Started - checking for conflicts every 30 min, optimizations every 2 min');
  }

  /**
   * Verify that an item was actually moved by re-querying Notion
   */
  async verifyMove(pageId, expectedDate, datePropName) {
    try {
      const page = await notionManager.getPage(pageId);
      if (!page || !page.properties) {
        console.log(`   ⚠️ Verification failed: Could not retrieve page ${pageId}`);
        return false;
      }

      const dateProp = page.properties[datePropName];
      if (!dateProp || !dateProp.date || !dateProp.date.start) {
        console.log(`   ⚠️ Verification failed: No date found for page ${pageId}`);
        return false;
      }

      const actualDate = new Date(dateProp.date.start);
      const expected = new Date(expectedDate);
      
      // Compare dates (allow 1 minute tolerance for processing time)
      const timeDiff = Math.abs(actualDate.getTime() - expected.getTime());
      const isVerified = timeDiff < 60000; // 1 minute tolerance
      
      if (!isVerified) {
        console.log(`   ⚠️ Verification failed: Expected ${expected.toISOString()}, got ${actualDate.toISOString()}`);
      } else {
        console.log(`   ✓ Verified move for page ${pageId}`);
      }
      
      return isVerified;
    } catch (error) {
      console.error(`   ⚠️ Verification error for page ${pageId}:`, error.message);
      return false;
    }
  }

  /**
   * Get default duration for an item based on its type
   * Tasks without estimated time can be as short as 10 mins
   */
  getDefaultDuration(itemType, estimatedMinutes) {
    // If there's an estimated time, always use it
    if (estimatedMinutes) {
      return estimatedMinutes;
    }
    
    // Default durations based on type
    if (itemType === 'Task') {
      return 10; // Tasks can be quick if no estimate
    } else if (itemType === 'Break') {
      return 15; // Standard break
    } else if (itemType === 'Meeting') {
      return 30; // Standard meeting
    }
    
    return 30; // Default for other types
  }

  /**
   * Check if an item can be moved based on its status and scheduled date
   * "Upcoming" items can only be moved if they're on current date or past
   */
  canItemBeMoved(itemStatus, itemDate) {
    // If status is "Upcoming", check if date is today or earlier
    if (itemStatus === 'Upcoming') {
      const itemDateOnly = new Date(itemDate);
      itemDateOnly.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Only allow moving if item is today or in the past
      return itemDateOnly <= today;
    }
    
    // Other statuses can be moved freely (unless they're protected types)
    return true;
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
            property: 'Status',
            status: {
              does_not_equal: 'Resolved'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Not Started'
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
          
          // Exclude Break, PTO, and Meeting from being moved
          if (taskType === 'Break' || taskType === 'PTO' || taskType === 'Meeting') {
            return false;
          }
          
          // Check if this item can be moved based on its status and date
          if (!this.canItemBeMoved(taskStatus, dateValue?.start)) {
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
        const taskType = task.properties['Type'] || 'Task';
        const duration = this.getDefaultDuration(taskType, task.properties['Estimated Mintues']);
        const bufferTime = this.getBufferTime(); // 15 min mental break

        // Check if task fits in the gap WITH buffer time
        const requiredMinutes = duration + bufferTime;
        if (requiredMinutes <= gap.minutes) {
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
          
          console.log(`   ✅ Moved "${title}" (${duration} min + ${bufferTime} min buffer) to fill gap at ${this.formatTime(gap.start)}`);
          
          // Send Slack notification with Claude
          if (slackService.isConfigured()) {
            const claudeMessage = await this.generateClaudeMessage('gap_filled', { 
              title: title, 
              time: this.formatDateTime(proposedStart) 
            });
            if (claudeMessage) {
              await slackService.postMessage(claudeMessage);
            }
          }
          
          // Add to today's schedule to prevent future overlaps in this run
          todaySchedule.push({ start: proposedStart, end: proposedEnd });
          
          // Update gap - account for task duration + buffer time
          gap.start = new Date(gap.start.getTime() + (requiredMinutes * 60 * 1000));
          gap.minutes = Math.floor((gap.end - gap.start) / (1000 * 60));

          // If gap is too small now (can't fit another task + buffer), stop
          if (gap.minutes < (10 + bufferTime)) {
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

      // Get all items that are NOT "Processed", "Resolved", or "Not Started"
      const reviewItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Resolved'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Not Started'
            }
          }
        ]
      });

      const staleItems = [];

      for (const item of reviewItems) {
        const dateValue = item.properties[dateProp.name];
        const itemType = item.properties['Type'];
        const itemStatus = item.properties['Status'];
        
        // Skip Break, PTO, and Meeting - they should not be moved
        if (itemType === 'Break' || itemType === 'PTO' || itemType === 'Meeting') {
          continue;
        }
        
        // Check if this item can be moved based on its status and date
        if (!this.canItemBeMoved(itemStatus, dateValue?.start)) {
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
          const itemType = item.properties['Type'] || 'Task';
          const duration = this.getDefaultDuration(itemType, item.properties['Estimated Mintues']);

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
        // CRITICAL: Get PTO days to avoid scheduling on them
        const ptoItems = await notionManager.queryDatabase({
          property: 'Type',
          select: {
            equals: 'PTO'
          }
        });
        
        const ptoDays = new Set();
        ptoItems.forEach(item => {
          const dateValue = item.properties[dateProp.name];
          if (dateValue && dateValue.start) {
            ptoDays.add(dateValue.start.split('T')[0]);
          }
        });
        
        // Get today's schedule
        const todaySchedule = await this.getTodaySchedule(dateProp);
        const movedItems = [];
        
        for (const stale of staleItems) {
          // Find next available slot that doesn't overlap (and avoid PTO)
          const slot = this.findNextAvailableTime(todaySchedule, stale.duration, ptoDays);
          
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
          
          // Verify the move before adding to announcement list
          const verified = await this.verifyMove(stale.item.id, slot.start, dateProp.name);
          if (verified) {
            console.log(`   ✅ Moved "${stale.title}" to ${this.formatTime(slot.start)} for urgent review`);
            movedItems.push({ title: stale.title, dateTimeStr: this.formatDateTime(slot.start) });
          } else {
            console.log(`   ❌ Failed to verify move for "${stale.title}" - will not announce`);
          }
          
          // Add to schedule to prevent overlaps in this run
          todaySchedule.push({ start: slot.start, end: slot.end });
        }
        
        // Post batched Slack message if items were moved
        if (slackService.isConfigured() && movedItems.length > 0) {
          let slackMessage = movedItems.length === 1
            ? `I took the liberty of rescheduling that overdue review, Sir:\n• ${movedItems[0].title} → ${movedItems[0].dateTimeStr}`
            : `I've rescheduled ${movedItems.length} overdue reviews for you, Sir:\n${movedItems.map(item => `• ${item.title} → ${item.dateTimeStr}`).join('\n')}`;
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
      
      // Get all items with dates and times (not processed, resolved, or not started)
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
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Resolved'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Not Started'
            }
          }
        ]
      });
      
      // CRITICAL: Get ALL PTO items regardless of status
      const ptoItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Type',
            select: {
              equals: 'PTO'
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
      
      // Build PTO days Set
      const ptoDays = new Set();
      ptoItems.forEach(item => {
        const dateValue = item.properties[dateProp.name];
        if (dateValue && dateValue.start) {
          const ptoDate = dateValue.start.split('T')[0];
          ptoDays.add(ptoDate);
          console.log(`   🏖️  PTO Day blocked: ${ptoDate}`);
        }
      });

      // Filter for items with time components and sort by start time
      const timedItems = allItems
        .filter(item => {
          const dateValue = item.properties[dateProp.name];
          const itemType = item.properties['Type'];
          const itemStatus = item.properties['Status'];
          
          // Exclude Break, PTO, and Meeting from being moved
          if (itemType === 'Break' || itemType === 'PTO' || itemType === 'Meeting') {
            return false;
          }
          
          // Check if this item can be moved based on its status and date
          if (!this.canItemBeMoved(itemStatus, dateValue?.start)) {
            return false;
          }
          
          return dateValue && dateValue.start && dateValue.start.includes('T') && dateValue.end;
        })
        .map(item => {
          const itemType = item.properties['Type'] || 'Task';
          return {
            id: item.id,
            title: item.properties[titleProp.name] || 'Untitled',
            start: new Date(item.properties[dateProp.name].start),
            end: new Date(item.properties[dateProp.name].end),
            duration: this.getDefaultDuration(itemType, item.properties['Estimated Mintues'])
          };
        })
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

        // Find next available slot (avoid PTO days)
        const slot = this.findNextAvailableTime(schedule, conflict.duration, ptoDays);
        
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
        
        // Verify the move before adding to announcement list
        const verified = await this.verifyMove(conflict.id, slot.start, dateProp.name);
        if (verified) {
          console.log(`   ✅ Moved "${conflict.title}" to ${movedTimeStr} to resolve conflict`);
          // Track for batched Slack notification
          movedItems.push({ title: conflict.title, dateTimeStr: movedDateTimeStr });
        } else {
          console.log(`   ❌ Failed to verify move for "${conflict.title}" - will not announce`);
        }
        
        // Add to schedule to prevent future overlaps in this run
        schedule.push({ start: slot.start, end: slot.end });
      }
      
      // Post batched Slack message if items were moved
      if (slackService.isConfigured() && movedItems.length > 0) {
        // Try to generate a conversational message with Claude
        const claudeMessage = await this.generateClaudeMessage('overlap_resolution', { items: movedItems });
        
        let slackMessage;
        if (claudeMessage) {
          // Use Claude's conversational message
          slackMessage = claudeMessage;
        } else {
          // Fallback to template
          slackMessage = movedItems.length === 1 
            ? `I've adjusted your schedule to prevent a conflict, Sir:\n• ${movedItems[0].title} → ${movedItems[0].dateTimeStr}`
            : `I've sorted out ${movedItems.length} scheduling conflicts for you, Sir:\n${movedItems.map(item => `• ${item.title} → ${item.dateTimeStr}`).join('\n')}`;
        }
        
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
        },
        {
          property: 'Status',
          status: {
            does_not_equal: 'Resolved'
          }
        },
        {
          property: 'Status',
          status: {
            does_not_equal: 'Not Started'
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
  findNextAvailableTime(schedule, durationMinutes, ptoDays = new Set()) {
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
      const dateKey = this.formatDateISO(checkTime);
      
      // Skip weekends
      if (!workDays.includes(dayOfWeek)) {
        checkTime.setDate(checkTime.getDate() + 1);
        checkTime.setHours(workStart, 0, 0, 0);
        daysChecked++;
        continue;
      }
      
      // CRITICAL: Skip PTO days
      if (ptoDays.has(dateKey)) {
        console.log(`   🏖️  Skipping PTO day: ${dateKey}`);
        checkTime.setDate(checkTime.getDate() + 1);
        checkTime.setHours(workStart, 0, 0, 0);
        daysChecked++;
        continue;
      }
      
      // Only check work days (this is now redundant but kept for clarity)
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
   * Check for scheduling conflicts in the next 2 weeks and auto-fix them
   */
  async checkScheduleConflicts() {
    if (!notionManager.isConfigured()) {
      return;
    }

    try {
      console.log('\n🔍 [Conflict Checker] Scanning schedule for next 2 weeks...');
      
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      const titleProp = schema.properties.find(p => p.type === 'title');
      
      if (!dateProp || !titleProp) {
        console.log('[Conflict Checker] Missing required properties');
        return;
      }

      // Get all unprocessed items for next 2 weeks
      const today = new Date();
      const twoWeeksLater = new Date();
      twoWeeksLater.setDate(today.getDate() + 14);
      
      const todayISO = this.formatDateISO(today);
      const endISO = this.formatDateISO(twoWeeksLater);

      const allItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Status',
            status: {
              does_not_equal: 'Processed'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Resolved'
            }
          },
          {
            property: 'Status',
            status: {
              does_not_equal: 'Not Started'
            }
          },
          {
            property: dateProp.name,
            date: {
              on_or_after: todayISO
            }
          },
          {
            property: dateProp.name,
            date: {
              on_or_before: endISO
            }
          }
        ]
      });
      
      // CRITICAL: Also get ALL PTO items regardless of status
      // PTO days must ALWAYS be blocked even if the PTO item is processed
      const ptoItems = await notionManager.queryDatabase({
        and: [
          {
            property: 'Type',
            select: {
              equals: 'PTO'
            }
          },
          {
            property: dateProp.name,
            date: {
              on_or_after: todayISO
            }
          },
          {
            property: dateProp.name,
            date: {
              on_or_before: endISO
            }
          }
        ]
      });
      
      console.log(`   Found ${allItems.length} unprocessed items and ${ptoItems.length} PTO days`);
      
      // Combine allItems with PTO items (avoid duplicates)
      const allItemsIncludingPTO = [...allItems];
      for (const pto of ptoItems) {
        if (!allItems.find(item => item.id === pto.id)) {
          allItemsIncludingPTO.push(pto);
        }
      }

      // First, identify PTO days from combined list
      const ptoDays = new Set();
      allItemsIncludingPTO.forEach(item => {
        const itemType = item.properties['Type'];
        const dateValue = item.properties[dateProp.name];
        
        if (itemType === 'PTO' && dateValue && dateValue.start) {
          const ptoDate = dateValue.start.split('T')[0];
          ptoDays.add(ptoDate);
          console.log(`   🏖️  PTO Day identified: ${ptoDate}`);
        }
      });

      // Filter items with times and group by date (skip Projects as they don't need times)
      const itemsByDate = {};
      const itemsOnPTO = []; // Track items scheduled on PTO days
      
      allItems.forEach(item => {
        const dateValue = item.properties[dateProp.name];
        const title = item.properties[titleProp.name] || 'Untitled';
        const itemType = item.properties['Type'] || 'Task';
        const itemStatus = item.properties['Status'];
        
        // Skip Projects and PTO items from conflict checking (they don't have times)
        if (itemType === 'Project' || itemType === 'PTO') {
          return;
        }

        if (!dateValue || !dateValue.start) {
          return;
        }

        const startDate = dateValue.start.split('T')[0];
        
        // Check if this item is scheduled on a PTO day
        if (ptoDays.has(startDate) && itemType !== 'PTO') {
          itemsOnPTO.push({
            id: item.id,
            title: title,
            type: itemType,
            status: itemStatus,
            date: startDate,
            start: dateValue.start.includes('T') ? new Date(dateValue.start) : null,
            duration: this.getDefaultDuration(itemType, item.properties['Estimated Mintues'])
          });
        }

        // Only process items with specific times for overlap checking
        if (!dateValue.start.includes('T')) {
          return; // Skip date-only items
        }

        if (!itemsByDate[startDate]) {
          itemsByDate[startDate] = [];
        }

        const defaultDuration = this.getDefaultDuration(itemType, item.properties['Estimated Mintues']);
        itemsByDate[startDate].push({
          id: item.id,
          title: title,
          start: new Date(dateValue.start),
          end: dateValue.end ? new Date(dateValue.end) : new Date(new Date(dateValue.start).getTime() + defaultDuration * 60 * 1000),
          type: itemType,
          status: itemStatus,
          duration: defaultDuration
        });
      });

      // Check each day for conflicts
      const conflicts = [];
      
      // Add PTO conflicts - items scheduled on PTO days
      for (const item of itemsOnPTO) {
        conflicts.push({
          date: item.date,
          item: item,
          type: 'pto_conflict'
        });
      }
      
      for (const [date, items] of Object.entries(itemsByDate)) {
        // Sort by start time
        items.sort((a, b) => a.start - b.start);
        
        // Check for overlaps
        for (let i = 0; i < items.length - 1; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const item1 = items[i];
            const item2 = items[j];
            
            // Check if times overlap
            if (item1.end > item2.start && item1.start < item2.end) {
              conflicts.push({
                date: date,
                item1: item1,
                item2: item2,
                type: 'overlap'
              });
            }
          }
        }
        
        // Check if day is overbooked (8+ hours)
        const totalMinutes = items.reduce((sum, item) => sum + item.duration, 0);
        if (totalMinutes > 480) { // 8 hours
          conflicts.push({
            date: date,
            items: items,
            totalHours: (totalMinutes / 60).toFixed(1),
            type: 'overbooked'
          });
        }
      }

      if (conflicts.length === 0) {
        console.log('✅ [Conflict Checker] No conflicts found in next 2 weeks');
        return;
      }

      console.log(`⚠️  [Conflict Checker] Found ${conflicts.length} conflict(s)`);
      
      // Auto-fix conflicts
      const movedItems = [];
      
      for (const conflict of conflicts) {
        if (conflict.type === 'pto_conflict') {
          // Move items scheduled on PTO days to next available day
          const itemToMove = conflict.item;
          
          // Don't auto-move protected types even from PTO days - notify instead
          if (itemToMove.type === 'Meeting' || itemToMove.type === 'Break') {
            console.log(`   ⚠️  Protected item on PTO day: "${itemToMove.title}" (${itemToMove.type}) on ${conflict.date}`);
            
            if (slackService.isConfigured()) {
              const message = `Sir, "${itemToMove.title}" (${itemToMove.type}) is scheduled on ${conflict.date}, which is a PTO day. This requires your attention as I cannot move protected items automatically.`;
              await slackService.postMessage(message);
            }
            continue;
          }
          
          console.log(`   🏖️  Moving item from PTO day: "${itemToMove.title}" on ${conflict.date}`);
          
          // Find next available non-PTO day
          let targetDate = new Date(conflict.date);
          let attempts = 0;
          
          do {
            targetDate.setDate(targetDate.getDate() + 1);
            attempts++;
            
            // Skip weekends
            while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
              targetDate.setDate(targetDate.getDate() + 1);
            }
            
            const targetDateISO = this.formatDateISO(targetDate);
            
            // Check if this day is also PTO
            if (!ptoDays.has(targetDateISO)) {
              break; // Found a non-PTO day
            }
          } while (attempts < 14); // Max 2 weeks ahead
          
          // Preserve original time if it exists
          if (itemToMove.start) {
            const originalTime = itemToMove.start.toTimeString().split(' ')[0];
            const [hours, minutes] = originalTime.split(':');
            targetDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            
            const newStart = this.toESTDatetime(targetDate);
            const newEnd = this.toESTDatetime(new Date(targetDate.getTime() + itemToMove.duration * 60 * 1000));
            
            const updateProps = {};
            updateProps[dateProp.name] = {
              type: 'date',
              date: {
                start: newStart,
                end: newEnd
              }
            };
            
            await notionManager.updatePage(itemToMove.id, updateProps);
          } else {
            // Date-only item
            const updateProps = {};
            updateProps[dateProp.name] = {
              type: 'date',
              date: {
                start: this.formatDateISO(targetDate)
              }
            };
            
            await notionManager.updatePage(itemToMove.id, updateProps);
          }
          
          movedItems.push({
            title: itemToMove.title,
            newDate: this.formatDateTime(targetDate),
            reason: 'PTO day'
          });
          
          console.log(`   ✅ Moved "${itemToMove.title}" from PTO day to ${this.formatDateTime(targetDate)}`);
        } else if (conflict.type === 'overlap') {
          // Determine which item to move - NEVER move Meetings, Breaks, PTO, or future Upcoming items
          let itemToMove = null;
          
          // Check item types
          const item1Type = conflict.item1.type;
          const item2Type = conflict.item2.type;
          const item1Status = conflict.item1.status;
          const item2Status = conflict.item2.status;
          const item1Start = conflict.item1.start;
          const item2Start = conflict.item2.start;
          
          // Check if items can be moved based on status and date
          const canMove1 = (item1Type !== 'Meeting' && item1Type !== 'Break' && item1Type !== 'PTO') && 
                          this.canItemBeMoved(item1Status, item1Start);
          const canMove2 = (item2Type !== 'Meeting' && item2Type !== 'Break' && item2Type !== 'PTO') && 
                          this.canItemBeMoved(item2Status, item2Start);
          
          // Determine which item to move
          if (canMove2 && !canMove1) {
            // Item 1 cannot be moved, move item 2
            itemToMove = conflict.item2;
          } else if (canMove1 && !canMove2) {
            // Item 2 cannot be moved, move item 1
            itemToMove = conflict.item1;
          } else if (!canMove1 && !canMove2) {
            // Neither can be moved - skip auto-fix, notify user
            console.log(`   ⚠️  Cannot auto-fix: both items cannot be moved (${item1Type} vs ${item2Type})`);
            
            if (slackService.isConfigured()) {
              const message = `Sir, I detected a scheduling conflict that requires your attention:\n• "${conflict.item1.title}" (${item1Type}) conflicts with "${conflict.item2.title}" (${item2Type}) on ${conflict.date}\n\nBoth items cannot be moved automatically.`;
              await slackService.postMessage(message);
            }
            continue;
          } else {
            // Both can be moved, move the later one (item2)
            itemToMove = conflict.item2;
          }
          
          if (!itemToMove) continue;
          
          const currentDate = new Date(conflict.date);
          
          console.log(`   🔧 Fixing overlap: Moving "${itemToMove.title}" (${itemToMove.type})`);
          
          // Try to find next available slot (next day, same time)
          let targetDate = new Date(currentDate);
          targetDate.setDate(targetDate.getDate() + 1);
          
          // Preserve the original time
          const originalTime = itemToMove.start.toTimeString().split(' ')[0];
          const [hours, minutes] = originalTime.split(':');
          targetDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          
          const newStart = this.toESTDatetime(targetDate);
          const newEnd = this.toESTDatetime(new Date(targetDate.getTime() + itemToMove.duration * 60 * 1000));
          
          const updateProps = {};
          updateProps[dateProp.name] = {
            type: 'date',
            date: {
              start: newStart,
              end: newEnd
            }
          };
          
          await notionManager.updatePage(itemToMove.id, updateProps);
          
          // Verify the move before adding to announcement list
          const verified = await this.verifyMove(itemToMove.id, targetDate, dateProp.name);
          if (verified) {
            movedItems.push({
              title: itemToMove.title,
              newDate: this.formatDateTime(targetDate)
            });
            console.log(`   ✅ Moved "${itemToMove.title}" to ${this.formatDateTime(targetDate)}`);
          } else {
            console.log(`   ❌ Failed to verify move for "${itemToMove.title}" - will not announce`);
          }
        }
      }

      // Send Slack notification if conflicts were fixed
      if (slackService.isConfigured() && movedItems.length > 0) {
        const claudeMessage = await this.generateClaudeMessage('conflict_resolution', {
          items: movedItems
        });
        
        if (claudeMessage) {
          await slackService.postMessage(claudeMessage);
        } else {
          // Fallback message
          const message = movedItems.length === 1
            ? `I detected and resolved a scheduling conflict, Sir:\n• ${movedItems[0].title} → ${movedItems[0].newDate}`
            : `I've sorted out ${movedItems.length} scheduling conflicts for you, Sir:\n${movedItems.map(i => `• ${i.title} → ${i.newDate}`).join('\n')}`;
          await slackService.postMessage(message);
        }
      }

    } catch (error) {
      console.error('[Conflict Checker] Error:', error.message);
    }
  }

  /**
   * Calculate buffer time needed between tasks (for mental breaks)
   * Returns buffer in minutes
   */
  getBufferTime() {
    return 15; // 15-minute mental break between tasks
  }

  /**
   * Calculate workload score for a day
   * Returns: { level: 'HEALTHY|BUSY|OVERLOADED', itemCount, totalHours, score }
   */
  calculateWorkloadScore(scheduleItems) {
    const itemCount = scheduleItems.length;
    let totalMinutes = 0;

    // Calculate total scheduled time
    for (const item of scheduleItems) {
      if (item.start && item.end) {
        const duration = (item.end - item.start) / (1000 * 60);
        totalMinutes += duration;
      }
    }

    // Add buffer time penalty (15 min per task for mental breaks)
    const bufferMinutes = itemCount * this.getBufferTime();
    const effectiveMinutes = totalMinutes + bufferMinutes;
    const totalHours = Math.round((effectiveMinutes / 60) * 10) / 10;

    // Determine workload level
    let level = 'HEALTHY';
    if (itemCount >= 8 || totalHours > 8) {
      level = 'OVERLOADED';
    } else if (itemCount >= 6 || totalHours >= 6) {
      level = 'BUSY';
    }

    return {
      level,
      itemCount,
      totalHours,
      score: itemCount + (totalHours / 2) // Combined score for sorting
    };
  }

  /**
   * Check if adding an item would overload a day
   * Returns true if day can handle the task, false if overloaded
   */
  canDayHandleTask(scheduleItems, taskDuration = 30) {
    const workload = this.calculateWorkloadScore(scheduleItems);
    
    // Don't add to already overloaded days
    if (workload.level === 'OVERLOADED') {
      return false;
    }

    // Check if adding this task would push it over
    const newItemCount = workload.itemCount + 1;
    const newHours = workload.totalHours + (taskDuration / 60) + (this.getBufferTime() / 60);
    
    return newItemCount < 8 && newHours <= 8;
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
