try {
  $body = @{ prompt="Human: Hello`nAssistant:"; max_tokens_to_sample=20 } | ConvertTo-Json -Depth 5
  $resp = Invoke-WebRequest -Uri 'https://api.anthropic.com/v1/complete?model=claude-2' -Method Post -Headers @{ 'Content-Type'='application/json'; 'x-api-key'=$env:ANTHROPIC_API_KEY } -Body $body -UseBasicParsing -ErrorAction Stop
  Write-Output "SUCCESS $($resp.StatusCode)"
  Write-Output $resp.Content
} catch {
  $errResp = $_.Exception.Response
  if ($errResp -ne $null) {
    $status = $errResp.StatusCode.value__
    $text = (New-Object System.IO.StreamReader($errResp.GetResponseStream())).ReadToEnd()
    Write-Output "ERROR $status"
    Write-Output $text
  } else {
    Write-Output "ERROR: $($_.Exception.Message)"
  }
}
