// 콘텐츠봇 — 썸류센터 릴스/스레드 소재를 AI로 생성
// 관리자 전용. ANTHROPIC_API_KEY 환경변수 필요.
const Anthropic = require("@anthropic-ai/sdk");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다" });

  const ADMIN_PW = process.env.ADMIN_PASSWORD;
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ADMIN_PW || req.headers["x-admin-key"] !== ADMIN_PW) {
    return res.status(401).json({ error: "관리자 인증이 필요합니다" });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수에 추가해주세요." });
  }

  const { type, topic, count } = req.body || {};
  const kind = type === "스레드" ? "스레드" : "릴스";
  const n = Math.min(Math.max(parseInt(count) || 3, 1), 5);

  const system = `당신은 강남 2030 소개팅 서비스 '썸류센터'의 센스있는 SNS 마케터입니다.

[썸류센터 정보]
- 썸배달(로테이션 커피팅): 여러 이성과 짧게 돌아가며 대화하는 로테이션 소개팅. 8/13(목)·8/27(목) 저녁 7:45, 강남역 도보 7분. 참가비 29,900원(음료 포함). 승인제(선착순 아님).
- 1:1 맞춤 매칭(유료 베타): 센터장이 프로필 보고 직접 골라 소개하는 1:1 소개팅.
- 타겟: 20~30대 싱글 직장인·전문직. 밝고 설레고 편안한 톤.

[작성 규칙]
- ${kind === "릴스" ? "릴스: 첫 1~2초에 시선을 확 잡는 후킹 문구(hook)와, 릴스에 넣을 장면/자막 구성(body)을 써주세요." : "스레드: 스크롤을 멈추게 하는 첫 문장(hook)과, 공감되며 읽히는 본문 글(body)을 써주세요."}
- 실제 정보(일정·가격·장소)는 정확하게, 없는 사실은 지어내지 마세요.
- 트렌디하고 자연스럽게. 이모지는 과하지 않게.
- 서로 다른 각도의 소재 ${n}개를 만들어주세요.
- 반드시 JSON만 출력하세요.`;

  const userPrompt = `${kind} 소재 ${n}개를 만들어주세요.${topic ? `\n주제/방향: ${topic}` : "\n주제는 자유롭게 (신청 유도에 도움되는 방향)"}
각 소재는 {title(소재 한줄 제목), hook(후킹 문구), body(${kind === "릴스" ? "장면·자막 구성" : "본문 글"}), hashtags(해시태그)}로.
{"ideas":[{"title":"...","hook":"...","body":"...","hashtags":"..."}]} 형식 JSON으로만 답하세요.`;

  try {
    const client = new Anthropic({ apiKey: API_KEY });
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: userPrompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              ideas: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    hook: { type: "string" },
                    body: { type: "string" },
                    hashtags: { type: "string" },
                  },
                  required: ["title", "hook", "body", "hashtags"],
                  additionalProperties: false,
                },
              },
            },
            required: ["ideas"],
            additionalProperties: false,
          },
        },
      },
    });

    let text = (resp.content.find((c) => c.type === "text") || {}).text || "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const data = JSON.parse(text);
    return res.status(200).json({ kind, ideas: Array.isArray(data.ideas) ? data.ideas : [] });
  } catch (e) {
    return res.status(500).json({ error: "AI 생성 실패: " + (e.message || String(e)) });
  }
};
