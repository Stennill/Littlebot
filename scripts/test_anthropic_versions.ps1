$versions = @('2024-10-01','2024-06-01','2024-04-01','2024-03-01','2024-01-01','2023-12-01','2023-10-11','2023-10-03')
$bodyObj = @{ model='claude-2'; prompt="Human: Hello`nAssistant:"; max_tokens_to_sample=20 }
$bodyJson = $bodyObj | ConvertTo-Json -Depth 5

foreach ($v in $versions) {
  Write-Output "----- Trying Anthropic-Version: $v -----"
  try {
    $resp = Invoke-WebRequest -Uri 'https://api.anthropic.com/v1/complete' -Method Post `
      -Headers @{ 'Content-Type'='application/json'; 'x-api-key'=$env:ANTHROPIC_API_KEY; 'Anthropic-Version'=$v } `
      -Body $bodyJson -UseBasicParsing -ErrorAction Stop

    Write-Output "SUCCESS ($($resp.StatusCode))"
    Write-Output $resp.Content
    break
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
}
