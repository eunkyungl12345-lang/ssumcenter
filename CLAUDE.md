# 썸류센터 프로젝트 지침

## 프로젝트 개요
- 썸류센터: 강남 기반 2030 소개팅 서비스
- 배포: ssumcenter.vercel.app (Vercel, GitHub 자동 배포)
- DB: Airtable / 파일: Cloudinary / 문자: 솔라피

## 사용자
- 비개발자 (센터장)
- 한국어로만 대화
- 기술 용어 쓰지 말고 쉽게 설명
- 코드 설명보다 결과 중심으로 답변

## 배포 전 필수 체크
1. **JS 문법 검증**: HTML 파일 수정 후 반드시 `node -e` 로 script 태그 내 JS 파싱 테스트
2. **admin.html 동기화**: admin/index.html과 admin.html 이 별도 파일임. cleanUrls 설정 때문에 /admin 접속 시 admin.html이 서빙됨. 수정 시 admin.html을 직접 수정할 것
3. **Tailwind CDN 사용 금지**: 새 페이지에 cdn.tailwindcss.com 절대 사용하지 않음. 순수 CSS 또는 인라인 스타일 사용
4. **Google Fonts 최소화**: 가능하면 시스템 폰트 사용. 한글 웹폰트는 로딩 느림

## 파일 구조
- `index.html` — 메인 홈페이지
- `rotation.html` — 썸배달 (로테이션 소개팅) 참여 안내
- `fintech.html` — 재테크 미팅 참여 안내
- `apply.html` — 재테크 미팅 신청 폼 (→ Airtable 재테크 커피팅)
- `matching.html` — 1:1 매칭 신청 폼 (→ Airtable 1:1 매칭 신청)
- `oneone.html` — 1:1 매칭 소개 페이지
- `admin.html` — 관리자 페이지 (승인/입금/문자 발송)
- `api/airtable.js` — Airtable 프록시 API
- `api/send-sms.js` — 솔라피 문자 발송 API
- `api/kakao-auth.js` — 카카오 로그인 API

## Airtable 테이블
- 1:1 매칭 신청 (tblRcERfvQz7jN5xc)
- 매칭 응답 (tblQKhTTmbieXVg6o)
- 재테크 커피팅 (tbl5rTbnwfdmFt878)

## 주의사항
- 어드민 페이지 수정 시 반드시 JS 문법 검증 후 push
- 환경변수는 Vercel CLI(`npx vercel env`)로 관리
- 문자 발송은 솔라피 API (IP 제한 해제 필요)
- 사진 업로드 시 클라이언트에서 1200px 압축 후 Cloudinary 업로드
