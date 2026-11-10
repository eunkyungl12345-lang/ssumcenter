/**
 * 📣 유입경로 집계 — "이번 달 손님이 어디서 왔나"
 *
 * 1:1 신청서의 '어떻게 알고 오셨어요?' 답을 경로별로 센다.
 * 릴스·스레드·블로그를 올린 뒤 실제 신청으로 이어졌는지 보려는 것이다.
 *
 * - 에어테이블을 새로 읽지 않는다. 브리핑이 이미 읽어둔 신청 목록을 받아서 세기만 한다.
 * - 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 */

// 같은 경로가 다르게 적힌 것을 하나로 모은다 (손으로 넣은 기록, 옛 선택지 포함)
function inflowLabel(raw) {
  const v = String(raw || "").replace(/\s/g, "");
  if (!v) return "안 적음";
  const low = v.toLowerCase();
  if (/쓰레드|스레드|threads?/.test(low)) return "스레드";
  if (/인스타|instagram|릴스/.test(low)) return "인스타";
  if (/블로그|blog/.test(low)) return "블로그";
  if (/지인|친구|추천/.test(low)) return "지인소개";
  if (/인터넷|검색|네이버|구글/.test(low)) return "검색";
  if (/그날그사람/.test(low)) return "그날그사람";
  return v;
}

/**
 * @param {Array} records 에어테이블 레코드 ({fields}) — 이미 '이번 달 · 1:1' 로 추려진 것
 * @returns {{ total:number, rows:Array<[string, number]> }} 많은 순
 */
function countInflow(records) {
  const m = new Map();
  for (const r of records || []) {
    const k = inflowLabel((r.fields || {})["유입경로"]);
    m.set(k, (m.get(k) || 0) + 1);
  }
  const rows = [...m.entries()].sort((a, b) => {
    // '안 적음'은 항상 맨 뒤 — 진짜 경로가 먼저 보이게
    if (a[0] === "안 적음") return 1;
    if (b[0] === "안 적음") return -1;
    return b[1] - a[1] || a[0].localeCompare(b[0], "ko");
  });
  return { total: (records || []).length, rows };
}

// 브리핑에 넣을 한 줄. 신청이 없으면 빈 문자열 (줄 자체를 뺀다)
function inflowLine(records) {
  const c = countInflow(records);
  if (!c.total) return "";
  return `\n📣 이번달 유입 — ${c.rows.map(([k, n]) => `${k} ${n}`).join(" · ")}`;
}

module.exports = { inflowLabel, countInflow, inflowLine };
