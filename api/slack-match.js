// 슬랙 `/매칭` 명령 → 1:1 소개팅 매칭 생성 및 현황 관리 (썸류센터봇)
// 사용법(슬랙):
//   /매칭                  (도움말 안내)
//   /매칭 대기             (현재 매칭 대기 중인 남녀 회원 목록 조회)
//   /매칭 현황             (소개중 / 성사 매칭 현황 요약)
//   /매칭 홍길동, 이영희   (두 사람 1:1 매칭 생성 + 카톡 전달용 고유 링크 발급)
//   /매칭 취소 홍길동, 이영희 (진행 중인 매칭 불발 취소 및 대기 상태로 복귀)

const crypto = require("crypto");
const { waitUntil } = require("@vercel/functions");

const BASE_ID = process.env.AIRTABLE_BASE_ID || "appgWdt1TeSuI77T1";
const TOKEN = process.env.AIRTABLE_TOKEN;

function atHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN || TOKEN}`,
    "Content-Type": "application/json"
  };
}

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

async function slackReply(url, body) {
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch((e) => console.error("[slack-match] reply error:", e.message));
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

// 📖 도움말
function getHelpMessage() {
  return {
    response_type: "ephemeral",
    blocks: [
      {
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
      }
    ]
  };
}

// 📋 대기 목록 조회
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
    const specs = [
      f["출생연도"] ? `${f["출생연도"]}년생` : null,
      f["사는곳"] || null,
      f["직업"] || null
    ].filter(Boolean).join(" · ");
    return `• *${f["이름"]}* (${specs || "정보 없음"})`;
  };

  const menList = men.slice(0, 10).map(fmt).join("\n") || "_(대기 중인 남성 회원이 없어요)_";
  const womenList = women.slice(0, 10).map(fmt).join("\n") || "_(대기 중인 여성 회원이 없어요)_";

  await slackReply(responseUrl, {
    response_type: "ephemeral",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📋 *1:1 매칭 대기 명단* (남 ${men.length}명 / 여 ${women.length}명)\n\n` +
            `👦 *남성 대기자 (최근 10명)*\n${menList}\n\n` +
            `👧 *여성 대기자 (최근 10명)*\n${womenList}\n\n` +
            `💡 *매칭 생성:* \`/매칭 [남성이름], [여성이름]\` 을 입력하세요.`
        }
      }
    ]
  });
}

// 📊 매칭 현황 요약
async function handleStatus(responseUrl) {
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
    response_type: "ephemeral",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📊 *1:1 매칭 현황 요약*\n\n` +
            `• 소개중: *${intro.length}쌍*\n` +
            `• 성사 커플: *${success.length}쌍* 🎉\n` +
            `• 불발: ${failed.length}건 / 결별: ${broken.length}건\n\n` +
            `⏳ *현재 진행 중인 소개 목록*\n${introList}`
        }
      }
    ]
  });
}

// 💘 매칭 생성
async function handleCreateMatch(text, responseUrl, who) {
  const rawParts = text.split(/[,，/·\s]+/).map(s => s.trim()).filter(Boolean);
  if (rawParts.length < 2) {
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: "⚠️ 두 분의 이름을 쉼표로 구분해서 입력해 주세요.\n예시: `/매칭 김철수, 이영희`"
    });
    return;
  }

  const name1 = rawParts[0], name2 = rawParts[1];
  const applicants = await fetchAll("1:1 매칭 신청");

  const found1 = applicants.filter(r => (r.fields || {})["이름"] === name1);
  const found2 = applicants.filter(r => (r.fields || {})["이름"] === name2);

  if (!found1.length) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ '${name1}' 님을 1:1 신청자 명단에서 찾을 수 없어요. 이름을 확인해 주세요.` });
    return;
  }
  if (!found2.length) {
    await slackReply(responseUrl, { response_type: "ephemeral", text: `⚠️ '${name2}' 님을 1:1 신청자 명단에서 찾을 수 없어요. 이름을 확인해 주세요.` });
    return;
  }

  const p1 = found1[0], p2 = found2[0];
  const f1 = p1.fields || {}, f2 = p2.fields || {};

  let man = null, woman = null;
  if (f1["성별"] === "남성" && f2["성별"] === "여성") {
    man = p1; woman = p2;
  } else if (f1["성별"] === "여성" && f2["성별"] === "남성") {
    man = p2; woman = p1;
  } else {
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: `⚠️ 두 분의 성별이 모두 '${f1["성별"] || "동일"}'으로 확인됐어요. 1:1 매칭은 이성끼리만 가능해요.`
    });
    return;
  }

  const mf = man.fields || {}, wf = woman.fields || {};

  // 중복 매칭 확인
  const matches = await fetchAll("매칭");
  const isOngoing = matches.some(m => {
    const f = m.fields || {};
    const s = f["상태"] || "소개중";
    return (s === "소개중" || s === "성사") &&
      ((f["남자ID"] === man.id && f["여자ID"] === woman.id) || (f["남자ID"] === woman.id && f["여자ID"] === man.id));
  });

  if (isOngoing) {
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: `⚠️ ${mf["이름"]}님과 ${wf["이름"]}님은 이미 진행 중(소개중/성사)인 매칭이 있어요. 중복 매칭을 방지하기 위해 생성을 중단했습니다.`
    });
    return;
  }

  const siteUrl = process.env.SITE_URL || "https://ssumcenter.vercel.app";
  const t = Date.now();
  const urlForMan = `${siteUrl}/response.html?id=${woman.id}&myId=${man.id}&t=${t}`;
  const urlForWoman = `${siteUrl}/response.html?id=${man.id}&myId=${woman.id}&t=${t}`;

  const createBody = {
    records: [{
      fields: {
        "남자": mf["이름"] || "",
        "여자": wf["이름"] || "",
        "남자ID": man.id,
        "여자ID": woman.id,
        "남자링크": urlForMan,
        "여자링크": urlForWoman,
        "상태": "소개중",
        "남자응답": "대기",
        "여자응답": "대기",
        "생성일": new Date().toLocaleString("ko-KR")
      }
    }]
  };

  const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}`, {
    method: "POST",
    headers: atHeaders(),
    body: JSON.stringify(createBody)
  });

  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: `⚠️ 매칭 생성 실패 (에어테이블 에러): ${err.slice(0, 100)}`
    });
    return;
  }

  const createdData = await createRes.json();
  const newMatchId = (createdData.records && createdData.records[0] && createdData.records[0].id) || "";

  // 신청자 상태 '소개중'으로 변경
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
    method: "PATCH",
    headers: atHeaders(),
    body: JSON.stringify({
      records: [
        { id: man.id, fields: { "매칭상태": "소개중" } },
        { id: woman.id, fields: { "매칭상태": "소개중" } }
      ]
    })
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
        elements: [
          {
            type: "button",
            style: "danger",
            text: { type: "plain_text", text: "✖ 이 매칭 불발 취소" },
            action_id: "match_cancel",
            value: `${newMatchId}:${man.id}:${woman.id}:${mf["이름"]}:${wf["이름"]}`,
            confirm: {
              title: { type: "plain_text", text: "매칭 취소 확인" },
              text: { type: "plain_text", text: `${mf["이름"]} ↔ ${wf["이름"]} 매칭을 취소하고 대기 상태로 되돌릴까요?` },
              confirm: { type: "plain_text", text: "취소하기" },
              deny: { type: "plain_text", text: "유지" }
            }
          }
        ]
      }
    ]
  });
}

// ✖ 매칭 취소
async function handleCancelMatch(text, responseUrl, who) {
  const rawParts = text.replace(/^(취소|불발)\s*/, "").split(/[,，/·\s]+/).map(s => s.trim()).filter(Boolean);
  if (rawParts.length < 2) {
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: "⚠️ 취소할 두 분의 이름을 입력해 주세요.\n예시: `/매칭 취소 김철수, 이영희`"
    });
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
    await slackReply(responseUrl, {
      response_type: "ephemeral",
      text: `⚠️ [${name1} ❤ ${name2}] 님의 진행 중인 '소개중' 매칭을 찾을 수 없어요.`
    });
    return;
  }

  const mf = ongoing.fields || {};
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}/${ongoing.id}`, {
    method: "PATCH",
    headers: atHeaders(),
    body: JSON.stringify({ fields: { "상태": "불발" } })
  });

  const idsToRevert = [mf["남자ID"], mf["여자ID"]].filter(Boolean);
  if (idsToRevert.length) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
      method: "PATCH",
      headers: atHeaders(),
      body: JSON.stringify({
        records: idsToRevert.map(id => ({ id, fields: { "매칭상태": "승인" } }))
      })
    });
  }

  await slackReply(responseUrl, {
    response_type: "in_channel",
    text: `✖ *${mf["남자"]} ❤ ${mf["여자"]}* 매칭이 취소(불발 처리)되었습니다. 두 분 모두 다시 매칭 대기 상태로 복귀했습니다. (${who})`
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const raw = await readRaw(req);

  if (!process.env.SLACK_SIGNING_SECRET) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: "⚠️ 서버에 SLACK_SIGNING_SECRET 이 설정되지 않았어요.\nVercel 환경변수에서 등록 후 재배포해 주세요."
    });
  }
  if (!raw) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: "⚠️ 슬랙 요청 본문이 비어 있습니다."
    });
  }
  if (!verifySlack(req, raw, process.env.SLACK_SIGNING_SECRET)) {
    return res.status(401).send("invalid signature");
  }

  const form = new URLSearchParams(raw);

  // 1. 버튼 클릭 액션 처리
  if (form.get("payload")) {
    const p = JSON.parse(form.get("payload"));
    const act = (p.actions || [])[0] || {};
    const who = (p.user && (p.user.name || p.user.username)) || "누군가";
    res.status(200).send("");

    waitUntil((async () => {
      try {
        if (act.action_id === "match_cancel") {
          const [matchId, manId, womanId, manName, womanName] = String(act.value || "").split(":");
          if (matchId) {
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("매칭")}/${matchId}`, {
              method: "PATCH",
              headers: atHeaders(),
              body: JSON.stringify({ fields: { "상태": "불발" } })
            });
          }
          const idsToRevert = [manId, womanId].filter(id => id && id.startsWith("rec"));
          if (idsToRevert.length) {
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent("1:1 매칭 신청")}`, {
              method: "PATCH",
              headers: atHeaders(),
              body: JSON.stringify({
                records: idsToRevert.map(id => ({ id, fields: { "매칭상태": "승인" } }))
              })
            });
          }
          await slackReply(p.response_url, {
            replace_original: true,
            text: `✖ *${manName || "남성"} ❤ ${womanName || "여성"}* 매칭이 취소(불발 처리)되었어요. 두 분 모두 다시 매칭 대기 상태로 복귀했습니다. (${who})`
          });
        }
      } catch (e) {
        console.error("[slack-match] button action error:", e);
      }
    })());
    return;
  }

  // 2. 슬래시 커맨드 (/매칭 ...) 처리
  const text = (form.get("text") || "").trim();
  const who = form.get("user_name") || "관리자";
  const responseUrl = form.get("response_url");

  // 즉시 200 응답하여 슬랙 3초 타임아웃 방지
  res.status(200).send("");

  waitUntil((async () => {
    try {
      if (!text || text === "도움말" || text === "help") {
        await slackReply(responseUrl, getHelpMessage());
      } else if (text === "대기" || text === "목록") {
        await handleWaitingList(responseUrl);
      } else if (text === "현황") {
        await handleStatus(responseUrl);
      } else if (text.startsWith("취소") || text.startsWith("불발")) {
        await handleCancelMatch(text, responseUrl, who);
      } else {
        await handleCreateMatch(text, responseUrl, who);
      }
    } catch (e) {
      console.error("[slack-match] command error:", e);
      await slackReply(responseUrl, {
        response_type: "ephemeral",
        text: `⚠️ 매칭 명령어 처리 중 오류가 발생했어요: ${e.message}`
      });
    }
  })());
};

module.exports.config = { api: { bodyParser: false } };
