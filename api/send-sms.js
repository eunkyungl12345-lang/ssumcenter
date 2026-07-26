const { sendSms } = require("./_sms.js");

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

  const { to, text } = req.body || {};
  if (!to || !text) {
    return res.status(400).json({ error: "수신번호와 메시지 내용이 필요합니다" });
  }

  try {
    const result = await sendSms({ to, text });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[send-sms] error:", err);
    return res.status(500).json({ error: err.message || "문자 발송 실패" });
  }
};
