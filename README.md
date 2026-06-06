# MockMate — Real-Time AI Interview Companion

MockMate is an **Electron desktop app** that floats over your screen during live interviews, generates AI answers in real time, and is **completely invisible to screen recording software** (Zoom, Teams, Meet, OBS).

> Built as a serious alternative to LockedIn AI — with resume-grounded answers, DSA pattern detection, and true OS-level screen capture protection.

---

## What it does

### 🎯 Live Interview Companion
- Runs as a **floating overlay** on top of Zoom / Google Meet / Microsoft Teams
- Captures system audio — hears the interviewer's voice through your speakers
- Transcribes questions in real time via **Deepgram nova-2**
- Generates a full natural-sounding answer in 2–4 seconds
- Press **`Ctrl+Shift+U`** to screenshot the screen — analyzes coding problems, slides, whiteboards via **Gemini vision**
- Answer streams in word by word so you can read and speak naturally

### 🤖 Solo Practice
- AI interviewer asks open-ended questions calibrated to your target role
- You answer out loud — it listens, probes with follow-ups, and scores you at the end
- Detailed scorecard: technical knowledge, communication, problem-solving, delivery

---

## Why MockMate beats LockedIn AI

| Feature | LockedIn AI | MockMate |
|---|---|---|
| Resume-grounded answers | ❌ Generic | ✅ Uses YOUR projects and experience |
| Screen capture protection | ⚠ Partial | ✅ `WDA_EXCLUDEFROMCAPTURE` / `NSWindow.sharingType=none` — blanked at OS level |
| DSA pattern detection | ❌ | ✅ Sliding Window, BFS, DP, etc. |
| Natural speech style | ❌ Sounds like ChatGPT | ✅ "Yeah so in my case…" — human rules |
| Follow-up handling | ❌ | ✅ Conversation context (last 6 turns) |
| Buy-time phrase | ❌ | ✅ Instant filler shown while loading |
| Screen + vision analysis | ✅ | ✅ `Ctrl+Shift+U` → Gemini vision |
| Confidence markers | ❌ | ✅ 🟢 From your resume / 🟡 General knowledge |

---

## Screen protection

MockMate uses `setContentProtection(true)` on the overlay window:
- **Windows** → `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 
- **macOS** → `NSWindow.sharingType = NSWindowSharingNone`

The window appears **black/blank** in every screen capture tool — Zoom sharing, Teams recording, OBS, `getDisplayMedia`. The interviewer never knows it exists.

---

## Setup

### 1. Clone and install
```bash
git clone <repo-url>
cd interview-coach
npm install
```

### 2. Configure `.env`
```bash
# Required — at least one LLM key:
GROQ_API_KEY=          # https://console.groq.com/keys (free, fastest)
GEMINI_API_KEY=        # https://aistudio.google.com/apikey (required for screen analysis)

# Required for live audio transcription:
DEEPGRAM_API_KEY=      # https://console.deepgram.com (free credits)
```

### 3. Run
```bash
npm run dev
```

The **Electron overlay window** opens automatically in the top-right of your screen.  
The browser (`localhost:5174`) shows a "use the desktop app" message — ignore it.

---

## Usage

### Live Interview Companion
1. Launch MockMate → click **🎯 Live Interview Companion**
2. Enter your name, target role, and paste your resume (makes answers resume-specific)
3. Select audio source:
   - **System Audio** — captures everything you hear through speakers/headphones (interviewer's voice from Zoom/Teams)
   - **Microphone** — fallback if system audio doesn't work
4. Click **Start listening →**
5. Join your Zoom/Teams/Meet call normally
6. When the interviewer speaks, MockMate automatically detects the question and generates an answer
7. **Read the answer** in the overlay — speak it in your own words

**Keyboard shortcuts:**
- `Ctrl+Shift+U` — screenshot current screen → instant vision analysis (coding problems, slides, whiteboards)
- `Alt+H` — toggle stealth mode (panel fades to near-invisible)
- Drag title bar — move the overlay anywhere
- ◢ corner — resize the overlay

### Solo Practice
1. Launch MockMate → click **🤖 Solo Practice**
2. Fill in your target role and paste your resume
3. Click **Start interview →** — AI interviewer begins asking questions
4. Answer aloud — it listens and probes with follow-ups
5. Click **End & get feedback** for your scored report

---

## Answer intelligence

MockMate operates in two modes based on question type:

**CS Expert mode** (DSA, technical, system design):
- Identifies algorithm pattern: Sliding Window, BFS, DFS, DP, HashMap, Heap, etc.
- Shows time + space complexity
- Gives approach-first answer — "Yeah so this is a sliding window problem…"

**Resume Narrator mode** (behavioral, project questions):
- Grounds answer in YOUR resume — names your actual projects
- STAR format for behavioral: situation → your decision → measurable result
- Never invents facts not in your resume

Every answer includes:
- **🟢 FROM YOUR RESUME** or **🟡 GENERAL** confidence badge
- Buy-time phrase shown instantly while LLM generates: *"Yeah so, let me think of a good example…"*
- Word-by-word streaming so you can read as it arrives

---

## Architecture

```
Electron main process
  ├── Main window (alwaysOnTop, setContentProtection)
  │     └── Vite React app (localhost:5174)
  ├── Co-pilot window (alwaysOnTop, setContentProtection, frame:false)
  │     └── copilot.html — protected hint display
  └── Global shortcut: Ctrl+Shift+U → desktopCapturer → vision API

Express API server (port 3002)
  ├── POST /api/hint        — audio question → structured hint (Groq/Gemini)
  ├── POST /api/analyze-screen — screenshot → vision analysis (Gemini)
  ├── POST /api/interview   — Solo mode AI interviewer turn
  ├── POST /api/evaluate    — Solo mode scoring
  └── POST /api/deepgram-token — short-lived STT token

Audio pipeline (Live Companion)
  desktopCapturer (system audio) → AudioContext → PCM16 → Deepgram WebSocket → onFinal → /api/hint
```

---

## API Keys Summary

| Key | Used for | Free tier |
|---|---|---|
| `GROQ_API_KEY` | AI answers (text) | ✅ Generous free tier |
| `GEMINI_API_KEY` | AI answers + screen vision | ✅ Free at aistudio.google.com |
| `DEEPGRAM_API_KEY` | Live audio transcription | ✅ $200 free credits |

Minimum to run: **one LLM key + Deepgram key**.  
Screen analysis (`Ctrl+Shift+U`) requires **Gemini API key** specifically (vision model).

---

## Scripts

```bash
npm run dev          # Start everything: API server + Vite + Electron overlay
npm run dev:browser  # Start without Electron (browser only — limited)
npm run build        # Build Vite for production
```

---

## Privacy

- Audio is streamed to **Deepgram** for transcription
- Screenshots (when you press Ctrl+Shift+U) are sent to **Google Gemini** for analysis
- Your resume text is sent to **Groq or Gemini** as context for answers
- Nothing is stored — all processing is per-session
