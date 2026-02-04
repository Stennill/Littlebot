/**
 * Slack Service - Post messages to Slack channel
 */

const https = require('https');
const { URL } = require('url');

class SlackService {
  constructor() {
    this.webhookUrl = null;
  }

  /**
   * Configure the Slack webhook URL
   */
  configure(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Check if Slack is configured
   */
  isConfigured() {
    return !!this.webhookUrl;
  }

  /**
   * Post a message to Slack
   */
  async postMessage(text, options = {}) {
    if (!this.isConfigured()) {
      console.log('⚠️ Slack not configured - skipping post');
      return { success: false, error: 'Slack webhook not configured' };
    }

    console.log('📤 Posting to Slack...');
    console.log('   Message:', text);

    const payload = {
      text: text,
      ...options
    };

    try {
      const url = new URL(this.webhookUrl);
      
      const postData = JSON.stringify(payload);
      
      const requestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      await new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('   ✅ Posted to Slack successfully');
              resolve({ success: true });
            } else {
              console.error('   ❌ Slack API error:', res.statusCode, data);
              reject(new Error(`Slack API error: ${res.statusCode}`));
            }
          });
        });

        req.on('error', (error) => {
          console.error('   ❌ Slack request failed:', error.message);
          reject(error);
        });

        req.write(postData);
        req.end();
      });

      return { success: true };
    } catch (error) {
      console.error('   ❌ Error posting to Slack:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Post scheduled tasks summary
   */
  async postScheduledTasks(count, details = []) {
    const message = count > 0
      ? `*Scheduled ${count} task${count !== 1 ? 's' : ''}*\n${details.slice(0, 5).map(d => `• ${d}`).join('\n')}${details.length > 5 ? `\n_...and ${details.length - 5} more_` : ''}`
      : `*Schedule updated* - All tasks are scheduled`;
    
    return await this.postMessage(message);
  }

  /**
   * Post upcoming event notification
   */
  async postUpcomingEvent(eventTitle, startTime) {
    const message = `⏰ *Upcoming Event*\n📌 ${eventTitle}\n🕐 Starting at ${startTime}`;
    return await this.postMessage(message);
  }

  /**
   * Post multiple upcoming events
   */
  async postUpcomingEvents(events) {
    const message = `⏰ *Upcoming Events (${events.length})*\n${events.map(e => `• ${e.title} at ${e.time}`).join('\n')}`;
    return await this.postMessage(message);
  }
}

module.exports = new SlackService();
