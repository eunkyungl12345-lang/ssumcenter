/**
 * 로테이션 회차 목록
 *
 * ★ 새 회차를 열 때는 ROTATION_ROUNDS 안에 한 줄만 추가하면 됩니다.
 *   그러면 홈 신청 모달 · 회차 선택 화면 · 신청서가 한꺼번에 따라옵니다.
 *   (예전처럼 900줄짜리 신청서 파일을 복사할 필요가 없습니다)
 *
 *   key         주소에 쓰는 값      /rotation-form?r=1119
 *   label       에어테이블 '회차' 칸에 저장되는 값 (관리자 회차 탭 이름도 이걸 씁니다)
 *   dateText    화면에 보여줄 일정
 *   refundFrom  환불 불가가 시작되는 날
 *
 * ⚠️ label 은 에어테이블에 그대로 저장되는 값이라 형식을 맞춰주세요: "11/19 (수)"
 *
 * 🔕 지금은 열린 회차가 없습니다 (로테이션 잠시 쉼).
 *    비워두면 손님 화면에 날짜가 하나도 안 뜨고 "상시 접수 중 · 센터장 검토"로 안내됩니다.
 *    지난 날짜가 남아 있으면 "여기 끝난 서비스인가?" 하는 오해를 주기 때문에,
 *    회차가 끝나면 이 목록에서 빼고 아래 ROTATION_PAST_ROUNDS 로 옮겨주세요.
 */
window.ROTATION_ROUNDS = [
  // 예) { key: "1119", label: "11/19 (수)", dateText: "11월 19일 (수) 19:45", refundFrom: "11/15(토)" },
];

// 지난 회차 기록 (손님 화면에는 안 나옵니다 — 나중에 참고용)
window.ROTATION_PAST_ROUNDS = [
  { key: "1022", label: "10/22 (목)", dateText: "10월 22일 (목) 19:45", refundFrom: "10/18(일)" },
  { key: "1008", label: "10/8 (목)",  dateText: "10월 8일 (목) 19:45",  refundFrom: "10/4(일)"  },
  { key: "0917", label: "9/17 (수)",  dateText: "9월 17일 (수) 19:45",  refundFrom: "9/13(일)"  },
  { key: "0827", label: "8/27 (목)",  dateText: "8월 27일 (목) 19:45",  refundFrom: "8/23(일)"  },
];

// 주소(?r=1119)로 '열린' 회차 찾기. 없으면 null
// 지난 회차 주소로 들어오면 null → 신청서가 회차 선택 화면으로 보내줍니다.
window.findRound = function (key) {
  var k = String(key || "").trim();
  var list = window.ROTATION_ROUNDS || [];
  for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
  return null;
};

// 열린 회차가 있는지 (없으면 '상시 접수 중'으로 안내)
window.hasOpenRound = function () {
  return (window.ROTATION_ROUNDS || []).length > 0;
};
