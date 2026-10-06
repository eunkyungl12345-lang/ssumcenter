/**
 * 신청 3건 통합 테스트
 *   10/8 로테이션 · 10/22 로테이션 · 1:1 매칭
 *
 * 실제 신청 폼이 만드는 데이터를 그대로 뽑아서, 실제 서버 코드(api/airtable.js)에
 * 통과시킨다. 에어테이블·문자·슬랙만 가짜로 바꿔서 실제 신청자 데이터는 건드리지 않는다.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "test-base";
process.env.ADMIN_PASSWORD = "test-pw";
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";

// ── 폼이 만드는 fields 를 그대로 뽑아낸다 ───────────────────────────────
function fieldsFromForm(file, varName, stub) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const re = new RegExp("const fields\\s*=\\s*(\\{[\\s\\S]*?\\n\\s*\\};)");
  const m = html.match(re);
  if (!m) throw new Error(file + " 에서 fields 를 못 찾음");
  const ctx = Object.assign({ Date, Object, Array, JSON }, stub);
  vm.createContext(ctx);
  return vm.runInContext("(" + m[1].replace(/;$/, "") + ")", ctx);
}

// ── 가짜 에어테이블 / 문자 / 슬랙 ──────────────────────────────────────
const log = { saved: [], sms: [], slack: [] };
const DB = { "로테이션 신청": [], "1:1 매칭 신청": [], "회원": [] };

global.fetch = async (url, opt) => {
  const u = String(url);
  const body = opt && opt.body ? JSON.parse(opt.body) : null;

  if (u.includes("hooks.slack")) { log.slack.push(body); return { ok: true, json: async () => ({}) }; }

  if (u.includes("api.airtable.com")) {
    const table = decodeURIComponent((u.match(/test-base\/([^/?]+)/) || [])[1] || "");
    const method = (opt && opt.method) || "GET";
    if (method === "POST") {
      const recs = (body.records || [body]).map((r, i) => ({ id: "recNEW" + (DB[table] || []).length + i, fields: r.fields || r }));
      if (!DB[table]) DB[table] = [];
      DB[table].push(...recs);
      if (table !== "회원") log.saved.push({ table, fields: recs[0].fields });
      return { ok: true, status: 200, json: async () => ({ records: recs }) };
    }
    if (method === "PATCH") return { ok: true, status: 200, json: async () => ({ records: [] }) };
    return { ok: true, status: 200, json: async () => ({ records: DB[table] || [] }) };
  }
  if (u.includes("solapi")) { log.sms.push(body); return { ok: true, json: async () => ({}) }; }
  return { ok: true, status: 200, json: async () => ({}) };
};

// 문자는 solapi SDK를 쓰므로 모듈 자체를 가짜로
const smsPath = require.resolve(path.join(ROOT, "api/_sms.js"));
require.cache[smsPath] = {
  id: smsPath, filename: smsPath, loaded: true,
  exports: {
    sendSms: async ({ to, text }) => { log.sms.push({ to, text }); return { ok: true }; },
    isValidPhone: (p) => String(p || "").replace(/[^0-9]/g, "").length >= 10,
  },
};

const handler = require(path.join(ROOT, "api/airtable.js"));

async function submit(name, table, fields) {
  log.saved.length = 0; log.sms.length = 0; log.slack.length = 0;
  let status = null, out = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(d) { out = d; return this; }, end() { return this; },
  };
  await handler({ method: "POST", query: { table }, headers: {}, body: { records: [{ fields }] } }, res);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("▶ " + name);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  결과: " + (status === 200 ? "✅ 신청 성공" : "❌ 실패 (" + status + ") " + JSON.stringify(out)));
  if (log.saved.length) {
    const f = log.saved[0].fields;
    console.log("  저장된 표: " + log.saved[0].table);
    ["회차", "이름", "성별", "출생연도", "연락처", "승인상태", "매칭상태", "직업", "직업_직장명"]
      .filter((k) => f[k] !== undefined && f[k] !== "")
      .forEach((k) => console.log("    · " + k + ": " + f[k]));
    const empty = Object.keys(f).filter((k) => f[k] === "" || f[k] === undefined);
    if (empty.length) console.log("    (빈 칸: " + empty.join(", ") + ")");
  }
  console.log("  문자 발송: " + (log.sms.length ? log.sms.map((s) => s.to).join(", ") : "없음"));
  console.log("  슬랙 알림: " + (log.slack.length ? "보냄" : "없음"));
  return status;
}

(async () => {
  const rotStub = (round) => ({
    p: {
      round, name: "테스트" + round.slice(0, 4).replace("/", ""), gender: "여성", birthYear: "1996",
      phone: "01000000000", height: "160", job: "테스트직업", appeal: "테스트 어필",
      drink: "아이스티", nickname: "테스트", referralName: "", discount: "해당없음", discountDetail: "",
    },
    selectedChannel: "인스타그램",
    document: { getElementById: () => ({ checked: true }) },
    localStorage: { getItem: () => null },
  });

  const results = [];
  for (const round of ["10/8 (목)", "10/22 (목)"]) {
    const file = round.startsWith("10/8") ? "rotation-1008.html" : "rotation-1022.html";
    const fields = fieldsFromForm(file, "fields", rotStub(round));
    results.push(await submit(round + " 로테이션 신청  (" + file + ")", "로테이션 신청", fields));
  }

  const oneFields = fieldsFromForm("matching.html", "fields", {
    payload: {
      name: "테스트일대일", phone: "01000000000", gender: "남성", birthYear: "1994",
      job: "테스트직업", height: "178", location: "강남", workLocation: "강남",
      hobby: "러닝", religion: "무교", idealType: "테스트 이상형", intro: "테스트 자기소개",
      testResult: "", matchType: "일반매칭",
    },
    selectedAges: new Set(["20대 후반"]),
    selectedKeywords: new Set(["다정한"]),
    localStorage: { getItem: () => null },
  });
  results.push(await submit("1:1 매칭 신청  (matching.html)", "1:1 매칭 신청", oneFields));

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const okCount = results.filter((s) => s === 200).length;
  console.log(okCount === 3 ? "✅ 테스트 3건 모두 통과" : "❌ " + (3 - okCount) + "건 실패");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exit(okCount === 3 ? 0 : 1);
})();
