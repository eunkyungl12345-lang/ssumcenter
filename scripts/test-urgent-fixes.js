/**
 * 🔍 긴급 3건 수정 검사 (배포 전에 손으로 돌리는 검사)
 *
 *   node scripts/test-urgent-fixes.js
 *
 * 1) /api/airtable?summary=1 이 열쇠 없이 불릴 때 401 로 막히는지
 * 2) /api/admin-auth 가 틀린 비밀번호를 세다가 429 로 잠그는지
 * 3) 성사 입금 안내가 '수락할 때 고른 유형'(일반/슈퍼)대로 금액·대상이 맞는지
 *
 * 에어테이블·솔라피·슬랙으로 실제 요청이 나가지 않도록 fetch 를 가짜로 바꿔 끼운다.
 */
const assert = require("assert");

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✅ " + name); }
  catch (e) { failed++; console.log("  ❌ " + name + " — " + e.message); }
}

// ---- 가짜 fetch: 밖으로 나가는 요청을 전부 막는다 ----
const calls = [];
global.fetch = async (url, opt) => {
  calls.push(String(url));
  return {
    ok: false, status: 401,
    json: async () => ({ records: [] }),
    text: async () => "",
  };
};

function fakeRes() {
  const r = {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
  return r;
}
function req({ method = "GET", headers = {}, query = {}, body = {} } = {}) {
  const h = {};
  Object.keys(headers).forEach((k) => { h[k.toLowerCase()] = headers[k]; });
  return { method, headers: h, query, body };
}

(async () => {
  process.env.AIRTABLE_TOKEN = "dummy-token-for-test";
  process.env.AIRTABLE_BASE_ID = "appDummyBaseId";
  process.env.ADMIN_PASSWORD = "admin-pw-for-test-1234";
  delete process.env.CRON_SECRET;
  delete process.env.SLACK_WEBHOOK_URL;

  const airtable = require("../api/airtable.js");
  const adminAuth = require("../api/admin-auth.js");

  // ---------- 1) 아침 브리핑(summary=1) 잠금 ----------
  console.log("\n1) /api/airtable?summary=1 인증");
  {
    const res = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "curl/8.5.0" } }), res);
    ok("열쇠 없이 부르면 401", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.body, { error: "인증이 필요합니다" });
    });
  }
  {
    const res = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "Mozilla/5.0" } }), res);
    ok("브라우저 흉내(열쇠 없음)도 401", () => assert.strictEqual(res.statusCode, 401));
  }
  {
    calls.length = 0;
    const res = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "curl/8.5.0", "x-admin-key": "admin-pw-for-test-1234" } }), res);
    ok("관리자 키(x-admin-key)가 맞으면 통과(401 아님)", () => assert.notStrictEqual(res.statusCode, 401));
  }
  {
    // CRON_SECRET 이 설정된 배포에서: 맞는 Bearer 는 통과, 틀린 Bearer 는 401
    process.env.CRON_SECRET = "cron-secret-for-test";
    const good = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "vercel-cron/1.0", authorization: "Bearer cron-secret-for-test" } }), good);
    ok("cron Bearer(맞음)는 통과", () => assert.notStrictEqual(good.statusCode, 401));
    const bad = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "vercel-cron/1.0", authorization: "Bearer wrong" } }), bad);
    ok("cron Bearer(틀림)는 401 — CRON_SECRET 이 있으면 표식 예외도 사라진다", () => assert.strictEqual(bad.statusCode, 401));
    delete process.env.CRON_SECRET;
  }
  {
    // CRON_SECRET 이 아직 없을 때: Vercel cron 표식은 통과해야 아침 브리핑이 안 끊긴다
    const res = fakeRes();
    await airtable(req({ query: { summary: "1" }, headers: { "user-agent": "vercel-cron/1.0" } }), res);
    ok("CRON_SECRET 미설정 + vercel-cron 표식은 통과(브리핑 유지)", () => assert.notStrictEqual(res.statusCode, 401));
  }

  // ---------- 2) 관리자 로그인 시도 제한 ----------
  console.log("\n2) /api/admin-auth 시도 제한");
  {
    const res = fakeRes();
    adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body: { password: "어떤오타" } }), res);
    ok("틀린 비밀번호 → 401", () => assert.strictEqual(res.statusCode, 401));
  }
  {
    const res = fakeRes();
    adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body: { password: "admin-pw-for-test-1234" } }), res);
    ok("맞는 비밀번호 → 200, 실패 기록도 지워짐", () => assert.strictEqual(res.statusCode, 200));
  }
  {
    let last = null, blockedAt = 0;
    for (let i = 1; i <= 12; i++) {
      const res = fakeRes();
      adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "198.51.100.7" }, body: { password: "wrong-" + i } }), res);
      last = res;
      if (res.statusCode === 429 && !blockedAt) blockedAt = i;
    }
    ok("같은 IP에서 계속 틀리면 10번째에 429 + Retry-After", () => {
      assert.strictEqual(blockedAt, 10);
      assert.strictEqual(last.statusCode, 429);
      assert.ok(Number(last.headers["retry-after"]) > 0);
    });
  }
  {
    const res = fakeRes();
    adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "198.51.100.7" }, body: { password: "admin-pw-for-test-1234" } }), res);
    ok("잠긴 IP는 맞는 비밀번호도 429 (잠금의 뜻)", () => assert.strictEqual(res.statusCode, 429));
  }
  {
    const res = fakeRes();
    adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "192.0.2.55" }, body: { password: "admin-pw-for-test-1234" } }), res);
    ok("다른 IP는 영향 없음 → 200", () => assert.strictEqual(res.statusCode, 200));
  }
  {
    // 앞에 가짜 IP를 붙여도(1.2.3.4, 진짜IP) 진짜 IP로 세야 한다
    let blockedAt = 0;
    for (let i = 1; i <= 12; i++) {
      const res = fakeRes();
      adminAuth(req({ method: "POST", headers: { "x-forwarded-for": "10.9.9." + i + ", 203.0.113.77" }, body: { password: "spoof-" + i } }), res);
      if (res.statusCode === 429 && !blockedAt) blockedAt = i;
    }
    ok("가짜 IP를 앞에 붙여도 맨 뒤(진짜) IP로 세서 10번째에 429", () => assert.strictEqual(blockedAt, 10));
  }
  {
    const res = fakeRes();
    adminAuth(req({ method: "GET", headers: { "x-forwarded-for": "192.0.2.55" } }), res);
    ok("POST 가 아니면 405", () => assert.strictEqual(res.statusCode, 405));
  }

  // ---------- 3) 성사 입금 안내 금액·대상 ----------
  console.log("\n3) 성사 입금 안내 (일반 / 슈퍼매칭)");
  const [M, W] = [{ id: "recAAAAAAAAAAAAAA", name: "민수" }, { id: "recBBBBBBBBBBBBBB", name: "지영" }];
  const plan = (mt, wt, marriage, first) => airtable.성사안내계획(
    [{ id: M.id, name: M.name, type: mt, app: { 연락처: "01011112222" } },
     { id: W.id, name: W.name, type: wt, app: { 연락처: "01033334444" } }],
    !!marriage, first || M.id);

  ok("일반 + 일반 → 두 사람 각 19,900원", () => {
    const p = plan("일반매칭", "일반매칭");
    assert.deepStrictEqual(p.map((x) => x.amount), ["19,900원", "19,900원"]);
    assert.deepStrictEqual(p.map((x) => x.free), [false, false]);
  });
  ok("남자가 슈퍼 → 남자만 39,800원, 여자는 0원(무료)", () => {
    const p = plan("슈퍼매칭", "일반매칭");
    assert.strictEqual(p[0].amount, "39,800원");
    assert.strictEqual(p[0].free, false);
    assert.strictEqual(p[1].free, true);
  });
  ok("여자가 슈퍼 → 여자만 39,800원, 남자는 0원(무료)", () => {
    const p = plan("일반매칭", "슈퍼매칭");
    assert.strictEqual(p[0].free, true);
    assert.strictEqual(p[1].amount, "39,800원");
  });
  ok("양쪽 다 슈퍼 → 응답 화면과 같게 각 19,900원", () => {
    const p = plan("슈퍼매칭", "슈퍼매칭");
    assert.deepStrictEqual(p.map((x) => x.amount), ["19,900원", "19,900원"]);
  });
  ok("유형이 비어 있는 옛 응답 → 일반으로 보고 각 19,900원", () => {
    const p = plan("", "");
    assert.deepStrictEqual(p.map((x) => x.amount), ["19,900원", "19,900원"]);
  });
  ok("결혼매칭 → 먼저 수락한 한 분께만 100,000원", () => {
    const p = plan("일반매칭", "일반매칭", true, W.id);
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].name, "지영");
    assert.strictEqual(p[0].amount, "100,000원");
    assert.strictEqual(p[0].kind, "결혼");
  });

  console.log(`\n결과: ${passed}개 통과 · ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
})();
