# MockMate — Real-Time AI Interview Companion

A desktop overlay app that floats over your screen during live interviews.  
Generates AI answers in real time. **Invisible to all screen recording software.**

## Quick Start

```bash
git clone https://github.com/vsv2014/MockMate
cd MockMate
npm install
cp .env.example .env   # add your API keys
npm run dev            # Electron overlay launches automatically
```

## Modes

### 🎯 Live Interview Companion
- Floats over **Zoom / Google Meet / Microsoft Teams** — always on top of every window
- Captures system audio — transcribes the interviewer's voice in real time via **Deepgram nova-2**
- Generates structured answers instantly, streamed word by word
- Press **`Ctrl+Shift+U`** to screenshot the screen — analyzes coding problems, slides, and whiteboards via **GPT-4o vision**
- Answers grounded in **your resume** — references your actual projects, never generic
- **Web search** auto-triggers for company/product questions — uses live data
- **Extra context field** — type mid-session to steer answers ("focus on Python", "system design round")
- **Post-session AI notes** — summary of questions covered when you end the session

### 🤖 Solo Practice
- AI interviewer asks open-ended questions calibrated to your target role and resume
- You answer out loud — it listens, probes with follow-ups, and scores you at the end
- Detailed scorecard: technical knowledge, communication, problem-solving, delivery

## Screen Protection

| Platform | Mechanism | Protection |
|---|---|---|
| **Windows** | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` | Invisible to all capture tools |
| **macOS** | `NSWindow.sharingType = NSWindowSharingNone` | Invisible to all capture tools |
| **Linux** | Document Picture-in-Picture (`getDisplayMedia` exclusion) | Invisible to Google Meet / Zoom |

**Hide shortcut:** Press `Alt+H` or `Ctrl+Shift+H` to completely hide the window — restore with the same shortcut. Works even when the window is not visible.

## Answer Intelligence

MockMate detects the question type and generates structured answers:

- **DSA / Algorithm** → pattern name (Sliding Window, BFS, DP…) + approach + time/space complexity
- **System Design** → requirements → scale estimate → components → key trade-off
- **Behavioral** → STAR format grounded in your resume — names your actual projects
- **Resume questions** → pulls exact achievements from your resume
- **Technical concepts** → definition + real-world analogy + common interview mistake
- **Company questions** → live web search for current company/product context

Every answer includes:
- **🟢 FROM YOUR RESUME** — grounded in your actual experience
- **🟡 GENERAL KNOWLEDGE** — standard technical knowledge
- **Buy-time phrase** — shown instantly while answer loads ("Yeah so, let me think...")
- **Watch out** — one specific mistake to avoid for this question type

## API Keys

| Key | Purpose | Free? | Link |
|---|---|---|---|
| `OPENAI_API_KEY` | GPT-4o answers + screen vision | Pay per use | [platform.openai.com](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | Fast AI answers | ✅ Free | [console.groq.com](https://console.groq.com/keys) |
| `GEMINI_API_KEY` | AI answers + vision alternative | ✅ Free | [aistudio.google.com](https://aistudio.google.com/apikey) |
| `DEEPGRAM_API_KEY` | Live audio transcription | ✅ $200 credits | [console.deepgram.com](https://console.deepgram.com) |
| `TAVILY_API_KEY` | Web search for company questions | ✅ Free | [tavily.com](https://tavily.com) |

**Minimum to run:** one LLM key + Deepgram key.

**Auto-fallback:** if one LLM provider is rate-limited, MockMate automatically switches to the next configured provider — no interruption.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+H` | Hide / restore window completely |
| `Ctrl+Shift+H` | Same as Alt+H |
| `Ctrl+Shift+U` | Capture screen → instant AI vision analysis |
| Drag title bar | Move overlay anywhere on screen |
| ◢ corner drag | Resize overlay |
| `click-thru` button | Click through the panel to interact with apps behind it |

## Scripts

```bash
npm run dev                  # Launch Electron overlay (recommended)
npm run dev:browser          # Browser only — no screen protection
npm run electron:build       # Build installer for current platform
npm run electron:build:win   # Windows .exe
npm run electron:build:mac   # macOS .dmg
npm run electron:build:linux # Linux .AppImage
```

## Supported Languages

English, Spanish, French, German, Portuguese, Hindi, Japanese, Chinese, Korean, Arabic, Italian, Dutch

## Architecture

```
Electron main window (alwaysOnTop, setContentProtection, skipTaskbar)
  └── React app (Vite)
        ├── Home screen — mode picker + keyboard shortcuts
        ├── Live Companion — audio capture + AI answers + Document PiP
        └── Solo Practice — AI interviewer + scoring report

API server (Express, port 3002)
  ├── POST /api/hint          — question → structured answer (auto-provider fallback)
  ├── POST /api/analyze-screen — screenshot → GPT-4o vision analysis
  ├── POST /api/interview     — Solo mode AI interviewer turn
  ├── POST /api/evaluate      — Solo mode end-of-session scoring
  └── POST /api/deepgram-token — short-lived STT token

Audio pipeline
  desktopCapturer (system audio) → AudioContext → PCM16 → Deepgram WebSocket → LLM
```

## Privacy

- Audio streamed to **Deepgram** for transcription (per-session, not stored)
- Screenshots sent to **OpenAI / Gemini** only when you press `Ctrl+Shift+U`
- Resume text sent to LLM as context — never stored server-side
- No user accounts, no analytics, no data retention
