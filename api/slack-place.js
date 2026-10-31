// 슬랙 슬래시 명령 처리:
// 1. `/장소` → 데이트 장소 자동 등록
// 2. `/매칭` → 1:1 소개팅 매칭 생성 및 현황 관리 (썸류센터봇)
// 필요한 환경변수: SLACK_SIGNING_SECRET, AIRTABLE_TOKEN, AIRTABLE_BASE_ID (선택: ANTHROPIC_API_KEY)

const crypto = require("crypto");
const { waitUntil } = require("@vercel/functions");

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appgWdt1TeSuI77T1";
const TOKEN = process.env.AIRTABLE_TOKEN;
const CENTERS = ["동탄", "성수", "강남"];

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(""), 5000);
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { clearTimeout(timer); resolve(data); });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
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

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN || TOKEN}`,
    "Content-Type": "application/json"
  };
}

async function slackReply(url, body) {
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch((e) => console.error("[slack] reply error:", e.message));
}

async function fetchAll(tableName, filterFormula) {
  let recs = [], offset;
  const H = atHeaders();
  do {
    const p = new URLSearchParams({ pageSize: "100" });
    if (offset) p.set("offset", offset);
    if (filterFormula) p.set("filterByFormula", filterFormula);
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}?${p.toString()}`, { headers: H });
    if (!r.ok) break;
    const d = await r.json();
    recs = recs.concat(d.records || []);
    offset = d.offset;
  } while (offset);
  return recs;
}

// ==========================================
// 1. 데이트 장소 등록 (/장소 ...)
// ==========================================
function parsePlaceCommand(text) {
  const parts = String(text || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0] || "";
  let area = parts[1] || "";
  if (/강남|신논현/.test(area)) area = "강남·신논현";
  const centers = String(parts[2] || "").split(/[\s·\/]+/)
    .map((s) => s.replace("센터장", "").trim()).filter((s) => CENTERS.includes(s));
  const story = parts.slice(3).join(", ");
  return { name, area, centers, story };
}

function placePreview(fields, recId) {
  const lines = [
    `*${fields["이름"]}*  ·  ${fields["분류"] || "분류 미정"}  ·  ${fields["동네"] || "동네 미정"}`,
    `💛 ${(fields["추천 센터장"] || []).join(" · ") || "센터장"} 센터장 PICK`,
    fields["한줄소개"] ? `📝 ${fields["한줄소개"]}` : "📝 (한줄소개는 나중에 채워도 돼요)",
    fields["위치"] ? `🚶 ${fields["위치"]}` : null,
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

async function handlePlaceCommand(cmd, responseUrl) {
  try {
    const info = { found: true };
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
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("데이트 장소")}`, {
      method: "POST", headers: atHeaders(), body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    const d = await r.json();
    if (!r.ok) {
      await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ 에어테이블 저장 실패: ${(d.error && (d.error.message || d.error.type)) || r.status}\n'데이트 장소' 표와 칸 이름을 확인해 주세요.` });
      return;
    }
    const recId = d.records[0].id;
    fields["지도링크"] = fields["지도링크"] || "";
    await slackReply(responseUrl, placePreview({ ...fields, "추천 센터장": cmd.centers }, recId));
  } catch (e) {
    console.error("[slack-place]", e);
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 장소를 등록하다 문제가 생겼어요. 잠시 후 다시 시도해 주세요." });
  }
}

// /장소삭제 상호명 → 이름으로 찾아 [삭제] 버튼 띄우기 (버튼은 기존 place_delete 액션 재사용)
async function handlePlaceDelete(text, responseUrl) {
  try {
    const q = String(text || "").trim();
    if (!q) { await slackReply(responseUrl, { response_type: "ephemeral", text: "사용법: `/장소삭제 상호명`\n예) `/장소삭제 효뜨`" }); return; }
    const spots = await fetchAll("데이트 장소");
    const matches = spots.filter((r) => String((r.fields || {})["이름"] || "").includes(q));
    if (!matches.length) { await slackReply(responseUrl, { response_type: "ephemeral", text: `'${q}' 장소를 못 찾았어요.` }); return; }
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: `🗑️ *'${q}' 검색 결과* — 삭제할 곳의 버튼을 눌러주세요` } }];
    matches.slice(0, 5).forEach((r) => {
      const f = r.fields || {};
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${f["이름"]}*${f["동네"] ? " · " + f["동네"] : ""}` },
        accessory: { type: "button", style: "danger", text: { type: "plain_text", text: "삭제" }, action_id: "place_delete", value: r.id }
      });
    });
    await slackReply(responseUrl, { response_type: "in_channel", blocks });
  } catch (e) {
    console.error("[slack-place] delete", e);
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 장소를 찾다 문제가 생겼어요." });
  }
}

// ==========================================
// 2. 1:1 매칭 관리 (/매칭 ...)
// ==========================================
function getMatchHelp() {
  return {
    response_type: "ephemeral",
    blocks: [{
      type: "section",
      text: {
        type: "mrkdwn",
        text: "💘 *[썸류센터봇] 1:1 매칭 명령어 안내*\n\n" +
          "• `/매칭 대기` : 현재 매칭 대기 중인 남녀 회원 목록 보기\n" +
          "• `/매칭 현황` : 현재 소개중인 커플과 성사 현황 요약\n" +
          "• `/매칭 [남성이름], [여성이름]` : 두 회원 매칭 생성 및 전달 링크 발급\n" +
          "   _예시: `/매칭 김철수, 이영희`_\n" +
          "• `/매칭 취소 [남성이름], [여성이름]` : 진행 중인 소개 불발 처리\n" +
          "   _예시: `/매칭 취소 김철수, 이영희`_"
      }
    }]
  };
}

async function handleWaitingList(responseUrl) {
  const applicants = await fetchAll("1:1 매칭 신청");
  const waiting = applicants.filter(r => {
    const f = r.fields || {};
    const st = f["매칭상태"] || "대기";
    return (st === "대기" || st === "승인") && f["이름"];
  });

  const men = waiting.filter(r => (r.fields || {})["성별"] === "남성");
  const women = waiting.filter(r => (r.fields || {})["성별"] === "여성");

  const fmt = r => {
    const f = r.fields || {};
    const specs = [f["출생연도"] ? `${f["출생연도"]}년생` : null, f["사는곳"] || null, f["직업"] || null].filter(Boolean).join(" · ");
    return `• *${f["이름"]}* (${specs || "정보 없음"})`;
  };

  const menList = men.slice(0, 10).map(fmt).join("\n") || "_(대기 중인 남성 회원이 없어요)_";
  const womenList = women.slice(0, 10).map(fmt).join("\n") || "_(대기 중인 여성 회원이 없어요)_";

  await slackReply(responseUrl, {
    response_type: "in_channel",
    blocks: [{
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *1:1 매칭 대기 명단* (남 ${men.length}명 / 여 ${women.length}명)\n\n` +
          `👦 *남성 대기자 (최근 10명)*\n${menList}\n\n` +
          `👧 *여성 대기자 (최근 10명)*\n${womenList}\n\n` +
          `💡 *매칭 생성:* \`/매칭 [남성이름], [여성이름]\` 을 입력하세요.`
      }
    }]
  });
}

async function handleMatchStatus(responseUrl) {
  const matches = await fetchAll("매칭");
  const intro = matches.filter(r => (r.fields || {})["상태"] === "소개중");
  const success = matches.filter(r => (r.fields || {})["상태"] === "성사");
  const broken = matches.filter(r => (r.fields || {})["상태"] === "결별");
  const failed = matches.filter(r => (r.fields || {})["상태"] === "불발");

  const introList = intro.map(r => {
    const f = r.fields || {};
    return `• ${f["남자"] || "?"} ❤ ${f["여자"] || "?"} (생성: ${f["생성일"] || "-"})`;
  }).join("\n") || "_(현재 진행 중인 소개가 없어요)_";

  await slackReply(responseUrl, {
    response_type: "in_channel",
    blocks: [{
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📊 *1:1 매칭 현황 요약*\n\n` +
          `• 소개중: *${intro.length}쌍*\n` +
          `• 성사 커플: *${success.length}쌍* 🎉\n` +
          `• 불발: ${failed.length}건 / 결별: ${broken.length}건\n\n` +
          `⏳ *현재 진행 중인 소개 목록*\n${introList}`
      }
    }]
  });
}

async function handleCreateMatch(text, responseUrl, who) {
  const rawParts = text.split(/[,，/·\s]+/).map(s => s.trim()).filter(Boolean);
  if (rawParts.length < 2) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 두 분의 이름을 쉼표로 구분해서 입력해 주세요.\n예시: `/매칭 김철수, 이영희`" });
    return;
  }

  const name1 = rawParts[0], name2 = rawParts[1];
  const applicants = await fetchAll("1:1 매칭 신청");

  const found1 = applicants.filter(r => (r.fields || {})["이름"] === name1);
  const found2 = applicants.filter(r => (r.fields || {})["이름"] === name2);

  if (!found1.length) { await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ '${name1}' 님을 신청자 명단에서 찾을 수 없어요.` }); return; }
  if (!found2.length) { await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ '${name2}' 님을 신청자 명단에서 찾을 수 없어요.` }); return; }

  const p1 = found1[0], p2 = found2[0];
  const f1 = p1.fields || {}, f2 = p2.fields || {};

  let man = null, woman = null;
  if (f1["성별"] === "남성" && f2["성별"] === "여성") { man = p1; woman = p2; }
  else if (f1["성별"] === "여성" && f2["성별"] === "남성") { man = p2; woman = p1; }
  else {
    await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ 두 분의 성별이 모두 '${f1["성별"] || "동일"}'입니다. 이성끼리만 매칭할 수 있어요.` });
    return;
  }

  const mf = man.fields || {}, wf = woman.fields || {};
  const matches = await fetchAll("매칭");
  const isOngoing = matches.some(m => {
    const f = m.fields || {};
    const s = f["상태"] || "소개중";
    return (s === "소개중" || s === "성사") &&
      ((f["남자ID"] === man.id && f["여자ID"] === woman.id) || (f["남자ID"] === woman.id && f["여자ID"] === man.id));
  });

  if (isOngoing) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ ${mf["이름"]}님과 ${wf["이름"]}님은 이미 진행 중(소개중/성사)인 매칭이 있어요.` });
    return;
  }

  const siteUrl = process.env.SITE_URL || "https://ssumcenter.vercel.app";
  const t = Date.now();
  const urlForMan = `${siteUrl}/response.html?id=${woman.id}&myId=${man.id}&t=${t}`;
  const urlForWoman = `${siteUrl}/response.html?id=${man.id}&myId=${woman.id}&t=${t}`;

  const createBody = {
    records: [{
      fields: {
        "남자": mf["이름"] || "", "여자": wf["이름"] || "",
        "남자ID": man.id, "여자ID": woman.id,
        "남자링크": urlForMan, "여자링크": urlForWoman,
        "상태": "소개중", "남자응답": "대기", "여자응답": "대기",
        "생성일": new Date().toLocaleString("ko-KR")
      }
    }]
  };

  const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}`, {
    method: "POST", headers: atHeaders(), body: JSON.stringify(createBody)
  });

  if (!createRes.ok) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 매칭 생성 실패 (에어테이블 에러)" });
    return;
  }

  const createdData = await createRes.json();
  const newMatchId = (createdData.records && createdData.records[0] && createdData.records[0].id) || "";

  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
    method: "PATCH", headers: atHeaders(),
    body: JSON.stringify({ records: [{ id: man.id, fields: { "매칭상태": "소개중" } }, { id: woman.id, fields: { "매칭상태": "소개중" } }] })
  }).catch(() => {});

  const manInfo = [mf["출생연도"] ? `${mf["출생연도"]}년생` : null, mf["사는곳"], mf["직업"]].filter(Boolean).join(" · ");
  const womanInfo = [wf["출생연도"] ? `${wf["출생연도"]}년생` : null, wf["사는곳"], wf["직업"]].filter(Boolean).join(" · ");

  await slackReply(responseUrl, {
    response_type: "in_channel",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🎉 *새로운 1:1 매칭이 생성되었어요!* (담당: ${who})\n\n` +
            `👦 *${mf["이름"]}* (${manInfo || "남성"})\n` +
            `👧 *${wf["이름"]}* (${womanInfo || "여성"})\n\n` +
            `💬 *${mf["이름"]}님 전달 링크 (카톡용):*\n<${urlForMan}|${urlForMan}>\n\n` +
            `💬 *${wf["이름"]}님 전달 링크 (카톡용):*\n<${urlForWoman}|${urlForWoman}>\n\n` +
            `_양쪽 모두에게 위 링크를 카톡으로 전달해 주세요. (48시간 동안 유효)_`
        }
      },
      {
        type: "actions",
        elements: [{
          type: "button", style: "danger", text: { type: "plain_text", text: "✖ 이 매칭 불발 취소" },
          action_id: "match_cancel", value: `${newMatchId}:${man.id}:${woman.id}:${mf["이름"]}:${wf["이름"]}`,
          confirm: {
            title: { type: "plain_text", text: "매칭 취소 확인" },
            text: { type: "plain_text", text: `${mf["이름"]} ↔ ${wf["이름"]} 매칭을 취소하고 대기 상태로 되돌릴까요?` },
            confirm: { type: "plain_text", text: "취소하기" }, deny: { type: "plain_text", text: "유지" }
          }
        }]
      }
    ]
  });
}

async function handleCancelMatch(text, responseUrl, who) {
  const rawParts = text.replace(/^(취소|불발)\s*/, "").split(/[,，/·\s]+/).map(s => s.trim()).filter(Boolean);
  if (rawParts.length < 2) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: "⚠️ 취소할 두 분의 이름을 입력해 주세요.\n예시: `/매칭 취소 김철수, 이영희`" });
    return;
  }
  const name1 = rawParts[0], name2 = rawParts[1];
  const matches = await fetchAll("매칭");
  const ongoing = matches.find(m => {
    const f = m.fields || {};
    return (f["상태"] || "소개중") === "소개중" &&
      ((f["남자"] === name1 && f["여자"] === name2) || (f["남자"] === name2 && f["여자"] === name1));
  });

  if (!ongoing) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ [${name1} ❤ ${name2}] 님의 '소개중' 매칭을 찾을 수 없어요.` });
    return;
  }

  const mf = ongoing.fields || {};
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}/${ongoing.id}`, {
    method: "PATCH", headers: atHeaders(), body: JSON.stringify({ fields: { "상태": "불발" } })
  });

  const idsToRevert = [mf["남자ID"], mf["여자ID"]].filter(Boolean);
  if (idsToRevert.length) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
      method: "PATCH", headers: atHeaders(),
      body: JSON.stringify({ records: idsToRevert.map(id => ({ id, fields: { "매칭상태": "승인" } })) })
    });
  }

  await slackReply(responseUrl, {
    response_type: "in_channel",
    text: `✖ *${mf["남자"]} ❤ ${mf["여자"]}* 매칭이 취소(불발 처리)되었습니다. (${who})`
  });
}

// ==========================================
// 메인 핸들러
// ==========================================
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const raw = await readRaw(req);

  if (!process.env.SLACK_SIGNING_SECRET) {
    return res.status(200).json({ response_type: "ephemeral", text: "⚠️ 서버에 SLACK_SIGNING_SECRET 이 없어요." });
  }
  if (!raw) {
    return res.status(200).json({ response_type: "ephemeral", text: "⚠️ 슬랙이 보낸 내용을 읽지 못했어요." });
  }
  if (!verifySlack(req, raw, process.env.SLACK_SIGNING_SECRET)) {
    return res.status(401).send("invalid signature");
  }

  const form = new URLSearchParams(raw);

  // 1. 버튼 클릭 인터랙션
  if (form.get("payload")) {
    const p = JSON.parse(form.get("payload"));
    const act = (p.actions || [])[0] || {};
    const who = (p.user && (p.user.name || p.user.username)) || "누군가";
    res.status(200).send("");

    waitUntil((async () => {
      try {
        if (act.action_id === "place_publish") {
          const recId = act.value;
          const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("데이트 장소")}/${recId}`, {
            method: "PATCH", headers: atHeaders(), body: JSON.stringify({ fields: { "공개": true } })
          });
          const d = await r.json();
          const nm = (d.fields && d.fields["이름"]) || "장소";
          await slackReply(p.response_url, { replace_original: true, text: r.ok ? `✅ *${nm}* 공개 완료! (${who})\nhttps://ssumcenter.vercel.app/date-spots` : `⚠️ 공개 실패` });
        } else if (act.action_id === "place_delete") {
          const recId = act.value;
          await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("데이트 장소")}/${recId}`, {
            method: "DELETE", headers: atHeaders()
          });
          await slackReply(p.response_url, { replace_original: true, text: `🗑️ 삭제했어요. (${who})` });
        } else if (act.action_id === "match_cancel") {
          const [matchId, manId, womanId, manName, womanName] = String(act.value || "").split(":");
          if (matchId) {
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}/${matchId}`, {
              method: "PATCH", headers: atHeaders(), body: JSON.stringify({ fields: { "상태": "불발" } })
            });
          }
          const idsToRevert = [manId, womanId].filter(id => id && id.startsWith("rec"));
          if (idsToRevert.length) {
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
              method: "PATCH", headers: atHeaders(),
              body: JSON.stringify({ records: idsToRevert.map(id => ({ id, fields: { "매칭상태": "승인" } })) })
            });
          }
          await slackReply(p.response_url, {
            replace_original: true,
            text: `✖ *${manName || "남성"} ❤ ${womanName || "여성"}* 매칭이 취소(불발 처리)되었어요. (${who})`
          });
        }
      } catch (e) { console.error("[slack] action error", e); }
    })());
    return;
  }

  // 2. 슬래시 명령
  const command = form.get("command") || "";
  const text = (form.get("text") || "").trim();
  const who = form.get("user_name") || "관리자";
  const responseUrl = form.get("response_url");

  // A. /매칭 명령
  if (command === "/매칭") {
    res.status(200).send("");
    waitUntil((async () => {
      try {
        if (!text || text === "도움말" || text === "help") {
          await slackReply(responseUrl, getMatchHelp());
        } else if (text === "대기" || text === "목록") {
          await handleWaitingList(responseUrl);
        } else if (text === "현황") {
          await handleMatchStatus(responseUrl);
        } else if (text.startsWith("취소") || text.startsWith("불발")) {
          await handleCancelMatch(text, responseUrl, who);
        } else {
          await handleCreateMatch(text, responseUrl, who);
        }
      } catch (e) {
        console.error("[slack-match] error", e);
        await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ 오류가 발생했어요: ${e.message}` });
      }
    })());
    return;
  }

  // A-2. /장소삭제 명령
  if (command === "/장소삭제") {
    waitUntil(handlePlaceDelete(text, responseUrl));
    return res.status(200).json({ response_type: "ephemeral", text: "🔎 찾는 중…" });
  }

  // B. /장소 명령
  const cmd = parsePlaceCommand(text);
  if (!cmd.name) {
    return res.status(200).json({ response_type: "ephemeral", text: "사용법: `/장소 상호명, 동네, 추천 센터장`\n예) `/장소 효뜨, 용산, 동탄`\n예) `/장소 에이비카페, 강남, 동탄 성수 강남`" });
  }
  waitUntil(handlePlaceCommand(cmd, responseUrl));
  return res.status(200).json({ response_type: "ephemeral", text: `🔎 '${cmd.name}' 등록 중이에요…` });
};

module.exports.config = { api: { bodyParser: false } };
