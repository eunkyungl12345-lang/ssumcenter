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

// 셋업(테이블 생성·데이터 이전)은 최초 1회 완료됨. 이 엔드포인트는 더 이상 직접 호출 안 함.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(404).json({ error: "not found" });
};

module.exports.upsertMember = upsertMember;
