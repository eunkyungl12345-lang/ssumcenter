export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { password } = req.body || {};
  const ADMIN_PW = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PW) return res.status(500).json({ error: "서버 환경변수 미설정" });

  if (password === ADMIN_PW) {
    return res.status(200).json({ ok: true });
  } else {
    return res.status(401).json({ ok: false });
  }
}
