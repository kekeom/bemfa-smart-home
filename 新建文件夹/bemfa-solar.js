export default async function handler(req, res) {
  try {
    const uid = process.env.BEMFA_UID;
    const topic = req.query.topic || 'TYN1004';
    const type = req.query.type || 1;

    if (!uid) {
      return res.status(500).json({ ok: false, error: '未配置 BEMFA_UID' });
    }

    const apiUrl =
      `https://apis.bemfa.com/va/getmsg?uid=${encodeURIComponent(uid)}` +
      `&topic=${encodeURIComponent(topic)}` +
      `&type=${encodeURIComponent(type)}`;

    const response = await fetch(apiUrl, { method: 'GET' });
    const result = await response.json();

    return res.status(200).json({
      ok: result.code === 0,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}