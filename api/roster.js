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
      성별: f["성별"] || "",
      age: f["출생연도"] ? (f["출생연도"] + "년생") : "",
      job: f["직업"] || "",
      keywords: f["성격키워드"] || "",
      intro: f["자기소개"] || "",
      height: f["키"] || "",
      location: f["사는곳"] || "",
      hobby: f["취미"] || "",
      religion: f["종교"] || "",
      photos,
    });
  }

  // ⏰ 만료 링크를 손님이 열었을 때 → 슬랙 알림 (중복 방지: 매칭 레코드에 만료알림 플래그)
  if (body.action === "expiredNotify") {
    try {
      const me = String(body.id || ""), other = String(body.myId || "");   // response.html의 id/myId
      if (!me || !other) return res.status(200).json({ ok: false });
      const AUTH = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
      const MTBL = encodeURIComponent("매칭");
      const formula = `AND({상태}="소개중",OR(AND({남자ID}="${me}",{여자ID}="${other}"),AND({남자ID}="${other}",{여자ID}="${me}")))`;
      const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MTBL}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`, { headers: AUTH });
      const fd = await fr.json();
      const rec = (fd.records || [])[0];
      if (!rec) return res.status(200).json({ ok: false });          // 소개중 아님 → 알림 X
      const mf = rec.fields || {};
      if (mf["만료알림"] === "O") return res.status(200).json({ ok: true, already: true }); // 이미 보냄
      // 플래그 세팅 + 슬랙 발송
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MTBL}/${rec.id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ fields: { "만료알림": "O" }, typecast: true }) }).catch(() => {});
      const url = process.env.SLACK_WEBHOOK_URL;
      if (url) { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `⏰ 매칭 응답 기한 만료\n${mf["여자"] || "?"} ❤ ${mf["남자"] || "?"} — 48시간 내 무응답으로 만료됐어요.\n필요하면 재매칭하거나 불발 처리해주세요.` }) }).catch(() => {}); }
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(200).json({ ok: false }); }
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

  // 출생연도(1993) → "30대 초반" 식 나이대
  const ageBracket = y => {
    const n = parseInt(String(y || "").replace(/[^0-9]/g, ""), 10);
    if (!n) return "";
    const full = n >= 1000 ? n : (n > 30 ? 1900 + n : 2000 + n);
    const age = new Date().getFullYear() - full;
    if (age < 15 || age > 99) return "";
    const dec = Math.floor(age / 10) * 10;
    return dec + "대 " + ((age % 10) < 5 ? "초반" : "후반");
  };
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
        나이대: ageBracket(r.fields["출생연도"]),
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
