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
  const SETUP_KEY = "ssum-tmp-setup-7Xk92Qp4vR"; // 임시 테스트용 (테스트 후 제거)
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

  // 출생연도(1993) → "93년생"
  const toBirth = y => { const s = String(y || "").replace(/[^0-9]/g, ""); return s.length >= 2 ? s.slice(-2) + "년생" : ""; };
  // 직업에서 괄호(지역/기관 상세) 제거: "경찰공무원(성동구)" → "경찰공무원"
  const jobCat = j => String(j || "").replace(/[\(（].*?[\)）]/g, "").trim();
  // 어필 첫 줄만, 45자 컷
  const oneLine = a => { const t = String(a || "").split("\n")[0].trim(); return t.length > 45 ? t.slice(0, 45) + "…" : t; };

  const digits = s => String(s || "").replace(/[^0-9]/g, "");

  // ---- 임시 테스트용 (승인/삭제) ----
  if (body.action === "approve" || body.action === "cleanup") {
    if (!isSetup) return res.status(401).json({ error: "권한 없음" });
    const rows = await getAll("로테이션 신청");
    if (body.action === "approve") {
      const t = rows.find(r => digits(r.fields["연락처"]) === digits(body.phone));
      if (!t) return res.status(404).json({ error: "없음" });
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("로테이션 신청")}/${t.id}`,
        { method: "PATCH", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { 승인상태: "승인" } }) });
      return res.status(200).json({ ok: true });
    }
    // cleanup: 지정 번호들 삭제
    const targets = (body.phones || []).map(digits);
    const del = rows.filter(r => targets.indexOf(digits(r.fields["연락처"])) >= 0);
    for (const r of del) {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("로테이션 신청")}/${r.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } });
    }
    return res.status(200).json({ ok: true, deleted: del.length });
  }

  if (body.action !== "preview") return res.status(400).json({ error: "알 수 없는 action" });

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
