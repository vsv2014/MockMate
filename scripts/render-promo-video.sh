#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-solo}"
case "$MODE" in
  solo)
    CARD="marketing/card-solo-practice.png"
    VOICE="marketing/voiceover-solo.mp3"
    SRT="marketing/captions-solo.srt"
    ;;
  live)
    CARD="marketing/card-live-mode.png"
    VOICE="marketing/voiceover-live.mp3"
    SRT="marketing/captions-live.srt"
    ;;
  *)
    echo "usage: $0 [solo|live]" >&2
    exit 2
    ;;
esac

for f in "$CARD" "$VOICE" "$SRT"; do
  [[ -f "$f" ]] || { echo "missing input: $f" >&2; exit 1; }
done

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
mkdir -p marketing/rendered
OUT="marketing/rendered/mockmate-${MODE}.mp4"

DURATION="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VOICE")"
FRAMES="$(python3 - <<PY
import math
print(max(1, math.ceil(float('${DURATION:-10}') * 30)))
PY
)"

ffmpeg -y \
  -loop 1 -i "$CARD" \
  -i "$VOICE" \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.00045,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=1080x1920:fps=30,subtitles=${SRT}" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -shortest -movflags +faststart "$OUT"

echo "rendered $OUT"
