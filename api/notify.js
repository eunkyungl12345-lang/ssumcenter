// api/notify.js — 관리자 페이지에서 슬랙으로 알림을 보내는 엔드포인트
// (관리자 비밀번호 x-admin-key로 인증 → 아무나 못 씀)

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능합니다" });

  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const url = process.env.SLACK_WEBHOOK_URL;
  const text = (req.body && req.body.text) || "";
  if (!url) return res.status(500).json({ error: "SLACK_WEBHOOK_URL 미설정" });
  if (!text) return res.status(400).json({ error: "text 필요" });

  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
