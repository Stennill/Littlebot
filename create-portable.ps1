# Simple script to create a portable version of LittleBot

Write-Host "Creating portable LittleBot package..." -ForegroundColor Cyan

# Create output directory
$outputDir = ".\LittleBot-Portable"
if (Test-Path $outputDir) {
    Remove-Item -Recurse -Force $outputDir
}
New-Item -ItemType Directory -Path $outputDir | Out-Null

# Copy necessary files
Write-Host "Copying files..." -ForegroundColor Yellow
Copy-Item "main.js" $outputDir
Copy-Item "preload.js" $outputDir
Copy-Item "package.json" $outputDir
Copy-Item -Recurse "renderer" $outputDir
Copy-Item -Recurse "node_modules" $outputDir

# Create a README
$readme = @"
# LittleBot Portable

## Installation
1. Make sure you have Node.js installed
2. Open PowerShell in this folder
3. Run: npm install electron
4. Run: npm start

## Requirements
- Node.js (https://nodejs.org/)
- Anthropic API key

## First Time Setup
1. Launch LittleBot
2. Click the settings button (⚙️)
3. Enter your Anthropic API key
4. Save settings

Enjoy your AI assistant!
"@
Set-Content -Path "$outputDir\README.txt" -Value $readme

# Create a run script
$runScript = @"
@echo off
echo Starting LittleBot...
call npm start
"@
Set-Content -Path "$outputDir\run.bat" -Value $runScript

# Compress to ZIP
Write-Host "Creating ZIP file..." -ForegroundColor Yellow
$zipPath = ".\LittleBot-Portable.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath
}
Compress-Archive -Path $outputDir -DestinationPath $zipPath

Write-Host "`nPortable package created successfully!" -ForegroundColor Green
Write-Host "Location: $zipPath" -ForegroundColor Green
Write-Host "`nYou can share this ZIP file. Recipients will need Node.js installed." -ForegroundColor Cyan
