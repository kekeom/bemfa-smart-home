export default async function handler(req, res) {
  try {
    const uid = process.env.BEMFA_UID;
    if (!uid) {
      return res.status(500).json({ ok: false, error: '未配置 BEMFA_UID' });
    }

    const apiUrl = `https://apis.bemfa.com/va/getMessage?uid=${encodeURIComponent(uid)}`;
    const response = await fetch(apiUrl, { method: 'GET' });
    const result = await response.json();

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}