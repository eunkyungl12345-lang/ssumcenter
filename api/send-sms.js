const { sendSms } = require("./_sms.js");

async function slack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || !text) return;
  try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch (e) { /* 무시 */ }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // 인증: 관리자만 문자 발송 가능
  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "인증이 필요합니다" });
  }

  const { to, text, notify, slackOnly, check } = req.body || {};

  // 🩺 문자 설정 점검 — 문자를 보내지 않고 "어디서 막히는지"만 확인한다.
  // 솔라피 메시지 목록에 아무것도 안 뜰 때, 요청이 솔라피까지 가기도 전에
  // 끊긴 것인지(환경변수·API키) 가려내기 위한 것.
  if (check) {
    const KEY = process.env.SOLAPI_API_KEY;
    const SECRET = process.env.SOLAPI_API_SECRET;
    const SENDER = process.env.SOLAPI_SENDER;
    const out = {
      "환경변수 SOLAPI_API_KEY": KEY ? "✅ 설정됨" : "❌ 없음",
      "환경변수 SOLAPI_API_SECRET": SECRET ? "✅ 설정됨" : "❌ 없음",
      "환경변수 SOLAPI_SENDER": SENDER ? "✅ " + SENDER : "❌ 없음",
    };
    if (!KEY || !SECRET || !SENDER) {
      out["결론"] = "❌ 환경변수가 빠져 있어요. 그래서 솔라피까지 요청이 가지 않습니다.";
      return res.status(200).json(out);
    }

    // 솔라피 REST 인증 헤더 (HMAC-SHA256)
    const crypto = require("crypto");
    const authHeader = () => {
      const date = new Date().toISOString();
      const salt = crypto.randomBytes(32).toString("hex");
      const signature = crypto.createHmac("sha256", SECRET).update(date + salt).digest("hex");
      return `HMAC-SHA256 apiKey=${KEY}, date=${date}, salt=${salt}, signature=${signature}`;
    };
    const call = async (url) => {
      const r = await fetch(url, { headers: { Authorization: authHeader() } });
      const body = await r.text();
      let d = null; try { d = JSON.parse(body); } catch (_) {}
      return { ok: r.ok, status: r.status, data: d, raw: body.slice(0, 200) };
    };

    try {
      const bal = await call("https://api.solapi.com/cash/v1/balance");
      if (!bal.ok) {
        out["API 키"] = "❌ 인증 실패 (" + bal.status + ") " + ((bal.data && (bal.data.errorMessage || bal.data.message)) || bal.raw);
        out["결론"] = "❌ API 키가 틀렸거나 IP 제한에 막혔어요. 그래서 솔라피까지 요청이 가지 않습니다.";
        return res.status(200).json(out);
      }
      out["API 키"] = "✅ 정상";
      const point = (bal.data && (bal.data.balance != null ? bal.data.balance : bal.data.point));
      out["잔액"] = (point != null ? point + "원" : JSON.stringify(bal.data));
      // 잔액 0원도 문자가 안 나가는 '원인'이므로 ❌로 표시한다 (경고로 두면 결론이 '정상'으로 나온다)
      if (point != null && Number(point) <= 0) out["잔액"] = "❌ " + point + "원 — 충전이 필요해요. 잔액이 없으면 문자가 나가지 않습니다";

      const nums = await call("https://api.solapi.com/senderid/v1/numbers?limit=100");
      if (nums.ok) {
        const list = ((nums.data && (nums.data.numberList || nums.data.senderIdList || nums.data.data)) || [])
          .map((n) => String(n.phoneNumber || n.number || n).replace(/[^0-9]/g, ""))
          .filter(Boolean);
        const mine = String(SENDER).replace(/[^0-9]/g, "");
        out["등록된 발신번호"] = list.length ? list.join(", ") : "없음";
        out["발신번호 등록 여부"] = list.includes(mine)
          ? "✅ " + mine + " 등록돼 있어요"
          : "❌ " + mine + " 가 등록 목록에 없어요 — 솔라피에서 발신번호 등록이 필요합니다";
      } else {
        out["발신번호 조회"] = "확인 불가 (" + nums.status + ")";
      }

      const bad = Object.values(out).some((v) => String(v).startsWith("❌"));
      out["결론"] = bad ? "❌ 위에 ❌ 표시된 항목이 원인이에요." : "✅ 설정은 정상이에요. 실제 발송을 한 번 해보세요.";
      return res.status(200).json(out);
    } catch (e) {
      out["결론"] = "❌ 솔라피에 연결하지 못했어요: " + e.message;
      return res.status(200).json(out);
    }
  }

  // 📢 슬랙 알림만 (문자 없음) — 일괄발송 요약 등
  if (slackOnly) {
    if (!text) return res.status(400).json({ error: "text 필요" });
    await slack(text);
    return res.status(200).json({ ok: true, slack: true });
  }

  if (!to || !text) {
    return res.status(400).json({ error: "수신번호와 메시지 내용이 필요합니다" });
  }

  try {
    const result = await sendSms({ to, text });
    if (notify) await slack("📤 문자 발송 → " + to + "\n" + String(text).slice(0, 60));
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[send-sms] error:", err);
    return res.status(500).json({ error: err.message || "문자 발송 실패" });
  }
};
