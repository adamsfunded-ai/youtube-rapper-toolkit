const { Innertube, ClientType } = require("youtubei.js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const videoId = req.query.v;
  if (!videoId) {
    res.status(400).json({ error: "Missing ?v= video ID" });
    return;
  }

  try {
    const yt = await Innertube.create({
      retrieve_player: true,
      client_type: ClientType.WEB,
    });
    const info = await yt.getBasicInfo(videoId);

    res.status(200).json({
      title: info.basic_info.title,
      duration: info.basic_info.duration,
      author: info.basic_info.author,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
