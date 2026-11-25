/* 접속 설정 — marathon-hub 과 같은 Supabase 프로젝트.
   publishable key 는 공개돼도 되는 키다(모든 survey_ 표는 RLS 로 막혀 있고, 일은 RPC 함수로만 한다).
   secret key · service_role key 는 절대 여기 넣지 않는다. */
window.SURVEY_CFG = {
  version: '20261125b',
  url: 'https://hfimvleiljqwortkzkrl.supabase.co',
  key: 'sb_publishable_7pHxNb12uvxBfmKpW7SVwg_RRvy41bw',
  bucket: 'survey-gift',
  kakao: 'http://pf.kakao.com/_hxaLJxj/friend'
};
/* 시험 때만: 주소에 ?mock=http://127.0.0.1:포트 를 붙이면 그 서버로 보낸다 */
(function () {
  var m = /[?&]mock=([^&#]+)/.exec(location.search);
  if (m && /^http:\/\/127\.0\.0\.1:\d+$/.test(decodeURIComponent(m[1]))) window.SURVEY_CFG.url = decodeURIComponent(m[1]);
})();
