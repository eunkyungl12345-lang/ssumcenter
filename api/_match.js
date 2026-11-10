// 매칭 권한 확인 — "이 두 사람이 지금 서로의 프로필을 봐도 되는 사이인가"
//
//  매칭 링크(/response?id=상대&myId=나&t=만든시각)는 주소를 가진 사람이면 누구나 열 수 있다.
//  예전에는 서버가 아무것도 확인하지 않아서,
//    · 회원 고유번호만 알면 아무나 프로필(사진·직업·사는 곳)을 볼 수 있었고
//    · 주소에서 &t= 를 지우면 48시간이 지난 링크도 다시 열렸고
//    · 불발 처리한 매칭도 계속 보였다.
//  이제 '매칭' 표에 두 사람의 기록이 있고, 진행 중이고, 기한 안일 때만 허용한다.
//
//  ⚠️ 파일 이름이 _ 로 시작해서 Vercel 함수 개수(한도 12개)에 들어가지 않는다.

const REC = /^rec[A-Za-z0-9]{14}$/;
function isRecId(s) { return typeof s === "string" && REC.test(s); }

const HOURS_48 = 48 * 60 * 60 * 1000;

// 저장된 링크에서 '만든 시각(t)' 을 꺼낸다. 요청한 사람(myId)의 링크를 우선으로 본다.
function linkTime(fields, requesterId) {
  const links = [fields["남자링크"], fields["여자링크"]].filter(Boolean).map(String);
  let best = null;
  for (const l of links) {
    const q = l.split("?")[1] || "";
    const p = new URLSearchParams(q);
    const t = p.get("t");
    if (!t || !/^\d+$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (p.get("myId") === requesterId) return n;   // 내 링크의 시각이 가장 정확
    if (best === null || n > best) best = n;
  }
  return best;
}

/**
 * 두 사람(me, other)의 매칭 기록을 찾아 열람 가능 여부를 판단한다.
 *   { ok:true, rec, state }                         → 봐도 됨
 *   { ok:false, reason:"notfound"|"closed"|"expired"|"badid" }
 * 에어테이블 호출 1번.
 */
async function checkPair({ TOKEN, BASE_ID, me, other, now }) {
  if (!isRecId(me) || !isRecId(other) || me === other) return { ok: false, reason: "badid" };
  // 기록에 ID 칸이 비어 있는 옛 매칭도 링크 안에 두 번호가 들어 있으므로 그걸로도 찾는다.
  const links = `{남자링크}&{여자링크}`;
  const formula = `OR(AND({남자ID}="${me}",{여자ID}="${other}"),AND({남자ID}="${other}",{여자ID}="${me}"),AND(FIND("${me}",${links}),FIND("${other}",${links})))`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}?filterByFormula=${encodeURIComponent(formula)}&pageSize=20`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) {
    const e = new Error("매칭 기록을 확인하지 못했어요 (" + r.status + ")");
    e.status = r.status;
    throw e;
  }
  const recs = ((await r.json()).records) || [];
  if (!recs.length) return { ok: false, reason: "notfound" };

  const st = (x) => String((x.fields || {})["상태"] || "소개중");
  // 같은 두 사람이 다시 매칭된 경우가 있으므로, 살아 있는 기록(성사 > 소개중)을 먼저 본다.
  const done = recs.find((x) => st(x) === "성사");
  if (done) return { ok: true, rec: done, state: "성사" };

  const live = recs.filter((x) => st(x) === "소개중");
  if (!live.length) return { ok: false, reason: "closed" };   // 불발·결별만 남음

  // 소개중이면 48시간 기한을 본다. 가장 최근에 만든 링크 기준.
  const t0 = now || Date.now();
  let newest = null, newestT = null;
  for (const x of live) {
    const t = linkTime(x.fields || {}, me);
    if (t === null) { newest = x; newestT = null; break; }   // 시각을 알 수 없는 기록 → 기한 판정 불가, 허용
    if (newestT === null || t > newestT) { newest = x; newestT = t; }
  }
  if (newestT !== null && t0 > newestT + HOURS_48) return { ok: false, reason: "expired", rec: newest };
  return { ok: true, rec: newest, state: "소개중" };
}

module.exports = { checkPair, isRecId, linkTime, HOURS_48 };
