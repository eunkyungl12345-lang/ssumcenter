/**
 * 🚦 로그인 시도 제한 (브루트포스 방어)
 *
 * 왜 필요한가:
 *   /api/admin-auth 는 비밀번호 한 개로 관리자 전체(손님 개인정보·문자 발송)를 여는 문이다.
 *   예전에는 틀린 비밀번호를 몇 번이든, 얼마나 빨리든 계속 시도할 수 있었다
 *   (화면에 30초 잠금이 있었지만 그건 브라우저 안에서만 도는 것이라 우회가 쉬웠다).
 *
 * 어떻게 세는가:
 *   서버 메모리(Vercel 함수 인스턴스)에 IP별 실패 횟수를 센다.
 *   - 이 프로젝트에는 아직 공유 저장소(Upstash Redis)가 연결돼 있지 않다.
 *     그래서 인스턴스마다 따로 센다 — 공격자가 여러 인스턴스에 흩어 보내면
 *     인스턴스 수만큼은 더 시도할 수 있다. 그래도 한 곳에서 반복하는 흔한 공격은 막힌다.
 *   - 실패가 쌓이면 잠금(lockMs) 동안은 **맞는 비밀번호도** 받지 않는다. 그게 잠금의 뜻이다.
 *   - 성공하면 그 IP의 기록을 지운다 (정상 사용자가 오타 몇 번 한 뒤 들어와도 바로 풀린다).
 *   - 메모리가 무한히 늘지 않도록 오래된 기록은 지운다.
 *
 * 공유 저장소를 붙이면(Upstash) 이 파일 안만 바꾸면 된다 — 부르는 쪽은 그대로 쓸 수 있다.
 *
 * 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 */

const crypto = require("crypto");

// name(용도) → Map(키 → { fails, firstAt, lockedUntil, lastAt })
const buckets = new Map();
const MAX_KEYS = 5000;          // 메모리 보호용 상한
const KEEP_MS = 60 * 60 * 1000; // 1시간 지난 기록은 버린다

function bucket(name) {
  let m = buckets.get(name);
  if (!m) { m = new Map(); buckets.set(name, m); }
  return m;
}

function prune(m, now) {
  if (m.size < MAX_KEYS) {
    // 가벼운 청소: 오래된 것만 골라 지운다 (매번 다 훑지 않게 20개까지만)
    let n = 0;
    for (const [k, v] of m) {
      if (now - (v.lastAt || 0) > KEEP_MS) { m.delete(k); if (++n >= 20) break; }
    }
    return;
  }
  // 상한을 넘으면 오래된 것부터 지운다
  const old = [...m.entries()].sort((a, b) => (a[1].lastAt || 0) - (b[1].lastAt || 0));
  for (let i = 0; i < Math.ceil(old.length / 4); i++) m.delete(old[i][0]);
}

/** 요청한 사람의 IP.
 *  ⚠️ x-forwarded-for 는 손님이 직접 넣은 값이 앞에 붙을 수 있다.
 *     ("1.2.3.4, 실제IP" 처럼) 그래서 **맨 뒤 값**(프록시가 마지막에 붙인 실제 주소)을 쓴다.
 *     앞 값을 쓰면 요청마다 가짜 IP를 바꿔 넣어 시도 제한을 그냥 빠져나갈 수 있다. */
function clientIp(req) {
  const xff = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  const real = String((req && req.headers && req.headers["x-real-ip"]) || "").trim();
  if (real) return real;
  const sock = (req && (req.socket || req.connection)) || {};
  return String(sock.remoteAddress || "").trim() || "unknown";
}

/**
 * 지금 이 키가 잠겨 있는지 본다.
 * @returns {{blocked:boolean, retryAfter:number}} retryAfter = 남은 초
 */
function check(name, key, opts) {
  const now = Date.now();
  const m = bucket(name);
  prune(m, now);
  const v = m.get(key);
  if (!v) return { blocked: false, retryAfter: 0 };
  if (v.lockedUntil && v.lockedUntil > now) {
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((v.lockedUntil - now) / 1000)) };
  }
  // 창(windowMs)이 지났으면 셈을 새로 시작한다
  if (now - (v.firstAt || 0) > ((opts && opts.windowMs) || 600000)) {
    m.delete(key);
  }
  return { blocked: false, retryAfter: 0 };
}

/**
 * 실패를 하나 기록한다. 한도에 닿으면 그때부터 잠근다.
 * @returns {{blocked:boolean, fails:number, retryAfter:number}}
 */
function fail(name, key, opts) {
  const now = Date.now();
  const o = opts || {};
  const max = o.max || 10;
  const windowMs = o.windowMs || 10 * 60 * 1000;
  const lockMs = o.lockMs || 5 * 60 * 1000;
  const m = bucket(name);
  let v = m.get(key);
  // 기록이 없거나, 세는 창(windowMs)이 지났으면 새로 센다
  if (!v || now - (v.firstAt || 0) > windowMs) {
    v = { fails: 0, firstAt: now, lockedUntil: 0, lastAt: now };
  }
  v.fails += 1;
  v.lastAt = now;
  if (v.fails >= max) {
    v.lockedUntil = now + lockMs;
    v.fails = 0;
    v.firstAt = now;
    m.set(key, v);
    return { blocked: true, fails: max, retryAfter: Math.ceil(lockMs / 1000) };
  }
  m.set(key, v);
  return { blocked: false, fails: v.fails, retryAfter: 0 };
}

/** 성공했을 때 그 키의 기록을 지운다. */
function clear(name, key) {
  const m = bucket(name);
  m.delete(key);
}

/** 길이가 같은 두 문자열을 시간차 없이 비교한다 (비밀번호 비교용). */
function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? "" : a));
  const y = Buffer.from(String(b == null ? "" : b));
  if (!x.length || x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch (e) { return false; }
}

module.exports = { clientIp, check, fail, clear, safeEqual };
