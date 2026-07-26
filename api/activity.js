// 실시간 활동 로그 — /office 대시보드용
//  - 에어테이블의 실제 신청·출석 기록을 끌어와 "누가 무엇을 했는지" 피드로 반환
//  - 공개 페이지(office)에서 쓰므로 이름은 마스킹(홍길동 → 홍○○)해서 개인정보 보호
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });
  const H = { Authorization: `Bearer ${TOKEN}` };

  async function fetchTable(table, n) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?pageSize=${n}`;
    const r = await fetch(url, { headers: H });
    if (!r.ok) return [];
    const d = await r.json();
    return d.records || [];
  }

  // 이름 마스킹: 홍길동 → 홍○○ / 김민 → 김○
  function mask(s) {
    s = String(s || "").trim();
    if (!s) return "익명";
    const a = Array.from(s);
    return a[0] + "○".repeat(Math.max(1, a.length - 1));
  }

  const SRC = [
    { table: "로테이션 신청", emoji: "📚", bot: "roster", name: f => f["이름"] || f["닉네임"], action: "로테이션 소개팅 신청 접수" },
    { table: "1:1 매칭 신청", emoji: "🐻", bot: "match", name: f => f["이름"], action: "1:1 매칭 신청 접수" },
    { table: "재테크 커피팅", emoji: "📚", bot: "roster", name: f => f["이름"], action: "재테크 미팅 신청 접수" },
    { table: "투표참가자", emoji: "📚", bot: "roster", name: f => f["닉네임"] || f["이름"], action: "출석부 자동 등록" },
  ];

  try {
    const events = [];
    for (const s of SRC) {
      let recs = [];
      try { recs = await fetchTable(s.table, 50); } catch (e) { recs = []; }
      for (const rc of recs) {
        if (!rc.createdTime) continue;
        events.push({
          time: rc.createdTime,
          emoji: s.emoji,
          bot: s.bot,
          actor: mask(s.name(rc.fields || {})),
          action: s.action,
        });
      }
    }
    // 최신순 정렬 후 상위 25개
    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    return res.status(200).json({ events: events.slice(0, 25) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
