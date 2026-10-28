// "그때 그 사람 찾기" — 로테이션 소개팅에서 만났던 사람에게 쪽지 보내기
//  - api/member.js 에서 action 이 "rc_" 로 시작하면 여기로 넘어옴 (함수 개수 절약)
//  - 로그인(카카오) 필수. 내 로테이션 신청 기록(카카오ID 연결 + 입금확정 O)이 있어야 사용 가능
//  - 하루 쪽지 3개 제한. 상대가 "수락" 하면 센터장에게 알림 → 센터장이 양쪽 연결 (연락처는 서로 공개 안 함)
//  - Airtable 테이블 "쪽지" 필요 (필드: 보낸레코드ID 보낸카카오ID 보낸닉네임 받는레코드ID 받는닉네임 회차 내용 상태 보낸날짜 응답날짜)

const ROT = "로테이션 신청";
const NOTE = "쪽지";
const DAILY_LIMIT = 3;

function kstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function esc(s) { return String(s || "").replace(/["\\]/g, ""); }
const BAD = /(시발|씨발|ㅅㅂ|ㅆㅂ|병신|ㅂㅅ|개새|좆|존나|ㅈㄴ|지랄|미친년|미친놈|년아|놈아|꺼져|닥쳐|섹스|섹파|원나잇|야한|야동|자위|가슴\s*크|몸매\s*(좋|죽)|모텔|호텔\s*가|19금|성인\s*(물|영상|사이트|만남|콘텐츠|용품)|조건\s*만남|스폰|애인\s*대행|돈\s*줄)/i;
function hasPII(t) { return /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(t) || /@[A-Za-z0-9_.]{3,}/.test(t) || /(인스타|카톡|카카오톡|아이디|id\s*[:：])/i.test(t); }
function roundKey(rd) { const m = String(rd || "").match(/(\d{1,2})\/(\d{1,2})/); return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0; }

async function listAll(base, H, formula, fields) {
  let out = [], offset = "";
  for (let i = 0; i < 10; i++) {
    let url = `${base}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}`;
    (fields || []).forEach(f => { url += `&fields%5B%5D=${encodeURIComponent(f)}`; });
    if (offset) url += `&offset=${offset}`;
    const d = await (await fetch(url, { headers: H })).json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
    out = out.concat(d.records || []);
    if (!d.offset) break;
    offset = d.offset;
  }
  return out;
}

function pubPerson(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    nickname: f["닉네임"] || f["이름"] || "참가자",
    gender: f["성별"] || "",
    birth: String(f["출생연도"] || "").slice(-2),
    round: f["회차"] || ""
  };
}

module.exports = async function reconnect({ action, body, TOKEN, BASE_ID, sendSms, notify }) {
  const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const rotBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ROT)}`;
  const noteBase = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(NOTE)}`;
  const kid = esc(body.kakaoId);
  if (!kid) return { status: 401, json: { error: "카카오 로그인이 필요해요" } };

  // 내 참가 기록 (입금확정된 것만)
  const mine = (await listAll(rotBase, H, `AND({카카오ID}="${kid}",{입금확정}="O")`))
    .sort((a, b) => roundKey(b.fields["회차"]) - roundKey(a.fields["회차"]));
  const myIds = mine.map(r => r.id);
  const myRounds = [...new Set(mine.map(r => r.fields["회차"]).filter(Boolean))];
  const myGender = mine.length ? (mine[0].fields["성별"] || "") : "";

  // ---- 내 정보: 참여 회차 목록 ----
  if (action === "rc_me") {
    return { status: 200, json: {
      ok: true,
      linked: mine.length > 0,
      gender: myGender,
      nickname: mine.length ? (mine[0].fields["닉네임"] || mine[0].fields["이름"] || "") : "",
      rounds: myRounds
    } };
  }

  if (!mine.length) return { status: 403, json: { error: "참가 기록이 없어요", needLink: true } };

  // ---- 그 회차에서 만난 사람들 (이성, 입금확정) ----
  if (action === "rc_people") {
    const round = esc(body.round);
    if (!myRounds.includes(round)) return { status: 403, json: { error: "참여하지 않은 회차예요" } };
    const other = myGender === "남성" ? "여성" : "남성";
    const people = (await listAll(rotBase, H, `AND({회차}="${round}",{입금확정}="O",{성별}="${other}")`,
      ["닉네임", "이름", "성별", "출생연도", "회차"])).map(pubPerson);
    // 이미 보낸 쪽지 표시
    const sent = await listAll(noteBase, H, `AND({보낸카카오ID}="${kid}",{회차}="${round}")`, ["받는레코드ID", "상태"]);
    const sentMap = {};
    sent.forEach(n => { sentMap[n.fields["받는레코드ID"]] = n.fields["상태"] || "대기"; });
    people.forEach(p => { p.sent = sentMap[p.id] || ""; });
    return { status: 200, json: { ok: true, people } };
  }

  // ---- 쪽지 보내기 ----
  if (action === "rc_send") {
    const toId = esc(body.toId), round = esc(body.round);
    const text = String(body.text || "").trim().slice(0, 300);
    if (!toId || !round || !text) return { status: 400, json: { error: "내용을 입력해주세요" } };
    if (BAD.test(text)) return { status: 400, json: { error: "욕설·비하·성적인 표현은 보낼 수 없어요" } };
    if (hasPII(text)) return { status: 400, json: { error: "쪽지에 전화번호·SNS 아이디는 넣을 수 없어요. 수락되면 센터장이 연결해드려요" } };
    if (!myRounds.includes(round)) return { status: 403, json: { error: "참여하지 않은 회차예요" } };

    const today = kstToday();
    const todaySent = await listAll(noteBase, H, `AND({보낸카카오ID}="${kid}",IS_SAME({보낸날짜},"${today}","day"))`, ["상태"]);
    if (todaySent.length >= DAILY_LIMIT) return { status: 429, json: { error: `쪽지는 하루 ${DAILY_LIMIT}개까지만 보낼 수 있어요. 내일 다시 보내주세요!` } };

    const dup = await listAll(noteBase, H, `AND({보낸카카오ID}="${kid}",{받는레코드ID}="${toId}")`, ["상태"]);
    if (dup.length) return { status: 409, json: { error: "이미 이 분께 쪽지를 보냈어요" } };

    const tr = await (await fetch(`${rotBase}/${toId}`, { headers: H })).json();
    const tf = tr.fields || {};
    if (!tf["회차"] || tf["회차"] !== round || tf["입금확정"] !== "O") return { status: 404, json: { error: "상대를 찾을 수 없어요" } };
    const me = mine.find(r => r.fields["회차"] === round) || mine[0];
    const mf = me.fields;

    const r = await fetch(noteBase, { method: "POST", headers: H, body: JSON.stringify({ typecast: true, fields: {
      "보낸레코드ID": me.id, "보낸카카오ID": kid, "보낸닉네임": mf["닉네임"] || mf["이름"] || "",
      "받는레코드ID": toId, "받는닉네임": tf["닉네임"] || tf["이름"] || "",
      "회차": round, "내용": text, "상태": "대기", "보낸날짜": today
    } }) });
    const d = await r.json();
    if (!r.ok) return { status: r.status, json: { error: (d.error && d.error.message) || "저장 실패" } };

    // 받는 사람에게 문자 (연락처 있을 때만, 실패해도 무시)
    try {
      if (tf["연락처"] && sendSms) {
        await sendSms({ to: tf["연락처"], text: `[썸류센터] ${round} 소개팅에서 만난 분이 쪽지를 보냈어요 💌\n확인하기: https://ssumcenter.vercel.app/reconnect` });
      }
    } catch (e) {}
    return { status: 200, json: { ok: true, remaining: DAILY_LIMIT - todaySent.length - 1 } };
  }

  // ---- 받은/보낸 쪽지함 ----
  if (action === "rc_inbox") {
    const recvF = myIds.map(id => `{받는레코드ID}="${id}"`).join(",");
    const received = await listAll(noteBase, H, `OR(${recvF})`);
    const sent = await listAll(noteBase, H, `{보낸카카오ID}="${kid}"`);
    const pack = async (n, dir) => {
      const f = n.fields || {};
      const item = { id: n.id, dir, round: f["회차"] || "", text: f["내용"] || "", status: f["상태"] || "대기",
        date: f["보낸날짜"] || "", from: f["보낸닉네임"] || "", to: f["받는닉네임"] || "" };
      return item;
    };
    const items = [];
    for (const n of received) items.push(await pack(n, "received"));
    for (const n of sent) items.push(await pack(n, "sent"));
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const today = kstToday();
    const todayCount = sent.filter(n => n.fields["보낸날짜"] === today).length;
    return { status: 200, json: { ok: true, items, remaining: Math.max(0, DAILY_LIMIT - todayCount) } };
  }

  // ---- 받은 쪽지에 답하기 (수락/거절) ----
  if (action === "rc_respond") {
    const noteId = esc(body.noteId);
    const answer = body.answer === "수락" ? "수락" : "거절";
    const n = await (await fetch(`${noteBase}/${noteId}`, { headers: H })).json();
    const f = n.fields || {};
    if (!f["받는레코드ID"] || !myIds.includes(f["받는레코드ID"])) return { status: 403, json: { error: "내 쪽지가 아니에요" } };
    if (f["상태"] && f["상태"] !== "대기") return { status: 409, json: { error: "이미 답한 쪽지예요" } };
    await fetch(`${noteBase}/${noteId}`, { method: "PATCH", headers: H, body: JSON.stringify({ typecast: true, fields: { "상태": answer, "응답날짜": kstToday() } }) });
    if (answer === "수락") {
      // 연락처는 서로 공개하지 않음 — 센터장이 양쪽에 연락해서 연결
      try {
        const s = await (await fetch(`${rotBase}/${f["보낸레코드ID"]}`, { headers: H })).json();
        const sf = s.fields || {};
        const meRec = mine.find(r => r.id === f["받는레코드ID"]) || mine[0];
        const myPhone = (meRec.fields || {})["연락처"] || "";
        const link = "https://ssumcenter.vercel.app/matching?ref=reconnect&note=" + noteId;
        const txt = `[썸류센터] 쪽지가 수락됐어요 🎉\n두 분 모두 1:1 매칭 신청서를 작성해주시면 센터장이 확인 후 연결해드려요.\n${link}`;
        if (sf["연락처"] && sendSms) await sendSms({ to: sf["연락처"], text: txt });
        if (myPhone && sendSms) await sendSms({ to: myPhone, text: txt });
        if (notify) await notify(`💌 그때 그 사람 — 수락!\n${f["회차"] || ""}\n${f["받는닉네임"] || "?"}(${myPhone || "?"}) ❤ ${f["보낸닉네임"] || "?"}(${sf["연락처"] || "?"})\n양쪽에 1:1 매칭 신청 링크 문자 발송됨 (쪽지 ${noteId}) → 신청 들어오면 연결`);
      } catch (e) {}
    }
    return { status: 200, json: { ok: true, status: answer } };
  }

  return { status: 400, json: { error: "알 수 없는 요청" } };
};
