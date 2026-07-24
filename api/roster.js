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
  const SETUP_KEY = "ssum-tmp-setup-7Xk92Qp4vR"; // 임시 조회용 (확인 후 제거)
  const isSetup = req.headers["x-setup-key"] === SETUP_KEY;

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

  // 임시: 이름으로 신청자가 어느 테이블에 있는지 찾기
  if (body.action === "find") {
    if (!isSetup) return res.status(401).json({ error: "권한 없음" });
    const q = String(body.name || "").trim();
    const out = [];
    for (const t of ["로테이션 신청", "1:1 매칭 신청", "재테크 커피팅"]) {
      try {
        const rows = await getAll(t);
        rows.forEach(r => {
          const hit = q && Object.values(r.fields).some(v => typeof v === "string" && v.indexOf(q) >= 0);
          if (hit) out.push({ table: t, 회차: r.fields["회차"] || r.fields["매칭유형"] || "", 상태: r.fields["승인상태"] || r.fields["매칭상태"] || "", 신청일시: r.fields["신청일시"] || "" });
        });
      } catch (e) {}
    }
    return res.status(200).json({ found: out });
  }

  if (body.action !== "preview") return res.status(400).json({ error: "알 수 없는 action" });

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
