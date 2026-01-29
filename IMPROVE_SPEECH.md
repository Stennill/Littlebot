# Improving Speech Recognition Accuracy

Windows Speech Recognition needs to be trained to understand your voice better. Here's how to improve accuracy:

## Quick Training (Recommended)

1. **Open Windows Speech Recognition Training**
   ```powershell
   control.exe /name Microsoft.SpeechRecognition
   ```
   Or search for "Speech Recognition" in Windows Settings

2. **Train Your Voice**
   - Click "Train your computer to better understand you"
   - Read the provided text aloud for 5-10 minutes
   - The more you train, the better it gets

3. **Set Up Microphone**
   - Click "Set up microphone" 
   - Follow the wizard to optimize mic settings
   - Speak at normal volume and distance

## Advanced Settings

### 1. Enable Speech Recognition at Startup
```powershell
# Run this in PowerShell as Admin
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Speech\UserSettings" -Name "SpeechRecognitionStartup" -Value 1
```

### 2. Improve Microphone Quality
- **Right-click the speaker icon** → Sounds → Recording
- **Select your microphone** → Properties
- **Levels tab**: Set microphone to 80-100%
- **Enhancements tab**: Enable "Noise Suppression" and "Acoustic Echo Cancellation"
- **Advanced tab**: Set to 48000 Hz, 24 bit

### 3. Reduce Background Noise
- Use a **headset microphone** (much better than laptop mic)
- Speak in a **quiet room**
- Position mic 2-3 inches from your mouth
- Avoid fans, air conditioning noise

### 4. Speaking Tips for Better Recognition
- **Speak clearly** but at normal pace
- **Don't shout** - use normal conversational volume
- **Pause briefly** between sentences
- **Enunciate** words, especially ending consonants
- **Face the microphone**

## Test Your Setup

Run this PowerShell script to test speech recognition:
```powershell
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)

Write-Host "Say something..."
$result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))

if ($result) {
    Write-Host "You said: $($result.Text)"
    Write-Host "Confidence: $([math]::Round($result.Confidence * 100, 0))%"
} else {
    Write-Host "No speech detected"
}

$recognizer.Dispose()
```

## Confidence Scores

LittleBot now shows confidence scores:
- **80-100%** ✅ Excellent - very accurate
- **60-79%** ⚠️ Good - mostly accurate
- **40-59%** ⚠️ Fair - may have errors
- **Below 40%** ❌ Poor - needs training

If you consistently get low scores:
1. Train Windows Speech Recognition (see above)
2. Check microphone setup
3. Reduce background noise
4. Try a better microphone

## Alternative: Use Text Input

If speech recognition isn't working well:
- Just **type** your messages in the input box
- LittleBot will still **speak** the responses
- This is faster and more accurate than training speech recognition

## Hardware Recommendations

For best results:
- **USB headset** with boom mic ($20-50)
- **Standalone USB microphone** like Blue Yeti ($50-130)
- **Gaming headset** with noise-canceling mic

Laptop built-in mics often give poor results due to:
- Distance from mouth
- Poor quality
- Background noise pickup
