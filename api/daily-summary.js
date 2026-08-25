// api/daily-summary.js — 매일 아침 슬랙 요약 (Vercel Cron이 자동 호출)
// vercel.json의 crons 설정으로 매일 09:00 KST(00:00 UTC)에 실행됨.

async function slack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  } catch (e) { /* 알림 실패는 무시 */ }
}

async function fetchAll(table, TOKEN, BASE_ID) {
  const base = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
  const H = { "Authorization": `Bearer ${TOKEN}` };
  let records = [], offset;
  do {
    const u = base + "?pageSize=100" + (offset ? "&offset=" + offset : "");
    const r = await fetch(u, { headers: H });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && d.error.message) || "airtable error");
    records = records.concat(d.records || []);
    offset = d.offset;
  } while (offset);
  return records;
}

module.exports = async function handler(req, res) {
  // Vercel Cron 인증 (CRON_SECRET이 설정돼 있으면 그 헤더가 있어야 실행)
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers["authorization"] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수가 설정되지 않았습니다" });

  try {
    const [rot, oneone, coffee] = await Promise.all([
      fetchAll("로테이션 신청", TOKEN, BASE_ID),
      fetchAll("1:1 매칭 신청", TOKEN, BASE_ID),
      fetchAll("재테크 커피팅", TOKEN, BASE_ID),
    ]);

    // 🔁 가장 최신 회차를 자동으로 골라서 요약 (예: 8/27 → 9/10 자동 전환)
    const roundKey = rd => { const m = String(rd || "").match(/(\d{1,2})\s*\/\s*(\d{1,2})/); return m ? (parseInt(m[1]) * 100 + parseInt(m[2])) : 0; };
    let latestRound = "", bestKey = -1;
    rot.forEach(x => { const rd = (x.fields || {})["회차"]; if (rd) { const k = roundKey(rd); if (k > bestKey) { bestKey = k; latestRound = rd; } } });
    if (!latestRound) latestRound = "(회차 없음)";

    const round = rot.filter(x => (x.fields || {})["회차"] === latestRound);
    const rApproved = round.filter(x => (x.fields || {})["승인상태"] === "승인").length;
    const rPaid = round.filter(x => (x.fields || {})["입금확정"] === "O").length;
    const rWait = round.filter(x => ((x.fields || {})["승인상태"] || "대기") === "대기").length;

    const o1Active = oneone.filter(x => (x.fields || {})["매칭상태"] !== "휴지통");
    const o1Wait = o1Active.filter(x => ((x.fields || {})["매칭상태"] || "대기") === "대기").length;

    const cWait = coffee.filter(x => ((x.fields || {})["승인상태"] || "대기") === "대기").length;

    const text = [
      "🌅 썸류센터 아침 요약",
      "",
      `🎡 로테이션(${latestRound}): 신청 ${round.length} · 승인 ${rApproved} · 입금확정(라인업) ${rPaid} · 대기 ${rWait}`,
      `💘 1:1 매칭: 전체 ${o1Active.length} · 대기 ${o1Wait}`,
      `☕ 재테크 커피팅: 대기 ${cWait}`,
    ].join("\n");

    await slack(text);
    return res.status(200).json({ ok: true });
  } catch (e) {
    await slack("🌅 아침 요약 생성 중 오류: " + e.message);
    return res.status(500).json({ error: e.message });
  }
};
