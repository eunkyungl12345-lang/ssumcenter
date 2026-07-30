// 1회용 관리자 도구: 에어테이블 테이블에 새 필드(칸) 생성
// - 관리자 키(x-admin-key) 필요. Metadata API 사용.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }

  const { tableId, name, type, description } = req.body || {};
  if (!tableId || !name) return res.status(400).json({ error: "tableId, name 필요" });

  try {
    const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: type || "multilineText", description: description || "" })
    });
    const d = await r.json();
    return res.status(r.status).json(d);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
