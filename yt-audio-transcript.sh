#!/bin/bash

# YouTube Audio Transcript and Summary Generator
# Usage: ./yt-audio-transcript.sh [-f] <youtube_url>
# Options: -f  Force processing even if cached files exist
# Requirements: pyenv


set -e

# Parse command line arguments
FORCE=false
URL=""

for arg in "$@"; do
  case $arg in
    -f)
      FORCE=true
      ;;
    -*)
      echo "Invalid option: $arg" >&2
      echo "Usage: $0 [-f] <youtube_url> or $0 <youtube_url> [-f]"
      exit 1
      ;;
    *)
      if [ -z "$URL" ]; then
        URL="$arg"
      fi
      ;;
  esac
done

# Activate pyenv environment
VENV_NAME="yt-transcript-env"
export PYENV_ROOT="$HOME/.pyenv"

if [ -d "$PYENV_ROOT" ]; then
  export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
  eval "$(pyenv virtualenv-init -)"
  pyenv activate "$VENV_NAME"

  pip install --upgrade pip
  pip install yt-dlp==2025.6.9 openai-whisper==20240930
else
  echo "❌  No se encontró pyenv en $PYENV_ROOT"
  exit 1
fi

if [ -z "$URL" ]; then
    echo "Usage: $0 [-f] <youtube_url> or $0 <youtube_url> [-f]"
    exit 1
fi
TEMP_DIR=$(mktemp -d)
AUDIO_FILE="$TEMP_DIR/audio.wav"
TRANSCRIPT_FILE="$TEMP_DIR/transcript.txt"
SUMMARY_FILE="$TEMP_DIR/summary.txt"

# Permanent output directory
OUTPUT_DIR="$HOME/yt-transcripts"
mkdir -p "$OUTPUT_DIR"

VIDEO_ID=$(echo "$URL" | sed -n 's/.*[?&]v=\([^&]*\).*/\1/p' | head -c 11)
if [ -z "$VIDEO_ID" ]; then
    VIDEO_ID=$(date +%s)
fi

FINAL_TRANSCRIPT="$OUTPUT_DIR/${VIDEO_ID}_transcript.txt"
FINAL_SUMMARY="$OUTPUT_DIR/${VIDEO_ID}_summary.txt"

# Check if files already exist (cache)
if [ "$FORCE" = false ] && [ -f "$FINAL_TRANSCRIPT" ] && [ -f "$FINAL_SUMMARY" ]; then
    echo "📋 Found cached files for this video!"
    echo
    echo "=== VIDEO SUMMARY ==="
    cat "$FINAL_SUMMARY"
    echo
    echo "=== FULL TRANSCRIPT ==="
    cat "$FINAL_TRANSCRIPT"
    echo
    echo "Files already exist at:"
    echo "Summary: $FINAL_SUMMARY"
    echo "Transcript: $FINAL_TRANSCRIPT"
    exit 0
fi

cleanup() {
    rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

echo "📥 Downloading audio from YouTube..."
if ! command -v yt-dlp &> /dev/null; then
    echo "Error: yt-dlp is not installed. Please install it first."
    echo "Install with: pip install yt-dlp"
    exit 1
fi

yt-dlp -x --audio-format wav --audio-quality 0 -o "$AUDIO_FILE" "$URL"

echo "🎤 Converting audio to text..."
if command -v whisper &> /dev/null; then
    whisper "$AUDIO_FILE" --output_dir "$TEMP_DIR" --output_format txt --model base
    TRANSCRIPT_FILE="$TEMP_DIR/audio.txt"
elif command -v speech-recognition &> /dev/null; then
    python3 -c "
import speech_recognition as sr
import wave
import contextlib

r = sr.Recognizer()
with contextlib.closing(wave.open('$AUDIO_FILE','r')) as f:
    frames = f.getnframes()
    rate = f.getframerate()
    duration = frames / float(rate)

with sr.AudioFile('$AUDIO_FILE') as source:
    audio = r.record(source)
    
try:
    text = r.recognize_google(audio)
    with open('$TRANSCRIPT_FILE', 'w') as f:
        f.write(text)
except sr.UnknownValueError:
    print('Could not understand audio')
except sr.RequestError as e:
    print(f'Error: {e}')
"
else
    echo "Error: No speech recognition tool found."
    echo "Please install either:"
    echo "  - OpenAI Whisper: pip install openai-whisper"
    echo "  - SpeechRecognition: pip install SpeechRecognition pyaudio"
    exit 1
fi

if [ ! -f "$TRANSCRIPT_FILE" ]; then
    echo "Error: Transcript file not created"
    exit 1
fi

echo "📝 Generating summary..."
TRANSCRIPT_TEXT=$(cat "$TRANSCRIPT_FILE")

if command -v curl &> /dev/null && [ -n "$OPENAI_API_KEY" ]; then
    curl -s -X POST "https://api.openai.com/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d "{
            \"model\": \"gpt-4o\",
            \"messages\": [{
                \"role\": \"user\",
                \"content\": \"Create a concise summary of this transcript. Include:\\n1. 2-3 key points (bullet format)\\n2. Main topic/theme\\n3. Any important conclusions or actionable insights\\n\\nKeep it under 150 words.\\n\\nTranscript:\\n$TRANSCRIPT_TEXT\"
            }],
            \"max_tokens\": 500
        }" | jq -r '.choices[0].message.content' > "$SUMMARY_FILE"
else
    echo "No AI summarization tool available. Creating basic summary..."
    echo "$TRANSCRIPT_TEXT" | head -n 10 > "$SUMMARY_FILE"
    echo "..." >> "$SUMMARY_FILE"
fi

# Copy files to permanent location
cp "$TRANSCRIPT_FILE" "$FINAL_TRANSCRIPT"
cp "$SUMMARY_FILE" "$FINAL_SUMMARY"

echo "✅ Processing complete!"
echo
echo "=== FULL TRANSCRIPT ==="
cat "$FINAL_TRANSCRIPT"
echo
echo "=== VIDEO SUMMARY ==="
cat "$FINAL_SUMMARY"

echo
echo "Files saved to:"
echo "Summary: $FINAL_SUMMARY"
echo "Transcript: $FINAL_TRANSCRIPT"