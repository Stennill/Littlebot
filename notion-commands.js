/**
 * Direct Notion Command Parser
 * Read-only: move/update commands return a message that Notion is query-only.
 */

const READ_ONLY_MESSAGE = 'Notion is configured for read-only access. I can only query your database, not move or update items.';

/**
 * Parse Notion commands - move/reschedule patterns return read-only message, else null
 */
async function parseNotionCommand(input) {
  const trimmed = input.trim();

  // Pattern: "move today's/tomorrow's meetings to [date]"
  const bulkMeetingPattern = /(move|reschedule)\s+(today'?s?|tomorrow'?s?)\s+meetings?\s+to\s+(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
  if (bulkMeetingPattern.test(trimmed)) {
    return READ_ONLY_MESSAGE;
  }

  // Pattern: "move [item name] to [date]"
  const movePattern = /move\s+(.+?)\s+(?:from\s+(?:yesterday|today|tomorrow|last\s+\w+|next\s+\w+|\w+day)\s+)?to\s+(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
  if (movePattern.test(trimmed)) {
    return READ_ONLY_MESSAGE;
  }

  return null;
}

module.exports = {
  parseNotionCommand
};
