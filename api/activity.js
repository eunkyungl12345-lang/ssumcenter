// 실시간 활동 로그 — /office 대시보드용
//  - 에어테이블의 실제 신청·출석 기록을 끌어와 "누가 무엇을 했는지" 피드로 반환
//  - 관리자 전용. 그래도 화면을 같이 볼 수 있으니 이름은 마스킹(홍길동 → 홍○○)한다
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 🔒 관리자만 볼 수 있다. 누가 언제 신청했는지(이름 일부 가림)는 내부 자료다.
  //    예전에는 로그인 없이 누구나 볼 수 있었다.
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }

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
    // 에어테이블 호출을 아끼기 위해 30분 동안 '보는 사람의 브라우저'에만 기억해 둔다.
    // ⚠️ 공용 저장소(CDN)에 올리면 안 된다 — 거기 올라간 응답은 로그인 여부와 상관없이
    //    누구에게나 나가서, 위의 관리자 확인이 소용없어진다.
    res.setHeader("Cache-Control", "private, max-age=1800");
    return res.status(200).json({ events: events.slice(0, 25) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
