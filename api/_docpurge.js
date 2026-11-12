/**
 * 🪪 재직 서류 자동 파기
 *
 * 신청서와 개인정보 처리방침에 "재직 증빙은 센터장 확인용으로만 쓰고 14일 안에 자동 삭제"라고 약속했다.
 * 그 약속을 실제로 지키는 코드다. 아침 브리핑 때 하루 한 번 돈다.
 *
 * ① 에어테이블: 신청일로부터 14일 지난 기록의 '재직증명서' 칸을 비운다.
 *    - 브리핑이 이미 읽어둔 목록을 받아서 쓰므로 '읽기' 호출은 늘지 않는다.
 *    - 지우기는 10건씩 묶어서, 하루 최대 MAX_PATCH 번만 한다 (월 1,000건 한도 보호).
 *      처음 켤 때 밀린 서류가 많아도 며칠에 걸쳐 나눠서 지운다.
 * ② Cloudinary(사진·서류 원본이 올라가는 곳): 서류 폴더에서 14일 지난 파일을 지운다.
 *    - 환경변수 CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET 이 있을 때만 동작한다.
 *      (없으면 조용히 건너뛴다. 브리핑에 빨간 줄을 띄우지 않는다)
 *    - 사진 폴더는 건드리지 않는다. 서류 폴더만 지운다.
 *
 * 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 */

// ⏸ 2026-11-12 센터장 요청으로 자동 파기를 멈췄다. (이날 아침 첫 실행에서 50건이 지워진 뒤)
//    - false 인 동안에는 에어테이블·Cloudinary 어디에서도 아무것도 지우지 않는다.
//    - 다시 켜려면 true 로 바꾼다. 켜기 전에 신청서·처리방침의 보관 기간 문구와 맞는지 꼭 확인할 것.
//    - 멈춘 채로 두려면 신청서·FAQ·처리방침의 "14일 뒤 자동 삭제" 문구도 실제 운영에 맞게 바꿔야 한다
//      (지우지 않으면서 지운다고 적어두면 안 된다).
const PURGE_ON = false;

const KEEP_DAYS = 14;
const MAX_PATCH = 5;          // 에어테이블 지우기 호출 하루 최대 횟수 (×10건)
const DOC_FIELD = "재직증명서";
const DOC_FOLDERS = ["ssumcenter/docs", "ssumcenter/rotation-docs", "ssumcenter/fintech-docs"];
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "ddvmmvcei";

function isOld(createdTime, now) {
  const t = new Date(createdTime).getTime();
  return !isNaN(t) && now - t > KEEP_DAYS * 86400000;
}

// ① 에어테이블 — sources: [{ table, records }]
async function purgeAirtable({ TOKEN, BASE_ID, sources, now }) {
  let calls = 0, cleared = 0;
  for (const { table, records } of sources) {
    const targets = (records || []).filter((r) => {
      const v = (r.fields || {})[DOC_FIELD];
      return Array.isArray(v) && v.length > 0 && isOld(r.createdTime, now);
    });
    for (let i = 0; i < targets.length && calls < MAX_PATCH; i += 10) {
      const batch = targets.slice(i, i + 10).map((r) => ({ id: r.id, fields: { [DOC_FIELD]: [] } }));
      calls++;
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: batch }),
      });
      if (!res.ok) {
        console.error("[docpurge] 에어테이블 지우기 실패:", table, res.status, (await res.text()).slice(0, 200));
        break;
      }
      cleared += batch.length;
    }
  }
  return cleared;
}

// ② Cloudinary — 서류 폴더의 14일 지난 파일 삭제
async function purgeCloudinary({ now }) {
  const KEY = process.env.CLOUDINARY_API_KEY, SECRET = process.env.CLOUDINARY_API_SECRET;
  if (!KEY || !SECRET) return null;   // 설정 전 → 건너뜀
  const auth = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");
  const base = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
  let removed = 0;

  async function listOld(url) {
    const out = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const r = await fetch(url + (cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""), { headers: { Authorization: auth } });
      if (!r.ok) { console.error("[docpurge] Cloudinary 목록 실패:", r.status); break; }
      const d = await r.json();
      for (const x of d.resources || []) {
        if (isOld(x.created_at, now)) out.push({ id: x.public_id, type: x.resource_type || "image" });
      }
      if (!d.next_cursor) break;
      cursor = d.next_cursor;
    }
    return out;
  }

  for (const folder of DOC_FOLDERS) {
    let old = [];
    // 계정 설정에 따라 폴더 표시 방식이 달라서 두 가지로 찾는다
    for (const type of ["image", "raw"]) {
      old = old.concat(await listOld(`${base}/resources/${type}/upload?prefix=${encodeURIComponent(folder + "/")}&max_results=500`));
    }
    if (!old.length) {
      old = await listOld(`${base}/resources/by_asset_folder?asset_folder=${encodeURIComponent(folder)}&max_results=500`);
    }
    for (const type of ["image", "raw"]) {
      const ids = old.filter((x) => x.type === type).map((x) => x.id);
      for (let i = 0; i < ids.length; i += 100) {
        const qs = ids.slice(i, i + 100).map((id) => "public_ids[]=" + encodeURIComponent(id)).join("&");
        const r = await fetch(`${base}/resources/${type}/upload?${qs}`, { method: "DELETE", headers: { Authorization: auth } });
        if (!r.ok) { console.error("[docpurge] Cloudinary 삭제 실패:", r.status); continue; }
        const d = await r.json();
        removed += Object.values(d.deleted || {}).filter((v) => v === "deleted").length;
      }
    }
  }
  return removed;
}

/** 14일이 지났는데 서류가 남아 있는 기록 수 (지우지 않고 세기만 한다) */
function countOverdue(sources, now) {
  let n = 0;
  for (const { records } of sources || []) {
    for (const r of records || []) {
      const v = (r.fields || {})[DOC_FIELD];
      if (Array.isArray(v) && v.length > 0 && isOld(r.createdTime, now)) n++;
    }
  }
  return n;
}

/** 브리핑에서 부른다. 지운 게 있을 때만 한 줄을 돌려준다. */
async function purgeDocs({ TOKEN, BASE_ID, sources }) {
  const now = Date.now();
  if (!PURGE_ON) {
    // 멈춰 있는 동안에는 아무것도 지우지 않는다. 잊히지 않게 브리핑에 한 줄만 남긴다.
    const n = countOverdue(sources, now);
    return `\n🪪 재직 서류 자동 파기 — ⏸ 멈춤${n ? ` (14일 지난 서류 ${n}건 보관 중)` : ""}`;
  }
  let a = 0, c = null;
  try { a = await purgeAirtable({ TOKEN, BASE_ID, sources, now }); }
  catch (e) { console.error("[docpurge] 에어테이블:", e.message); }
  try { c = await purgeCloudinary({ now }); }
  catch (e) { console.error("[docpurge] Cloudinary:", e.message); }
  const total = a + (c || 0);
  return total ? `\n🪪 재직 서류 자동 파기 — ${a}건${c ? ` (원본 파일 ${c}개)` : ""}` : "";
}

module.exports = { purgeDocs, KEEP_DAYS, PURGE_ON };
