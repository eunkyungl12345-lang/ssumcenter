// 슬랙 `/장소` 명령 → 데이트 장소 자동 등록
// 사용법(슬랙):  /장소 효뜨, 용산, 동탄            (상호명, 동네, 추천 센터장)
//               /장소 효뜨, 용산, 동탄, 신랑 첫 만남 장소   (4번째는 스토리, 선택)
// 흐름: 가게 정보를 AI가 웹에서 찾아 → 에어테이블 '데이트 장소' 표에 비공개로 저장
//       → 슬랙에 미리보기 + [공개하기] [삭제] 버튼 → 공개하기 누르면 사이트(/date-spots)에 바로 노출
// 필요한 환경변수: SLACK_SIGNING_SECRET, ANTHROPIC_API_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { waitUntil } = require("@vercel/functions");

const TABLE = "데이트 장소";
const CENTERS = ["동탄", "성수", "강남"];

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySlack(req, raw, secret) {
  const ts = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const mine = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
  const a = Buffer.from(mine), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "효뜨, 용산, 동탄 성수, 스토리" → { name, area, centers[], story }
function parseCommand(text) {
  const parts = String(text || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0] || "";
  let area = parts[1] || "";
  if (/강남|신논현/.test(area)) area = "강남·신논현";
  const centers = String(parts[2] || "").split(/[\s·\/]+/)
    .map((s) => s.replace("센터장", "").trim()).filter((s) => CENTERS.includes(s));
  const story = parts.slice(3).join(", ");
  return { name, area, centers, story };
}

async function slackReply(url, body) {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function airtableUrl(id) {
  const base = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE)}`;
  return id ? `${base}/${id}` : base;
}
const atHeaders = () => ({ Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" });

// AI가 웹 검색으로 가게 정보 찾기 (확인 안 되는 건 비워둠)
async function lookupPlace({ name, area }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    system: `당신은 소개팅 서비스 '썸류센터'의 장소 리스트를 정리하는 도우미입니다.
웹 검색으로 실제 존재하는 가게인지 확인하고 정보를 정리하세요.
- 확인되지 않는 정보는 절대 지어내지 말고 빈 문자열로 두세요.
- 한줄소개는 센터장 말투(~해요)로 35자 이내, 분위기·음식 종류 중심. 별점·리뷰 수는 쓰지 마세요.
- 위치는 "OO역 도보 약 N분" 형식. 확실하지 않으면 빈 문자열.
- 마지막에 JSON 하나만 출력하세요.`,
    messages: [{
      role: "user",
      content: `상호명: ${name}\n동네: ${area || "(모름)"}\n\n아래 형식의 JSON으로 답하세요.
{"found": true/false, "정식이름": "", "분류": "카페" 또는 "밥집" 또는 "미용실" 또는 "네일" 또는 "기타", "한줄소개": "", "위치": "", "주소": ""}`,
    }],
  });
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/g);
  if (!m) return { found: false };
  try { return JSON.parse(m[m.length - 1]); } catch (e) { return { found: false }; }
}

function preview(fields, recId) {
  const lines = [
    `*${fields["이름"]}*  ·  ${fields["분류"] || "분류 미정"}  ·  ${fields["동네"] || "동네 미정"}`,
    `💛 ${(fields["추천 센터장"] || []).join(" · ") || "센터장"} 센터장 PICK`,
    fields["한줄소개"] ? `📝 ${fields["한줄소개"]}` : "📝 (한줄소개 못 찾음 — 에어테이블에서 채워주세요)",
    fields["위치"] ? `🚶 ${fields["위치"]}` : "🚶 (위치 못 찾음)",
    fields["스토리"] ? `💍 ${fields["스토리"]}` : null,
    `🗺️ <${fields["지도링크"]}|네이버 지도에서 확인>`,
  ].filter(Boolean);
  return {
    response_type: "in_channel",
    text: `새 데이트 장소: ${fields["이름"]}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "📍 *새 장소를 찾았어요. 맞으면 공개해 주세요!*\n\n" + lines.join("\n") } },
      { type: "context", elements: [{ type: "mrkdwn", text: "내용 수정은 에어테이블 '데이트 장소' 표에서 할 수 있어요." }] },
      { type: "actions", elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "공개하기" }, action_id: "place_publish", value: recId },
        { type: "button", style: "danger", text: { type: "plain_text", text: "삭제" }, action_id: "place_delete", value: recId },
      ] },
    ],
  };
}

async function handleCommand(cmd, responseUrl) {
  try {
    const info = await lookupPlace(cmd);
    const name = (info.found && info["정식이름"]) || cmd.name;
    const fields = {
      "이름": name,
      "동네": cmd.area || "",
      "분류": info["분류"] || "",
      "추천 센터장": cmd.centers,
      "한줄소개": info["한줄소개"] || "",
      "위치": info["위치"] || "",
      "스토리": cmd.story || "",
      "지도링크": "https://map.naver.com/p/search/" + encodeURIComponent(`${name} ${cmd.area.replace("·", " ")}`.trim()),
    };
    Object.keys(fields).forEach((k) => { if (fields[k] === "" || (Array.isArray(fields[k]) && !fields[k].length)) delete fields[k]; });
    const r = await fetch(airtableUrl(), { method: "POST", headers: atHeaders(), body: JSON.stringify({ records: [{ fields }], typecast: true }) });
    const d = await r.json();
    if (!r.ok) {
      await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ 에어테이블 저장 실패: ${(d.error && (d.error.message || d.error.type)) || r.status}\n'데이트 장소' 표와 칸 이름을 확인해 주세요.` });
      return;
    }
    const recId = d.records[0].id;
    fields["지도링크"] = fields["지도링크"] || "";
    await slackReply(responseUrl, preview({ ...fields, "추천 센터장": cmd.centers }, recId));
    if (!info.found) {
      await slackReply(responseUrl, { response_type: "ephemeral", text: "ℹ️ 웹에서 가게를 정확히 못 찾았어요. 이름이 맞는지, 정보는 에어테이블에서 확인해 주세요." });
    }
  } catch (e) {
    console.error("[slack-place]", e);
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 장소를 등록하다 문제가 생겼어요. 잠시 후 다시 시도해 주세요." });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const raw = await readRaw(req);
  if (!verifySlack(req, raw, process.env.SLACK_SIGNING_SECRET)) return res.status(401).send("invalid signature");
  const form = new URLSearchParams(raw);

  // 버튼 클릭 (공개하기 / 삭제)
  if (form.get("payload")) {
    const p = JSON.parse(form.get("payload"));
    const act = (p.actions || [])[0] || {};
    const who = (p.user && (p.user.name || p.user.username)) || "누군가";
    const recId = act.value;
    res.status(200).send("");
    waitUntil((async () => {
      try {
        if (act.action_id === "place_publish") {
          const r = await fetch(airtableUrl(recId), { method: "PATCH", headers: atHeaders(), body: JSON.stringify({ fields: { "공개": true } }) });
          const d = await r.json();
          const nm = (d.fields && d.fields["이름"]) || "장소";
          await slackReply(p.response_url, { replace_original: true, text: r.ok ? `✅ *${nm}* 공개 완료! (${who})\nhttps://ssumcenter.vercel.app/date-spots` : `⚠️ 공개 실패: ${(d.error && d.error.message) || r.status}` });
        } else if (act.action_id === "place_delete") {
          const r = await fetch(airtableUrl(recId), { method: "DELETE", headers: atHeaders() });
          await slackReply(p.response_url, { replace_original: true, text: r.ok ? `🗑️ 삭제했어요. (${who})` : "⚠️ 삭제 실패" });
        }
      } catch (e) { console.error("[slack-place] action", e); }
    })());
    return;
  }

  // 슬래시 명령 (/장소 ...)
  const cmd = parseCommand(form.get("text"));
  if (!cmd.name) {
    return res.status(200).json({ response_type: "ephemeral", text: "사용법: `/장소 상호명, 동네, 추천 센터장`\n예) `/장소 효뜨, 용산, 동탄`\n예) `/장소 에이비카페, 강남, 동탄 성수 강남`" });
  }
  const responseUrl = form.get("response_url");
  waitUntil(handleCommand(cmd, responseUrl));
  return res.status(200).json({ response_type: "ephemeral", text: `🔎 '${cmd.name}' 찾는 중이에요… 30초 정도 걸려요.` });
};

module.exports.parseCommand = parseCommand;
module.exports.verifySlack = verifySlack;
