// "그날 그 사람" 익명 게시판 — 다른 업체 로테이션 소개팅에서 만난 사람 찾기
//  - api/member.js 에서 action 이 "bd_" 로 시작하면 여기로 넘어옴
//  - 글 보기: 누구나 / 글쓰기·"저예요" 쪽지: 카카오 로그인 필수
//  - "저예요" 쪽지는 첫 1회 무료, 2회부터는 회원 테이블 "쪽지권"이 있어야 함 (센터장이 입금 확인 후 수동으로 +1)
//  - Airtable 테이블 "익명찾기" (작성카카오ID 유형 업체 날짜 장소 내호수 내닉네임 내묘사 상대호수 상대닉네임 상대묘사 하고싶은말 상태 작성일 응답수 신고수 신고자 신고사유)
//    업체는 초성으로만 저장·공개 (원문은 저장하지 않음)
//    쪽지는 기존 "쪽지" 테이블 사용: 회차="익명게시판", 받는레코드ID=글ID. 연락처는 어디에도 저장하지 않음 (1:1 매칭 신청서에서만)

const BOARD = "익명찾기";
const NOTE = "쪽지";
const MEMBER = "회원";
const TAG = "익명게시판";

function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function esc(s) { return String(s || "").replace(/["\\]/g, ""); }
function clean(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
function normPhone(p) { return String(p || "").replace(/[^0-9]/g, ""); }
// 이름·전화번호·SNS 아이디 같은 식별 정보는 글에서 걸러냄
// 한글 → 초성 (업체명 익명화: 썸류센터 → ㅆㄹㅅㅌ). 한글 아닌 글자는 그대로
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function chosung(t) { return String(t || "").split("").map(c => { const code = c.charCodeAt(0); return (code >= 0xAC00 && code <= 0xD7A3) ? CHO[Math.floor((code - 0xAC00) / 588)] : c; }).join(""); }
// 욕설·비하·19금 표현 차단 (커뮤니티 규칙)
const BAD = /(시발|씨발|ㅅㅂ|ㅆㅂ|병신|ㅂㅅ|개새|좆|존나|ㅈㄴ|지랄|미친년|미친놈|년아|놈아|꺼져|닥쳐|섹스|섹파|원나잇|야한|야동|자위|가슴\s*크|몸매\s*(좋|죽)|모텔|호텔\s*가|19금|성인\s*(물|영상|사이트|만남|콘텐츠|용품)|조건\s*만남|스폰|애인\s*대행|돈\s*줄)/i;
function isBad(t) { return BAD.test(String(t || "")); }
function hasPII(t) { return /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(t) || /@[A-Za-z0-9_.]{3,}/.test(t) || /(인스타|카톡|카카오톡|아이디|id\s*[:：])/i.test(t); }

async function listAll(base, H, formula, fields, sort) {
  let out = [], offset = "";
  for (let i = 0; i < 10; i++) {
    let url = `${base}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}`;
    (fields || []).forEach(f => { url += `&fields%5B%5D=${encodeURIComponent(f)}`; });
    if (sort) url += `&sort%5B0%5D%5Bfield%5D=${encodeURIComponent(sort)}&sort%5B0%5D%5Bdirection%5D=desc`;
    if (offset) url += `&offset=${offset}`;
    const d = await (await fetch(url, { headers: H })).json();
    if (d.error) { const m = d.error.message || JSON.stringify(d.error); throw new Error(/model was not found|NOT_FOUND|Could not find table/i.test(m) ? "아직 준비 중이에요. 조금만 기다려주세요!" : m); }
    out = out.concat(d.records || []);
    if (!d.offset) break;
    offset = d.offset;
  }
  return out;
}

// ---- 제재 (블라인드식) : 신고 1회 → 글 검토중(숨김)+경고, 누적 2회 → 7일 정지, 누적 3회 → 영구 정지
async function getMember(mBase, H, kid) {
  // 필드 지정 없이 조회 — 쪽지권/신고누적/정지해제일 필드가 아직 없어도 에러 안 나게
  try { const mm = await listAll(mBase, H, `{카카오ID}="${kid}"`); return mm[0] || null; } catch (e) { return null; }
}
function banInfo(m) {
  const until = m && m.fields && m.fields["정지해제일"];
  if (!until) return null;
  if (until >= "9999") return "운영 정책 위반으로 이용이 영구 정지됐어요";
  if (until > kstToday()) return `신고 누적으로 ${until}까지 글쓰기·쪽지가 정지됐어요`;
  return null;
}
async function strike(mBase, H, kid) {
  const m = await getMember(mBase, H, kid);
  if (!m) return;
  const n = (m.fields["신고누적"] || 0) + 1;
  const upd = { "신고누적": n };
  if (n >= 3) upd["정지해제일"] = "9999-12-31";
  else if (n === 2) { const d = new Date(Date.now() + 9 * 3600 * 1000 + 7 * 86400 * 1000); upd["정지해제일"] = d.toISOString().slice(0, 10); }
  await fetch(`${mBase}/${m.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: upd }) });
  return n;
}

function pubPost(r, kid) {
  const f = r.fields || {};
  return {
    id: r.id, type: f["유형"] || "찾기", company: f["업체"] || "", date: f["날짜"] || "", place: f["장소"] || "",
    me: f["내묘사"] || "", you: f["상대묘사"] || "", msg: f["하고싶은말"] || "",
    meNo: f["내호수"] || "", meNick: f["내닉네임"] || "", youNo: f["상대호수"] || "", youNick: f["상대닉네임"] || "",
    created: f["작성일"] || "", replies: f["응답수"] || 0,
    mine: !!kid && f["작성카카오ID"] === kid
  };
}

module.exports = async function board({ action, body, TOKEN, BASE_ID, sendSms, notify }) {
  const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const bBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(BOARD)}`;
  const nBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(NOTE)}`;
  const mBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBER)}`;
  const kid = esc(body.kakaoId);

  // ---- 글 목록 (로그인 없이 가능) ----
  if (action === "bd_list") {
    const posts = await listAll(bBase, H, `{상태}="공개"`, ["유형", "업체", "날짜", "장소", "내묘사", "상대묘사", "하고싶은말", "내호수", "내닉네임", "상대호수", "상대닉네임", "작성일", "응답수", "작성카카오ID"], "작성일");
    let sentTo = {};
    if (kid) {
      const sent = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${TAG}")`, ["받는레코드ID", "상태"]);
      sent.forEach(n => { sentTo[n.fields["받는레코드ID"]] = n.fields["상태"] || "대기"; });
    }
    let ban = null, strikes = 0;
    if (kid) { const m = await getMember(mBase, H, kid); ban = banInfo(m); strikes = m && m.fields ? (m.fields["신고누적"] || 0) : 0; }
    return { status: 200, json: { ok: true, ban, strikes, posts: posts.map(r => Object.assign(pubPost(r, kid), { sent: sentTo[r.id] || "" })) } };
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
    const meNick = clean(body.meNick, 12), youNick = chosung(clean(body.youNick, 12)); // 상대 닉네임은 초성만 (본인만 알아보게)
    const type = body.type === "셀소" ? "셀소" : "찾기";
    if (!companyRaw || !date || !place) return { status: 400, json: { error: "업체·날짜·장소는 꼭 적어주세요" } };
    if (type === "찾기" && !youNo && !youNick && !you) return { status: 400, json: { error: "찾는 분의 번호·닉네임·인상 중 하나는 적어주세요" } };
    if (type === "셀소" && !myG) return { status: 400, json: { error: "셀소는 내 성별을 골라주세요" } };
    if (type === "셀소" && !meNo && !meNick && !me) return { status: 400, json: { error: "내 번호·닉네임·인상 중 하나는 적어주세요" } };
    if (isBad(me + " " + you + " " + msg + " " + meNick + " " + youNick + " " + companyRaw)) return { status: 400, json: { error: "욕설·비하·성적인 표현은 올릴 수 없어요. 커뮤니티 규칙을 확인해주세요" } };
    if (hasPII(me + " " + you + " " + msg + " " + meNick + " " + youNick)) return { status: 400, json: { error: "글에는 전화번호·SNS 아이디·실명을 넣을 수 없어요. 그날의 인상만 적어주세요 :)" } };
    const banMsg = banInfo(await getMember(mBase, H, kid));
    if (banMsg) return { status: 403, json: { error: banMsg } };
    const myToday = await listAll(bBase, H, `AND({작성카카오ID}="${kid}",IS_SAME({작성일},"${kstToday()}","day"))`, ["상태"]);
    if (myToday.length >= 2) return { status: 429, json: { error: "글은 하루 2개까지만 올릴 수 있어요" } };
    const r = await fetch(bBase, { method: "POST", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "작성카카오ID": kid, "유형": type, "업체": company, "날짜": date, "장소": place, "내묘사": me, "상대묘사": you, "하고싶은말": msg,
      "내호수": meNo, "내닉네임": meNick, "상대호수": youNo, "상대닉네임": youNick,
      "상태": "공개", "작성일": kstToday(), "응답수": 0
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

  // ---- 신고 (글 또는 쪽지) : 1회 신고로 즉시 숨김 + 작성자 경고 누적 ----
  if (action === "bd_report") {
    const reason = clean(body.reason, 100);
    if (body.noteId) {
      const n = await (await fetch(`${nBase}/${esc(body.noteId)}`, { headers: H })).json();
      const f = n.fields || {};
      if (!f["받는레코드ID"]) return { status: 404, json: { error: "쪽지를 찾을 수 없어요" } };
      const p = await (await fetch(`${bBase}/${f["받는레코드ID"]}`, { headers: H })).json();
      if (!p.fields || p.fields["작성카카오ID"] !== kid) return { status: 403, json: { error: "내가 받은 쪽지만 신고할 수 있어요" } };
      if (f["상태"] === "삭제") return { status: 409, json: { error: "이미 신고한 쪽지예요" } };
      await fetch(`${nBase}/${n.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: { "상태": "삭제", "신고사유": reason } }) });
      const cnt = await strike(mBase, H, f["보낸카카오ID"]);
      try { if (notify) await notify(`🚨 쪽지 신고\n사유: ${reason || "-"}\n내용: ${f["내용"] || ""}\n보낸이 ${f["보낸카카오ID"]} (누적 ${cnt || "?"}회)`); } catch (e) {}
      return { status: 200, json: { ok: true } };
    }
    const p = await (await fetch(`${bBase}/${esc(body.postId)}`, { headers: H })).json();
    const pf = p.fields || {};
    if (!pf["작성카카오ID"]) return { status: 404, json: { error: "글을 찾을 수 없어요" } };
    if (pf["작성카카오ID"] === kid) return { status: 400, json: { error: "내 글은 신고할 수 없어요" } };
    const reporters = String(pf["신고자"] || "").split(",").filter(Boolean);
    if (reporters.includes(kid)) return { status: 409, json: { error: "이미 신고한 글이에요" } };
    reporters.push(kid);
    await fetch(`${bBase}/${p.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "상태": "검토중", "신고수": (pf["신고수"] || 0) + 1, "신고자": reporters.join(","), "신고사유": ((pf["신고사유"] || "") + "\n" + reason).trim()
    } }) });
    const cnt = await strike(mBase, H, pf["작성카카오ID"]);
    try { if (notify) await notify(`🚨 글 신고 → 검토중으로 숨김\n${pf["업체"] || ""} ${pf["날짜"] || ""} · 사유: ${reason || "-"}\n작성자 ${pf["작성카카오ID"]} (누적 ${cnt || "?"}회${cnt >= 3 ? " → 영구정지" : (cnt === 2 ? " → 7일 정지" : " → 경고")})\nAirtable 익명찾기에서 상태를 '공개'로 되돌리면 복구돼요`); } catch (e) {}
    return { status: 200, json: { ok: true } };
  }

  // ---- "저예요!" 쪽지 (1회 무료, 이후 쪽지권 필요) ----
  if (action === "bd_reply") {
    const postId = esc(body.postId), text = clean(body.text, 300);
    if (!postId || !text) return { status: 400, json: { error: "내용을 입력해주세요" } };
    if (isBad(text)) return { status: 400, json: { error: "욕설·비하·성적인 표현은 보낼 수 없어요" } };
    if (hasPII(text)) return { status: 400, json: { error: "쪽지에 전화번호·SNS 아이디는 넣을 수 없어요. 수락되면 센터장이 연결해드려요" } };
    const banMsg2 = banInfo(await getMember(mBase, H, kid));
    if (banMsg2) return { status: 403, json: { error: banMsg2 } };
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
      memberRec = await getMember(mBase, H, kid);
      const tickets = memberRec ? (memberRec.fields["쪽지권"] || 0) : 0;
      if (tickets < 1) return { status: 402, json: { error: "첫 쪽지는 무료, 두 번째부터는 쪽지권이 필요해요", needTicket: true } };
      usedTicket = true;
    }

    const r = await fetch(nBase, { method: "POST", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "보낸레코드ID": "", "보낸카카오ID": kid, "보낸닉네임": "저예요",
      "받는레코드ID": postId, "받는닉네임": "글쓴이", "회차": TAG, "내용": text, "상태": "대기", "보낸날짜": kstToday()
    } }) });
    const d = await r.json();
    if (!r.ok) return { status: r.status, json: { error: (d.error && d.error.message) || "저장 실패" } };

    if (usedTicket && memberRec) {
      await fetch(`${mBase}/${memberRec.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { "쪽지권": (memberRec.fields["쪽지권"] || 0) - 1 } }) });
    }
    await fetch(`${bBase}/${postId}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { "응답수": (pf["응답수"] || 0) + 1 } }) });
    return { status: 200, json: { ok: true, usedTicket } };
  }

  // ---- 쪽지함 (익명게시판 분) ----
  if (action === "bd_inbox") {
    const myPosts = await listAll(bBase, H, `{작성카카오ID}="${kid}"`, ["업체", "날짜"]);
    const pMap = {}; myPosts.forEach(p => { pMap[p.id] = p.fields; });
    const received = myPosts.length ? await listAll(nBase, H, `AND({회차}="${TAG}",OR(${myPosts.map(p => `{받는레코드ID}="${p.id}"`).join(",")}))`) : [];
    const sent = await listAll(nBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${TAG}")`);
    const items = [];
    received.forEach(n => { const f = n.fields || {}; if (f["상태"] === "삭제") return; const pf = pMap[f["받는레코드ID"]] || {};
      items.push({ id: n.id, dir: "received", board: true, round: `${pf["업체"] || ""} ${pf["날짜"] || ""}`.trim(), text: f["내용"] || "", status: f["상태"] || "대기", date: f["보낸날짜"] || "",
        from: "저예요!", to: "" }); });
    const postIds = [...new Set(sent.map(n => n.fields["받는레코드ID"]))];
    const postMap = {};
    for (const id of postIds) { try { const p = await (await fetch(`${bBase}/${id}`, { headers: H })).json(); postMap[id] = p.fields || {}; } catch (e) {} }
    sent.forEach(n => { const f = n.fields || {}; const pf = postMap[f["받는레코드ID"]] || {};
      items.push({ id: n.id, dir: "sent", board: true, round: `${pf["업체"] || ""} ${pf["날짜"] || ""}`.trim(), text: f["내용"] || "", status: f["상태"] || "대기", date: f["보낸날짜"] || "",
        from: "", to: "글쓴이" }); });
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const mm = await getMember(mBase, H, kid);
    return { status: 200, json: { ok: true, items, freeLeft: sent.length ? 0 : 1, tickets: mm ? (mm.fields["쪽지권"] || 0) : 0 } };
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
      // 연락처는 아무도 모름 — 양쪽 쪽지함에 1:1 매칭 신청 링크가 뜨고, 신청서에서 센터장이 확인 후 연결
      const label = `${p.fields["업체"] || ""} ${p.fields["날짜"] || ""}`.trim();
      try { if (notify) await notify(`💌 그날 그 사람 — 수락!\n${label} (쪽지 ${n.id})\n양쪽 쪽지함에 1:1 매칭 신청 링크 표시됨 → 두 명 신청 들어오면 '쪽지연결' 값으로 짝 맞춰 연결`); } catch (e) {}
    }
    return { status: 200, json: { ok: true, status: answer } };
  }

  return { status: 400, json: { error: "알 수 없는 요청" } };
};
