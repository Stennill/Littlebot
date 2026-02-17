const notionManager = require('./notion-manager');
const slackService = require('./slack-service');

class EventNotifier {
  constructor() {
    this.notificationWindow = 15; // minutes before event to notify
    this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
    // Track already-notified events with the start time they were notified for.
    // Map<eventId, { startIso: string, notifiedAtMs: number }>
    this.notifiedEvents = new Map();
  }

  /**
   * Start the event notifier service
   */
  start(sendNotificationCallback, sendStructuredCallback) {
    this.sendNotification = sendNotificationCallback;
    this.sendNotificationStructured = sendStructuredCallback || null;
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
      const upcomingEvents = []; // For Slack / one-time notification
      const highlightEventsMap = new Map(); // id -> event (upcoming OR in progress, for schedule highlight)

      const titleProp = schema.properties.find(p => p.type === 'title');

      for (const item of items) {
        const dateValue = item.properties[dateProp.name];
        if (!dateValue || !dateValue.start || !dateValue.start.includes('T')) {
          continue; // Skip date-only items
        }

        const eventStart = new Date(dateValue.start);
        const eventEnd = (dateValue.end && String(dateValue.end).includes('T'))
          ? new Date(dateValue.end)
          : new Date(eventStart.getTime() + 60 * 60 * 1000); // default 1 hr if no end
        const minutesUntil = (eventStart - now) / (1000 * 60);
        const inProgress = now >= eventStart && now <= eventEnd;
        const upcoming = minutesUntil > 0 && minutesUntil <= this.notificationWindow;
        const eventId = item.id;
        const title = item.properties[titleProp.name] || 'Untitled';
        const type = item.properties['Type'] || 'Event';

        if (upcoming && this.shouldNotifySlack(eventId, dateValue.start, minutesUntil)) {
          upcomingEvents.push({
            id: eventId,
            title,
            type,
            startTime: eventStart,
            minutesUntil: Math.round(minutesUntil)
          });
          this.notifiedEvents.set(eventId, { startIso: dateValue.start, notifiedAtMs: now.getTime() });
        }

        if (upcoming || inProgress) {
          const minutesUntilDisplay = inProgress ? 0 : Math.round(minutesUntil);
          highlightEventsMap.set(eventId, {
            id: eventId,
            title,
            type,
            startTime: eventStart,
            endTime: eventEnd,
            minutesUntil: minutesUntilDisplay,
            inProgress
          });
        }
      }

      const highlightEvents = Array.from(highlightEventsMap.values());
      if (highlightEvents.length > 0) {
        highlightEvents.forEach(e => { e.timeStr = this.formatTime(e.startTime); });
        await this.notifyUpcomingEvents(upcomingEvents, highlightEvents);
      } else if (this.sendNotificationStructured) {
        this.sendNotificationStructured([]);
      }

      // Clean up old notified events (older than 2 hours)
      this.cleanupNotifiedEvents();

    } catch (error) {
      console.error('[Event Notifier] Error checking events:', error.message);
    }
  }

  /**
   * Send notification about upcoming events; highlight list includes both upcoming and in-progress.
   * @param {Array} upcomingEvents - Events within the notification window (for Slack / one-time notify)
   * @param {Array} highlightEvents - Events to highlight on schedule (upcoming + currently in progress)
   */
  async notifyUpcomingEvents(upcomingEvents, highlightEvents) {
    const toHighlight = highlightEvents || upcomingEvents || [];
    console.log(`[Event Notifier] ${toHighlight.length} event(s) to highlight (${upcomingEvents.length} upcoming)`);

    if (this.sendNotificationStructured) {
      this.sendNotificationStructured(toHighlight.map(e => ({
        id: e.id,
        type: e.type,
        title: e.title,
        minutesUntil: e.minutesUntil,
        timeStr: e.timeStr || this.formatTime(e.startTime),
        startTime: e.startTime ? e.startTime.toISOString() : null,
        endTime: e.endTime ? e.endTime.toISOString() : null,
        inProgress: !!e.inProgress
      })));
    }

    // Post to Slack only for newly upcoming (not for in-progress)
    if (slackService.isConfigured() && upcomingEvents.length > 0) {
      if (upcomingEvents.length === 1) {
        const event = upcomingEvents[0];
        const timeStr = this.formatTime(event.startTime);
        const slackMessage = `*Upcoming ${event.type}*\n\n*${event.title}* is starting in ${event.minutesUntil} minute${event.minutesUntil !== 1 ? 's' : ''} at ${timeStr}`;
        await slackService.postMessage(slackMessage);
      } else {
        const slackMessage = `*You have ${upcomingEvents.length} upcoming events:*\n\n${upcomingEvents.map(e => {
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
    const now = Date.now();
    // Keep enough history to prevent repeats; prune old entries by age
    const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
    for (const [id, entry] of this.notifiedEvents.entries()) {
      if (!entry || !entry.notifiedAtMs) {
        this.notifiedEvents.delete(id);
        continue;
      }
      if (now - entry.notifiedAtMs > MAX_AGE_MS) {
        this.notifiedEvents.delete(id);
      }
    }
  }

  /**
   * Reset notifications (for testing)
   */
  reset() {
    this.notifiedEvents.clear();
    console.log('[Event Notifier] Reset notification history');
  }

  /**
   * Slack should fire once per event start time, about 15 minutes beforehand.
   * We allow a small tolerance because checks run on an interval.
   */
  shouldNotifySlack(eventId, startIso, minutesUntil) {
    if (!eventId || !startIso) return false;
    // Only notify in the 0..15 minute window
    if (!(minutesUntil > 0 && minutesUntil <= this.notificationWindow)) return false;

    const existing = this.notifiedEvents.get(eventId);
    // If we've never notified, or the event was rescheduled (start changed), allow notify
    if (!existing || existing.startIso !== startIso) return true;

    // Already notified for this exact start time
    return false;
  }
}

module.exports = new EventNotifier();
