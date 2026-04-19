export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { topic, type, msg } = req.body || {};

    if (!topic || !msg) {
      return res.status(400).json({ ok: false, error: '缺少 topic 或 msg' });
    }

    const uid = process.env.BEMFA_UID;
    if (!uid) {
      return res.status(500).json({ ok: false, error: '未配置 BEMFA_UID' });
    }

    const apiUrl =
      `https://apis.bemfa.com/va/sendMessage?uid=${encodeURIComponent(uid)}` +
      `&topic=${encodeURIComponent(topic)}` +
      `&type=${encodeURIComponent(type || 1)}` +
      `&msg=${encodeURIComponent(msg)}`;

    const response = await fetch(apiUrl, { method: 'GET' });
    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: `巴法云接口异常: ${response.status}`,
        raw: result
      });
    }

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