// Background script — handles cross-origin fetches to the local server
// Content scripts on youtube.com can't directly fetch 127.0.0.1 (CORS),
// but background scripts can with the right permissions.
// Uses browser.downloads API to save directly to Downloads folder.

const LOCAL_SERVER = "http://127.0.0.1:3456";

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "health") {
    fetch(LOCAL_SERVER + "/health", { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .then((ok) => sendResponse({ online: ok }))
      .catch(() => sendResponse({ online: false }));
    return true;
  }

  if (msg.type === "meta") {
    const url = LOCAL_SERVER + "/meta?v=" + encodeURIComponent(msg.videoId);
    fetch(url, { signal: AbortSignal.timeout(10000) })
      .then((r) => r.json())
      .then((data) => sendResponse(data))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "download") {
    const url = LOCAL_SERVER + "/download?v=" + encodeURIComponent(msg.videoId);

    // Build filename: Title - Key BPMbpm - Channel.mp3
    let filename = "audio.mp3";
    if (msg.title) {
      let name = msg.title;
      // Insert key/BPM in the middle if found
      const keyBpm = [msg.key, msg.bpm ? msg.bpm + "BPM" : ""].filter(Boolean).join(" ");
      if (keyBpm) name += " - " + keyBpm;
      if (msg.channel) name += " - " + msg.channel;
      // Sanitize for filesystem
      name = name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();
      if (name) filename = name + ".mp3";
    }

    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Download failed" }));
          sendResponse({ error: err.error || "Download failed" });
          return;
        }

        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Save to Downloads folder
        browser.downloads.download({
          url: blobUrl,
          filename: filename,
          saveAs: false,
        }).then((downloadId) => {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          sendResponse({ success: true, filename: filename });
        }).catch((err) => {
          URL.revokeObjectURL(blobUrl);
          sendResponse({ error: err.message });
        });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
