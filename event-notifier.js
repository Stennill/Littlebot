const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class EventNotifier {
  constructor() {
    this.notificationWindow = 15; // minutes before event to notify
    this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
    this.notifiedEvents = new Set(); // Track already notified events
  }

  /**
   * Start the event notifier service
   */
  start(sendNotificationCallback) {
    this.sendNotification = sendNotificationCallback;
    
    // Initial check after 30 seconds
    setTimeout(() => this.checkUpcomingEvents(), 30 * 1000);
    
    // Then check every 5 minutes
    setInterval(() => this.checkUpcomingEvents(), this.checkInterval);
    
    console.log('[Event Notifier] Started - checking for upcoming events every 5 minutes');
  }

  /**
   * Check for upcoming events and notify
   */
  async checkUpcomingEvents() {
    if (!notionManager.isConfigured()) {
      return;
    }

    try {
      console.log('[Event Notifier] Checking for upcoming events...');
      
      const schema = await notionManager.getDatabaseSchema();
      const dateProp = schema.properties.find(p => p.type === 'date');
      
      if (!dateProp) {
        return;
      }

      // Get all unprocessed events with dates (exclude Processed, Resolved, and Not Started)
      const items = await notionManager.queryDatabase({
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

      const now = new Date();
      const upcomingEvents = [];

      // Check each item for upcoming events
      for (const item of items) {
        const dateValue = item.properties[dateProp.name];
        if (!dateValue || !dateValue.start || !dateValue.start.includes('T')) {
          continue; // Skip date-only items
        }

        const eventStart = new Date(dateValue.start);
        const minutesUntil = (eventStart - now) / (1000 * 60);

        // Check if event is within notification window and not yet notified
        if (minutesUntil > 0 && minutesUntil <= this.notificationWindow) {
          const eventId = item.id;
          
          if (!this.notifiedEvents.has(eventId)) {
            const titleProp = schema.properties.find(p => p.type === 'title');
            const title = item.properties[titleProp.name] || 'Untitled';
            const type = item.properties['Type'] || 'Event';
            
            upcomingEvents.push({
              id: eventId,
              title,
              type,
              startTime: eventStart,
              minutesUntil: Math.round(minutesUntil)
            });
            
            this.notifiedEvents.add(eventId);
          }
        }
      }

      // Send notifications for upcoming events
      if (upcomingEvents.length > 0) {
        await this.notifyUpcomingEvents(upcomingEvents);
      }

      // Clean up old notified events (older than 2 hours)
      this.cleanupNotifiedEvents();

    } catch (error) {
      console.error('[Event Notifier] Error checking events:', error.message);
    }
  }

  /**
   * Send notification about upcoming events
   */
  async notifyUpcomingEvents(events) {
    console.log(`[Event Notifier] Found ${events.length} upcoming event(s)`);
    
    let message = '';
    
    if (events.length === 1) {
      const event = events[0];
      const timeStr = this.formatTime(event.startTime);
      message = `⏰ **Upcoming ${event.type}**\n\n` +
                `**${event.title}** is starting in ${event.minutesUntil} minute${event.minutesUntil !== 1 ? 's' : ''} at ${timeStr}`;
    } else {
      message = `⏰ **You have ${events.length} upcoming events:**\n\n`;
      events.forEach(event => {
        const timeStr = this.formatTime(event.startTime);
        message += `• **${event.title}** - ${event.minutesUntil} min (${timeStr})\n`;
      });
    }

    // Send notification via callback
    if (this.sendNotification) {
      this.sendNotification(message);
    }
    
    // Post to Slack if configured
    if (slackService.isConfigured()) {
      if (events.length === 1) {
        const event = events[0];
        const timeStr = this.formatTime(event.startTime);
        const slackMessage = `*Upcoming ${event.type}*\n\n*${event.title}* is starting in ${event.minutesUntil} minute${event.minutesUntil !== 1 ? 's' : ''} at ${timeStr}`;
        await slackService.postMessage(slackMessage);
      } else {
        const slackMessage = `*You have ${events.length} upcoming events:*\n\n${events.map(e => {
          const timeStr = this.formatTime(e.startTime);
          return `• *${e.title}* - ${e.minutesUntil} min (${timeStr})`;
        }).join('\n')}`;
        await slackService.postMessage(slackMessage);
      }
    }
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
   * Clean up old notified events
   */
  cleanupNotifiedEvents() {
    // For now, just clear after 100 events to prevent memory growth
    if (this.notifiedEvents.size > 100) {
      this.notifiedEvents.clear();
      console.log('[Event Notifier] Cleared notification history');
    }
  }

  /**
   * Reset notifications (for testing)
   */
  reset() {
    this.notifiedEvents.clear();
    console.log('[Event Notifier] Reset notification history');
  }
}

module.exports = new EventNotifier();
