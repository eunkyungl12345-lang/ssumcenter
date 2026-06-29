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

    // 3. Supabase에 사용자 저장/조회
    const SUPA_URL = process.env.SUPABASE_URL || "https://nvqlguhzsucrcnmjlxoe.supabase.co";
    const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (SUPA_SERVICE_KEY) {
      // Supabase에 프로필 upsert
      const upsertRes = await fetch(SUPA_URL + "/rest/v1/profiles", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + SUPA_SERVICE_KEY,
          "apikey": SUPA_SERVICE_KEY,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          id: "kakao_" + kakaoId,
          name: nickname,
          phone: "",
          gender: "",
          birth_year: "",
          created_at: new Date().toISOString()
        })
      });
    }

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
