module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const KAKAO_KEY = process.env.KAKAO_REST_KEY || "f27b06fa1f606f4ef7b083a627b41b83";
  const { code, origin } = req.body;
  const REDIRECT_URI = (origin || "https://ssumcenter.vercel.app") + "/auth-callback.html";
  console.log("[kakao-auth] origin:", origin, "redirect_uri:", REDIRECT_URI);

  if (!code) return res.status(400).json({ error: "인증 코드가 없습니다" });

  try {
    // 1. 인가 코드로 토큰 받기
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_KEY,
        redirect_uri: REDIRECT_URI,
        code
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.log("[kakao-auth] token error:", JSON.stringify(tokenData));
      return res.status(400).json({ error: "카카오 토큰 발급 실패: " + (tokenData.error_description || tokenData.error || "") });
    }

    // 2. 토큰으로 사용자 정보 가져오기
    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { "Authorization": "Bearer " + tokenData.access_token }
    });
    const userData = await userRes.json();
    if (!userRes.ok) {
      return res.status(400).json({ error: "카카오 사용자 정보 조회 실패" });
    }

    const kakaoId = userData.id;
    const nickname = userData.properties?.nickname || userData.kakao_account?.profile?.nickname || "카카오 유저";
    const profileImage = userData.properties?.profile_image || userData.kakao_account?.profile?.profile_image_url || "";

    // 3. 회원 명부(Airtable)에 카카오 로그인 기록 — 카카오ID 기준, 없으면 새로 생성
    const kid = "kakao_" + kakaoId;
    try {
      const AT_TOKEN = process.env.AIRTABLE_TOKEN;
      const AT_BASE = process.env.AIRTABLE_BASE_ID;
      if (AT_TOKEN && AT_BASE) {
        const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent("회원")}`;
        const H = { "Authorization": "Bearer " + AT_TOKEN, "Content-Type": "application/json" };
        const findUrl = `${base}?filterByFormula=${encodeURIComponent(`{카카오ID}="${kid}"`)}&pageSize=1`;
        const found = await (await fetch(findUrl, { headers: H })).json();
        if (!((found.records || []).length)) {
          const today = new Date().toISOString().slice(0, 10);
          const fields = {
            "이름": nickname,
            "카카오ID": kid,
            "유입경로": "카카오로그인",
            "상태": "활성",
            "가입일": today,
            "참여이력": "카카오 로그인 (" + today + ")"
          };
          if (profileImage) fields["프로필사진"] = [{ url: profileImage }];
          await fetch(base, { method: "POST", headers: H, body: JSON.stringify({ fields, typecast: true }) });
        }
      }
    } catch (e) { /* 명부 저장 실패해도 로그인은 성공 처리 */ }

    return res.status(200).json({
      ok: true,
      user: {
        id: "kakao_" + kakaoId,
        name: nickname,
        profileImage,
        provider: "kakao"
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
