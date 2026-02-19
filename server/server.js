const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 3456;
const TEMP_DIR = path.join(os.tmpdir(), "yt-rapper-toolkit");

// Auto-detect FFmpeg location. Checks common install paths on Windows.
// If FFmpeg is already in your PATH, this is not needed.
function findFfmpegDir() {
  // Check if ffmpeg is in PATH already
  const { execSync } = require("child_process");
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return null; // ffmpeg is in PATH, no need to specify location
  } catch (e) { /* not in PATH */ }

  // Check common Windows install locations
  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links"),
  ];

  // Search winget packages for ffmpeg
  const wingetDir = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(wingetDir)) {
    try {
      const entries = fs.readdirSync(wingetDir);
      for (const e of entries) {
        if (e.toLowerCase().includes("ffmpeg")) {
          // Look for bin dir inside
          const pkgDir = path.join(wingetDir, e);
          const binCandidates = [];
          function findBin(dir, depth) {
            if (depth > 3) return;
            try {
              for (const f of fs.readdirSync(dir)) {
                const full = path.join(dir, f);
                if (f === "bin" && fs.statSync(full).isDirectory()) binCandidates.push(full);
                else if (fs.statSync(full).isDirectory()) findBin(full, depth + 1);
              }
            } catch (e) {}
          }
          findBin(pkgDir, 0);
          if (binCandidates.length > 0) candidates.unshift(binCandidates[0]);
        }
      }
    } catch (e) {}
  }

  for (const c of candidates) {
    const ffmpegExe = path.join(c, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(ffmpegExe)) return c;
  }
  return null;
}

const FFMPEG_DIR = findFfmpegDir();

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Filename, Content-Disposition");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, "http://127.0.0.1:" + PORT);
  const pathname = reqUrl.pathname;

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "yt-rapper-toolkit" }));
    return;
  }

  if (pathname === "/download") {
    const videoId = reqUrl.searchParams.get("v");
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing video ID" }));
      return;
    }

    try {
      // Get title + channel name using yt-dlp
      const { title, channel } = await getVideoMeta(videoId);
      const safeName = ((title || "audio") + (channel ? " - " + channel : ""))
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Download and convert to MP3 in temp dir
      const tempFile = path.join(TEMP_DIR, videoId);
      const mp3Path = tempFile + ".mp3";

      // Clean up any old temp file for this video
      try { fs.unlinkSync(mp3Path); } catch (e) {}

      await new Promise((resolve, reject) => {
        let stderrOutput = "";
        const ytdlpArgs = [
          "-f", "bestaudio",
          "--extract-audio",
          "--audio-format", "mp3",
          "--audio-quality", "0",
          "--no-playlist",
        ];
        if (FFMPEG_DIR) ytdlpArgs.push("--ffmpeg-location", FFMPEG_DIR);
        ytdlpArgs.push("-o", tempFile + ".%(ext)s");
        ytdlpArgs.push("https://www.youtube.com/watch?v=" + videoId);

        const ytdlp = spawn("yt-dlp", ytdlpArgs);

        ytdlp.stderr.on("data", (d) => { stderrOutput += d.toString(); });
        ytdlp.on("close", (code) => {
          // yt-dlp may exit with 1 due to warnings but still produce the file
          if (fs.existsSync(mp3Path)) resolve();
          else reject(new Error("yt-dlp failed (code " + code + "): " + stderrOutput.slice(-200)));
        });
        ytdlp.on("error", reject);
      });

      const stat = fs.statSync(mp3Path);
      const filename = encodeURIComponent(safeName + ".mp3");

      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size,
        "Content-Disposition": 'attachment; filename="' + filename + "\"; filename*=UTF-8''" + filename,
        "X-Filename": Buffer.from(safeName + ".mp3").toString("base64"),
      });

      const stream = fs.createReadStream(mp3Path);
      stream.pipe(res);
      stream.on("end", () => {
        // Clean up temp file after sending
        try { fs.unlinkSync(mp3Path); } catch (e) {}
      });

    } catch (err) {
      console.error("Download error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
    return;
  }

  // Fast endpoint: returns title, channel, and description for key/BPM parsing
  if (pathname === "/meta") {
    const videoId = reqUrl.searchParams.get("v");
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing video ID" }));
      return;
    }

    try {
      const meta = await getVideoMetaFull(videoId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(meta));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === "/info") {
    const videoId = reqUrl.searchParams.get("v");
    if (!videoId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing ?v= video ID" }));
      return;
    }

    try {
      const info = await getVideoInfo(videoId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// Get video title + channel name via yt-dlp
function getVideoMeta(videoId) {
  return new Promise((resolve) => {
    let output = "";
    const proc = spawn("yt-dlp", [
      "--print", "%(title)s\n%(channel)s",
      "--no-playlist",
      "--no-warnings",
      "--skip-download",
      "https://www.youtube.com/watch?v=" + videoId,
    ]);
    proc.stdout.on("data", (d) => { output += d.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", () => {
      const lines = output.trim().split("\n");
      resolve({ title: lines[0] || "audio", channel: lines[1] || "" });
    });
    proc.on("error", () => resolve({ title: "audio", channel: "" }));
  });
}

// Get video title + channel + description via yt-dlp (fast — no download)
function getVideoMetaFull(videoId) {
  return new Promise((resolve) => {
    let output = "";
    const proc = spawn("yt-dlp", [
      "--print", "%(title)s\n%(channel)s\n%(description)s",
      "--no-playlist",
      "--no-warnings",
      "--skip-download",
      "https://www.youtube.com/watch?v=" + videoId,
    ]);
    proc.stdout.on("data", (d) => { output += d.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", () => {
      const lines = output.trim().split("\n");
      const title = lines[0] || "";
      const channel = lines[1] || "";
      // Description is everything from line 3 onwards (may contain newlines)
      const description = lines.slice(2).join("\n") || "";
      resolve({ title, channel, description });
    });
    proc.on("error", () => resolve({ title: "", channel: "", description: "" }));
  });
}

// Get video info via yt-dlp
function getVideoInfo(videoId) {
  return new Promise((resolve, reject) => {
    let output = "";
    const proc = spawn("yt-dlp", [
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      "https://www.youtube.com/watch?v=" + videoId,
    ]);
    proc.stdout.on("data", (d) => { output += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) { reject(new Error("yt-dlp failed")); return; }
      try {
        const data = JSON.parse(output);
        resolve({
          title: data.title,
          duration: data.duration,
          author: data.uploader || data.channel,
        });
      } catch (e) { reject(e); }
    });
    proc.on("error", reject);
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log("YT Rapper Toolkit server running on http://127.0.0.1:" + PORT);
});
