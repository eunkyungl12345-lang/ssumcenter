const { SolapiMessageService } = require("solapi");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const API_KEY = process.env.SOLAPI_API_KEY;
  const API_SECRET = process.env.SOLAPI_API_SECRET;
  const SENDER = process.env.SOLAPI_SENDER;

  if (!API_KEY || !API_SECRET || !SENDER) {
    return res.status(500).json({ error: "솔라피 환경변수가 설정되지 않았습니다" });
  }

  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: "수신번호와 메시지 내용이 필요합니다" });
  }

  try {
    const messageService = new SolapiMessageService(API_KEY, API_SECRET);
    const result = await messageService.sendOne({
      to: to.replace(/-/g, ""),
      from: SENDER.replace(/-/g, ""),
      text: text
    });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[send-sms] error:", err);
    return res.status(500).json({ error: err.message || "문자 발송 실패" });
  }
};
