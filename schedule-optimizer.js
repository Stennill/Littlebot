const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class ScheduleOptimizer {
  constructor() {
    this.checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    this.lastCheckedItems = new Set();
    // Bumped items: Map<pageId, dateString> — items the user manually bumped.
    // The optimizer will not move these items for the rest of that calendar day.
    this.bumpedItems = new Map();
  }

  /**
   * Build a canned Slack notification message.
   */
  buildSlackMessage(context, data) {
    try {
      if (context === 'gap_filled') {
        return `Moved "${data.title}" to ${data.time}, Sir.`;
      }

      if (context === 'overlap_resolution') {
        const items = data.items || [];
        if (items.length === 1) return `Sorted out an overlap, Sir:\n• ${items[0].title} → ${items[0].dateTimeStr}`;
        if (items.length > 1) return `Sorted out a few overlaps, Sir:\n${items.map(i => `• ${i.title} → ${i.dateTimeStr}`).join('\n')}`;
        return `Sorted out an overlap, Sir.`;
      }

      if (context === 'conflict_resolution') {
        const items = data.items || [];
        if (items.length === 1) return `Resolved a scheduling conflict, Sir:\n• ${items[0].title} → ${items[0].newDate}`;
        if (items.length > 1) return `Resolved ${items.length} scheduling conflicts, Sir:\n${items.map(i => `• ${i.title} → ${i.newDate}`).join('\n')}`;
        return `Resolved a scheduling conflict, Sir.`;
      }

      if (context === 'out_of_window') {
        const items = data.items || [];
        if (items.length === 1) return `Moved an off-hours item into your work schedule, Sir:\n• ${items[0].title} → ${items[0].newDate}`;
        if (items.length > 1) return `Relocated ${items.length} off-hours items into your work schedule, Sir:\n${items.map(i => `• ${i.title} → ${i.newDate}`).join('\n')}`;
        return `Relocated off-hours items into your work schedule, Sir.`;
      }

      return null;
    } catch (e) {
      console.error('[Schedule Optimizer] Error building Slack message:', e.message);
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
   * Check if an item can be moved based on its status and scheduled date.
   * "Upcoming" items can only be moved if they're on current date or past.
   * Bumped items cannot be moved for the rest of the day they were bumped.
   * Large items (> 60 estimated minutes) are never auto-moved.
   */
  canItemBeMoved(itemStatus, itemDate, itemId, estimatedMinutes) {
    // If the user bumped this item today, don't let the optimizer move it back
    if (itemId && this.isItemBumped(itemId)) {
      return false;
    }

    // Large tasks (> 60 min) are intentional time blocks — don't auto-move
    if (estimatedMinutes && estimatedMinutes > 60) {
      return false;
    }

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
   * Register an item as bumped by the user.
   * The optimizer will not touch it for the rest of the calendar day.
   */
  registerBump(pageId) {
    const todayKey = this.formatDateISO(new Date());
    this.bumpedItems.set(pageId, todayKey);
    console.log(`[Schedule Optimizer] Item ${pageId} bumped — protected until end of ${todayKey}`);
    this._cleanupExpiredBumps();
  }

  /**
   * Check whether an item is currently protected by a bump.
   */
  isItemBumped(pageId) {
    const bumpDate = this.bumpedItems.get(pageId);
    if (!bumpDate) return false;
    const todayKey = this.formatDateISO(new Date());
    if (bumpDate === todayKey) return true;
    // Bump expired (different day) — clean it up
    this.bumpedItems.delete(pageId);
    return false;
  }

  /** Remove bump entries from previous days. */
  _cleanupExpiredBumps() {
    const todayKey = this.formatDateISO(new Date());
    for (const [id, date] of this.bumpedItems) {
      if (date !== todayKey) this.bumpedItems.delete(id);
    }
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

      // Relocate items scheduled outside Mon-Fri 8am-4:30pm work window
      await this.relocateOutOfWindowItems(schema, dateProp, titleProp);

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
   * Fill a time gap with tasks from future dates.
   * Conservative policy: only pull SHORT tasks (≤ 30 min) from TOMORROW.
   * We never pull items from multiple days away or large time blocks.
   */
  async fillGap(gap, schema, dateProp, titleProp) {
    const MAX_GAP_FILL_DURATION = 30; // minutes – don't pull tasks bigger than this

    try {
      // Get current day's schedule to check for overlaps
      const todaySchedule = await this.getTodaySchedule(dateProp);
      
      // Only pull tasks from TOMORROW (not further out)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowKey = this.formatDateISO(tomorrow);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const dayAfterKey = this.formatDateISO(dayAfter);

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
          },
          {
            property: dateProp.name,
            date: {
              before: dayAfterKey
            }
          }
        ]
      });

      // Filter for small tasks with times and sort by date
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
          if (!this.canItemBeMoved(taskStatus, dateValue?.start, task.id, task.properties['Estimated Mintues'])) {
            return false;
          }

          // Only pull short tasks into gaps – large tasks are intentional blocks
          const duration = this.getDefaultDuration(taskType, task.properties['Estimated Mintues']);
          if (duration > MAX_GAP_FILL_DURATION) {
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
          
          if (slackService.isConfigured()) {
            const msg = this.buildSlackMessage('gap_filled', { title, time: this.formatDateTime(proposedStart) });
            if (msg) await slackService.postMessage(msg);
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
        if (!this.canItemBeMoved(itemStatus, dateValue?.start, item.id, item.properties['Estimated Mintues'])) {
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
          // Prefer rescheduling on the SAME day the item was originally on,
          // only fall back to the global "next available" if no same-day slot.
          const origDate = stale.item.properties[dateProp.name]?.start;
          let slot = null;
          if (origDate) {
            const origDay = new Date(origDate);
            const origDaySchedule = await this.getDaySchedule(dateProp, origDay);
            slot = this.findNextAvailableTimeOnDay(origDaySchedule, stale.duration, origDay, ptoDays);
          }
          if (!slot) {
            slot = await this.findNextAvailableTime(dateProp, stale.duration, ptoDays, todaySchedule);
          }
          
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
          if (!this.canItemBeMoved(itemStatus, dateValue?.start, item.id, item.properties['Estimated Mintues'])) {
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

        // Prefer rescheduling on the same day, fall back to next available
        const conflictDaySchedule = await this.getDaySchedule(dateProp, conflict.start);
        let slot = this.findNextAvailableTimeOnDay(conflictDaySchedule, conflict.duration, conflict.start, ptoDays);
        if (!slot) {
          slot = await this.findNextAvailableTime(dateProp, conflict.duration, ptoDays);
        }
        
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
        const slackMessage = this.buildSlackMessage('overlap_resolution', { items: movedItems });
        if (slackMessage) await slackService.postMessage(slackMessage);
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error resolving overlaps:', error.message);
    }
  }

  /**
   * Relocate items scheduled outside the Mon-Fri 8AM-4:30PM work window
   * into open time slots within the next 14 days.
   *
   * "Open time" = any slot NOT occupied by a non-Processed item.
   * Processed items free up their time slots (considered open).
   * Upcoming tasks CAN be moved to the current date if there is room.
   * Tasks default to 5-15 min (uses Estimated Mintues when available).
   */
  async relocateOutOfWindowItems(schema, dateProp, titleProp) {
    try {
      console.log('[Schedule Optimizer] Checking for items outside work window...');

      const now = new Date();
      const todayISO = this.formatDateISO(now);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 14);
      const horizonISO = this.formatDateISO(horizon);

      const workStart = 8;      // 8:00 AM
      const workEnd   = 16.5;   // 4:30 PM
      const workDays  = [1, 2, 3, 4, 5]; // Mon-Fri

      // ── 1. Fetch all non-terminal items in the 14-day window ──────────
      const candidateItems = await notionManager.queryDatabase({
        and: [
          { property: 'Status', status: { does_not_equal: 'Processed' } },
          { property: 'Status', status: { does_not_equal: 'Resolved' } },
          { property: 'Status', status: { does_not_equal: 'Not Started' } },
          { property: dateProp.name, date: { on_or_after: todayISO } },
          { property: dateProp.name, date: { on_or_before: horizonISO } }
        ]
      });

      // ── 2. Identify items that are OUT of the work window ─────────────
      const outOfWindow = [];

      for (const item of candidateItems) {
        const dateValue = item.properties[dateProp.name];
        const itemType  = item.properties['Type'];
        const itemStatus = item.properties['Status'];

        // Skip protected types
        if (itemType === 'Break' || itemType === 'PTO' || itemType === 'Project') {
          continue;
        }

        // Skip items the user has bumped today
        if (this.isItemBumped(item.id)) {
          continue;
        }

        // Skip large items (> 60 min) — intentional time blocks
        const estimatedMin = item.properties['Estimated Mintues'];
        if (estimatedMin && estimatedMin > 60) {
          continue;
        }

        // Must have a timed date
        if (!dateValue || !dateValue.start || !dateValue.start.includes('T')) {
          continue;
        }

        const startDt   = new Date(dateValue.start);
        const dayOfWeek = startDt.getDay();
        const hour      = startDt.getHours() + startDt.getMinutes() / 60;

        const isWeekend      = !workDays.includes(dayOfWeek);
        const isBeforeWork   = hour < workStart;
        const isAfterWork    = hour >= workEnd;

        if (isWeekend || isBeforeWork || isAfterWork) {
          // For Upcoming items: allow move to current date or keep existing
          // relaxed rule – we allow Upcoming to be moved into work hours
          const title = item.properties[titleProp.name] || 'Untitled';
          const estimatedMin = item.properties['Estimated Mintues'];
          // Tasks: 5-15 min default (10 if unset); Meetings keep their own duration
          let duration;
          if (estimatedMin) {
            duration = estimatedMin;
          } else if (itemType === 'Meeting') {
            // Derive from existing start/end if available
            if (dateValue.end) {
              duration = Math.max(5, Math.round((new Date(dateValue.end) - startDt) / 60000));
            } else {
              duration = 30;
            }
          } else {
            duration = 10; // Default task duration within 5-15 range
          }

          const reason = isWeekend ? 'weekend' : isBeforeWork ? 'before 8 AM' : 'after 4:30 PM';
          console.log(`   ⏰ Out-of-window: "${title}" (${reason}, ${this.formatDateTime(startDt)})`);

          outOfWindow.push({
            id: item.id,
            title,
            start: startDt,
            end: dateValue.end ? new Date(dateValue.end) : new Date(startDt.getTime() + duration * 60000),
            duration,
            type: itemType,
            status: itemStatus
          });
        }
      }

      if (outOfWindow.length === 0) {
        console.log('   ✅ All items are within the work window');
        return;
      }

      console.log(`   Found ${outOfWindow.length} item(s) outside work window, relocating...`);

      // ── 3. Build occupied-time map from NON-Processed items ───────────
      // Processed items = open time; only non-Processed block slots
      const allNonProcessed = await notionManager.queryDatabase({
        and: [
          { property: 'Status', status: { does_not_equal: 'Processed' } },
          { property: dateProp.name, date: { on_or_after: todayISO } },
          { property: dateProp.name, date: { on_or_before: horizonISO } }
        ]
      });

      const occupiedSlots = [];
      for (const item of allNonProcessed) {
        const dv = item.properties[dateProp.name];
        if (!dv || !dv.start || !dv.start.includes('T') || !dv.end) continue;
        occupiedSlots.push({
          start: new Date(dv.start),
          end:   new Date(dv.end)
        });
      }

      // ── 4. Get PTO days to block ─────────────────────────────────────
      const ptoItems = await notionManager.queryDatabase({
        and: [
          { property: 'Type', select: { equals: 'PTO' } },
          { property: dateProp.name, date: { on_or_after: todayISO } },
          { property: dateProp.name, date: { on_or_before: horizonISO } }
        ]
      });
      const ptoDays = new Set();
      ptoItems.forEach(item => {
        const dv = item.properties[dateProp.name];
        if (dv && dv.start) ptoDays.add(dv.start.split('T')[0]);
      });

      // ── 5. Relocate each out-of-window item ─────────────────────────
      const movedItems = [];

      for (const oow of outOfWindow) {
        // Remove the item's own slot from the occupied list so it doesn't
        // block itself when searching for a new slot
        const selfIdx = occupiedSlots.findIndex(s =>
          s.start.getTime() === oow.start.getTime() &&
          s.end.getTime()   === oow.end.getTime()
        );
        if (selfIdx !== -1) occupiedSlots.splice(selfIdx, 1);

        // For Upcoming tasks: prefer current date first
        let slot = null;
        if (oow.status === 'Upcoming') {
          slot = this._findSlotOnDate(now, occupiedSlots, oow.duration, ptoDays, workStart, workEnd, workDays);
        }

        // General search: today + next 14 days
        if (!slot) {
          slot = this._findWorkWindowSlot(occupiedSlots, oow.duration, ptoDays, workStart, workEnd, workDays, 14);
        }

        if (!slot) {
          console.log(`   ⚠️ No work-window slot found for "${oow.title}"`);
          // Re-add the item's slot back so future searches still see it
          occupiedSlots.push({ start: oow.start, end: oow.end });
          continue;
        }

        // Update Notion
        const updateProps = {};
        updateProps[dateProp.name] = {
          type: 'date',
          date: {
            start: this.toESTDatetime(slot.start),
            end:   this.toESTDatetime(slot.end)
          }
        };

        await notionManager.updatePage(oow.id, updateProps);

        // Verify
        const verified = await this.verifyMove(oow.id, slot.start, dateProp.name);
        if (verified) {
          console.log(`   ✅ Relocated "${oow.title}" → ${this.formatDateTime(slot.start)}`);
          movedItems.push({ title: oow.title, newDate: this.formatDateTime(slot.start) });
        } else {
          console.log(`   ❌ Verification failed for "${oow.title}"`);
        }

        // Register the new slot as occupied for subsequent iterations
        occupiedSlots.push({ start: slot.start, end: slot.end });
      }

      if (slackService.isConfigured() && movedItems.length > 0) {
        const slackMessage = this.buildSlackMessage('out_of_window', { items: movedItems });
        if (slackMessage) await slackService.postMessage(slackMessage);
      }

    } catch (error) {
      console.error('[Schedule Optimizer] Error relocating out-of-window items:', error.message);
    }
  }

  /**
   * Find the first open work-window slot across the next `maxDays` days.
   * Only non-Processed items occupy time (Processed = open).
   */
  _findWorkWindowSlot(occupiedSlots, durationMinutes, ptoDays, workStart, workEnd, workDays, maxDays) {
    const now = new Date();
    let checkDate = new Date(now);
    checkDate.setMinutes(Math.ceil(checkDate.getMinutes() / 5) * 5, 0, 0);

    for (let d = 0; d < maxDays; d++) {
      const slot = this._findSlotOnDate(checkDate, occupiedSlots, durationMinutes, ptoDays, workStart, workEnd, workDays);
      if (slot) return slot;

      // Advance to start of next day
      checkDate = new Date(checkDate);
      checkDate.setDate(checkDate.getDate() + 1);
      checkDate.setHours(workStart, 0, 0, 0);
    }
    return null;
  }

  /**
   * Try to find a slot on a specific date within work hours.
   * Returns { start, end } or null.
   */
  _findSlotOnDate(dateRef, occupiedSlots, durationMinutes, ptoDays, workStart, workEnd, workDays) {
    const dayOfWeek = dateRef.getDay();
    if (!workDays.includes(dayOfWeek)) return null;

    const dateKey = this.formatDateISO(dateRef);
    if (ptoDays.has(dateKey)) return null;

    const dayStart = new Date(dateRef);
    dayStart.setHours(workStart, 0, 0, 0);
    const dayEnd = new Date(dateRef);
    dayEnd.setHours(Math.floor(workEnd), (workEnd % 1) * 60, 0, 0);

    const now = new Date();
    let cursor = (dateRef.toDateString() === now.toDateString() && now > dayStart) ? new Date(now) : new Date(dayStart);
    cursor.setMinutes(Math.ceil(cursor.getMinutes() / 5) * 5, 0, 0);

    while (cursor < dayEnd) {
      const proposedEnd = new Date(cursor.getTime() + durationMinutes * 60000);
      if (proposedEnd > dayEnd) break;

      if (!this.hasOverlap(occupiedSlots, cursor, proposedEnd)) {
        return { start: new Date(cursor), end: proposedEnd };
      }
      // Advance 5 minutes
      cursor = new Date(cursor.getTime() + 5 * 60000);
    }
    return null;
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
   * Get a day's full schedule — ALL items with start/end times on that date,
   * regardless of status. Meetings, breaks, tasks, etc. all block time.
   * Only Processed/Resolved items are excluded (their slots are considered free).
   */
  async getDaySchedule(dateProp, targetDate) {
    const dateKey = targetDate ? this.formatDateISO(targetDate) : this.formatDateISO(new Date());
    const nextDay = new Date(targetDate || new Date());
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayKey = this.formatDateISO(nextDay);

    // Use a date range so items with datetime components are included
    const items = await notionManager.queryDatabase({
      and: [
        {
          property: dateProp.name,
          date: { on_or_after: dateKey }
        },
        {
          property: dateProp.name,
          date: { before: nextDayKey }
        }
      ]
    });

    const schedule = [];
    for (const item of items) {
      const dateValue = item.properties[dateProp.name];
      if (!dateValue || !dateValue.start || !dateValue.end) continue;

      // Processed / Resolved items free their slot
      const status = (item.properties['Status'] || '').toString().trim().toLowerCase();
      if (status === 'processed' || status === 'resolved') continue;

      schedule.push({
        start: new Date(dateValue.start),
        end: new Date(dateValue.end)
      });
    }

    return schedule;
  }

  /** Convenience alias — returns today's schedule. */
  async getTodaySchedule(dateProp) {
    return this.getDaySchedule(dateProp, new Date());
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
   * Find next available time slot on a specific day only.
   * Returns null if nothing fits on that day.
   */
  findNextAvailableTimeOnDay(schedule, durationMinutes, targetDay, ptoDays = new Set()) {
    const workStart = 8;
    const workEnd = 16.5;
    const workDays = [1, 2, 3, 4, 5];
    const dayOfWeek = targetDay.getDay();
    const dateKey = this.formatDateISO(targetDay);

    if (!workDays.includes(dayOfWeek) || ptoDays.has(dateKey)) return null;

    const dayStart = new Date(targetDay);
    dayStart.setHours(workStart, 0, 0, 0);
    const dayEnd = new Date(targetDay);
    dayEnd.setHours(Math.floor(workEnd), (workEnd % 1) * 60, 0, 0);

    const now = new Date();
    let slotTime = new Date(Math.max(dayStart.getTime(), now.getTime()));
    slotTime.setMinutes(Math.ceil(slotTime.getMinutes() / 5) * 5, 0, 0);

    while (slotTime < dayEnd) {
      const proposedEnd = new Date(slotTime.getTime() + durationMinutes * 60 * 1000);
      if (proposedEnd <= dayEnd && !this.hasOverlap(schedule, slotTime, proposedEnd)) {
        return { start: slotTime, end: proposedEnd };
      }
      slotTime = new Date(slotTime.getTime() + 5 * 60 * 1000);
    }
    return null;
  }

  /**
   * Find next available time slot that doesn't overlap.
   * Fetches the REAL schedule for each candidate day so meetings, breaks,
   * and all non-free items are respected.
   * @param {object} dateProp - The Notion date property descriptor
   * @param {number} durationMinutes - Required slot length in minutes
   * @param {Set} ptoDays - Date strings (YYYY-MM-DD) of PTO days to skip
   * @param {Array|null} todayScheduleOverride - Pre-fetched schedule for today
   */
  async findNextAvailableTime(dateProp, durationMinutes, ptoDays = new Set(), todayScheduleOverride = null) {
    const now = new Date();
    const workStart = 8;
    const workEnd = 16.5;
    const workDays = [1, 2, 3, 4, 5];

    let checkTime = new Date(now);
    checkTime.setMinutes(Math.ceil(checkTime.getMinutes() / 5) * 5, 0, 0);

    const maxDays = 30;
    let daysChecked = 0;
    let lastDateKey = null;
    let daySchedule = null;

    while (daysChecked < maxDays) {
      const dayOfWeek = checkTime.getDay();
      const dateKey = this.formatDateISO(checkTime);

      if (!workDays.includes(dayOfWeek)) {
        checkTime.setDate(checkTime.getDate() + 1);
        checkTime.setHours(workStart, 0, 0, 0);
        daysChecked++;
        continue;
      }

      if (ptoDays.has(dateKey)) {
        console.log(`   🏖️  Skipping PTO day: ${dateKey}`);
        checkTime.setDate(checkTime.getDate() + 1);
        checkTime.setHours(workStart, 0, 0, 0);
        daysChecked++;
        continue;
      }

      // Fetch real schedule for this day (once per day)
      if (dateKey !== lastDateKey) {
        const todayKey = this.formatDateISO(now);
        if (dateKey === todayKey && todayScheduleOverride) {
          daySchedule = todayScheduleOverride;
        } else {
          daySchedule = await this.getDaySchedule(dateProp, checkTime);
        }
        lastDateKey = dateKey;
      }

      const dayStart = new Date(checkTime);
      dayStart.setHours(workStart, 0, 0, 0);
      const dayEnd = new Date(checkTime);
      dayEnd.setHours(Math.floor(workEnd), (workEnd % 1) * 60, 0, 0);

      let startTime = checkTime.getTime() > dayStart.getTime() ? checkTime : dayStart;
      let slotTime = new Date(startTime);

      while (slotTime < dayEnd) {
        const proposedEnd = new Date(slotTime.getTime() + (durationMinutes * 60 * 1000));
        if (proposedEnd <= dayEnd) {
          if (!this.hasOverlap(daySchedule, slotTime, proposedEnd)) {
            return { start: slotTime, end: proposedEnd };
          }
        }
        slotTime = new Date(slotTime.getTime() + (5 * 60 * 1000));
      }

      checkTime.setDate(checkTime.getDate() + 1);
      checkTime.setHours(workStart, 0, 0, 0);
      daysChecked++;
    }

    console.log('   ⚠️ No available slot found in next 30 days for duration:', durationMinutes, 'minutes');
    return null;
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
          
          if (itemToMove.start) {
            // Timed item — find a verified open slot using the standard search
            const slot = await this.findNextAvailableTime(dateProp, itemToMove.duration, ptoDays);
            if (!slot) {
              console.log(`   ⚠️ No available slot found for "${itemToMove.title}"`);
              continue;
            }
            const newStart = this.toESTDatetime(slot.start);
            const newEnd = this.toESTDatetime(slot.end);
            const updateProps = {};
            updateProps[dateProp.name] = { type: 'date', date: { start: newStart, end: newEnd } };
            await notionManager.updatePage(itemToMove.id, updateProps);

            movedItems.push({ title: itemToMove.title, newDate: this.formatDateTime(slot.start), reason: 'PTO day' });
            console.log(`   ✅ Moved "${itemToMove.title}" from PTO day to ${this.formatDateTime(slot.start)}`);
          } else {
            // Date-only item — move to next non-PTO workday
            let targetDate = new Date(conflict.date);
            let attempts = 0;
            do {
              targetDate.setDate(targetDate.getDate() + 1);
              attempts++;
              while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
                targetDate.setDate(targetDate.getDate() + 1);
              }
              if (!ptoDays.has(this.formatDateISO(targetDate))) break;
            } while (attempts < 14);

            const updateProps = {};
            updateProps[dateProp.name] = { type: 'date', date: { start: this.formatDateISO(targetDate) } };
            await notionManager.updatePage(itemToMove.id, updateProps);

            movedItems.push({ title: itemToMove.title, newDate: this.formatDateTime(targetDate), reason: 'PTO day' });
            console.log(`   ✅ Moved "${itemToMove.title}" from PTO day to ${this.formatDateTime(targetDate)}`);
          }
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
                          this.canItemBeMoved(item1Status, item1Start, conflict.item1.id, conflict.item1.duration);
          const canMove2 = (item2Type !== 'Meeting' && item2Type !== 'Break' && item2Type !== 'PTO') && 
                          this.canItemBeMoved(item2Status, item2Start, conflict.item2.id, conflict.item2.duration);
          
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
          
          console.log(`   🔧 Fixing overlap: Moving "${itemToMove.title}" (${itemToMove.type})`);
          
          // First try later on the SAME day, then search future days
          const sameDaySchedule = await this.getDaySchedule(dateProp, itemToMove.start);
          let slot = this.findNextAvailableTimeOnDay(sameDaySchedule, itemToMove.duration, itemToMove.start, ptoDays);
          if (!slot) {
            slot = await this.findNextAvailableTime(dateProp, itemToMove.duration, ptoDays);
          }
          
          if (!slot) {
            console.log(`   ⚠️ No available slot found for "${itemToMove.title}"`);
            continue;
          }

          const targetDate = slot.start;
          const newStart = this.toESTDatetime(slot.start);
          const newEnd = this.toESTDatetime(slot.end);
          
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
        const slackMessage = this.buildSlackMessage('conflict_resolution', { items: movedItems });
        if (slackMessage) await slackService.postMessage(slackMessage);
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
