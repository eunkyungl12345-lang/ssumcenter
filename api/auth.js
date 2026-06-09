const crypto = require("crypto");

function hashPw(pw) {
  return crypto.createHash("sha256").update(pw + "ssumryu_salt_2026").digest("hex");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });

  const TABLE = encodeURIComponent("회원");
  const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  const { action } = req.query;
  const body = req.body;

  try {
    // 회원가입
    if (action === "signup") {
      const { name, phone, password, gender, birthYear } = body;
      if (!name || !phone || !password || !gender || !birthYear) {
        return res.status(400).json({ error: "필수 항목을 모두 입력해주세요" });
      }

      // 중복 체크 (연락처 기준)
      const checkUrl = `${BASE_URL}?filterByFormula=${encodeURIComponent(`{연락처}="${phone}"`)}`;
      const checkRes = await fetch(checkUrl, { headers });
      const checkData = await checkRes.json();
      if (checkData.records && checkData.records.length > 0) {
        return res.status(409).json({ error: "이미 가입된 연락처입니다" });
      }

      // 생성
      const createRes = await fetch(BASE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          records: [{
            fields: {
              "이름": name,
              "연락처": phone,
              "비밀번호": hashPw(password),
              "성별": gender,
              "출생연도": birthYear,
              "가입일": new Date().toISOString(),
              "상태": "활성"
            }
          }]
        })
      });
      const createData = await createRes.json();
      if (!createRes.ok) return res.status(createRes.status).json(createData);

      const record = createData.records[0];
      return res.status(200).json({
        ok: true,
        user: { id: record.id, name, phone, gender, birthYear }
      });
    }

    // 로그인
    if (action === "login") {
      const { phone, password } = body;
      if (!phone || !password) {
        return res.status(400).json({ error: "연락처와 비밀번호를 입력해주세요" });
      }

      const findUrl = `${BASE_URL}?filterByFormula=${encodeURIComponent(`{연락처}="${phone}"`)}`;
      const findRes = await fetch(findUrl, { headers });
      const findData = await findRes.json();

      if (!findData.records || findData.records.length === 0) {
        return res.status(401).json({ error: "가입되지 않은 연락처입니다" });
      }

      const record = findData.records[0];
      const storedHash = record.fields["비밀번호"];
      if (storedHash !== hashPw(password)) {
        return res.status(401).json({ error: "비밀번호가 일치하지 않습니다" });
      }

      return res.status(200).json({
        ok: true,
        user: {
          id: record.id,
          name: record.fields["이름"],
          phone: record.fields["연락처"],
          gender: record.fields["성별"],
          birthYear: record.fields["출생연도"]
        }
      });
    }

    return res.status(400).json({ error: "action 파라미터 필요 (signup / login)" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
