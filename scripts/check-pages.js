#!/usr/bin/env node
/**
 * 썸류센터 배포 전 자동 검사
 *
 *   실행:  npm run check
 *
 * push 할 때마다 GitHub이 이 검사를 자동으로 돌립니다.
 * 문제가 있으면 빨간 X가 뜨고, 무엇이 잘못됐는지 한국어로 알려줍니다.
 *
 * 검사 항목
 *   1. JS 문법        — 페이지가 통째로 안 뜨는 제일 흔한 사고
 *   2. 깨진 링크      — 없는 페이지로 가는 버튼
 *   3. 죽은 버튼      — 눌러도 아무 일도 안 일어나는 버튼
 *   4. 관리자 로그인  — 페이지마다 로그인이 따로 놀지 않게
 *   5. 프로젝트 규칙  — Tailwind CDN 사용 금지 (CLAUDE.md)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules", ".vercel", "scripts"]);

const problems = [];
const notes = [];
function problem(file, msg, hint) { problems.push({ file, msg, hint }); }

// ── 검사할 HTML 파일 모으기 ────────────────────────────────────────────
function htmlFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) htmlFiles(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

const files = htmlFiles(ROOT).sort();

// 관리자 페이지 (로그인 규칙을 지켜야 하는 페이지)
const ADMIN_PAGES = new Set([
  "admin.html", "rotation-admin.html", "1on1-admin.html", "1on1.html",
  "vote-admin.html", "lineup.html", "attendance.html", "participants.html",
]);

// onclick 안에서 함수처럼 보이지만 자바스크립트 기본 기능이라 정의가 필요 없는 것들
const BUILTINS = new Set([
  "alert", "confirm", "prompt", "fetch", "open", "close", "print", "Number",
  "String", "Array", "Object", "Boolean", "Date", "RegExp", "Error", "JSON",
  "Math", "parseInt", "parseFloat", "isNaN", "setTimeout", "setInterval",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "if", "for", "while", "switch", "catch", "return", "typeof", "function",
  "require", "Promise", "Set", "Map",
]);

for (const full of files) {
  const rel = path.relative(ROOT, full);
  const html = fs.readFileSync(full, "utf8");
  const lineOf = (idx) => html.slice(0, idx).split("\n").length;

  // ── 1. JS 문법 ────────────────────────────────────────────────────
  let allJs = "";
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], code = m[2];
    if (/\bsrc\s*=/.test(attrs)) continue;                       // 외부 파일
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue; // JSON 등
    allJs += code + "\n";
    try {
      new vm.Script(code, { filename: rel });
    } catch (e) {
      problem(rel, `자바스크립트 문법이 잘못됐어요 (${lineOf(m.index)}번째 줄에서 시작하는 script 안) — ${e.message}`,
        "이대로 배포하면 그 페이지의 버튼이 전부 먹통이 됩니다.");
    }
  }

  // ── 2. 깨진 링크 ──────────────────────────────────────────────────
  const links = new Set();
  for (const m of html.matchAll(/(?:href|action)\s*=\s*["']([^"']+)["']/gi)) links.add(m[1]);
  for (const m of html.matchAll(/location\.(?:href|replace)\s*[=(]\s*["']([^"']+)["']/gi)) links.add(m[1]);

  for (const link of links) {
    if (/^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(link)) continue;
    if (link.includes("${") || link.includes('"+') || link.includes("'+")) continue; // 코드로 만드는 주소
    const clean = link.split("?")[0].split("#")[0];
    if (!clean || clean === "/") continue;

    const base = clean.startsWith("/")
      ? path.join(ROOT, clean.slice(1))
      : path.resolve(path.dirname(full), clean);
    const found = [base, base + ".html", path.join(base, "index.html")].some(fs.existsSync);
    if (!found) {
      problem(rel, `없는 곳으로 가는 링크가 있어요 → "${link}"`,
        "이 버튼을 누르면 '페이지를 찾을 수 없습니다'가 뜹니다.");
    }
  }

  // ── 3. 죽은 버튼 ──────────────────────────────────────────────────
  // 함수 이름에 한글도 쓸 수 있으므로 유니코드 글자까지 인식
  const declared = new Set();
  for (const m of allJs.matchAll(/(?:^|[\s;{}])(?:async\s+)?function\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu)) declared.add(m[1]);
  for (const m of allJs.matchAll(/(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=/gu)) declared.add(m[1]);
  for (const m of allJs.matchAll(/window\.([\p{L}_$][\p{L}\p{N}_$]*)\s*=/gu)) declared.add(m[1]);

  const handlerAttr = /\bon(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*"([^"]*)"/gi;
  for (const m of html.matchAll(handlerAttr)) {
    // "document.getElementById(...)" 같은 점 뒤의 호출은 제외하고 남은 것만 검사
    const bare = m[1].replace(/\.\s*[\p{L}_$][\p{L}\p{N}_$]*\s*\(/gu, ".(");
    for (const c of bare.matchAll(/([\p{L}_$][\p{L}\p{N}_$]*)\s*\(/gu)) {
      const name = c[1];
      if (BUILTINS.has(name) || declared.has(name)) continue;
      problem(rel, `눌러도 아무 일도 안 일어나는 버튼이 있어요 (${lineOf(m.index)}번째 줄) → ${name}()`,
        `${name}() 이라는 기능이 이 페이지 안에 없습니다. 이름이 틀렸거나 지워졌을 수 있어요.`);
    }
  }

  // ── 4. 관리자 로그인 규칙 ─────────────────────────────────────────
  // 규칙: /api/admin-auth 로 확인 → localStorage 의 admin_key 에 저장
  if (/sessionStorage\s*\.\s*(?:get|set)Item\s*\(\s*["']admin_key["']/.test(html)) {
    problem(rel, "관리자 비밀번호를 sessionStorage에 저장하고 있어요.",
      "그러면 이 페이지만 로그인이 따로 놀아서, 다른 관리자 페이지에서 넘어올 때 비밀번호를 또 물어봅니다. localStorage를 쓰세요.");
  }
  const name = path.basename(full);
  if (ADMIN_PAGES.has(name) && name !== "admin.html") {
    if (!html.includes("/api/admin-auth")) {
      problem(rel, "관리자 페이지인데 비밀번호를 서버에 확인하지 않아요.",
        "/api/admin-auth 로 확인해야 틀린 비밀번호일 때 바로 알려줄 수 있습니다.");
    }
    if (!/localStorage\s*\.\s*getItem\s*\(\s*(?:KEY|["']admin_key["'])/.test(html)) {
      problem(rel, "관리자 페이지인데 localStorage의 admin_key를 쓰지 않아요.",
        "다른 관리자 페이지와 로그인을 공유하려면 localStorage의 admin_key를 써야 합니다.");
    }
  }

  // ── 5. 프로젝트 규칙 ──────────────────────────────────────────────
  if (html.includes("cdn.tailwindcss.com")) {
    problem(rel, "Tailwind CDN(cdn.tailwindcss.com)을 쓰고 있어요.",
      "CLAUDE.md에서 금지한 방식입니다. 순수 CSS나 인라인 스타일을 쓰세요.");
  }
}

// ── 결과 출력 ──────────────────────────────────────────────────────────
console.log(`\n🔍 썸류센터 배포 전 검사 — HTML ${files.length}개 확인했습니다.\n`);

if (problems.length === 0) {
  console.log("✅ 문제 없습니다. 배포해도 좋아요.\n");
  process.exit(0);
}

const byFile = new Map();
for (const p of problems) {
  if (!byFile.has(p.file)) byFile.set(p.file, []);
  byFile.get(p.file).push(p);
}

console.log(`❌ 문제 ${problems.length}개를 찾았어요. 고치고 다시 올려주세요.\n`);
for (const [file, list] of byFile) {
  console.log(`📄 ${file}`);
  for (const p of list) {
    console.log(`   • ${p.msg}`);
    if (p.hint) console.log(`     └ ${p.hint}`);
  }
  console.log("");
}
notes.forEach((n) => console.log(n));
process.exit(1);
