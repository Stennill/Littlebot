$apiKey = $env:ANTHROPIC_API_KEY

if (-not $apiKey) {
  Write-Host "ERROR: ANTHROPIC_API_KEY not set" -ForegroundColor Red
  exit 1
}

$headers = @{
  "Content-Type" = "application/json"
  "x-api-key" = $apiKey
  "anthropic-version" = "2023-06-01"
}

$body = @{
  model = "claude-sonnet-4-5-20250929"
  max_tokens = 100
  messages = @(
    @{
      role = "user"
      content = "Say 'Hello from LittleBot!' in a friendly way."
    }
  )
} | ConvertTo-Json -Depth 10

Write-Host "Testing Anthropic Messages API with version 2023-06-01..." -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest -Uri "https://api.anthropic.com/v1/messages" `
    -Method POST `
    -Headers $headers `
    -Body $body `
    -ContentType "application/json"

  Write-Host "`nSUCCESS! Status: $($response.StatusCode)" -ForegroundColor Green
  Write-Host "`nResponse:" -ForegroundColor Yellow
  $json = $response.Content | ConvertFrom-Json
  Write-Host ($json | ConvertTo-Json -Depth 10)
  
  if ($json.content -and $json.content.Count -gt 0) {
    Write-Host "`nClaude says:" -ForegroundColor Cyan
    $json.content | ForEach-Object {
      if ($_.type -eq "text") {
        Write-Host $_.text -ForegroundColor White
      }
    }
  }
} catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "Response body:" -ForegroundColor Yellow
    Write-Host $responseBody
  }
}
