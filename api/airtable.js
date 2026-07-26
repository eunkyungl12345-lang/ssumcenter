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

  const { table, recordId, filter, sort } = req.query;
  if (!table) return res.status(400).json({ error: "table 파라미터 필요" });

  // ---- 접근 제어 ----
  // 관리자(admin.html): x-admin-key 헤더로 인증 → 전체 접근
  // 비인증(신청폼·매칭응답 페이지): 아래 허용 범위만
  const isAdmin = ADMIN_PW && req.headers["x-admin-key"] === ADMIN_PW;

  if (!isAdmin) {
    if (req.method === "GET") {
      // 개인정보(연락처·사진) 노출 방지: 매칭 응답 테이블만 조회 허용
      if (table !== "매칭 응답") {
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
      if (!onlyAcceptStatus) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
    } else {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }
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
  if (filter) params.set("filterByFormula", filter);
  if (sort) {
    params.set("sort[0][field]", sort);
    params.set("sort[0][direction]", "desc");
  }
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

    // 로테이션 신청 접수(공개 폼) → 입금안내 문자 자동 발송 (실패해도 신청은 성공 처리)
    // - 공개 폼 제출만 대상(isAdmin 제외): admin 수동 등록은 기존 딸깍 버튼 사용
    // - 번호가 유효할 때만 발송 → 테스트/빈값 오발송 방지
    if (req.method === "POST" && !isAdmin && table === "로테이션 신청") {
      try {
        const recs = (req.body && req.body.records) || [];
        for (const rc of recs) {
          const to = (rc && rc.fields && rc.fields["연락처"]) || "";
          if (isValidPhone(to)) {
            await sendSms({ to, text: 로테이션접수문자() });
          }
        }
      } catch (e) { console.error("[airtable] 접수문자 발송 실패:", e.message); }
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
