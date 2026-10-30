/**
 * 로테이션 회차 목록
 *
 * ★ 새 회차를 열 때는 맨 위에 한 줄만 추가하면 됩니다.
 *   예전처럼 900줄짜리 신청서 파일을 복사할 필요가 없습니다.
 *
 *   key         주소에 쓰는 값      /rotation-form?r=1119
 *   label       에어테이블 '회차' 칸에 저장되는 값 (관리자 회차 탭 이름도 이걸 씁니다)
 *   dateText    화면에 보여줄 일정
 *   refundFrom  환불 불가가 시작되는 날
 *
 * ⚠️ label 은 에어테이블에 그대로 저장되는 값이라 형식을 맞춰주세요: "11/19 (수)"
 */
window.ROTATION_ROUNDS = [
  { key: "1022", label: "10/22 (목)", dateText: "10월 22일 (목) 19:45", refundFrom: "10/18(일)" },
  { key: "1008", label: "10/8 (목)",  dateText: "10월 8일 (목) 19:45",  refundFrom: "10/4(일)"  },
  { key: "0917", label: "9/17 (수)",  dateText: "9월 17일 (수) 19:45",  refundFrom: "9/13(일)"  },
  { key: "0827", label: "8/27 (목)",  dateText: "8월 27일 (목) 19:45",  refundFrom: "8/23(일)"  },
];

// 주소(?r=1008)로 회차 찾기. 없으면 null
window.findRound = function (key) {
  var k = String(key || "").trim();
  var list = window.ROTATION_ROUNDS || [];
  for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
  return null;
};
