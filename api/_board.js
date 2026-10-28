// "그날 그 사람" 익명 게시판 — 다른 업체 로테이션 소개팅에서 만난 사람 찾기
//  - api/member.js 에서 action 이 "bd_" 로 시작하면 여기로 넘어옴
//  - 글 보기: 누구나 / 글쓰기·"저예요" 쪽지: 카카오 로그인 필수
//  - "저예요" 쪽지는 첫 1회 무료, 2회부터는 회원 테이블 "쪽지권"이 있어야 함 (센터장이 입금 확인 후 수동으로 +1)
//  - Airtable 테이블 "익명찾기" (작성카카오ID 업체 업체원문 날짜 장소 내호수 내닉네임 내묘사 상대호수 상대닉네임 상대묘사 하고싶은말 연락처 상태 작성일 응답수 신고수)
//    업체는 초성으로만 저장·공개 (업체원문은 센터장 확인용)
//    쪽지는 기존 "쪽지" 테이블 사용: 회차="익명게시판", 받는레코드ID=글ID, 보낸연락처 필드 추가 필요

const BOARD = "익명찾기";
const NOTE = "쪽지";
const MEMBER = "회원";
const TAG = "익명게시판";

function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function esc(s) { return String(s || "").replace(/["\\]/g, ""); }
function clean(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
function normPhone(p) { return String(p || "").replace(/[^0-9]/g, ""); }
function maskPhone(p) { const n = normPhone(p); return n.length >= 10 ? n.slice(0, 3) + "-" + n.slice(3, 7) + "-" + n.slice(7) : n; }
// 이름·전화번호·SNS 아이디 같은 식별 정보는 글에서 걸러냄
// 한글 → 초성 (업체명 익명화: 썸류센터 → ㅆㄹㅅㅌ). 한글 아닌 글자는 그대로
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function chosung(t) { return String(t || "").split("").map(c => { const code = c.charCodeAt(0); return (code >= 0xAC00 && code <= 0xD7A3) ? CHO[Math.floor((code - 0xAC00) / 588)] : c; }).join(""); }
function hasPII(t) { return /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(t) || /@[A-Za-z0-9_.]{3,}/.test(t) || /(인스타|카톡|카카오톡|아이디|id\s*[:：])/i.test(t); }

async function listAll(base, H, formula, fields, sort) {
  let out = [], offset = "";
  for (let i = 0; i < 10; i++) {
    let url = `${base}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}`;
    (fields || []).forEach(f => { url += `&fields%5B%5D=${encodeURIComponent(f)}`; });
    if (sort) url += `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent(sort)}&sort%5B0%5D%5Bdirection%5D=desc`;
    if (offset) url += `&offset=${offset}`;
    const d = await (await fetch(url, { headers: H })).json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
    out = out.concat(d.records || []);
    if (!d.offset) break;
    offset = d.offset;
  }
  return out;
}

function pubPost(r, kid) {
  const f = r.fields || {};
  return {
    id: r.id, company: f["업체"] || "", date: f["날짜"] || "", place: f["장소"] || "",
    me: f["내묘사"] || "", you: f["상대묘사"] || "", msg: f["하고싶은말"] || "",
    meNo: f["내호수"] || "", meNick: f["내닉네임"] || "", youNo: f["상대호수"] || "", youNick: f["상대닉네임"] || "",
    created: f["작성일"] || "", replies: f["응답수"] || 0,
    mine: !!kid && f["작성카카오ID"] === kid
  };
}

module.exports = async function board({ action, body, TOKEN, BASE_ID, sendSms }) {
  const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const bBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(BOARD)}`;
  const nBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(NOTE)}`;
  const mBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBER)}`;
  const kid = esc(body.kakaoId);

  // ---- 글 목록 (로그인 없이 가능) ----
  if (action === "bd_list") {
    const posts = await listAll(bBase, H, `{상태}="공개"`, ["업체", "날짜", "장소", "내묘사", "상대묘사", "하고싶은말", "내호수", "내닉네임", "상대호수", "상대닉네임", "작성일", "응답수", "작성카카오ID"], "작성일");
    let sentTo = {};
    if (kid) {
      const sent = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${TAG}")`, ["받는레코드ID", "상태"]);
      sent.forEach(n => { sentTo[n.fields["받는레코드ID"]] = n.fields["상태"] || "대기"; });
    }
    return { status: 200, json: { ok: true, posts: posts.map(r => Object.assign(pubPost(r, kid), { sent: sentTo[r.id] || "" })) } };
  }

  if (!kid) return { status: 401, json: { error: "카카오 로그인이 필요해요" } };

  // ---- 글 쓰기 ----
  if (action === "bd_post") {
    const companyRaw = clean(body.company, 30), company = chosung(companyRaw), date = clean(body.date, 10), place = clean(body.place, 20);
    // 묘사는 짧게만 (너무 자세하면 특정 가능) — 나 60자 / 상대 80자
    const me = clean(body.me, 60), you = clean(body.you, 80), msg = clean(body.msg, 200);
    const myG = body.myGender === "여" ? "여" : (body.myGender === "남" ? "남" : "");
    const otherG = myG === "여" ? "남" : (myG === "남" ? "여" : "");
    const meNoN = parseInt(body.meNo, 10), youNoN = parseInt(body.youNo, 10);
    const meNo = myG && meNoN > 0 && meNoN < 100 ? `${myG} ${meNoN}호` : "";
    const youNo = otherG && youNoN > 0 && youNoN < 100 ? `${otherG} ${youNoN}호` : "";
    const meNick = clean(body.meNick, 12), youNick = clean(body.youNick, 12);
    const phone = normPhone(body.phone);
    if (!companyRaw || !date || !place) return { status: 400, json: { error: "업체·날짜·장소는 꼭 적어주세요" } };
    if (!youNo && !youNick && !you) return { status: 400, json: { error: "찾는 분의 번호·닉네임·인상 중 하나는 적어주세요" } };
    if (phone.length < 9) return { status: 400, json: { error: "연락처를 정확히 입력해주세요 (상대가 수락할 때만 공개돼요)" } };
    if (hasPII(me + " " + you + " " + msg + " " + meNick + " " + youNick)) return { status: 400, json: { error: "글에는 전화번호·SNS 아이디·실명을 넣을 수 없어요. 그날의 인상만 적어주세요 :)" } };
    const myToday = await listAll(bBase, H, `AND({작성카카오ID}="${kid}",IS_SAME({작성일},"${kstToday()}","day"))`, ["상태"]);
    if (myToday.length >= 2) return { status: 429, json: { error: "글은 하루 2개까지만 올릴 수 있어요" } };
    const r = await fetch(bBase, { method: "POST", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "작성카카오ID": kid, "업체": company, "업체원문": companyRaw, "날짜": date, "장소": place, "내묘사": me, "상대묘사": you, "하고싶은말": msg,
      "내호수": meNo, "내닉네임": meNick, "상대호수": youNo, "상대닉네임": youNick,
      "연락처": phone, "상태": "공개", "작성일": kstToday(), "응답수": 0
    } }) });
    const d = await r.json();
    if (!r.ok) return { status: r.status, json: { error: (d.error && d.error.message) || "저장 실패" } };
    return { status: 200, json: { ok: true, id: d.id } };
  }

  // ---- 내 글 내리기 ----
  if (action === "bd_hide") {
    const p = await (await fetch(`${bBase}/${esc(body.postId)}`, { headers: H })).json();
    if (!p.fields || p.fields["작성카카오ID"] !== kid) return { status: 403, json: { error: "내 글이 아니에요" } };
    await fetch(`${bBase}/${p.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: { "상태": "숨김" } }) });
    return { status: 200, json: { ok: true } };
  }

  // ---- 신고 ----
  if (action === "bd_report") {
    const p = await (await fetch(`${bBase}/${esc(body.postId)}`, { headers: H })).json();
    if (!p.fields) return { status: 404, json: { error: "글을 찾을 수 없어요" } };
    const cnt = (p.fields["신고수"] || 0) + 1;
    const upd = { "신고수": cnt };
    if (cnt >= 3) upd["상태"] = "숨김"; // 3회 신고면 자동 숨김
    await fetch(`${bBase}/${p.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: upd }) });
    return { status: 200, json: { ok: true } };
  }

  // ---- "저예요!" 쪽지 (1회 무료, 이후 쪽지권 필요) ----
  if (action === "bd_reply") {
    const postId = esc(body.postId), text = clean(body.text, 300), phone = normPhone(body.phone);
    if (!postId || !text) return { status: 400, json: { error: "내용을 입력해주세요" } };
    if (phone.length < 9) return { status: 400, json: { error: "연락처를 정확히 입력해주세요 (상대가 수락할 때만 공개돼요)" } };
    const p = await (await fetch(`${bBase}/${postId}`, { headers: H })).json();
    const pf = p.fields || {};
    if (!pf["상태"] || pf["상태"] !== "공개") return { status: 404, json: { error: "글을 찾을 수 없어요" } };
    if (pf["작성카카오ID"] === kid) return { status: 400, json: { error: "내가 쓴 글이에요" } };
    const dup = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{받는레코드ID}="${postId}")`, ["상태"]);
    if (dup.length) return { status: 409, json: { error: "이미 이 글에 쪽지를 보냈어요" } };

    // 무료 1회 / 이후 쪽지권
    const sentAll = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${TAG}")`, ["상태"]);
    let usedTicket = false, memberRec = null;
    if (sentAll.length >= 1) {
      const mm = await listAll(mBase, H, `{카카오ID}="${kid}"`, ["쪽지권"]);
      memberRec = mm[0];
      const tickets = memberRec ? (memberRec.fields["쪽지권"] || 0) : 0;
      if (tickets < 1) return { status: 402, json: { error: "첫 쪽지는 무료, 두 번째부터는 쪽지권이 필요해요", needTicket: true } };
      usedTicket = true;
    }

    const r = await fetch(nBase, { method: "POST", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "보낸레코드ID": "", "보낸카카오ID": kid, "보낸닉네임": "저예요", "보낸연락처": phone,
      "받는레코드ID": postId, "받는닉네임": "글쓴이", "회차": TAG, "내용": text, "상태": "대기", "보낸날짜": kstToday()
    } }) });
    const d = await r.json();
    if (!r.ok) return { status: r.status, json: { error: (d.error && d.error.message) || "저장 실패" } };

    if (usedTicket && memberRec) {
      await fetch(`${mBase}/${memberRec.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { "쪽지권": (memberRec.fields["쪽지권"] || 0) - 1 } }) });
    }
    await fetch(`${bBase}/${postId}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { "응답수": (pf["응답수"] || 0) + 1 } }) });
    try {
      if (pf["연락처"] && sendSms) await sendSms({ to: pf["연락처"], text: `[썸류센터] "${pf["업체"]} ${pf["날짜"]}" 글에 "저예요!" 쪽지가 왔어요 💌\n확인하기: https://ssumcenter.vercel.app/reconnect` });
    } catch (e) {}
    return { status: 200, json: { ok: true, usedTicket } };
  }

  // ---- 쪽지함 (익명게시판 분) ----
  if (action === "bd_inbox") {
    const myPosts = await listAll(bBase, H, `{작성카카오ID}="${kid}"`, ["업체", "날짜", "연락처"]);
    const pMap = {}; myPosts.forEach(p => { pMap[p.id] = p.fields; });
    const received = myPosts.length ? await listAll(nBase, H, `AND({회차}="${TAG}",OR(${myPosts.map(p => `{받는레코드ID}="${p.id}"`).join(",")}))`) : [];
    const sent = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${TAG}")`);
    const items = [];
    received.forEach(n => { const f = n.fields || {}; const pf = pMap[f["받는레코드ID"]] || {};
      items.push({ id: n.id, dir: "received", board: true, round: `${pf["업체"] || ""} ${pf["날짜"] || ""}`.trim(), text: f["내용"] || "", status: f["상태"] || "대기", date: f["보낸날짜"] || "",
        from: "저예요!", to: "", contact: f["상태"] === "수락" ? maskPhone(f["보낸연락처"]) : "" }); });
    const postIds = [...new Set(sent.map(n => n.fields["받는레코드ID"]))];
    const postMap = {};
    for (const id of postIds) { try { const p = await (await fetch(`${bBase}/${id}`, { headers: H })).json(); postMap[id] = p.fields || {}; } catch (e) {} }
    sent.forEach(n => { const f = n.fields || {}; const pf = postMap[f["받는레코드ID"]] || {};
      items.push({ id: n.id, dir: "sent", board: true, round: `${pf["업체"] || ""} ${pf["날짜"] || ""}`.trim(), text: f["내용"] || "", status: f["상태"] || "대기", date: f["보낸날짜"] || "",
        from: "", to: "글쓴이", contact: f["상태"] === "수락" ? maskPhone(pf["연락처"]) : "" }); });
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const mm = await listAll(mBase, H, `{카카오ID}="${kid}"`, ["쪽지권"]);
    return { status: 200, json: { ok: true, items, freeLeft: sent.length ? 0 : 1, tickets: mm[0] ? (mm[0].fields["쪽지권"] || 0) : 0 } };
  }

  // ---- 받은 "저예요" 쪽지에 답하기 ----
  if (action === "bd_respond") {
    const n = await (await fetch(`${nBase}/${esc(body.noteId)}`, { headers: H })).json();
    const f = n.fields || {};
    if (f["회차"] !== TAG) return { status: 400, json: { error: "잘못된 요청" } };
    const p = await (await fetch(`${bBase}/${f["받는레코드ID"]}`, { headers: H })).json();
    if (!p.fields || p.fields["작성카카오ID"] !== kid) return { status: 403, json: { error: "내 쪽지가 아니에요" } };
    if (f["상태"] && f["상태"] !== "대기") return { status: 409, json: { error: "이미 답한 쪽지예요" } };
    const answer = body.answer === "수락" ? "수락" : "거절";
    await fetch(`${nBase}/${n.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: { "상태": answer, "응답날짜": kstToday() } }) });
    if (answer === "수락") {
      try { if (f["보낸연락처"] && sendSms) await sendSms({ to: f["보낸연락처"], text: `[썸류센터] 글쓴이가 "저예요!" 쪽지를 수락했어요 🎉\n연락처 확인: https://ssumcenter.vercel.app/reconnect` }); } catch (e) {}
    }
    return { status: 200, json: { ok: true, status: answer, contact: answer === "수락" ? maskPhone(f["보낸연락처"]) : "" } };
  }

  return { status: 400, json: { error: "알 수 없는 요청" } };
};
