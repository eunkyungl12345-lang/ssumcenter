/**
 * 🧾 유형 테스트 발급 수 집계 — "연애 사원증을 몇 명이 발급받았나, 어떤 직급이 1위인가"
 *
 * ⚠️ 에어테이블에 세지 않는다.
 *    에어테이블 무료 요금제는 월 1,000건이라, 테스트가 퍼져서 하루 50명만 해도
 *    한 달 한도를 다 써버리고 **신청서 저장까지 멈춘다** (실제로 한 번 터진 적이 있다).
 *    그래서 숫자 세기 전용 저장소(Upstash Redis, 무료)를 쓴다.
 *
 * - 저장소가 연결돼 있지 않으면 아무것도 하지 않는다 (조용히 건너뜀).
 *   Vercel → Storage 에서 Upstash Redis 를 만들어 이 프로젝트에 연결하면
 *   환경변수(KV_REST_API_URL / KV_REST_API_TOKEN)가 자동으로 들어온다.
 * - 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 * - 유형 목록은 test/ideal.html · test/work.html 의 TYPES 와 맞춰야 한다 (새 유형을 만들면 여기도 추가).
 */
const TESTS = {
  coffee: { label: "영수증", types: { dripper: "직진드리퍼", coldbrew: "콜드브루형", honeylatte: "꿀라떼형", americano: "아아고수", vanilla: "바닐라라떼형", espresso: "에스프레소샷", decaf: "디카페인형", todaycoffee: "오늘의커피형" } },
  work: { label: "사원증", types: { intern: "열정 인턴", ace: "영업 에이스", welfare: "애정 복지 담당", mood: "분위기 메이커", planner: "밀당 기획자", ontime: "칼퇴 장인", manager: "안정 관리자", remote: "재택 근무자" } },
};
const KEY = (test) => "ssum:test:" + test;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: String(url).replace(/\/+$/, ""), token } : null;
}
function isConfigured() { return !!store(); }

async function send(path, body) {
  const s = store();
  const r = await fetch(s.url + path, { method: "POST", headers: { Authorization: "Bearer " + s.token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.error) || "저장소 오류 " + r.status);
  return d;
}

/** 한 번 발급 = +1. 목록에 없는 유형은 받지 않는다 (아무 글자나 쌓이지 않게). */
async function bump(test, type) {
  if (!isConfigured()) return { ok: false, reason: "not_configured" };
  if (!TESTS[test] || !Object.prototype.hasOwnProperty.call(TESTS[test].types, type)) return { ok: false, reason: "bad_type" };
  // 여러 명령을 한 번에 보내는 주소(/pipeline)를 쓴다 — 조회와 같은 방식이라 한 가지만 맞으면 된다
  const d = await send("/pipeline", [["HINCRBY", KEY(test), type, 1]]);
  if (d && d[0] && d[0].error) throw new Error(d[0].error);
  return { ok: true, count: Number(d && d[0] && d[0].result) || 0 };
}

/** 지금까지의 발급 수. { coffee:{label,total,rows:[{key,name,count}]}, work:{...} } — 많은 순 */
async function read() {
  if (!isConfigured()) return { configured: false };
  const names = Object.keys(TESTS);
  const d = await send("/pipeline", names.map((t) => ["HGETALL", KEY(t)]));
  const out = { configured: true };
  names.forEach((t, i) => {
    const flat = (d && d[i] && d[i].result) || [];
    const got = {};
    if (Array.isArray(flat)) { for (let j = 0; j + 1 < flat.length; j += 2) got[flat[j]] = Number(flat[j + 1]) || 0; }
    else if (flat && typeof flat === "object") { Object.keys(flat).forEach((k) => { got[k] = Number(flat[k]) || 0; }); }
    const rows = Object.keys(TESTS[t].types).map((k) => ({ key: k, name: TESTS[t].types[k], count: got[k] || 0 })).sort((a, b) => b.count - a.count);
    out[t] = { label: TESTS[t].label, total: rows.reduce((a, r) => a + r.count, 0), rows };
  });
  return out;
}

/** 아침 브리핑에 넣을 한 줄. 연결 전이거나 아직 0건이면 빈 문자열. */
async function countLine() {
  if (!isConfigured()) return "";
  const c = await read();
  const parts = Object.keys(TESTS).map((t) => {
    const x = c[t]; if (!x || !x.total) return "";
    return `${x.label} ${x.total.toLocaleString()}건 (1위 ${x.rows[0].name} ${x.rows[0].count})`;
  }).filter(Boolean);
  return parts.length ? `\n🧾 테스트 발급 누적 — ${parts.join(" · ")}` : "";
}

/** 신청서에 남은 테스트 유형 집계 (에어테이블을 새로 읽지 않는다 — 브리핑이 읽어둔 목록을 센다) */
function applicantLine(records) {
  const m = new Map(); let n = 0;
  for (const r of records || []) {
    const v = String((r.fields || {})["테스트결과"] || "").trim();
    if (!v) continue;
    n++;
    v.split("/").map((x) => x.trim()).filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1));
  }
  if (!n) return "";
  const top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 4);
  return `\n🧪 테스트 하고 신청 — ${n}명 (${top.map(([k, c]) => `${k} ${c}`).join(" · ")})`;
}

module.exports = { TESTS, isConfigured, bump, read, countLine, applicantLine };
