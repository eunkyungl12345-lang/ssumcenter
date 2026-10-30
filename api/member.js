// 회원 통합 명부 (마스터 DB)
//  - upsertMember: 전화번호 기준으로 회원 찾아서 있으면 업데이트, 없으면 생성 (중복방지)
//    → api/airtable.js 에서 신청서 제출 성공 시 자동 호출됨
//  - action:"createTable" / "migrate" : 최초 1회 셋업용 (x-setup-key 필요, 완료 후 제거 예정)

const MEMBER_TABLE = "회원";

function today() { return new Date().toISOString().slice(0, 10); }
function normPhone(p) { return String(p || "").replace(/[^0-9]/g, ""); }

// 신청서 → 유입경로 라벨
function sourceLabel(table) {
  if (table === "로테이션 신청") return "로테이션";
  if (table === "1:1 매칭 신청") return "1:1신청";
  if (table === "재테크 커피팅") return "재테크";
  return "투표";
}

// 신청 레코드 필드 → 회원 필드로 매핑
function mapToMember(fields) {
  const 이상형 = fields["이상형"] || [fields["선호나이대"], fields["선호직업군"]].filter(Boolean).join(" / ");
  const m = {
    "이름": fields["이름"] || "",
    "전화번호": normPhone(fields["연락처"] || fields["전화번호"]),
    "성별": fields["성별"] || "",
    "출생연도": String(fields["출생연도"] || ""),
    "직업": fields["직업"] || fields["직업_직장명"] || "",
    "사는곳": fields["사는곳"] || "",
    "키": String(fields["키"] || ""),
    "성격키워드": fields["성격키워드"] || "",
    "자기소개": fields["자기소개"] || fields["어필포인트"] || "",
    "취미": fields["취미"] || "",
    "종교": fields["종교"] || "",
    "이상형": 이상형,
  };
  const photos = (fields["프로필사진"] || []).map(p => ({ url: p.url })).filter(x => x.url);
  return { m, photos };
}

// 핵심: 전화번호 기준 upsert
async function upsertMember({ table, fields, TOKEN, BASE_ID }) {
  const phone = normPhone(fields["연락처"] || fields["전화번호"]);
  if (!phone) return { skipped: "전화번호 없음" };

  const base = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBER_TABLE)}`;
  const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  // 기존 회원 찾기
  const findUrl = `${base}?filterByFormula=${encodeURIComponent(`{전화번호}="${phone}"`)}&pageSize=1`;
  const findRes = await fetch(findUrl, { headers: H });
  const found = await findRes.json();
  const existing = (found.records || [])[0];

  const { m, photos } = mapToMember(fields);
  const src = sourceLabel(table);
  const histTag = src + (fields["회차"] ? (" " + fields["회차"]) : "") + " (" + today() + ")";

  if (existing) {
    // 이미 있는 회원 → 빈 칸만 채우고 참여이력은 항상 누적
    const ex = existing.fields || {};
    const upd = {};
    Object.keys(m).forEach(k => { if (m[k] && m[k] !== "" && !ex[k]) upd[k] = m[k]; });
    if (photos.length && !(ex["프로필사진"] && ex["프로필사진"].length)) upd["프로필사진"] = photos;
    const hist = ex["참여이력"] || "";
    if (hist.indexOf(src + (fields["회차"] ? (" " + fields["회차"]) : "")) < 0) {
      upd["참여이력"] = (hist ? hist + "\n" : "") + histTag;
    }
    if (Object.keys(upd).length) {
      await fetch(`${base}/${existing.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: upd }) });
    }
    return { id: existing.id, updated: true };
  } else {
    // 신규 회원 생성
    const fresh = Object.assign({}, m);
    if (photos.length) fresh["프로필사진"] = photos;
    fresh["유입경로"] = src;
    fresh["상태"] = "활성";
    fresh["가입일"] = today();
    fresh["참여이력"] = histTag;
    const r = await fetch(base, { method: "POST", headers: H, body: JSON.stringify({ fields: fresh }) });
    const d = await r.json();
    return { id: d.id, created: true };
  }
}

/**
 * 회원 명부 일괄 적립 (하루 한 번 cron 에서 호출)
 *
 * 예전에는 신청이 들어올 때마다 upsertMember 를 불렀다. 신청 1건에
 * 에어테이블을 3번(신청 저장 + 회원 조회 + 회원 갱신) 쓰게 되고,
 * 신청이 몰리면 에어테이블 한도에 금방 닿는다. 실제로 2026-09-24 에
 * 월 한도를 넘겨 신청·관리자 조회가 전부 막혔다.
 *
 * 그래서 신청 때는 저장만(1번) 하고, 적립은 여기서 몰아서 한다.
 *   · 회원 명부를 통째로 한 번 읽어 전화번호 → 레코드 로 만든다
 *   · 쓰기는 10건씩 묶어서 보낸다 (에어테이블 한 번에 10건)
 * 신청이 몇 건이든 쓰는 호출 수가 거의 늘지 않는다.
 *
 * 같은 사람을 여러 번 돌려도 안전하다. 빈 칸만 채우고 참여이력은
 * 이미 있으면 더하지 않는다.
 */
async function syncMembers({ TOKEN, BASE_ID, sources }) {
  const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const base = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBER_TABLE)}`;
  const stat = { 읽음: 0, 새회원: 0, 갱신: 0, 건너뜀: 0, 호출: 0 };

  // 1) 회원 명부 전체를 한 번만 읽는다
  const byPhone = new Map();
  let off;
  do {
    const p = new URLSearchParams({ pageSize: "100" });
    if (off) p.set("offset", off);
    const r = await fetch(`${base}?${p.toString()}`, { headers: H });
    stat.호출++;
    if (!r.ok) throw new Error("회원 명부 조회 실패 (" + r.status + ")");
    const d = await r.json();
    (d.records || []).forEach((rec) => {
      const ph = normPhone((rec.fields || {})["전화번호"]);
      if (ph && !byPhone.has(ph)) byPhone.set(ph, rec);
    });
    off = d.offset;
  } while (off);

  // 2) 신청 기록을 돌며 만들 것 / 고칠 것을 모은다
  const creates = [], patches = [];
  for (const { table, records } of sources) {
    for (const rec of records || []) {
      stat.읽음++;
      const fields = rec.fields || {};
      const phone = normPhone(fields["연락처"] || fields["전화번호"]);
      if (!phone) { stat.건너뜀++; continue; }

      const { m, photos } = mapToMember(fields);
      const src = sourceLabel(table);
      const histKey = src + (fields["회차"] ? " " + fields["회차"] : "");
      const histTag = histKey + " (" + today() + ")";
      const existing = byPhone.get(phone);

      if (!existing) {
        const fresh = Object.assign({}, m);
        if (photos.length) fresh["프로필사진"] = photos;
        fresh["유입경로"] = src;
        fresh["상태"] = "활성";
        fresh["가입일"] = today();
        fresh["참여이력"] = histTag;
        creates.push({ fields: fresh });
        // 같은 사람이 같은 회차에 두 번 들어오지 않게 자리만 잡아둔다
        byPhone.set(phone, { id: null, fields: fresh });
        continue;
      }

      const ex = existing.fields || {};
      const upd = {};
      Object.keys(m).forEach((k) => { if (m[k] && !ex[k]) upd[k] = m[k]; });
      if (photos.length && !(ex["프로필사진"] && ex["프로필사진"].length)) upd["프로필사진"] = photos;
      const hist = ex["참여이력"] || "";
      if (hist.indexOf(histKey) < 0) upd["참여이력"] = (hist ? hist + "\n" : "") + histTag;

      if (Object.keys(upd).length && existing.id) {
        patches.push({ id: existing.id, fields: upd });
        existing.fields = Object.assign({}, ex, upd); // 같은 실행 안에서 중복 반영 방지
      }
    }
  }

  // 3) 10건씩 묶어서 쓴다
  async function writeBatches(list, method) {
    for (let i = 0; i < list.length; i += 10) {
      const r = await fetch(base, {
        method, headers: H, body: JSON.stringify({ records: list.slice(i, i + 10) }),
      });
      stat.호출++;
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error("회원 " + (method === "POST" ? "생성" : "갱신") + " 실패 (" + r.status + ") " + t.slice(0, 120));
      }
    }
  }
  await writeBatches(creates, "POST");
  await writeBatches(patches, "PATCH");
  stat.새회원 = creates.length;
  stat.갱신 = patches.length;
  return stat;
}

// 관리자 셋업 엔드포인트: 테이블/필드 생성 (Metadata API, 함수 개수 절약 위해 여기 통합)
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  const isAdmin = ADMIN_PW && req.headers["x-admin-key"] === ADMIN_PW;
  const body = (req.method === "POST" && req.body) || {};

  // "그때 그 사람 찾기" 쪽지 기능 (고객용, 카카오 로그인 필요) → api/_reconnect.js
  if (req.method === "POST" && typeof body.action === "string" && (body.action.indexOf("rc_") === 0 || body.action.indexOf("bd_") === 0)) {
    try {
      const reconnect = body.action.indexOf("bd_") === 0 ? require("./_board.js") : require("./_reconnect.js");
      let sendSms = null, notify = null;
      try { sendSms = require("./_sms.js").sendSms; } catch (e) {}
      try { notify = require("./airtable.js").notifySlack || null; } catch (e) {}
      const out = await reconnect({ action: body.action, body, TOKEN, BASE_ID, sendSms, notify });
      return res.status(out.status).json(out.json);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (isAdmin && body.action === "listTables") {
    try {
      const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: { "Authorization": `Bearer ${TOKEN}` } });
      const d = await r.json();
      return res.status(r.status).json({ tables: (d.tables || []).map(t => ({ id: t.id, name: t.name })) });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (isAdmin && (body.action === "createTable" || body.action === "createField")) {
    try {
      const url = body.action === "createTable"
        ? `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`
        : `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${body.tableId}/fields`;
      const payload = body.action === "createTable"
        ? { name: body.name, description: body.description || "", fields: body.fields || [] }
        : Object.assign({ name: body.name, type: body.type || "multilineText", description: body.description || "" }, body.options ? { options: body.options } : {});
      const r = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return res.status(r.status).json(await r.json());
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(404).json({ error: "not found" });
};

module.exports.upsertMember = upsertMember;
module.exports.syncMembers = syncMembers;
