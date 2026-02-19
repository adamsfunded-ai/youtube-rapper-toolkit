const { Innertube } = require("youtubei.js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const videoId = req.query.v || "dQw4w9WgXcQ";

  try {
    const yt = await Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    });

    const info = await yt.getBasicInfo(videoId);

    const allFormats = [
      ...(info.streaming_data?.adaptive_formats || []),
      ...(info.streaming_data?.formats || []),
    ];

    const audioFormats = allFormats
      .filter((f) => f.mime_type?.startsWith("audio/"))
      .map((f) => ({
        mime: f.mime_type,
        bitrate: f.bitrate,
        has_url: !!f.url,
        has_signature_cipher: !!f.signature_cipher,
        has_decipher: typeof f.decipher === "function",
        url_preview: f.url ? f.url.substring(0, 80) + "..." : null,
        cipher_preview: f.signature_cipher ? f.signature_cipher.substring(0, 80) + "..." : null,
      }));

    res.status(200).json({
      title: info.basic_info.title,
      total_formats: allFormats.length,
      audio_formats: audioFormats.length,
      audio_details: audioFormats,
      player_available: !!yt.session?.player,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
  }
};
