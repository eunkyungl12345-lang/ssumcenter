// 참여자 미리보기 전용 (공개) — 승인된 로테이션 참가자의 "안전한 정보만" 반환
// 실명·연락처·사진·상세지역은 절대 내보내지 않음
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });

  const body = req.body || {};
  const SETUP_KEY = "ssum-tmp-setup-7Xk92Qp4vR"; // 임시 (칸 추가 후 제거)
  const isSetup = req.headers["x-setup-key"] === SETUP_KEY;

  // 임시: 1:1 매칭 신청 테이블에 누락된 칸 추가
  if (body.action === "addfields") {
    if (!isSetup) return res.status(401).json({ error: "권한 없음" });
    const metaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const meta = await metaRes.json();
    if (!metaRes.ok) return res.status(metaRes.status).json({ error: meta.error?.message || "테이블 조회 실패" });
    const tbl = (meta.tables || []).find(t => t.name === "1:1 매칭 신청");
    if (!tbl) return res.status(404).json({ error: "테이블 없음" });
    const existing = tbl.fields.map(f => f.name);
    const want = body.fields || ["키", "사는곳", "취미", "종교"];
    const added = [], skipped = [];
    for (const name of want) {
      if (existing.includes(name)) { skipped.push(name); continue; }
      const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tbl.id}/fields`,
        { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, type: "singleLineText" }) });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: name + " 추가 실패: " + (d.error?.message || JSON.stringify(d.error)), added });
      added.push(name);
    }
    return res.status(200).json({ ok: true, added, skipped });
  }

  // 매칭 프로필 조회 (response 페이지용) — 이름·연락처 제외, 안전 정보만
  if (body.action === "profile") {
    if (!body.id) return res.status(400).json({ error: "id 필요" });
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}/${encodeURIComponent(body.id)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return res.status(404).json({ error: "프로필을 찾을 수 없어요" });
    const d = await r.json();
    const f = d.fields || {};
    const photos = (f["프로필사진"] || []).map(p => p.url).filter(Boolean);
    return res.status(200).json({
      age: f["출생연도"] ? (f["출생연도"] + "년생") : "",
      job: f["직업"] || "",
      keywords: f["성격키워드"] || "",
      intro: f["자기소개"] || "",
      photos,
    });
  }

  if (body.action !== "preview") return res.status(400).json({ error: "알 수 없는 action" });

  async function getAll(table, filter) {
    let records = [], offset;
    do {
      const p = new URLSearchParams({ pageSize: "100" });
      if (filter) p.set("filterByFormula", filter);
      if (offset) p.set("offset", offset);
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${p.toString()}`,
        { headers: { Authorization: `Bearer ${TOKEN}` } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || "airtable error");
      records = records.concat(d.records || []);
      offset = d.offset;
    } while (offset);
    return records;
  }

  // 출생연도(1993) → "93년생"
  const toBirth = y => { const s = String(y || "").replace(/[^0-9]/g, ""); return s.length >= 2 ? s.slice(-2) + "년생" : ""; };
  // 직업에서 괄호(지역/기관 상세) 제거: "경찰공무원(성동구)" → "경찰공무원"
  const jobCat = j => String(j || "").replace(/[\(（].*?[\)）]/g, "").trim();
  // 어필 첫 줄만, 45자 컷
  const oneLine = a => { const t = String(a || "").split("\n")[0].trim(); return t.length > 45 ? t.slice(0, 45) + "…" : t; };

  try {
    const rows = await getAll("로테이션 신청");
    const list = rows
      .filter(r => r.fields["승인상태"] === "승인" && (!body.round || r.fields["회차"] === body.round))
      .map(r => ({
        성별: r.fields["성별"] || "",
        닉네임: r.fields["닉네임"] || "",
        년생: toBirth(r.fields["출생연도"]),
        직업: jobCat(r.fields["직업_직장명"]),
        한줄: oneLine(r.fields["어필포인트"]),
        회차: r.fields["회차"] || "",
      }));
    // 회차 목록도 함께
    const rounds = [];
    rows.forEach(r => { const rd = r.fields["회차"]; if (rd && rounds.indexOf(rd) < 0) rounds.push(rd); });
    const counts = {
      남: list.filter(x => x.성별 === "남성").length,
      여: list.filter(x => x.성별 === "여성").length,
    };
    return res.status(200).json({ list, rounds, counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
