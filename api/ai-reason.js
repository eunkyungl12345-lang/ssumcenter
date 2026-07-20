// 두 회원 프로필을 받아 "센터장이 이 분을 고른 이유" 초안을 AI로 생성
// 관리자(admin.html)에서만 호출. ANTHROPIC_API_KEY 환경변수 필요.
const Anthropic = require("@anthropic-ai/sdk");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다" });

  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  const API_KEY = process.env.ANTHROPIC_API_KEY;

  // 관리자 인증
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "관리자 인증이 필요합니다" });
  }
  if (!API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수에 추가해주세요.",
    });
  }

  const { a, b } = req.body || {};
  if (!a || !b) return res.status(400).json({ error: "두 사람(a, b) 정보가 필요합니다" });

  const profile = (p) => [
    p.name && `이름: ${p.name}`,
    p.age && `나이: ${p.age}`,
    p.job && `직업: ${p.job}`,
    p.hobby && `취미: ${p.hobby}`,
    p.keywords && `성격 키워드: ${p.keywords}`,
    p.pref && `이상형 조건: ${p.pref}`,
    p.intro && `자기소개: ${p.intro}`,
  ].filter(Boolean).join("\n");

  const system = `당신은 강남 소개팅 서비스 '썸류센터'의 센터장입니다.
두 회원을 1:1로 매칭할 때, 각자에게 상대방을 소개하며 "센터장이 왜 이 분을 골랐는지" 이유를 씁니다.

작성 규칙:
- 따뜻하고 다정한 존댓말("~해요"체), 각 2~3문장
- 상대의 매력과 두 사람의 공통점·궁합을 구체적으로 짚어주세요
- 받는 사람의 이상형 조건에 상대가 잘 맞는 점이 있으면 자연스럽게 언급
- "센터장이 직접 고심해서 골랐다"는 신뢰감이 느껴지게
- 이모지는 최대 1개. 과장하거나 없는 사실을 지어내지 마세요
- 프로필에 없는 정보는 추측하지 말고 있는 정보만 활용하세요
- 반드시 JSON만 출력하세요. 설명이나 서론 없이.`;

  const userPrompt = `[A 회원]
${profile(a)}

[B 회원]
${profile(b)}

A에게 B를 소개하는 이유(reason_for_a)와, B에게 A를 소개하는 이유(reason_for_b)를 각각 써주세요.
{"reason_for_a": "...", "reason_for_b": "..."} 형식의 JSON으로만 답하세요.`;

  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userPrompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              reason_for_a: { type: "string" },
              reason_for_b: { type: "string" },
            },
            required: ["reason_for_a", "reason_for_b"],
            additionalProperties: false,
          },
        },
      },
    });

    let text = (resp.content.find((c) => c.type === "text") || {}).text || "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const data = JSON.parse(text);
    return res.status(200).json({
      reason_for_a: data.reason_for_a || "",
      reason_for_b: data.reason_for_b || "",
    });
  } catch (e) {
    return res.status(500).json({ error: "AI 생성 실패: " + (e.message || String(e)) });
  }
};
