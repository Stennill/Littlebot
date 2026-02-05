# Microphone Test Guide

## What I Fixed:

1. **Added microphone permission handling** - Electron now automatically grants microphone access
2. **Added error handling** - Better error messages if mic fails
3. **Added permission request** - Properly requests getUserMedia before starting recognition
4. **Added error callbacks** - Handles no-speech, audio-capture, and permission-denied errors

## How to Test:

1. **Launch the app** (should already be running)
2. **Click the 🎤 microphone button** in the bottom-right controls
3. **Allow microphone access** if prompted by Windows
4. **Speak clearly** - say something like "Hello LittleBot"
5. **Wait for the button to change back** to 🎤 (means it's done listening)
6. Your spoken text should appear as a message

## Troubleshooting:

### If you see "Microphone permission denied":
- Check Windows Settings → Privacy → Microphone
- Make sure "Allow apps to access your microphone" is ON
- Restart the app after changing settings

### If you see "No microphone found":
- Connect a microphone or headset
- Check Windows Sound settings to ensure mic is detected
- Set your microphone as the default recording device

### If you see "No speech detected":
- Speak louder or move closer to the mic
- Check mic volume in Windows Sound settings
- Test your mic in Windows Settings → Sound → Input

### If recognition keeps stopping immediately:
- This is normal - it stops after detecting one phrase
- Click the 🎤 button again to start a new recording
- The button shows ⏹ while actively listening

## What Works Now:

✅ Microphone permission auto-granted in Electron
✅ Better error messages for debugging
✅ Proper async permission request flow
✅ Speech-to-text transcription
✅ Auto-send transcribed text to LittleBot
