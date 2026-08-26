// 투표 전용 API — 개인정보(전화번호) 노출을 막기 위해 범용 airtable 프록시 대신 별도 구성
// 테이블 3개 사용:
//   투표참가자: 행사, 순번, 닉네임, 성별, 년생, 한줄소개, 전화번호, 사진(첨부), 공개상태(체크박스), 결제상태
//   투표:       행사, 투표자전화, 투표자닉네임, 뽑은1, 뽑은2, 일시
//   투표설정:   행사, 공개(체크박스)
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!TOKEN || !BASE_ID) return res.status(500).json({ error: "서버 환경변수 미설정" });

  const body = req.body || {};
  const action = body.action;
  const isAdmin = ADMIN_PW && req.headers["x-admin-key"] === ADMIN_PW;

  // ---- Airtable 헬퍼 ----
  const api = (path, opts = {}) =>
    fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
      method: opts.method || "GET",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || d.error || "airtable error");
      return d;
    });

  // 테이블 전체 레코드 가져오기 (페이지네이션)
  async function getAll(table, filter) {
    let records = [], offset;
    do {
      const p = new URLSearchParams({ pageSize: "100" });
      if (filter) p.set("filterByFormula", filter);
      if (offset) p.set("offset", offset);
      const d = await api(`${encodeURIComponent(table)}?${p.toString()}`);
      records = records.concat(d.records || []);
      offset = d.offset;
    } while (offset);
    return records;
  }

  const digits = s => String(s || "").replace(/[^0-9]/g, "");
  const norm = s => digits(s); // 전화번호 비교용

  try {
    // ============ 참가자 본인 확인 ============
    if (action === "verify") {
      const phone = norm(body.phone);
      if (phone.length < 10) return res.status(200).json({ found: false });
      const people = await getAll("투표참가자", body.event ? `{행사}='${body.event}'` : null);
      const me = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!me) return res.status(200).json({ found: false });
      const event = me.fields["행사"] || "";
      const myVotes = await getAll("투표", `{행사}='${event}'`);
      const voted = myVotes.some(v => norm(v.fields["투표자전화"]) === phone);
      const settings = await getAll("투표설정", `{행사}='${event}'`);
      const revealed = settings.some(s => s.fields["공개"] === true);
      return res.status(200).json({
        found: true,
        voted,
        revealed,
        me: {
          닉네임: me.fields["닉네임"] || "",
          성별: me.fields["성별"] || "",
          행사: event,
        },
      });
    }

    // ============ 이성 참가자 목록 (전화번호 미포함) ============
    if (action === "list") {
      const people = await getAll("투표참가자", body.event ? `{행사}='${body.event}'` : null);
      const list = people
        .filter(p => !body.gender || p.fields["성별"] !== body.gender) // 이성만
        .map(p => ({
          순번: p.fields["순번"] || 0,
          닉네임: p.fields["닉네임"] || "",
          년생: p.fields["년생"] || "",
          한줄소개: p.fields["한줄소개"] || "",
          사진: (p.fields["사진"] && p.fields["사진"][0] && p.fields["사진"][0].url) || "",
        }))
        .sort((a, b) => (a.순번 || 0) - (b.순번 || 0));
      return res.status(200).json({ list });
    }

    // ============ 투표 제출 ============
    if (action === "vote") {
      const phone = norm(body.phone);
      const picks = (body.picks || []).filter(Boolean).slice(0, 2);
      if (phone.length < 10) return res.status(400).json({ error: "본인 확인 필요" });
      if (picks.length === 0) return res.status(400).json({ error: "최소 1명 선택" });

      const people = await getAll("투표참가자");
      const me = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!me) return res.status(400).json({ error: "명단에 없는 번호" });
      const event = me.fields["행사"] || "";

      // 중복 투표 방지
      const existing = await getAll("투표", `{투표자전화}='${me.fields["전화번호"]}'`);
      const dup = existing.find(v => norm(v.fields["투표자전화"]) === phone && (v.fields["행사"] || "") === event);
      if (dup) return res.status(200).json({ ok: false, already: true });

      await api("투표", {
        method: "POST",
        body: {
          records: [{
            fields: {
              행사: event,
              투표자전화: me.fields["전화번호"],
              투표자닉네임: me.fields["닉네임"] || "",
              뽑은1: picks[0] || "",
              뽑은2: picks[1] || "",
              일시: new Date().toLocaleString("ko-KR"),
            },
          }],
        },
      });
      return res.status(200).json({ ok: true });
    }

    // ============ 결과 조회 ============
    if (action === "result") {
      const phone = norm(body.phone);
      if (phone.length < 10) return res.status(400).json({ error: "본인 확인 필요" });

      const people = await getAll("투표참가자");
      const me = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!me) return res.status(400).json({ error: "명단에 없는 번호" });
      const event = me.fields["행사"] || "";
      const myNick = me.fields["닉네임"] || "";

      // 공개 여부
      const settings = await getAll("투표설정", `{행사}='${event}'`);
      const revealed = settings.some(s => s.fields["공개"] === true);
      if (!revealed) return res.status(200).json({ revealed: false });

      const votes = await getAll("투표", `{행사}='${event}'`);
      const byNick = {};
      people.forEach(p => { byNick[p.fields["닉네임"]] = p; });

      const myVote = votes.find(v => norm(v.fields["투표자전화"]) === phone);
      const myPicks = myVote ? [myVote.fields["뽑은1"], myVote.fields["뽑은2"]].filter(Boolean) : [];

      // 나를 뽑은 사람들
      const votersForMe = votes
        .filter(v => v.fields["뽑은1"] === myNick || v.fields["뽑은2"] === myNick)
        .map(v => v.fields["투표자닉네임"])
        .filter(Boolean);

      // 상호 매칭 (내가 뽑았고 + 그 사람도 나를 뽑음)
      const mutual = myPicks.filter(n => votersForMe.includes(n));

      const profile = nick => {
        const p = byNick[nick];
        return p ? {
          닉네임: nick,
          년생: p.fields["년생"] || "",
          한줄소개: p.fields["한줄소개"] || "",
          사진: (p.fields["사진"] && p.fields["사진"][0] && p.fields["사진"][0].url) || "",
        } : { 닉네임: nick };
      };

      // 무료: 상호 매칭 → 연락처 공유
      const free = mutual.map(nick => {
        const p = byNick[nick];
        return { ...profile(nick), 연락처: p ? p.fields["전화번호"] : "" };
      });

      // 유료: 결제(공개상태) 되어야 상세 공개
      const paidUnlocked = me.fields["공개상태"] === true;
      const paid = paidUnlocked
        ? {
            unlocked: true,
            득표수: votersForMe.length,
            상호수: mutual.length,
            나를뽑은사람: votersForMe.map(nick => {
              const isMutual = mutual.includes(nick);
              const p = byNick[nick];
              return { ...profile(nick), 상호매칭: isMutual, 연락처: isMutual ? "" : (p ? p.fields["전화번호"] : "") };
            }),
          }
        : { unlocked: false, hasVotes: votersForMe.length > 0 };

      return res.status(200).json({ revealed: true, free, paid });
    }

    // ============ (관리자) 공개 스위치 ============
    if (action === "reveal") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const event = body.event;
      const on = body.on !== false;
      const settings = await getAll("투표설정", `{행사}='${event}'`);
      if (settings.length > 0) {
        await api("투표설정", { method: "PATCH", body: { records: [{ id: settings[0].id, fields: { 공개: on } }] } });
      } else {
        await api("투표설정", { method: "POST", body: { records: [{ fields: { 행사: event, 공개: on } }] } });
      }
      return res.status(200).json({ ok: true, revealed: on });
    }

    // ============ (관리자) 결제 확인 → 개별 공개 ============
    if (action === "setPaid") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const phone = norm(body.phone);
      const people = await getAll("투표참가자");
      const target = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!target) return res.status(404).json({ error: "참가자 없음" });
      await api("투표참가자", { method: "PATCH", body: { records: [{ id: target.id, fields: { 공개상태: body.on !== false, 결제상태: body.on !== false ? "완료" : "미결제" } }] } });
      return res.status(200).json({ ok: true });
    }

    // ============ (관리자) 테이블 자동 생성 ============
    if (action === "setup") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const metaBase = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
      const listRes = await fetch(metaBase, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const listData = await listRes.json();
      if (!listRes.ok) return res.status(listRes.status).json({ error: listData.error?.message || "테이블 목록 조회 실패 (토큰 권한 확인)" });
      const existing = (listData.tables || []).map(t => t.name);

      const specs = [
        { name: "투표참가자", fields: [
          { name: "행사", type: "singleLineText" },
          { name: "순번", type: "number", options: { precision: 0 } },
          { name: "닉네임", type: "singleLineText" },
          { name: "성별", type: "singleSelect", options: { choices: [{ name: "남성" }, { name: "여성" }] } },
          { name: "년생", type: "singleLineText" },
          { name: "한줄소개", type: "singleLineText" },
          { name: "전화번호", type: "singleLineText" },
          { name: "사진", type: "multipleAttachments" },
          { name: "공개상태", type: "checkbox", options: { icon: "check", color: "greenBright" } },
          { name: "결제상태", type: "singleLineText" },
          { name: "음료", type: "singleLineText" },
          { name: "피드백", type: "multilineText" },
          { name: "출석", type: "checkbox", options: { icon: "check", color: "greenBright" } },
        ]},
        { name: "투표", fields: [
          { name: "행사", type: "singleLineText" },
          { name: "투표자전화", type: "singleLineText" },
          { name: "투표자닉네임", type: "singleLineText" },
          { name: "뽑은1", type: "singleLineText" },
          { name: "뽑은2", type: "singleLineText" },
          { name: "일시", type: "singleLineText" },
        ]},
        { name: "투표설정", fields: [
          { name: "행사", type: "singleLineText" },
          { name: "공개", type: "checkbox", options: { icon: "check", color: "greenBright" } },
        ]},
      ];

      const created = [], skipped = [];
      for (const spec of specs) {
        if (existing.includes(spec.name)) { skipped.push(spec.name); continue; }
        const r = await fetch(metaBase, {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(spec),
        });
        const d = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: `${spec.name} 생성 실패: ${d.error?.message || JSON.stringify(d.error)}`, created });
        created.push(spec.name);
      }
      return res.status(200).json({ ok: true, created, skipped });
    }

    // ============ (관리자) 참가자 일괄 등록 ============
    if (action === "addParticipants") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const event = body.event || "";
      const rows = body.rows || [];
      if (!rows.length) return res.status(400).json({ error: "등록할 참가자가 없어요" });
      // 100개씩 나눠 생성
      let n = 0;
      for (let i = 0; i < rows.length; i += 10) {
        const chunk = rows.slice(i, i + 10).map((r, idx) => ({
          fields: {
            행사: event,
            순번: r.순번 || (i + idx + 1),
            닉네임: r.닉네임 || "",
            성별: r.성별 || "",
            년생: r.년생 || "",
            한줄소개: r.한줄소개 || "",
            전화번호: r.전화번호 || "",
            음료: r.음료 || "",
          },
        }));
        await api("투표참가자", { method: "POST", body: { records: chunk } });
        n += chunk.length;
      }
      return res.status(200).json({ ok: true, count: n });
    }

    // ============ (관리자) 로테이션 승인자 자동 불러오기 ============
    // 로테이션 신청(승인상태=승인 & 해당 회차)을 투표참가자로 자동 등록.
    // 이미 등록된 번호는 건너뜀(중복방지) → 출석부 수동 복붙 제거.
    if (action === "importFromRotation") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const event = body.event || "";
      const round = body.round || event; // 투표 행사명 = 로테이션 회차명 (기본 동일)
      if (!event) return res.status(400).json({ error: "행사(회차)를 입력하세요" });

      // 입금완료(참석자) 해당 회차 신청자 — 실제 행사 참석자만
      const filter = `AND({입금확정}='O',{회차}='${round}')`;
      const applicants = await getAll("로테이션 신청", filter);
      if (!applicants.length) {
        return res.status(200).json({ ok: true, count: 0, skipped: 0, message: "해당 회차 입금완료(참석) 인원이 없어요" });
      }

      // 이미 등록된 참가자 번호(중복방지)
      const existing = await getAll("투표참가자", `{행사}='${event}'`);
      const seen = new Set(existing.map(r => norm(r.fields["전화번호"])).filter(Boolean));
      let maxSeq = existing.reduce((mx, r) => Math.max(mx, parseInt(r.fields["순번"], 10) || 0), 0);

      const firstLine = a => String(a || "").split("\n")[0].trim().slice(0, 60);
      const rows = [];
      let skipped = 0;
      for (const r of applicants) {
        const f = r.fields || {};
        const phone = norm(f["연락처"]);
        if (!phone || seen.has(phone)) { skipped++; continue; }
        seen.add(phone);
        maxSeq += 1;
        rows.push({
          fields: {
            행사: event,
            순번: maxSeq,
            닉네임: f["닉네임"] || f["이름"] || "",
            성별: f["성별"] || "",
            년생: String(f["출생연도"] || ""),
            한줄소개: firstLine(f["어필포인트"] || f["자기소개"]),
            전화번호: f["연락처"] || "",
            음료: "",
          },
        });
      }

      let n = 0;
      for (let i = 0; i < rows.length; i += 10) {
        const chunk = rows.slice(i, i + 10);
        if (!chunk.length) break;
        await api("투표참가자", { method: "POST", body: { records: chunk } });
        n += chunk.length;
      }
      return res.status(200).json({ ok: true, count: n, skipped, total: applicants.length });
    }

    // ============ (관리자) 출석 체크 ============
    if (action === "setAttend") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const phone = norm(body.phone);
      const people = await getAll("투표참가자");
      const target = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!target) return res.status(404).json({ error: "참가자 없음" });
      await api("투표참가자", { method: "PATCH", body: { records: [{ id: target.id, fields: { 출석: body.on !== false } }] } });
      return res.status(200).json({ ok: true });
    }

    // ============ (관리자) 참가자 목록 + 투표현황 ============
    if (action === "adminData") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const event = body.event;
      const people = await getAll("투표참가자", event ? `{행사}='${event}'` : null);
      const votes = await getAll("투표", event ? `{행사}='${event}'` : null);
      const settings = await getAll("투표설정", event ? `{행사}='${event}'` : null);
      const revealed = settings.some(s => s.fields["공개"] === true);
      const drinks = {};
      people.forEach(p => {
        const d = String(p.fields["음료"] || "").trim(); if (!d) return;
        if (!drinks[d]) drinks[d] = { 남: 0, 여: 0, 계: 0 };
        const g = p.fields["성별"];
        if (g === "남성") drinks[d].남++; else if (g === "여성") drinks[d].여++;
        drinks[d].계++;
      });
      // 💘 성사된 커플 계산 (A가 B를 뽑고 + B도 A를 뽑음)
      const pickMap = {};
      votes.forEach(v => { const voter = v.fields["투표자닉네임"]; if (voter) pickMap[voter] = [v.fields["뽑은1"], v.fields["뽑은2"]].filter(Boolean); });
      const genderByNick = {}, phoneByNick = {};
      people.forEach(p => { genderByNick[p.fields["닉네임"]] = p.fields["성별"] || ""; phoneByNick[p.fields["닉네임"]] = p.fields["전화번호"] || ""; });
      const seenPair = {}, couples = [];
      Object.keys(pickMap).forEach(a => {
        pickMap[a].forEach(b => {
          if (pickMap[b] && pickMap[b].indexOf(a) >= 0) {
            const k = [a, b].sort().join("|");
            if (seenPair[k]) return;
            seenPair[k] = true;
            let woman = a, man = b;
            if (genderByNick[a] === "남성" || genderByNick[b] === "여성") { man = a; woman = b; }
            couples.push({ 여자: woman, 남자: man, 여자전화: phoneByNick[woman] || "", 남자전화: phoneByNick[man] || "" });
          }
        });
      });

      // 📋 구글시트식 현황표 (참가자별 1·2순위 / 성사 / 날 찍은 사람)
      const votersOf = {};
      Object.keys(pickMap).forEach(voter => { pickMap[voter].forEach(pick => { (votersOf[pick] = votersOf[pick] || []).push(voter); }); });
      const rows = people.map(p => {
        const nick = p.fields["닉네임"] || "";
        const myPicks = pickMap[nick] || [];
        const forMe = votersOf[nick] || [];
        const mutual = myPicks.filter(x => forMe.indexOf(x) >= 0);
        return {
          순번: p.fields["순번"] || 0, 닉네임: nick, 성별: p.fields["성별"] || "", 음료: p.fields["음료"] || "",
          voted: !!pickMap[nick], p1: myPicks[0] || "", p2: myPicks[1] || "",
          성사: mutual, 날찍은사람: forMe, 피드백: p.fields["피드백"] || "",
        };
      });

      return res.status(200).json({
        revealed,
        participants: people.map(p => ({
          닉네임: p.fields["닉네임"] || "", 성별: p.fields["성별"] || "", 전화번호: p.fields["전화번호"] || "",
          공개상태: p.fields["공개상태"] === true, 결제상태: p.fields["결제상태"] || "",
          출석: p.fields["출석"] === true, 순번: p.fields["순번"] || 0,
          음료: p.fields["음료"] || "", 피드백: p.fields["피드백"] || "",
        })),
        couples,
        rows,
        voteCount: votes.length,
        attendCount: people.filter(p => p.fields["출석"] === true).length,
        drinks,
      });
    }

    if (action === "setFeedback") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const phone = norm(body.phone);
      const people = await getAll("투표참가자");
      const target = people.find(p => norm(p.fields["전화번호"]) === phone);
      if (!target) return res.status(404).json({ error: "참가자 없음" });
      await api("투표참가자", { method: "PATCH", body: { records: [{ id: target.id, fields: { 피드백: body.text || "" } }] } });
      return res.status(200).json({ ok: true });
    }

    // ============ (관리자) 수기 투표 입력 — 쪽지 받아서 직접 입력 ============
    if (action === "adminSetVote") {
      if (!isAdmin) return res.status(401).json({ error: "관리자 전용" });
      const event = body.event || "";
      const voterNick = String(body.voter || "").trim();
      const p1 = String(body.p1 || "").trim();
      const p2 = String(body.p2 || "").trim();
      if (!event || !voterNick) return res.status(400).json({ error: "행사·투표자 필요" });

      const people = await getAll("투표참가자", `{행사}='${event}'`);
      const voter = people.find(p => (p.fields["닉네임"] || "") === voterNick);
      const phone = voter ? (voter.fields["전화번호"] || "") : "";

      // 이 사람의 기존 투표 삭제 (덮어쓰기)
      const votes = await getAll("투표", `{행사}='${event}'`);
      const mine = votes.filter(v => (v.fields["투표자닉네임"] || "") === voterNick);
      for (const v of mine) { await api(encodeURIComponent("투표") + "/" + v.id, { method: "DELETE" }); }

      // 하나라도 골랐으면 새로 저장
      if (p1 || p2) {
        await api(encodeURIComponent("투표"), { method: "POST", body: { records: [{ fields: {
          행사: event, 투표자전화: phone, 투표자닉네임: voterNick, 뽑은1: p1, 뽑은2: p2, 일시: new Date().toLocaleString("ko-KR"),
        } }] } });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "알 수 없는 action" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
