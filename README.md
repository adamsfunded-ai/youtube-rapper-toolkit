# YouTube Rapper Toolkit 🎤

A Firefox extension built for producers and rappers who write to YouTube beats. Three tools in one:

1. **Sort by Recently Added** — One-click sort on your Watch Later playlist
2. **Beat Looper** — Loop any section of a beat with precise start/end controls, keyboard shortcuts, and persistent state
3. **MP3 Download** — One-click download of any YouTube video as MP3, with auto-detected Key & BPM in the filename

![Extension Screenshot](screenshots/demo.png)

---

## Install the Extension

### Option A: Firefox Add-ons (Recommended)
> Coming soon — link will be here once approved

### Option B: Install from GitHub
1. Download or clone this repo
2. Open Firefox → `about:debugging` → **This Firefox**
3. Click **Load Temporary Add-on** → select `manifest.json`

> **Note:** Temporary add-ons are removed when Firefox closes. For permanent install, use the signed .xpi from the Releases page or the Firefox Add-ons store.

---

## MP3 Download Setup (Required for download feature)

The Sort and Beat Looper features work immediately. The **MP3 Download** feature requires a small local server running on your PC. This is because YouTube blocks downloads from cloud servers — it has to come from your own machine.

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (must be in your PATH)
- [FFmpeg](https://ffmpeg.org/) (must be in your PATH)

### Quick Install (Windows)

1. **Install Node.js** — Download from [nodejs.org](https://nodejs.org/) and run the installer

2. **Install yt-dlp and FFmpeg** — Open a terminal and run:
   ```
   winget install yt-dlp.yt-dlp
   winget install Gyan.FFmpeg
   ```

3. **Start the server:**
   ```
   cd server
   npm start
   ```

4. **Auto-start on boot (optional):** Double-click `server/install-startup.bat`
   - This creates a Windows scheduled task that runs the server silently at login
   - Uses ~0 CPU and ~30MB RAM when idle
   - To remove: double-click `server/uninstall-startup.bat`

### Quick Install (Mac/Linux)

1. **Install dependencies:**
   ```bash
   # Mac
   brew install node yt-dlp ffmpeg

   # Linux (Ubuntu/Debian)
   sudo apt install nodejs npm ffmpeg
   pip install yt-dlp
   ```

2. **Update the server config:** Edit `server/server.js` and remove the `--ffmpeg-location` line (it'll use your system FFmpeg)

3. **Start the server:**
   ```bash
   cd server
   npm start
   ```

4. **Auto-start on boot (optional):** Add to your shell profile or create a systemd service

### Verify It Works
Once the server is running, visit http://127.0.0.1:3456/health — you should see:
```json
{"status":"ok","service":"yt-rapper-toolkit"}
```

The extension will show a green dot next to "Local server" when connected.

---

## Features

### Sort by Recently Added
On any Watch Later page, click the **Sort: Recently Added** button to instantly sort your playlist by most recently added. No more scrolling through old videos.

### Beat Looper
- Set precise loop start/end with click, drag, or keyboard
- **Keyboard shortcuts:** `L` = toggle loop, `[` = set start, `]` = set end, `\` = jump to start
- Loop state is saved per video for 7 days
- Quick presets for Intro, Verse 1, Hook, or Full Beat
- Nudge buttons for fine-tuning (±0.5s)

### MP3 Download
- One-click download as MP3
- Auto-detects **Key** and **BPM** from the video title and description
- Key & BPM displayed as an orange badge on the download bar
- Filename format: `Title - Key BPM - Channel.mp3`
- Downloads go straight to your Downloads folder

---

## How It Works

The extension injects a content script into YouTube pages. The Sort and Looper features are pure JavaScript — no server needed. The download feature communicates with a tiny Node.js server running on `127.0.0.1:3456` that uses yt-dlp to grab the audio and FFmpeg to convert it to MP3.

```
[Firefox Extension] → content.js detects video info
                    → background.js fetches from local server (bypasses CORS)
                    → server uses yt-dlp + ffmpeg to download & convert
                    → browser.downloads API saves to Downloads folder
```

---

## Project Structure

```
├── manifest.json          # Extension manifest (Manifest V2)
├── content.js             # Main extension logic (injected into YouTube)
├── background.js          # Background script (handles downloads via local server)
├── styles.css             # UI styling
├── icons/                 # Extension icons
└── server/                # Local download server
    ├── server.js          # Node.js HTTP server (port 3456)
    ├── package.json
    ├── install-startup.bat    # Windows auto-start installer
    ├── uninstall-startup.bat  # Windows auto-start remover
    └── start-hidden.vbs       # Windows hidden launcher
```

---

## Updating yt-dlp

YouTube frequently changes their site. If downloads stop working, update yt-dlp:
```
yt-dlp -U
```
or
```
winget upgrade yt-dlp.yt-dlp
```

---

## License

MIT
