const { sendSms } = require("./_sms.js");

async function slack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || !text) return;
  try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch (e) { /* 무시 */ }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // 인증: 관리자만 문자 발송 가능
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }

  const { to, text, notify, slackOnly } = req.body || {};

  // 📢 슬랙 알림만 (문자 없음) — 일괄발송 요약 등
  if (slackOnly) {
    if (!text) return res.status(400).json({ error: "text 필요" });
    await slack(text);
    return res.status(200).json({ ok: true, slack: true });
  }

  if (!to || !text) {
    return res.status(400).json({ error: "수신번호와 메시지 내용이 필요합니다" });
  }

  try {
    const result = await sendSms({ to, text });
    if (notify) await slack("📤 문자 발송 → " + to + "\n" + String(text).slice(0, 60));
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[send-sms] error:", err);
    return res.status(500).json({ error: err.message || "문자 발송 실패" });
  }
};
