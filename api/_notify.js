/**
 * 센터장 폰으로 알림 보내기 (텔레그램)
 *
 * 필요한 환경변수 2개 (Vercel에 등록):
 *   TELEGRAM_BOT_TOKEN  — @BotFather 에게 받은 봇 토큰
 *   TELEGRAM_CHAT_ID    — 알림을 받을 내 채팅 ID
 *
 * 환경변수가 없으면 조용히 아무것도 안 합니다.
 * 알림이 실패해도 신청·응답 자체는 절대 실패하면 안 되므로,
 * 이 함수는 어떤 경우에도 예외를 밖으로 던지지 않습니다.
 */
async function notify(text) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID || !text) return { ok: false, skipped: true };

  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: String(text),
        disable_web_page_preview: true,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.error("[notify] 텔레그램 전송 실패:", d.description || r.status);
    return { ok: !!d.ok, error: d.description };
  } catch (e) {
    console.error("[notify] 텔레그램 전송 오류:", e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { notify };
