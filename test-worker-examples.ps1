# Test Examples for Cloudflare Worker - Notion Assistant (PowerShell)
# Replace $WorkerUrl with your actual worker URL

$WorkerUrl = "https://notion-assistant.YOUR-SUBDOMAIN.workers.dev"

Write-Host "======================================================================"
Write-Host "CLOUDFLARE WORKER - NOTION ASSISTANT TEST EXAMPLES"
Write-Host "======================================================================"
Write-Host ""
Write-Host "Replace WorkerUrl with your actual worker URL!"
Write-Host ""

# Test 1: Move today's meetings to tomorrow
Write-Host "Test 1: Move today's meetings to tomorrow" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "move today's meetings to tomorrow"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 2: Move tomorrow's meetings to Friday
Write-Host "Test 2: Move tomorrow's meetings to Friday" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "reschedule tomorrow's meetings to friday"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 3: Move specific item by name
Write-Host "Test 3: Move specific item to Monday" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "move dentist appointment to monday"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 4: Move item to specific time
Write-Host "Test 4: Move item to specific time (2pm today)" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "move standup to 2pm"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 5: Move item to specific time on specific date
Write-Host "Test 5: Move item to specific time tomorrow" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "move client call to 3:30pm tomorrow"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 6: Get database schema
Write-Host "Test 6: Get database schema" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    action = "getSchema"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 7: Direct action - move meetings with dates
Write-Host "Test 7: Direct action - move meetings (ISO dates)" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    action = "moveMeetings"
    fromDate = "2026-02-06"
    toDate = "2026-02-10"
} | ConvertTo-Json
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 8: Query database with filters
Write-Host "Test 8: Query all meetings" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    action = "queryDatabase"
    filters = @{
        and = @(
            @{
                property = "Type"
                select = @{
                    equals = "Meeting"
                }
            },
            @{
                property = "Status"
                status = @{
                    does_not_equal = "Processed"
                }
            }
        )
    }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 9: Create new page
Write-Host "Test 9: Create new task" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    action = "createPage"
    properties = @{
        Name = @{
            type = "title"
            title = @(
                @{
                    text = @{
                        content = "New Test Task"
                    }
                }
            )
        }
        Date = @{
            type = "date"
            date = @{
                start = "2026-02-10"
            }
        }
        Type = @{
            type = "select"
            select = @{
                name = "Task"
            }
        }
        Status = @{
            type = "status"
            status = @{
                name = "Upcoming"
            }
        }
    }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
Write-Host ""
Read-Host "Press Enter to continue..."
Write-Host ""

# Test 10: Error handling - invalid command
Write-Host "Test 10: Error handling - invalid command" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"
$body = @{
    command = "do something random"
} | ConvertTo-Json
try {
    Invoke-RestMethod -Uri $WorkerUrl -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error:" $_.Exception.Message -ForegroundColor Red
}
Write-Host ""

Write-Host "======================================================================"
Write-Host "TESTS COMPLETE" -ForegroundColor Green
Write-Host "======================================================================"
