const { Innertube } = require("youtubei.js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const videoId = req.query.v;
  if (!videoId) {
    res.status(400).json({ error: "Missing ?v= video ID" });
    return;
  }

  try {
    // Create client with full player retrieval for deciphering
    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    });

    // Get info — this also populates the decipher function
    const info = await yt.getBasicInfo(videoId);

    const title = (info.basic_info.title || "audio")
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Try to find audio formats with direct URLs (no decipher needed)
    const allFormats = [
      ...(info.streaming_data?.adaptive_formats || []),
      ...(info.streaming_data?.formats || []),
    ];

    // Look for audio formats that already have a direct URL
    const audioWithUrl = allFormats
      .filter((f) => f.mime_type?.startsWith("audio/") && f.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    let streamUrl = null;
    let contentType = "audio/webm";

    if (audioWithUrl.length > 0) {
      // Found a format with direct URL — no decipher needed
      streamUrl = audioWithUrl[0].url;
      contentType = audioWithUrl[0].mime_type?.split(";")[0] || "audio/webm";
    } else {
      // No direct URLs, try to decipher
      const audioFormats = allFormats
        .filter((f) => f.mime_type?.startsWith("audio/"))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audioFormats.length > 0) {
        const fmt = audioFormats[0];
        // Try to get deciphered URL from the format object
        if (fmt.decipher) {
          streamUrl = fmt.decipher(yt.session.player);
        } else if (fmt.url) {
          streamUrl = fmt.url;
        }
        contentType = fmt.mime_type?.split(";")[0] || "audio/webm";
      }
    }

    if (!streamUrl) {
      res.status(404).json({
        error: "Could not get audio URL. Video may be restricted.",
        formats_found: allFormats.length,
        audio_found: allFormats.filter((f) => f.mime_type?.startsWith("audio/")).length,
      });
      return;
    }

    const filename = encodeURIComponent(title + ".webm");
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="' + filename + "\"; filename*=UTF-8''" + filename
    );

    // Proxy the audio stream to the client
    const audioResp = await fetch(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
      },
    });

    if (!audioResp.ok) {
      res.status(500).json({ error: "Audio stream returned HTTP " + audioResp.status });
      return;
    }

    const reader = audioResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    console.error("Download error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Download failed" });
    }
  }
};
