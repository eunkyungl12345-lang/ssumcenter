// 회원 통합 명부 (마스터 DB)
//  - upsertMember: 전화번호 기준으로 회원 찾아서 있으면 업데이트, 없으면 생성 (중복방지)
//    → api/airtable.js 에서 신청서 제출 성공 시 자동 호출됨
//  - action:"createTable" / "migrate" : 최초 1회 셋업용 (x-setup-key 필요, 완료 후 제거 예정)

const SETUP_KEY = "ssum-tmp-setup-7Xk92Qp4vR";
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
  const 이상형 = [fields["선호나이대"], fields["선호직업군"]].filter(Boolean).join(" / ");
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-setup-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });

  const body = req.body || {};
  const isSetup = req.headers["x-setup-key"] === SETUP_KEY;

  // ── 1회 셋업: 회원 테이블 생성 ──
  if (body.action === "createTable") {
    if (!isSetup) return res.status(401).json({ error: "권한 없음" });
    const fields = [
      { name: "이름", type: "singleLineText" },
      { name: "전화번호", type: "singleLineText" },
      { name: "성별", type: "singleSelect", options: { choices: [{ name: "남성" }, { name: "여성" }] } },
      { name: "출생연도", type: "singleLineText" },
      { name: "직업", type: "singleLineText" },
      { name: "사는곳", type: "singleLineText" },
      { name: "키", type: "singleLineText" },
      { name: "프로필사진", type: "multipleAttachments" },
      { name: "성격키워드", type: "singleLineText" },
      { name: "자기소개", type: "multilineText" },
      { name: "취미", type: "singleLineText" },
      { name: "종교", type: "singleLineText" },
      { name: "이상형", type: "multilineText" },
      { name: "유입경로", type: "singleSelect", options: { choices: [{ name: "1:1신청" }, { name: "로테이션" }, { name: "투표" }, { name: "재테크" }] } },
      { name: "참여이력", type: "multilineText" },
      { name: "매칭이력", type: "multilineText" },
      { name: "상태", type: "singleSelect", options: { choices: [{ name: "활성" }, { name: "휴면" }, { name: "멤버십" }, { name: "성사" }] } },
      { name: "등급", type: "singleLineText" },
      { name: "거절횟수", type: "number", options: { precision: 0 } },
      { name: "가입일", type: "singleLineText" },
      { name: "메모", type: "multilineText" },
    ];
    const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: MEMBER_TABLE, fields }),
    });
    const d = await r.json();
    return res.status(r.status).json(d);
  }

  // ── 1회 셋업: 기존 신청 데이터 → 회원 이전 ──
  if (body.action === "migrate") {
    if (!isSetup) return res.status(401).json({ error: "권한 없음" });
    const H = { "Authorization": `Bearer ${TOKEN}` };
    const results = { "1:1 매칭 신청": [], "로테이션 신청": [] };
    for (const table of ["1:1 매칭 신청", "로테이션 신청"]) {
      let offset;
      do {
        const p = new URLSearchParams({ pageSize: "100" });
        if (offset) p.set("offset", offset);
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${p}`, { headers: H });
        const d = await r.json();
        if (!r.ok) { results[table].push({ error: d.error }); break; }
        for (const rec of (d.records || [])) {
          try {
            const out = await upsertMember({ table, fields: rec.fields || {}, TOKEN, BASE_ID });
            results[table].push({ 이름: rec.fields["이름"] || "?", ...out });
          } catch (e) { results[table].push({ 이름: rec.fields["이름"], error: e.message }); }
        }
        offset = d.offset;
      } while (offset);
    }
    return res.status(200).json({ ok: true, results });
  }

  return res.status(400).json({ error: "알 수 없는 action" });
};

module.exports.upsertMember = upsertMember;
