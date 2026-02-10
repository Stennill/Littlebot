#!/bin/bash
# Test Examples for Cloudflare Worker - Notion Assistant
# Replace YOUR_WORKER_URL with your actual worker URL

WORKER_URL="https://notion-assistant.YOUR-SUBDOMAIN.workers.dev"

echo "======================================================================"
echo "CLOUDFLARE WORKER - NOTION ASSISTANT TEST EXAMPLES"
echo "======================================================================"
echo ""
echo "Replace WORKER_URL with your actual worker URL!"
echo ""

# Test 1: Move today's meetings to tomorrow
echo "Test 1: Move today's meetings to tomorrow"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move today'\''s meetings to tomorrow"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 2: Move tomorrow's meetings to Friday
echo "Test 2: Move tomorrow's meetings to Friday"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "reschedule tomorrow'\''s meetings to friday"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 3: Move specific item by name
echo "Test 3: Move specific item to Monday"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move dentist appointment to monday"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 4: Move item to specific time
echo "Test 4: Move item to specific time (2pm today)"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move standup to 2pm"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 5: Move item to specific time on specific date
echo "Test 5: Move item to specific time tomorrow"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "move client call to 3:30pm tomorrow"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 6: Get database schema
echo "Test 6: Get database schema"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "getSchema"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 7: Direct action - move meetings with dates
echo "Test 7: Direct action - move meetings (ISO dates)"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "moveMeetings",
    "fromDate": "2026-02-06",
    "toDate": "2026-02-10"
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 8: Query database with filters
echo "Test 8: Query all meetings"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "queryDatabase",
    "filters": {
      "and": [
        {
          "property": "Type",
          "select": {
            "equals": "Meeting"
          }
        },
        {
          "property": "Status",
          "status": {
            "does_not_equal": "Processed"
          }
        }
      ]
    }
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 9: Create new page
echo "Test 9: Create new task"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "createPage",
    "properties": {
      "Name": {
        "type": "title",
        "title": [{"text": {"content": "New Test Task"}}]
      },
      "Date": {
        "type": "date",
        "date": {"start": "2026-02-10"}
      },
      "Type": {
        "type": "select",
        "select": {"name": "Task"}
      },
      "Status": {
        "type": "status",
        "status": {"name": "Upcoming"}
      }
    }
  }' | jq
echo ""
read -p "Press Enter to continue..."
echo ""

# Test 10: Error handling - invalid command
echo "Test 10: Error handling - invalid command"
echo "----------------------------------------------------------------------"
curl -X POST $WORKER_URL \
  -H "Content-Type: application/json" \
  -d '{
    "command": "do something random"
  }' | jq
echo ""

echo "======================================================================"
echo "TESTS COMPLETE"
echo "======================================================================"
