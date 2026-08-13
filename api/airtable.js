const { upsertMember } = require("./member.js");
const { sendSms, isValidPhone } = require("./_sms.js");

// 로테이션 접수 → 자동 입금안내 문자 (센터장 확정 문구)
function 로테이션접수문자() {
  return [
    "🩷📦썸류센터 로테이션 커피팅 입금 안내📦🩷",
    "",
    "안녕하세요😊",
    "썸류센터 로테이션 커피팅을 신청해주셔서 감사합니다!",
    "",
    "-",
    "📦참가비 안내📦",
    "",
    "카카오뱅크 장민 3333-34-1009531",
    "",
    "위 계좌로 29,900원 입금 부탁드립니다!",
    "",
    "-",
    "✔️입금자명과 신청서에 작성해주신 이름이 일치해야 신청이 확인됩니다.",
    "✔️입금은 내일 자정 전까지 가능하며 기한 내 미입금시 참가 확정 취소 예정입니다.",
    "✔️입금이 확인되면 최종 확정 안내드립니다.",
    "",
    "✔️환불은 신청하신 날짜의 4일전까지만 가능하며, 당일 노쇼와 지각 및 기타 사유로 인한 환불 또한 불가능한 점 양해부탁드려요🥲",
  ].join("\n");
}

// 1:1 신청 접수 → 자동 접수 안내 문자 (관리자 수동 버튼과 동일 문구)
function 일대일접수문자(name) {
  return [
    name + "님, 안녕하세요. 썸류센터입니당",
    "1:1 매칭 신청이 잘 접수됐어요 💛",
    "센터장이 " + name + "님께 어울리는 분을 신중하게 찾고 있어요.",
    "좋은 인연이 준비되면 상대 프로필과 함께 문자로 안내드릴게요!",
    "설레는 마음으로 준비할게요. 조금만 기다려주세요 ✨",
  ].join("\n");
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const ADMIN_PW = process.env.ADMIN_PASSWORD;

  if (!TOKEN || !BASE_ID) {
    return res.status(500).json({ error: "서버 환경변수가 설정되지 않았습니다" });
  }

  // ---- 고객: 전화번호로 기존(로그인 전) 신청을 내 계정에 연결 (카카오ID 없는 것만) ----
  if (req.method === "POST" && req.query.claim === "1") {
    const claimKakao = req.query.kakaoId;
    const rawPhone = (req.body && req.body.phone) || "";
    const np = String(rawPhone).replace(/[^0-9]/g, "");
    if (!claimKakao || np.length < 9) return res.status(400).json({ error: "카카오 로그인 후, 올바른 전화번호를 입력해주세요" });
    const H = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    const tables = ["1:1 매칭 신청", "로테이션 신청"];
    let linked = 0;
    try {
      for (const t of tables) {
        const base = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(t)}`;
        const formula = `AND(SUBSTITUTE(SUBSTITUTE({연락처},"-","")," ","")="${np}",{카카오ID}="")`;
        const findUrl = `${base}?filterByFormula=${encodeURIComponent(formula)}&pageSize=50`;
        const found = await (await fetch(findUrl, { headers: H })).json();
        for (const r of (found.records || [])) {
          await fetch(`${base}/${r.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { "카카오ID": claimKakao } }) });
          linked++;
        }
      }
    } catch (e) { return res.status(500).json({ error: "연결 중 오류가 났어요" }); }
    return res.status(200).json({ ok: true, linked });
  }

  const { table, recordId, filter, sort, offset } = req.query;
  if (!table) return res.status(400).json({ error: "table 파라미터 필요" });

  // ---- 접근 제어 ----
  // 관리자(admin.html): x-admin-key 헤더로 인증 → 전체 접근
  // 비인증(신청폼·매칭응답 페이지): 아래 허용 범위만
  const isAdmin = ADMIN_PW && req.headers["x-admin-key"] === ADMIN_PW;

  // ---- 고객 본인 모드: 카카오 로그인 회원이 자기 신청 정보만 조회/수정 ----
  const kakaoId = req.query.kakaoId;
  const CUST_TABLES = ["1:1 매칭 신청", "로테이션 신청"];
  const CUST_EDITABLE = {
    "1:1 매칭 신청": ["프로필사진", "자기소개", "이상형"],
    "로테이션 신청": ["프로필사진", "어필포인트"]
  };
  const isCustomer = !isAdmin && !!kakaoId && CUST_TABLES.includes(table);
  let custFilter = null;

  if (!isAdmin) {
    if (req.method === "GET") {
      // 개인정보(연락처·사진) 노출 방지: 매칭 응답 테이블 + 고객 본인 조회만 허용
      if (isCustomer) {
        custFilter = `{카카오ID}="${String(kakaoId).replace(/["\\]/g, "")}"`;
      } else if (table !== "매칭 응답") {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
    } else if (req.method === "POST") {
      // 신청 폼 제출용 (레코드 생성만 가능, 조회 불가)
      const allowedTables = ["재테크 커피팅", "1:1 매칭 신청", "매칭 응답", "로테이션 신청"];
      if (!allowedTables.includes(table)) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
    } else if (req.method === "PATCH") {
      // 매칭응답 페이지의 "매칭상태 → 수락" 업데이트만 허용
      const records = (req.body && req.body.records) || [];
      const onlyAcceptStatus = table === "1:1 매칭 신청" && records.length > 0 &&
        records.every(r => {
          const keys = Object.keys(r.fields || {});
          return keys.length === 1 && keys[0] === "매칭상태" && r.fields["매칭상태"] === "수락";
        });
      if (!isCustomer && !onlyAcceptStatus) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
    } else {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }
  }

  // 고객 PATCH: 본인 레코드인지 확인 + 허용 필드(사진·자기소개·이상형/어필)만 수정
  if (isCustomer && req.method === "PATCH") {
    const editable = CUST_EDITABLE[table] || [];
    const recs = (req.body && req.body.records) || [];
    const base2 = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
    const H2 = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    for (const r of recs) {
      const chk = await (await fetch(`${base2}/${r.id}`, { headers: H2 })).json();
      if (!chk || !chk.fields || chk.fields["카카오ID"] !== kakaoId) {
        return res.status(403).json({ error: "본인 신청서만 수정할 수 있어요" });
      }
      const clean = {};
      Object.keys(r.fields || {}).forEach(k => { if (editable.includes(k)) clean[k] = r.fields[k]; });
      r.fields = clean;
    }
    req.body.records = recs;
  }

  // POST 요청 시 필수 필드 검증 (빈 데이터 차단) — 비인증 신청 폼만
  if (req.method === "POST" && !isAdmin && (table === "재테크 커피팅" || table === "1:1 매칭 신청" || table === "로테이션 신청") && req.body && req.body.records) {
    const fields = req.body.records[0]?.fields || {};
    if (!fields["이름"] || !fields["이름"].trim()) {
      return res.status(400).json({ error: "이름은 필수입니다" });
    }
    if (!fields["연락처"] || !fields["연락처"].trim()) {
      return res.status(400).json({ error: "연락처는 필수입니다" });
    }
    if (!fields["성별"]) {
      return res.status(400).json({ error: "성별은 필수입니다" });
    }
  }

  let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
  if (recordId) url += `/${recordId}`;

  const params = new URLSearchParams();
  if (custFilter || filter) params.set("filterByFormula", custFilter || filter);
  if (sort) {
    params.set("sort[0][field]", sort);
    params.set("sort[0][direction]", "desc");
  }
  if (offset) params.set("offset", offset);
  const qs = params.toString();
  if (!recordId && req.method === "GET" && qs) url += `?${qs}`;

  try {
    const options = {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    };
    if (req.method === "POST" || req.method === "PATCH") {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);

    // 신청서 제출 성공 → 회원 통합 명부에 자동 적립 (실패해도 신청은 성공 처리)
    if (req.method === "POST" && ["1:1 매칭 신청", "로테이션 신청", "재테크 커피팅"].includes(table)) {
      try {
        const recs = (req.body && req.body.records) || [];
        for (const rc of recs) { await upsertMember({ table, fields: (rc && rc.fields) || {}, TOKEN, BASE_ID }); }
      } catch (e) { /* 명부 적립 실패는 무시 */ }
    }

    // (로테이션 신청 시 자동 문자는 제거됨 — 이제 rotation-admin에서 '승인' 누르면 입금안내 문자 자동 발송)

    // 1:1 매칭 신청 접수(공개 폼) → 접수 안내 문자 자동 발송 (실패해도 신청은 성공)
    if (req.method === "POST" && !isAdmin && table === "1:1 매칭 신청") {
      try {
        const recs = (req.body && req.body.records) || [];
        for (const rc of recs) {
          const f = (rc && rc.fields) || {};
          const to = f["연락처"] || "";
          if (isValidPhone(to)) {
            await sendSms({ to, text: 일대일접수문자(f["이름"] || "") });
          }
        }
      } catch (e) { console.error("[airtable] 1:1 접수문자 발송 실패:", e.message); }
    }

    // 매칭 응답이 '거절'이면 → 양쪽을 '승인'으로 되돌림 (소개중 해제 → 다음 소개 가능, best-effort)
    if (req.method === "POST" && table === "매칭 응답") {
      try {
        const recs = (req.body && req.body.records) || [];
        const revert = new Set();
        for (const rc of recs) {
          const f = (rc && rc.fields) || {};
          if (f["응답"] === "거절") {
            if (f["응답자ID"]) revert.add(f["응답자ID"]);
            if (f["매칭ID"]) revert.add(f["매칭ID"]);
          }
        }
        const ids = [...revert].filter(id => typeof id === "string" && id.startsWith("rec"));
        if (ids.length) {
          await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ records: ids.map(id => ({ id, fields: { "매칭상태": "승인" } })) })
          });
        }
      } catch (e) { console.error("[airtable] 거절 후 상태복귀 실패:", e.message); }
    }

    // 매칭 응답 → '매칭' 테이블 상태 자동 갱신 (소개중 → 성사/불발, best-effort)
    if (req.method === "POST" && table === "매칭 응답") {
      try {
        const AUTH = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
        const MTBL = encodeURIComponent("매칭");
        const recs = (req.body && req.body.records) || [];
        for (const rc of recs) {
          const f = (rc && rc.fields) || {};
          const responder = f["응답자ID"], target = f["매칭ID"], ans = f["응답"];
          if (!responder || !target || !ans) continue;
          const formula = `AND({상태}="소개중",OR(AND({남자ID}="${responder}",{여자ID}="${target}"),AND({남자ID}="${target}",{여자ID}="${responder}")))`;
          const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MTBL}?filterByFormula=${encodeURIComponent(formula)}&pageSize=1`, { headers: AUTH });
          const fd = await fr.json();
          const rec = (fd.records || [])[0];
          if (!rec) continue;
          const mf = rec.fields || {};
          const responderIsMan = mf["남자ID"] === responder;
          const upd = responderIsMan ? { "남자응답": ans } : { "여자응답": ans };
          const manAns = responderIsMan ? ans : mf["남자응답"];
          const womanAns = responderIsMan ? mf["여자응답"] : ans;
          if (ans === "거절") {
            upd["상태"] = "불발";
            upd["결과"] = (responderIsMan ? mf["남자"] : mf["여자"]) + " 거절 → 불발";
          } else if (manAns === "수락" && womanAns === "수락") {
            upd["상태"] = "성사";
            upd["결과"] = "양쪽 수락 → 성사 🎉";
          }
          await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MTBL}/${rec.id}`, { method: "PATCH", headers: AUTH, body: JSON.stringify({ fields: upd }) });
        }
      } catch (e) { console.error("[airtable] 매칭 테이블 갱신 실패:", e.message); }
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
