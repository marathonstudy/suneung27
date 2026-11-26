/* 2027 수능 성적·후기 조사 — 관리자 화면
   등급은 DB에 없다. 원점수 + 학생이 고른 등급만 저장하고, 여기서 등급컷으로 그때그때 계산한다. */
(function () {
  'use strict';
  var CFG = window.SURVEY_CFG;
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false, autoRefreshToken: false } });
  var TK = 'survey_admin_token';
  var token = sessionStorage.getItem(TK) || '';
  var D = null;                       // survey_admin_data 결과
  var tab = 'approve';
  var UI = { list: 'pending', base: 'pre', fCourse: 'all', fSubj: 'all', fStart: 'all', withRejected: false };

  var EXAMS = [['m6', '6월 모평'], ['m9', '9월 모평'], ['sn', '수능 가채점']];
  var SUBJ = { hwa: '화법과 작문', eon: '언어와 매체' };
  var SUBJ_S = { hwa: '화작', eon: '언매' };
  var START = { sep_early: '9월 초', sep_mid: '9월 중순(9평 이후)', oct: '10월 이후' };
  var COURSE = { online: '온라인', offline: '현장강의' };
  var HELPFUL = ['1일 1지문 매일 루틴', '1:1 코칭·피드백', '24시간 질문', '한수 실전 모의고사',
    '해설 강의', 'EBS 수특·수완 정리', '학습 데이터 레포트', '완주 환급(동기부여)'];
  var WARN_MSG = '이미 기프티콘을 받은 학생일 수 있습니다. 그래도 승인할까요?';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function nk(s) { return String(s || '').replace(/\s/g, ''); }
  function fmtPhone(d) { d = digits(d); return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d; }
  function fmtTime(t) {
    if (!t) return '';
    var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function mask(name) { name = String(name || '').trim(); return name ? name[0] + '○'.repeat(Math.max(name.length - 1, 2)) : ''; }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function avg(arr) { return arr.length ? Math.round(arr.reduce(function (s, x) { return s + x; }, 0) / arr.length * 10) / 10 : null; }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }

  function rpc(fn, args) {
    return sb.rpc(fn, args || {}).then(function (r) {
      if (r.error) {
        if (/admin_auth/.test(r.error.message || '')) { logout(); throw new Error('다시 로그인해 주세요'); }
        throw new Error(r.error.message || '오류');
      }
      return r.data;
    });
  }

  /* ---------- 로그인 ---------- */
  function showLogin() { $('main').hidden = true; $('login').hidden = false; $('pw').focus(); }
  function logout() { token = ''; sessionStorage.removeItem(TK); showLogin(); }
  function login() {
    var pw = $('pw').value; $('pwerr').textContent = '';
    if (!pw) return;
    $('pwbtn').disabled = true;
    rpc('survey_admin_login', { p_password: pw }).then(function (d) {
      if (!d || !d.ok) { $('pwerr').textContent = d && d.reason === 'locked' ? '실패가 많아 10분 동안 잠겼습니다.' : '비밀번호가 맞지 않습니다.'; return; }
      token = d.token; sessionStorage.setItem(TK, token); $('pw').value = '';
      $('login').hidden = true; $('main').hidden = false; load();
    }).catch(function (e) { $('pwerr').textContent = '연결 오류: ' + e.message; })
      .then(function () { $('pwbtn').disabled = false; });
  }
  $('pwbtn').onclick = login;
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });

  function load() {
    return rpc('survey_admin_data', { p_token: token }).then(function (d) { D = d; render(); if (UI.detail != null) renderDetail(); smsPoll(); })
      .catch(function (e) { $('view').innerHTML = '<div class="panel">불러오지 못했습니다: ' + esc(e.message) + '</div>'; });
  }
  $('reload').onclick = function () { load().then(function () { toast('새로 불러왔습니다'); }); };
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]'); if (!b) return;
    tab = b.getAttribute('data-tab');
    if (UI.detail != null) closeDetail();
    Array.prototype.forEach.call($('tabs').children, function (x) { x.classList.toggle('on', x === b); });
    render();
  });

  /* ---------- 등급 계산 ---------- */
  // 컷 배열 [1등급컷 … 8등급컷], 8등급 컷 미만은 9등급. 필요한 칸이 비어 있으면 계산 불가(null).
  function gradeFromRaw(exam, subj, raw) {
    if (raw == null || !subj) return null;
    var c = D.settings.cuts && D.settings.cuts[exam] && D.settings.cuts[exam][subj];
    if (!c) return null;
    for (var i = 0; i < 8; i++) {
      if (c[i] == null || c[i] === '') return null;
      if (raw >= c[i]) return i + 1;
    }
    return 9;
  }
  // { g: 등급|null, how: 'score'|'self'|null, raw }
  function gradeOf(r, exam) {
    var raw = r[exam + '_raw'];
    if (raw != null) {
      var g = gradeFromRaw(exam, r.subject, raw);
      return { g: g, how: 'score', raw: raw, nocut: g == null };
    }
    if (exam !== 'sn' && r[exam + '_grade'] != null) return { g: r[exam + '_grade'], how: 'self', raw: null };
    return { g: null, how: null, raw: null };
  }
  function gradeCell(r, exam) {
    var x = gradeOf(r, exam);
    if (x.how === 'score') return (x.g ? x.g + '등급' : '<span class="muted">컷 없음</span>') + ' <span class="how">점수 환산 · ' + x.raw + '점</span>';
    if (x.how === 'self') return x.g + '등급 <span class="how">직접 입력</span>';
    var st = r[exam + '_status'];
    return '<span class="muted">' + (st === 'none' ? '응시 안 함' : st === 'forgot' ? '기억 안 남' : '-') + '</span>';
  }
  // 수강 전 점수: 학생이 고른 등급(원점수는 참고). 없거나 「기억 안 남」이면 6·9모 중 낮은(숫자 큰) 등급을 대신 쓴다.
  function preOf(r) {
    if (r.pre_grade != null) return { g: r.pre_grade, raw: r.pre_raw, how: 'self' };
    var a = gradeOf(r, 'm6').g, b = gradeOf(r, 'm9').g;
    var g = a == null ? b : b == null ? a : Math.max(a, b);
    if (g != null) return { g: g, raw: null, how: 'fallback', forgot: r.pre_status === 'forgot' };
    return { g: null, raw: null, how: null, forgot: r.pre_status === 'forgot' };
  }
  function deltaHtml(st, sn) {
    if (st == null || sn == null) return '';
    var n = st - sn;
    return n > 0 ? '<span class="dl up">▲' + n + '</span>' : n < 0 ? '<span class="dl down">▼' + (-n) + '</span>' : '<span class="dl same">=</span>';
  }
  // 승인 목록 「점수 추이」: 수강 전 4 → 6모 3 → 9모 3 → 수능 2  (아래 작게 원점수 · 과목, 수강 전 대비 ▲▼=)
  function trendCell(r) {
    var p = preOf(r);
    var top = ['<span class="tg-l">수강 전</span> <b class="tg' + (p.g == null ? ' none' : '') + '">' + (p.g != null ? p.g : '—') + '</b>'];
    var raw = [p.how === 'self' ? (p.raw != null ? p.raw : '직접') : p.how === 'fallback' ? '6·9모 중 낮은 쪽' : '—'];
    EXAMS.forEach(function (e) {
      var x = gradeOf(r, e[0]);
      var gtxt = x.g != null ? String(x.g) : (x.how === 'score' ? '?' : '—');
      top.push('<span class="tg-l">' + { m6: '6모', m9: '9모', sn: '수능' }[e[0]] + '</span> <b class="tg' + (x.g == null ? ' none' : '') + '"' + (x.nocut ? ' title="등급컷 비어 있음"' : '') + '>' + gtxt + '</b>');
      raw.push(x.how === 'score' ? x.raw : x.how === 'self' ? '직접' : '—');
    });
    return '<div class="trend-row">' + top.join(' <span class="tg-a">→</span> ') + ' ' + deltaHtml(p.g, gradeOf(r, 'sn').g) + '</div>' +
      '<div class="trend-raw">' + raw.join(' · ') + (r.subject ? ' <span class="subj">' + SUBJ_S[r.subject] + '</span>' : '') + '</div>';
  }
  function textCell(r) {
    var h = r.review ? '<div class="rv-full">' + esc(r.review) + laterTag(r.review_added_at) + '</div>' : '<span class="muted small">후기 없음</span>';
    if (r.message) h += '<div class="msg-full"><span class="msg-lab">한마디</span>' + esc(r.message) + laterTag(r.message_added_at) + '</div>';
    return h;
  }
  // 제출 뒤 「기프티콘 확인」 화면에서 나중에 남긴 글
  function laterTag(t) {
    return t ? ' <span class="later-tag" title="' + esc(new Date(t).toLocaleString('ko-KR')) + '">나중에 추가</span>' : '';
  }
  function scoreCount(r) {
    var n = 0;
    EXAMS.forEach(function (e) { if (gradeOf(r, e[0]).how) n++; });
    return n;
  }

  /* ---------- 배지 ---------- */
  function badges(r) {
    var out = [], warn = false;
    var key = nk(r.name), ph = digits(r.phone);
    var same = D.roster.filter(function (x) { return x.name_key === key; });
    var exact = ph ? same.filter(function (x) { return x.phone === ph; }) : [];
    var roster;
    if (exact.length) {
      var chk = exact.some(function (x) { return x.status !== '정상'; });
      roster = chk ? 'chk' : 'ok';
      out.push(chk ? '<span class="badge b-chk">명단 ✓(번호 확인 필요)</span>' : '<span class="badge b-ok">명단 ✓</span>');
    } else {
      roster = 'no';
      out.push('<span class="badge b-no">명단에 없음</span>');
      if (same.length && ph) { out.push('<span class="badge b-warn">⚠ 번호 다름</span>'); warn = true; }
    }
    var dupe = D.responses.some(function (o) { return o.id !== r.id && o.status === 'approved' && nk(o.name) === key; });
    if (dupe) { out.push('<span class="badge b-warn">⚠ 이미 받음 의심 (같은 이름)</span>'); warn = true; }
    return { html: out.join(''), warn: warn, roster: roster };
  }

  /* ---------- 기프티콘 재고 ---------- */
  function stock() {
    var live = D.gifts.filter(function (g) { return !g.retired || g.response_id; });
    var given = D.gifts.filter(function (g) { return g.response_id; }).length;
    var left = D.gifts.filter(function (g) { return !g.response_id && !g.retired; }).length;
    return { total: live.length, left: left, given: given };
  }
  function giftOf(rid) { for (var i = 0; i < D.gifts.length; i++) if (D.gifts[i].response_id === rid) return D.gifts[i]; return null; }

  function render() {
    if (!D) return;
    var v = $('view');
    ({ approve: vApprove, stats: vStats, reviews: vReviews, messages: vMessages, gifts: vGifts, roster: vRoster, cuts: vCuts, settings: vSettings })[tab](v);
  }

  /* ============ 승인 ============ */
  function surveyUrl() {
    if (D.settings.survey_url) return D.settings.survey_url;
    return location.origin + location.pathname.replace(/admin\.html.*$/, '');
  }
  function smsText() {
    return '[마라톤국어] 설문 감사해요! 「기프티콘 확인」을 눌러 받아 가세요 ' + surveyUrl().replace(/\/$/, '') + '/#gift';
  }
  function vApprove(v) {
    var s = stock();
    var all = D.responses.slice().sort(function (a, b) { return b.id - a.id; });
    var cnt = { pending: 0, approved: 0, rejected: 0 };
    all.forEach(function (r) { cnt[r.status]++; });
    var list = UI.list === 'all' ? all : all.filter(function (r) { return r.status === UI.list; });
    var bulk = all.filter(function (r) { if (r.status !== 'pending') return false; var b = badges(r); return b.roster === 'ok' && !b.warn; });
    var unnotified = all.filter(function (r) { return r.status === 'approved' && !r.notified_at && r.phone; });
    var paidPhones = all.filter(function (r) { return r.status === 'approved' && r.phone && giftOf(r.id); }).length;

    var h = '';
    h += '<div class="cards">' +
      card('승인 대기', cnt.pending, '명') + card('승인', cnt.approved, '명') + card('반려', cnt.rejected, '명') +
      card('기프티콘 남음', s.left, '장', '전체 ' + s.total + ' · 지급됨 ' + s.given, s.left === 0) + '</div>';
    if (s.left === 0) h += '<div class="stockout">기프티콘 재고 없음 — 「기프티콘」 탭에서 이미지를 올려 주세요.</div>';
    h += '<div class="panel"><div class="toolbar">' +
      '<div class="chips">' + [['pending', '승인 대기 ' + cnt.pending], ['approved', '승인 ' + cnt.approved], ['rejected', '반려 ' + cnt.rejected], ['all', '전체 ' + all.length]].map(function (x) {
        return '<button class="mini' + (UI.list === x[0] ? ' on' : '') + '" data-list="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div><span class="sp"></span>' +
      '<button class="mini red" id="bulk"' + (bulk.length && s.left ? '' : ' disabled') + ' title="⚠ 없고 「명단 ✓」인 대기 줄만 (번호 확인 필요 줄은 빼고)">일괄 승인 ' + bulk.length + '명</button>' +
      '<button class="mini" id="smsx"' + (unnotified.length ? '' : ' disabled') + '>승인자 문자용 엑셀 ' + unnotified.length + '명</button>' +
      '<button class="mini danger" id="delph"' + (paidPhones ? '' : ' disabled') + '>지급 완료 번호 일괄 삭제</button>' +
      '</div>';
    var sl = smsText().length;
    h += '<p class="small muted" style="margin:-4px 0 12px">문자 안내 문구(<b style="color:' + (sl > 90 ? 'var(--red)' : 'inherit') + '">' + sl + '자' + (sl > 90 ? ' · 90자 넘음 — 설정에서 짧은 주소로 바꿔 주세요' : '') + '</b>): ' + esc(smsText()) + '</p>';
    h += '<div class="toolbar"><input id="qname" class="qname" type="search" placeholder="이름 검색" value="' + esc(UI.q || '') + '"><span class="small muted" id="qcount"></span><span class="sp"></span>' +
      '<button class="mini deep" id="storybulk"' + ((UI.sel || []).length ? '' : ' disabled') + '>선택한 학생 스토리 한꺼번에 받기 <b id="selcnt">' + (UI.sel || []).length + '</b>명</button>' +
      '<span class="small muted">스토리 CASE 마지막 번호 <b id="caselast">' + caseLast() + '</b></span><button class="mini" id="casereset">번호 초기화</button></div>';
    UI.detailIds = list.map(function (r) { return r.id; });
    if (!list.length) h += '<p class="muted">해당하는 응답이 없습니다.</p>';
    else {
      h += '<div class="wrap"><table class="t resp"><thead><tr><th>이름</th><th>번호</th><th>강의</th><th>점수 추이</th><th>만족도</th><th>후기</th><th>제출</th><th>확인</th><th></th></tr></thead><tbody>';
      list.forEach(function (r) {
        var b = badges(r), g = giftOf(r.id), act = '';
        if (r.status === 'pending') {
          act = '<button class="mini red" data-ap="' + r.id + '" data-warn="' + (b.warn ? 1 : 0) + '"' + (s.left ? '' : ' disabled title="기프티콘 재고 없음"') + '>승인</button> ' +
            '<button class="mini" data-rj="' + r.id + '">반려</button>';
        } else if (r.status === 'rejected') {
          act = '<span class="badge b-st-rejected">반려</span> <button class="mini" data-pd="' + r.id + '">대기로</button>';
        } else {
          act = '<span class="badge b-st-approved">승인 · ' + esc(g ? g.label || ('#' + g.id) : '') + '</span><br>' + smsLine(r, true);
        }
        h += '<tr data-name="' + esc(nk(r.name)) + '"' + (r.status === 'rejected' ? ' class="dim"' : '') + '>' +
          '<td class="nowrap c-name" data-l="이름">' + selBox(r) + '<button class="nm-link" data-detail="' + r.id + '" title="상세 보기">' + esc(r.name) + '</button></td>' +
          '<td class="num" data-l="번호">' + (r.phone ? fmtPhone(r.phone) : '<span class="muted">삭제됨</span>') + '</td>' +
          '<td class="nowrap" data-l="강의">' + (r.courses || []).map(function (c) { return COURSE[c] || c; }).join('·') + '</td>' +
          '<td class="nowrap" data-l="점수 추이">' + trendCell(r) + '</td>' +
          '<td class="num" data-l="만족도">' + (r.satisfaction ? r.satisfaction + '점' : '-') + '</td>' +
          '<td class="rvcell" data-l="후기">' + textCell(r) + '</td>' +
          '<td class="num" data-l="제출">' + fmtTime(r.created_at) + '</td>' +
          '<td data-l="확인">' + b.html + '</td><td class="nowrap c-act">' + act + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    v.innerHTML = h;

    v.querySelectorAll('[data-list]').forEach(function (b) { b.onclick = function () { UI.list = b.getAttribute('data-list'); render(); }; });
    bindActs(v);
    v.querySelectorAll('[data-detail]').forEach(function (b) { b.onclick = function () { openDetail(Number(b.getAttribute('data-detail'))); }; });
    var q = $('qname');
    q.oninput = function () { UI.q = q.value; applySearch(); };
    applySearch();
    $('bulk').onclick = function () {
      if (!confirm('⚠ 없고 「명단 ✓」인 ' + bulk.length + '명을 한 번에 승인할까요?\n(기프티콘 ' + Math.min(bulk.length, s.left) + '장 배정)')) return;
      approve(bulk.map(function (r) { return r.id; }));
    };
    $('smsx').onclick = function () { smsExcel(unnotified); };
    $('storybulk').onclick = storyBulk;
    $('casereset').onclick = function () { if (!confirm('스토리 CASE 번호를 처음(01)부터 다시 쓸까요?')) return; caseSet(0); $('caselast').textContent = '0'; toast('CASE 번호를 초기화했습니다'); };
    v.querySelectorAll('[data-sel]').forEach(function (c) {
      c.onchange = function () {
        var id = Number(c.getAttribute('data-sel')); UI.sel = (UI.sel || []).filter(function (x) { return x !== id; });
        if (c.checked) UI.sel.push(id);
        selRefresh(v);
      };
    });
    $('delph').onclick = function () {
      if (!confirm('삭제하면 학생이 기프티콘을 다시 볼 수 없습니다. 이벤트가 끝난 뒤에 누르세요.\n\n지급 완료된 ' + paidPhones + '명의 휴대폰 번호를 지울까요? (성적·만족도·후기·한마디는 남습니다)')) return;
      rpc('survey_admin_delete_phones', { p_token: token }).then(function (d) { toast('번호 ' + d.changed + '개를 지웠습니다'); load(); }).catch(err);
    };
  }
  // 승인 · 반려 · 대기로 버튼 (표와 상세 패널 공통 · ⚠ 확인 창 규칙 같음)
  function bindActs(root) {
    root.querySelectorAll('[data-ap]').forEach(function (b) {
      b.onclick = function () {
        if (b.getAttribute('data-warn') === '1' && !confirm(WARN_MSG)) return;
        approve([Number(b.getAttribute('data-ap'))]);
      };
    });
    root.querySelectorAll('[data-rj]').forEach(function (b) { b.onclick = function () { setStatus([Number(b.getAttribute('data-rj'))], 'rejected'); }; });
    root.querySelectorAll('[data-pd]').forEach(function (b) { b.onclick = function () { setStatus([Number(b.getAttribute('data-pd'))], 'pending'); }; });
    root.querySelectorAll('[data-story]').forEach(function (b) { b.onclick = function () { b.disabled = true; Promise.resolve(storyOne(Number(b.getAttribute('data-story')))).then(function () { b.disabled = false; }); }; });
    root.querySelectorAll('[data-sr]').forEach(function (b) { b.onclick = function () { b.disabled = true; smsSend([Number(b.getAttribute('data-sr'))]); }; });
  }
  function qMatch(r) { var q = nk(UI.q || ''); return !q || nk(r.name).indexOf(q) >= 0; }
  function applySearch() {
    var q = nk(UI.q || ''), n = 0, rows = document.querySelectorAll('table.resp tbody tr');
    rows.forEach(function (tr) { var ok = !q || tr.getAttribute('data-name').indexOf(q) >= 0; tr.hidden = !ok; if (ok) n++; });
    var c = $('qcount'); if (c) c.textContent = q ? n + '명' : '';
  }
  function visibleIds() {
    return (UI.detailIds || []).filter(function (id) { var r = respById(id); return r && qMatch(r); });
  }
  function respById(id) { for (var i = 0; i < D.responses.length; i++) if (D.responses[i].id === id) return D.responses[i]; return null; }

  /* ---------- 학생별 상세 패널 ---------- */
  var ST_KO = { pending: '승인 대기', approved: '승인', rejected: '반려' };
  function openDetail(id) { UI.detail = id; renderDetail(); }
  function closeDetail() { UI.detail = null; $('detail').hidden = true; document.body.classList.remove('detail-open'); }
  function spark(r) {
    // 등급 1(위) ~ 9(아래), 점 4개: 수강 전 · 6모 · 9모 · 수능 (없는 시험은 비움)
    var W = 280, H = 110, px = [34, 114, 194, 262], y = function (g) { return 12 + (g - 1) * (H - 30) / 8; };
    var gs = [preOf(r).g].concat(EXAMS.map(function (e) { return gradeOf(r, e[0]).g; }));
    var pts = gs.map(function (g, i) { return g == null ? null : [px[i], y(g), g]; });
    var s = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="등급 추이">';
    [1, 5, 9].forEach(function (g) { s += '<line x1="18" x2="' + (W - 8) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#EFEAE4"/><text x="0" y="' + (y(g) + 4) + '" font-size="10" fill="#9A948C">' + g + '</text>'; });
    var seg = pts.filter(Boolean);
    if (seg.length > 1) s += '<polyline fill="none" stroke="#A8151C" stroke-width="2.5" points="' + seg.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '"/>';
    pts.forEach(function (p, i) {
      if (p) s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5" fill="#A8151C"/><text x="' + p[0] + '" y="' + (p[1] - 9) + '" font-size="12" font-weight="700" text-anchor="middle" fill="#2C2C2C">' + p[2] + '</text>';
      s += '<text x="' + px[i] + '" y="' + (H - 2) + '" font-size="11" text-anchor="middle" fill="#6E675E">' + ['수강 전', '6모', '9모', '수능'][i] + (p ? '' : ' —') + '</text>';
    });
    return s + '</svg>';
  }
  function examLine(r, e) {
    var x = gradeOf(r, e[0]), st = r[e[0] + '_status'];
    if (x.how === 'score') return x.raw + '점 → ' + (x.g ? x.g + '등급' : '컷 없음') + ' <span class="how">점수 환산</span>';
    if (x.how === 'self') return x.g + '등급 <span class="how">직접 입력</span>';
    return '<span class="muted">' + (st === 'none' ? '응시 안 함' : st === 'forgot' ? '기억 안 남' : '입력 없음') + '</span>';
  }
  function preLine(r) {
    var p = preOf(r);
    if (p.how === 'self') return p.g + '등급 <span class="how">직접 입력</span>' + (p.raw != null ? ' · 원점수 ' + p.raw + '점' : '');
    var why = r.pre_status === 'forgot' ? '기억 안 남' : '입력 없음(예전 화면)';
    if (p.how === 'fallback') return p.g + '등급 <span class="how">6·9모 중 낮은 쪽 · ' + why + '</span>';
    return '<span class="muted">' + why + '</span>';
  }
  function renderDetail() {
    var r = respById(UI.detail), el = $('detail');
    if (!r) return closeDetail();
    var ids = visibleIds(), i = ids.indexOf(r.id), b = badges(r), g = giftOf(r.id), s = stock();
    var rosterRows = D.roster.filter(function (x) { return x.name_key === nk(r.name); });
    var act = r.status === 'pending'
      ? '<button class="mini red" data-ap="' + r.id + '" data-warn="' + (b.warn ? 1 : 0) + '"' + (s.left ? '' : ' disabled title="기프티콘 재고 없음"') + '>승인</button> <button class="mini" data-rj="' + r.id + '">반려</button>' + (s.left ? '' : ' <span class="small" style="color:var(--red)">기프티콘 재고 없음</span>')
      : r.status === 'rejected' ? '<button class="mini" data-pd="' + r.id + '">대기로</button>' : '';
    var row = function (k, v) { return '<div class="dr"><span class="dk">' + k + '</span><span class="dv">' + v + '</span></div>'; };
    var h = '<div class="dh"><button class="mini" data-dnav="prev"' + (i > 0 ? '' : ' disabled') + '>← 이전 학생</button>' +
      '<span class="small muted">' + (i >= 0 ? (i + 1) + ' / ' + ids.length : '') + '</span>' +
      '<button class="mini" data-dnav="next"' + (i >= 0 && i < ids.length - 1 ? '' : ' disabled') + '>다음 학생 →</button>' +
      '<button class="mini dclose" data-dclose aria-label="닫기">✕</button></div>';
    h += '<div class="dtitle"><b>' + esc(r.name) + '</b> <span class="badge b-st-' + r.status + '">' + ST_KO[r.status] + '</span></div>';
    h += '<div class="dact">' + act + (act ? ' ' : '') + storyBtn(r) + '</div>';
    h += '<section><h4>기본</h4>' + row('번호', r.phone ? fmtPhone(r.phone) : '<span class="muted">삭제됨</span>') + row('제출', r.created_at ? new Date(r.created_at).toLocaleString('ko-KR') : '') +
      row('강의', (r.courses || []).map(function (c) { return COURSE[c] || c; }).join(' · ') || '-') + row('시작', START[r.start_when] || '-') + row('과목', SUBJ[r.subject] || '-') + '</section>';
    h += '<section><h4>성적</h4>' + row('수강 전', preLine(r)) + EXAMS.map(function (e) { return row(e[1], examLine(r, e)); }).join('') +
      '<div class="dspark">' + spark(r) + '</div>' + '<div class="dtrend">' + trendCell(r) + '</div></section>';
    h += '<section><h4>만족도 · 도움된 부분</h4>' + row('만족도', r.satisfaction ? r.satisfaction + '점 / 5' : '-') +
      row('도움', (r.helpful || []).length ? (r.helpful || []).map(function (x) { return '<span class="badge b-no">' + esc(x) + '</span>'; }).join(' ') : '-') + '</section>';
    h += '<section><h4>수강 후기' + laterTag(r.review_added_at) + '</h4><div class="dtext">' + (r.review ? esc(r.review) : '<span class="muted">없음</span>') + '</div></section>';
    h += '<section><h4>종현샘께 한마디' + laterTag(r.message_added_at) + '</h4><div class="dtext">' + (r.message ? esc(r.message) : '<span class="muted">없음</span>') + '</div></section>';
    h += '<section><h4>명단 대조</h4><div>' + b.html + '</div>' +
      (rosterRows.length ? rosterRows.map(function (x) {
        return '<div class="droster"><b>' + esc(x.name) + '</b> ' + esc(fmtPhone(x.phone)) + ' <span class="badge ' + (x.status === '정상' ? 'b-ok' : 'b-chk') + '">' + esc(x.status) + '</span>' +
          (x.note ? '<div class="small muted">' + esc(x.note) + '</div>' : '') + '</div>';
      }).join('') : '<p class="small muted">명단에 같은 이름 없음</p>') + '</section>';
    h += '<section><h4>기프티콘</h4>' +
      row('지급', g ? '지급됨 · ' + esc(g.label || '#' + g.id) + ' · ' + (g.assigned_at ? new Date(g.assigned_at).toLocaleString('ko-KR') : '') : '<span class="muted">아직 지급 안 함</span>') +
      row('문자 안내', r.status === 'approved' ? smsLine(r, false) : '<span class="muted">안 함</span>') + '</section>';
    el.innerHTML = '<div class="dpanel">' + h + '</div>';
    el.hidden = false; document.body.classList.add('detail-open');
    el.querySelector('.dpanel').scrollTop = 0;
    bindActs(el);
    el.querySelectorAll('[data-dnav]').forEach(function (bt) {
      bt.onclick = function () { var j = i + (bt.getAttribute('data-dnav') === 'next' ? 1 : -1); if (ids[j] != null) openDetail(ids[j]); };
    });
    el.querySelector('[data-dclose]').onclick = closeDetail;
  }
  document.addEventListener('keydown', function (e) {
    if (UI.detail == null || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') closeDetail();
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { var b = document.querySelector('[data-dnav="next"]'); if (b && !b.disabled) b.click(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { var c = document.querySelector('[data-dnav="prev"]'); if (c && !c.disabled) c.click(); }
  });

  function card(k, v, unit, sub, red) {
    return '<div class="card"><div class="k">' + k + '</div><div class="v' + (red ? ' red' : '') + '">' + v + '<small style="font-size:15px;font-weight:600"> ' + (unit || '') + '</small></div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }
  function err(e) { toast('오류: ' + (e && e.message || e)); }
  function approve(ids) {
    rpc('survey_admin_approve', { p_token: token, p_ids: ids }).then(function (d) {
      toast('승인 ' + d.approved + '명' + (d.no_stock ? ' · 재고 없어 못 한 ' + d.no_stock + '명' : '') + (d.sms ? ' · 문자 ' + d.sms + '통 보내는 중' : ''));
      return load();
    }).catch(err);
  }
  /* ---------- 승인 안내 문자 (솔라피 · 서버에서 보냄) ---------- */
  function smsOn() { return D && D.settings && D.settings.sms_auto !== undefined; }   // 추가_승인문자.sql 설치됨
  function smsLine(r, short) {
    var when = function (x) { return short ? fmtTime(x) : new Date(x).toLocaleString('ko-KR'); };
    var again = '<button class="mini" data-sr="' + r.id + '">다시 보내기</button>';
    if (r.sms_status === 'sent') return '<span class="small muted">문자 안내 완료 ' + when(r.sms_sent_at || r.notified_at) + '</span>';
    if (r.sms_status === 'sending') return '<span class="small" style="color:var(--warn)">문자 보내는 중…</span>';
    if (r.sms_status === 'failed') return '<span class="badge b-warn" title="' + esc(r.sms_error || '') + '">문자 실패</span>' + (short ? '<br>' : ' ') + again +
      (short ? '' : '<div class="small muted">' + esc(r.sms_error || '') + '</div>') +
      (r.notified_at ? (short ? '<br>' : '') + '<span class="small muted">문자 안내 완료(엑셀) ' + when(r.notified_at) + '</span>' : '');
    var base = r.notified_at ? '<span class="small muted">문자 안내 완료 ' + when(r.notified_at) + '</span>' : '<span class="small" style="color:var(--warn)">문자 안내 전</span>';
    return base + (smsOn() && D.settings.sms_ready && r.phone ? ' <button class="mini" data-sr="' + r.id + '">문자 보내기</button>' : '');
  }
  function smsSend(ids) {
    return rpc('survey_admin_sms_send', { p_token: token, p_ids: ids }).then(function (d) {
      toast(d.queued ? '문자 ' + d.queued + '통 보내는 중' : '문자를 보내지 못했습니다'); return load();
    }).catch(err);
  }
  function smsPoll() {
    clearTimeout(smsPoll.t);
    var busy = D && D.responses.some(function (r) { return r.sms_status === 'sending'; });
    if (busy && (smsPoll.n = (smsPoll.n || 0) + 1) <= 20) smsPoll.t = setTimeout(load, 3000); else if (!busy) smsPoll.n = 0;
  }
  function setStatus(ids, st) {
    rpc('survey_admin_set_status', { p_token: token, p_ids: ids, p_status: st }).then(function () { toast(st === 'rejected' ? '반려했습니다' : '대기로 돌렸습니다'); return load(); }).catch(err);
  }
  function smsExcel(rows) {
    var text = smsText();
    var aoa = [['이름', '휴대폰', '안내 문구']].concat(rows.map(function (r) { return [r.name, fmtPhone(r.phone), text]; }));
    var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 90 }];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '문자');
    XLSX.writeFile(wb, '승인자_문자_' + stamp() + '.xlsx');
    rpc('survey_admin_mark_notified', { p_token: token, p_ids: rows.map(function (r) { return r.id; }) })
      .then(function (d) { toast(d.changed + '명을 「문자 안내 완료」로 표시했습니다'); return load(); }).catch(err);
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }

  /* ============ 인스타 스토리 이미지 (학생 1명 = CASE 1장, 1080×1920 PNG) ============
     휴대폰 번호 · 「종현샘께 한마디」는 절대 쓰지 않는다. */
  var STORY_W = 1080, STORY_H = 1920, FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';
  var CASE_KEY = 'survey_story_case';
  function caseLast() { return Number(localStorage.getItem(CASE_KEY) || 0) || 0; }
  function caseSet(n) { localStorage.setItem(CASE_KEY, String(n)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function maskO(name) { name = nk(name); return name ? name[0] + 'O'.repeat(Math.max(name.length - 1, 2)) : ''; }
  function hasReview(r) { return !!(r.review && String(r.review).trim()); }
  // 출발점: 학생이 고른 수강 전 등급. 없으면 6·9모 중 낮은 쪽(그 시험 이름으로 표시)
  function storyInfo(r) {
    var p = preOf(r), m6 = gradeOf(r, 'm6').g, m9 = gradeOf(r, 'm9').g, sn = gradeOf(r, 'sn').g;
    var startL = '수강 전';
    if (p.how === 'fallback') startL = (m9 == null || (m6 != null && m6 >= m9)) ? '6모' : '9모';
    var pts = [];
    if (p.how === 'self') pts.push({ l: '수강 전', g: p.g });
    if (m6 != null) pts.push({ l: '6모', g: m6 });
    if (m9 != null) pts.push({ l: '9모', g: m9 });
    if (sn != null) pts.push({ l: '수능', g: sn });
    return { start: p.g, startL: startL, sn: sn, pts: pts, up: p.g != null && sn != null && sn < p.g ? p.g - sn : 0 };
  }
  function storyFile(r, no) {
    var s = storyInfo(r);
    var g = (s.start != null ? s.startL.replace(/\s/g, '') + s.start : '') + (s.sn != null ? (s.start != null ? '→' : '') + '수능' + s.sn : '');
    return 'CASE' + pad2(no) + '_' + maskO(r.name) + (g ? '_' + g : '') + '.png';
  }
  // keep-all 줄바꿈: 띄어쓰기에서만 자르고, 한 낱말이 한 줄보다 길 때만 글자 단위로
  function wrapText(ctx, text, maxW) {
    var lines = [];
    String(text).replace(/\r/g, '').split('\n').forEach(function (para) {
      var words = para.split(/ +/).filter(function (w) { return w !== ''; }), cur = '';
      if (!words.length) { lines.push(''); return; }
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW) { cur = t; return; }
        if (cur) lines.push(cur);
        cur = '';
        while (ctx.measureText(w).width > maxW) {
          var i = 1; while (i < w.length && ctx.measureText(w.slice(0, i + 1)).width <= maxW) i++;
          lines.push(w.slice(0, i)); w = w.slice(i);
        }
        cur = w;
      });
      lines.push(cur);
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  // 상자에 맞춰 글자 크기 자동 축소, 최소 크기에서도 넘치면 끝을 「…」
  function fitText(ctx, text, maxW, maxH, big, small, weight, lh) {
    var fs, ls;
    for (fs = big; fs >= small; fs -= 2) {
      ctx.font = weight + ' ' + fs + 'px ' + FONT;
      ls = wrapText(ctx, text, maxW);
      if (ls.length * fs * lh <= maxH) return { fs: fs, lines: ls, cut: false };
    }
    fs = small; ctx.font = weight + ' ' + fs + 'px ' + FONT;
    ls = wrapText(ctx, text, maxW);
    var n = Math.max(1, Math.floor(maxH / (fs * lh))), keep = ls.slice(0, n), last = keep[n - 1] || '';
    while (last && ctx.measureText(last + '…”').width > maxW) last = last.slice(0, -1);
    keep[n - 1] = last.replace(/\s+$/, '') + '…”';
    return { fs: fs, lines: keep, cut: true };
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function runsWidth(ctx, runs) { return runs.reduce(function (s, r) { ctx.font = r.f; return s + ctx.measureText(r.t).width; }, 0); }
  // 여러 색 조각을 한 줄로 (가운데 정렬)
  function drawRuns(ctx, runs, cx, y) {
    var x = cx - runsWidth(ctx, runs) / 2;
    ctx.textAlign = 'left';
    runs.forEach(function (r) { ctx.font = r.f; ctx.fillStyle = r.c; ctx.fillText(r.t, x, y); x += ctx.measureText(r.t).width; });
  }
  function storyLoadFonts(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([500, 600, 700, 800].map(function (w) { return document.fonts.load(w + ' 40px "Pretendard Variable"', text); }))
      .then(function () { return document.fonts.ready; }).catch(function () {});
  }
  function drawStory(r, no) {
    var s = storyInfo(r), W = STORY_W, H = STORY_H, M = 90;
    var RED = '#A8151C', DEEP = '#7A0C12', INK = '#2C2C2C', MUTED = '#6E675E', OK = '#1F7A4A', LINE = '#E3DDD4';
    var title = '2027 수능 · 마라톤 CASE ' + pad2(no);
    var who = mask(nk(r.name)) + ' 학생 · ' + ((r.courses || []).map(function (c) { return COURSE[c] || c; }).join('/') || '강의') + (r.subject ? ' · ' + SUBJ_S[r.subject] : '');
    var review = '“' + String(r.review || '').trim() + '”';
    return storyLoadFonts(title + who + review + '수강 전등급→수능6모9모▲상승가채점기준마라톤스터디0123456789…').then(function () {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d'); ctx.textBaseline = 'alphabetic';
      // 바탕
      ctx.fillStyle = '#FAF8F5'; ctx.fillRect(0, 0, W, H);
      var gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, DEEP); gr.addColorStop(1, RED);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, 24);
      // 제목 · 학생
      ctx.textAlign = 'center';
      ctx.font = '800 50px ' + FONT; ctx.fillStyle = DEEP; ctx.fillText(title, W / 2, 150);
      ctx.font = '600 40px ' + FONT; ctx.fillStyle = MUTED; ctx.fillText(who, W / 2, 222, W - 2 * M);
      ctx.fillStyle = LINE; ctx.fillRect(M, 270, W - 2 * M, 3);
      // 큰 글씨: 수강 전 N등급 → 수능 M등급 (너비에 맞춰 줄임)
      var runs = function (fs) {
        var a = [], b = '800 ' + fs + 'px ' + FONT, l = '700 ' + Math.round(fs * 0.62) + 'px ' + FONT;
        if (s.start != null) { a.push({ t: s.startL + ' ', f: l, c: INK }); a.push({ t: s.start + '등급', f: b, c: s.sn != null ? MUTED : RED }); }
        if (s.start != null && s.sn != null) a.push({ t: '  →  ', f: l, c: MUTED });
        if (s.sn != null) { a.push({ t: '수능 ', f: l, c: INK }); a.push({ t: s.sn + '등급', f: b, c: RED }); }
        return a;
      };
      var hf = 120;
      while (hf > 56 && runsWidth(ctx, runs(hf)) > W - 2 * M) hf -= 4;
      drawRuns(ctx, runs(hf), W / 2, 420);
      if (s.up) {
        var y = 470;
        ctx.font = '800 44px ' + FONT; var pt = '▲ ' + s.up + '등급 상승', pw = ctx.measureText(pt).width + 64;
        ctx.fillStyle = '#E3F2E9'; rrect(ctx, (W - pw) / 2, y, pw, 76, 38); ctx.fill();
        ctx.fillStyle = OK; ctx.textAlign = 'center'; ctx.fillText(pt, W / 2, y + 54);
      }
      // 등급 그래프 (1등급이 위)
      var gx = M, gy = 590, gw = W - 2 * M, gh = 430;
      ctx.fillStyle = '#fff'; rrect(ctx, gx, gy, gw, gh, 36); ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke();
      if (s.pts.length) {
        var gs = s.pts.map(function (p) { return p.g; }), lo = Math.max(1, Math.min.apply(null, gs) - 1), hi = Math.min(9, Math.max.apply(null, gs) + 1);
        if (hi - lo < 2) { if (lo > 1) lo--; else hi = Math.min(9, hi + 1); }
        var px0 = gx + 190, px1 = gx + gw - 90, py0 = gy + 90, py1 = gy + gh - 120;
        var X = function (i) { return s.pts.length === 1 ? (px0 + px1) / 2 : px0 + (px1 - px0) * i / (s.pts.length - 1); };
        var Y = function (g) { return py0 + (py1 - py0) * (g - lo) / (hi - lo); };
        ctx.font = '600 28px ' + FONT; ctx.textAlign = 'right';
        for (var g = lo; g <= hi; g++) {
          ctx.strokeStyle = '#EFEAE4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px0 - 50, Y(g)); ctx.lineTo(px1 + 50, Y(g)); ctx.stroke();
          ctx.fillStyle = '#A39C92'; ctx.fillText(g + '등급', px0 - 66, Y(g) + 10);
        }
        ctx.strokeStyle = RED; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.beginPath();
        s.pts.forEach(function (p, i) { if (i) ctx.lineTo(X(i), Y(p.g)); else ctx.moveTo(X(i), Y(p.g)); }); ctx.stroke();
        ctx.textAlign = 'center';
        s.pts.forEach(function (p, i) {
          var last = i === s.pts.length - 1;
          ctx.beginPath(); ctx.arc(X(i), Y(p.g), last ? 20 : 15, 0, Math.PI * 2); ctx.fillStyle = last ? RED : '#fff'; ctx.fill();
          ctx.lineWidth = 6; ctx.strokeStyle = RED; ctx.stroke();
          ctx.font = '800 36px ' + FONT; ctx.fillStyle = last ? RED : INK; ctx.fillText(p.g + '등급', X(i), Y(p.g) - 36);
          ctx.font = '700 32px ' + FONT; ctx.fillStyle = MUTED; ctx.fillText(p.l, X(i), gy + gh - 42);
        });
      }
      // 후기 전문
      var bx = M, by = 1070, bw = W - 2 * M, bh = 660;
      ctx.fillStyle = '#fff'; rrect(ctx, bx, by, bw, bh, 36); ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = RED; ctx.fillRect(bx, by + 60, 10, bh - 120);
      var tx = bx + 70, tw = bw - 130, ty = by + 70, th = bh - 140, lh = 1.55;
      var ft = fitText(ctx, review, tw, th, 64, 34, '700', lh);
      ctx.font = '700 ' + ft.fs + 'px ' + FONT; ctx.fillStyle = INK; ctx.textAlign = 'left';
      var top = ty + (th - ft.lines.length * ft.fs * lh) / 2;
      ft.lines.forEach(function (ln, i) { ctx.fillText(ln, tx, top + ft.fs * (i * lh + 1.12)); });
      // 맨 아래
      ctx.font = '600 30px ' + FONT; ctx.fillStyle = '#A39C92'; ctx.fillText('수능은 가채점 기준', M, 1840);
      ctx.textAlign = 'right'; ctx.font = '800 36px ' + FONT; ctx.fillStyle = RED; ctx.fillText('마라톤 스터디', W - M, 1842);
      var meta = { fit: { fs: ft.fs, lines: ft.lines.length, cut: ft.cut }, headFont: hf, headWidth: runsWidth(ctx, runs(hf)), whoWidth: (ctx.font = '600 40px ' + FONT, ctx.measureText(who).width) };
      return new Promise(function (res) { cv.toBlob(function (b) { res({ blob: b, fit: ft, meta: meta }); }, 'image/png'); });
    });
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  // 압축 없는 zip (UTF-8 파일명)
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {   // [{name, data: Uint8Array}]
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    var d = new Date(), dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + f.data.length;
    });
    var csize = central.reduce(function (s, x) { return s + x.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  function storyOne(id) {
    var r = respById(id); if (!r || !hasReview(r)) return;
    var no = caseLast() + 1;
    return drawStory(r, no).then(function (o) {
      caseSet(no); saveBlob(o.blob, storyFile(r, no));
      toast('CASE ' + pad2(no) + ' 스토리 이미지를 받았습니다' + (o.fit.cut ? ' · 후기가 길어 끝을 줄였습니다' : ''));
      render(); if (UI.detail != null) renderDetail();
    }).catch(err);
  }
  function storyBulk() {
    var ids = (UI.sel || []).filter(function (id) { var r = respById(id); return r && hasReview(r); });
    if (!ids.length) return;
    var files = [], cut = 0, i = 0;
    toast('스토리 이미지 ' + ids.length + '장 만드는 중…');
    (function next() {
      if (i >= ids.length) {
        caseSet(Math.max(caseLast(), ids.length));
        saveBlob(makeZip(files), '스토리_CASE01-' + pad2(ids.length) + '_' + stamp() + '.zip');
        toast('스토리 이미지 ' + files.length + '장을 zip 으로 받았습니다' + (cut ? ' · 후기가 길어 끝을 줄인 것 ' + cut + '장' : ''));
        UI.sel = []; render(); return Promise.resolve();
      }
      var r = respById(ids[i]), no = i + 1; i++;
      return drawStory(r, no).then(function (o) {
        if (o.fit.cut) cut++;
        return o.blob.arrayBuffer().then(function (ab) { files.push({ name: storyFile(r, no), data: new Uint8Array(ab) }); });
      }).then(next);
    })().catch(err);
  }
  function storyBtn(r) {
    return hasReview(r) ? '<button class="mini deep" data-story="' + r.id + '">스토리 이미지 받기</button>'
      : '<button class="mini" disabled style="opacity:.45">스토리 이미지 받기</button> <span class="small muted">후기 없음</span>';
  }
  // 목록 체크박스: 체크한 순서 = CASE 번호 순서 (옆에 작게 번호)
  function selBox(r) {
    var i = (UI.sel || []).indexOf(r.id);
    if (!hasReview(r)) return '<label class="sel off" title="후기 없음 — 스토리 이미지를 만들 수 없음"><input type="checkbox" disabled><i>후기 없음</i></label>';
    return '<label class="sel" title="스토리 이미지 고르기"><input type="checkbox" data-sel="' + r.id + '"' + (i >= 0 ? ' checked' : '') + '><i>' + (i >= 0 ? pad2(i + 1) : '') + '</i></label>';
  }
  function selRefresh(v) {
    var sel = UI.sel || [];
    v.querySelectorAll('[data-sel]').forEach(function (c) { var i = sel.indexOf(Number(c.getAttribute('data-sel'))); c.nextElementSibling.textContent = i >= 0 ? pad2(i + 1) : ''; });
    $('selcnt').textContent = sel.length; $('storybulk').disabled = !sel.length;
  }
  window.__story = { draw: drawStory, file: storyFile, info: storyInfo };   // 시험·점검용

  /* ============ 통계 ============ */
  function filtered() {
    return D.responses.filter(function (r) {
      if (!UI.withRejected && r.status === 'rejected') return false;
      if (UI.fCourse !== 'all' && (r.courses || []).indexOf(UI.fCourse) < 0) return false;
      if (UI.fSubj !== 'all' && r.subject !== UI.fSubj) return false;
      if (UI.fStart !== 'all' && r.start_when !== UI.fStart) return false;
      return true;
    });
  }
  var BASE_LABEL = { pre: '수강 전', '9': '9모(없으면 6모)', '6': '6모' };
  function startGrade(r) {
    if (UI.base === 'pre') return preOf(r).g;
    if (UI.base === '6') return gradeOf(r, 'm6').g;
    var g9 = gradeOf(r, 'm9').g;
    return g9 != null ? g9 : gradeOf(r, 'm6').g;
  }
  function chipGroup(key, opts) {
    return opts.map(function (o) { return '<button class="mini' + (UI[key] === o[0] ? ' on' : '') + '" data-f="' + key + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('');
  }
  function vStats(v) {
    var rs = filtered();
    var cnt = { pending: 0, approved: 0, rejected: 0 };
    D.responses.forEach(function (r) { cnt[r.status]++; });
    var sats = rs.map(function (r) { return r.satisfaction; }).filter(function (x) { return x; });
    var moves = [], up = 0, same = 0, down = 0;
    rs.forEach(function (r) {
      var a = startGrade(r), b = gradeOf(r, 'sn').g;
      if (a == null || b == null) return;
      moves.push([a, b]);
      if (b < a) up++; else if (b === a) same++; else down++;
    });
    var mv = moves.length;

    var h = '<div class="panel"><div class="toolbar">' +
      '<span class="lbl">강의</span>' + chipGroup('fCourse', [['all', '전체'], ['online', '온라인'], ['offline', '현장강의']]) +
      '<span class="lbl" style="margin-left:10px">과목</span>' + chipGroup('fSubj', [['all', '전체'], ['hwa', '화작'], ['eon', '언매']]) +
      '<span class="lbl" style="margin-left:10px">시작</span>' + chipGroup('fStart', [['all', '전체'], ['sep_early', '9월 초'], ['sep_mid', '9월 중순'], ['oct', '10월 이후']]) +
      '<span class="sp"></span><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="withrj"' + (UI.withRejected ? ' checked' : '') + '> 반려 포함</label>' +
      '<button class="mini deep" id="xl">엑셀 다운로드</button></div>' +
      '<p class="small muted" style="margin:0">지금 보는 응답 ' + rs.length + '명 ' + (UI.withRejected ? '(반려 포함)' : '(반려 뺌)') + '</p></div>';

    h += '<div class="cards">' +
      card('응답 수', D.responses.length, '명', '승인 ' + cnt.approved + ' · 대기 ' + cnt.pending + ' · 반려 ' + cnt.rejected) +
      card('평균 만족도', sats.length ? avg(sats) : '-', '/ 5', sats.length + '명 기준') +
      card('등급 오른 비율', mv ? pct(up, mv) : '-', '%', mv + '명 기준 · ' + BASE_LABEL[UI.base] + ' → 수능') + '</div>';

    // 등급 변화
    var fb = UI.base === 'pre' ? rs.filter(function (r) { return preOf(r).how === 'fallback' && gradeOf(r, 'sn').g != null; }).length : 0;
    h += '<div class="panel"><h3>등급 변화 <small>' + BASE_LABEL[UI.base] + ' → 수능 가채점</small></h3><div class="toolbar">' +
      '<span class="lbl">출발 성적</span>' + chipGroup('base', [['pre', '수강 전 기준'], ['9', '9모 기준 (없으면 6모)'], ['6', '6모 기준']]) +
      (fb ? '<span class="small muted">수강 전 점수가 없는 ' + fb + '명은 6·9모 중 낮은 쪽으로 셈</span>' : '') + '</div>';
    if (!mv) h += '<p class="muted">두 시험 등급이 모두 있는 응답이 아직 없습니다.</p>';
    else {
      h += '<div class="bars">' + barRow('상승', up, mv, 'ok') + barRow('유지', same, mv, 'gray') + barRow('하락', down, mv, '') + '</div>';
      var M = {}; moves.forEach(function (m) { var k = m[0] + '_' + m[1]; M[k] = (M[k] || 0) + 1; });
      var t = '<div class="wrap" style="margin-top:14px"><table class="mx"><tr><th>출발 \\ 수능</th>';
      for (var j = 1; j <= 9; j++) t += '<th>' + j + '등급</th>';
      t += '</tr>';
      for (var i = 1; i <= 9; i++) {
        var any = false; for (j = 1; j <= 9; j++) if (M[i + '_' + j]) any = true;
        if (!any) continue;
        t += '<tr><th>' + i + '등급</th>';
        for (j = 1; j <= 9; j++) { var n = M[i + '_' + j] || 0; t += '<td class="' + (n ? (j < i ? 'up' : j === i ? 'same' : 'down') : 'z') + '">' + (n || '·') + '</td>'; }
        t += '</tr>';
      }
      h += t + '</table></div>';
      var top = Object.keys(M).map(function (k) { var p = k.split('_'); return [Number(p[0]), Number(p[1]), M[k]]; })
        .sort(function (a, b) { return b[2] - a[2] || a[0] - b[0]; });
      h += '<p class="small" style="margin-top:12px;line-height:1.9">' + top.map(function (x) {
        return '<span class="badge ' + (x[1] < x[0] ? 'b-ok' : x[1] === x[0] ? 'b-no' : 'b-warn') + '">' + x[0] + '등급→' + x[1] + '등급 ' + x[2] + '명</span>';
      }).join(' ') + '</p>';
    }
    h += '</div>';

    // 평균 원점수 추이
    h += '<div class="panel"><h3>평균 원점수 <small>6모 → 9모 → 수능 · 원점수 넣은 응답만</small></h3><div class="trend">';
    ['hwa', 'eon'].forEach(function (sj) {
      if (UI.fSubj !== 'all' && UI.fSubj !== sj) return;
      var sub = rs.filter(function (r) { return r.subject === sj; });
      h += '<div class="box"><b>' + SUBJ[sj] + '</b> <span class="small muted">' + sub.length + '명</span><div class="steps">';
      EXAMS.forEach(function (e, i) {
        var vals = sub.map(function (r) { return r[e[0] + '_raw']; }).filter(function (x) { return x != null; });
        h += (i ? '<div class="arr">→</div>' : '') + '<div class="st"><b>' + (vals.length ? avg(vals) : '-') + '</b><span>' + e[1] + '</span><span>' + vals.length + '명 기준</span></div>';
      });
      h += '</div></div>';
    });
    h += '</div></div>';

    // 만족도 분포 · 도움된 부분
    h += '<div class="trend"><div class="panel"><h3>만족도 <small>' + sats.length + '명</small></h3><div class="bars">';
    for (var s = 5; s >= 1; s--) { var c = sats.filter(function (x) { return x === s; }).length; h += barRow(s + '점', c, sats.length, s >= 4 ? '' : 'gray'); }
    h += '</div></div><div class="panel"><h3>도움된 부분 <small>여러 개 고름 · ' + rs.length + '명</small></h3><div class="bars">';
    var hc = {}; rs.forEach(function (r) { (r.helpful || []).forEach(function (x) { hc[x] = (hc[x] || 0) + 1; }); });
    Object.keys(hc).sort(function (a, b) { return hc[b] - hc[a]; }).forEach(function (k, i) { h += barRow((i + 1) + '. ' + k, hc[k], rs.length, ''); });
    if (!Object.keys(hc).length) h += '<p class="muted">아직 없습니다.</p>';
    h += '</div></div></div>';

    v.innerHTML = h;
    v.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { UI[b.getAttribute('data-f')] = b.getAttribute('data-v'); render(); }; });
    $('withrj').onchange = function () { UI.withRejected = this.checked; render(); };
    $('xl').onclick = exportAll;
  }
  function barRow(label, n, total, cls) {
    var p = pct(n, total);
    return '<div class="row"><span>' + esc(label) + '</span><div class="track"><div class="fill ' + (cls || '') + '" style="width:' + p + '%"></div></div><span class="n">' + n + '명 · ' + p + '%</span></div>';
  }
  function exportAll() {
    var head = ['번호', '이름', '휴대폰', '상태', '강의', '시작 시점', '선택 과목', '수강 전 원점수', '수강 전 등급', '수강 전 등급 방식'];
    EXAMS.forEach(function (e) { head.push(e[1] + ' 원점수', e[1] + ' 등급', e[1] + ' 등급 방식'); });
    head.push('수강 전→수능 변화');
    head = head.concat(['만족도', '도움된 부분', '수강 후기', '종현샘께 한마디', '제출 시각', '승인 시각', '기프티콘', '문자 안내']);
    var ST = { pending: '승인 대기', approved: '승인', rejected: '반려' };
    var rows = D.responses.map(function (r) {
      var row = [r.id, r.name, r.phone ? fmtPhone(r.phone) : '(삭제됨)', ST[r.status], (r.courses || []).map(function (c) { return COURSE[c]; }).join('·'),
        START[r.start_when] || '', SUBJ[r.subject] || ''];
      var p = preOf(r);
      row.push(r.pre_raw != null ? r.pre_raw : (r.pre_status === 'forgot' ? '기억 안 남' : ''), p.g != null ? p.g : '',
        p.how === 'self' ? '직접 입력' : p.how === 'fallback' ? '6·9모 중 낮은 쪽' : '');
      EXAMS.forEach(function (e) {
        var x = gradeOf(r, e[0]), st = r[e[0] + '_status'];
        row.push(r[e[0] + '_raw'] != null ? r[e[0] + '_raw'] : (st === 'none' ? '응시 안 함' : st === 'forgot' ? '기억 안 남' : ''));
        row.push(x.g != null ? x.g : '');
        row.push(x.how === 'score' ? (x.g ? '점수 환산' : '컷 없음') : x.how === 'self' ? '직접 입력' : '');
      });
      var sg = gradeOf(r, 'sn').g;
      row.push(p.g != null && sg != null ? (p.g - sg > 0 ? '▲' + (p.g - sg) : p.g - sg < 0 ? '▼' + (sg - p.g) : '=') : '');
      var g = giftOf(r.id);
      row.push(r.satisfaction || '', (r.helpful || []).join(', '), r.review || '', r.message || '',
        r.created_at ? new Date(r.created_at).toLocaleString('ko-KR') : '', r.approved_at ? new Date(r.approved_at).toLocaleString('ko-KR') : '',
        g ? (g.label || '#' + g.id) : '', r.notified_at ? '완료' : '');
      return row;
    });
    var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '전체 응답');
    var cut = [['시험', '과목', '1', '2', '3', '4', '5', '6', '7', '8']];
    EXAMS.forEach(function (e) { ['hwa', 'eon'].forEach(function (s) { cut.push([e[1], SUBJ[s]].concat((D.settings.cuts[e[0]] || {})[s] || [])); }); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cut), '등급컷');
    XLSX.writeFile(wb, '수능조사_전체응답_' + stamp() + '.xlsx');
  }

  /* ============ 후기 · 한마디 ============ */
  function vReviews(v) {
    var rs = D.responses.filter(function (r) { return r.review && r.status !== 'rejected'; }).sort(function (a, b) { return b.id - a.id; });
    var h = '<div class="panel"><h3>수강 후기 <small>' + rs.length + '개 · 이름을 가려 표시 (설명회용) · 반려 응답 뺌</small></h3>';
    if (!rs.length) h += '<p class="muted">아직 후기가 없습니다.</p>';
    rs.forEach(function (r) {
      h += '<div class="rv"><span class="who">' + esc(mask(r.name)) + '</span><span class="meta">' +
        (r.courses || []).map(function (c) { return COURSE[c]; }).join('·') + (r.subject ? ' · ' + SUBJ_S[r.subject] : '') + (r.satisfaction ? ' · 만족도 ' + r.satisfaction + '점' : '') +
        laterTag(r.review_added_at) + '</span><p>' + esc(r.review) + '</p></div>';
    });
    v.innerHTML = h + '</div>';
  }
  function vMessages(v) {
    var rs = D.responses.filter(function (r) { return r.message; }).sort(function (a, b) { return b.id - a.id; });
    var h = '<div class="panel"><h3>종현샘께 한마디 <small>' + rs.length + '개 · 내부용 (설명회 자료에 쓰지 않음)</small></h3>';
    if (!rs.length) h += '<p class="muted">아직 없습니다.</p>';
    rs.forEach(function (r) {
      var g = gradeOf(r, 'sn');
      h += '<div class="rv"><span class="who">' + esc(r.name) + '</span><span class="meta">' +
        (r.courses || []).map(function (c) { return COURSE[c]; }).join('·') + ' · 수능 가채점 ' + (g.g ? g.g + '등급' : g.raw != null ? '컷 없음' : '-') +
        (g.raw != null ? ' (' + g.raw + '점)' : '') + (r.status === 'rejected' ? ' · 반려' : '') + laterTag(r.message_added_at) + '</span><p>' + esc(r.message) + '</p></div>';
    });
    v.innerHTML = h + '</div>';
  }

  /* ============ 기프티콘 ============ */
  function vGifts(v) {
    var s = stock();
    var h = '<div class="cards">' + card('전체', s.total, '장') + card('남음', s.left, '장', '', s.left === 0) + card('지급됨', s.given, '장') + '</div>';
    h += '<div class="panel"><h3>기프티콘 등록 <small>바코드가 서로 다른 이미지를 한 장씩 · 여러 장 한 번에</small></h3>' +
      '<div class="drop" id="drop">이미지를 여기로 끌어 놓거나 <button class="mini red" id="pick">이미지 고르기</button>' +
      '<input type="file" id="gfile" accept="image/*" multiple hidden><div id="upmsg" class="small" style="margin-top:8px"></div></div></div>';
    h += '<div class="panel"><h3>목록 <small>먼저 올린 것부터 나갑니다</small></h3><div class="giftgrid">';
    D.gifts.slice().reverse().forEach(function (g) {
      var st = g.response_id ? '지급됨 → ' + esc(g.to_name || '') + ' <span class="small muted">' + fmtTime(g.assigned_at) + '</span>'
        : g.retired ? '<span class="muted">쓰지 않음(응답 삭제됨)</span>' : '<span style="color:var(--ok)">남음</span>';
      h += '<div class="gift"><div class="gl">#' + g.id + ' · ' + esc(g.label) + '</div><div class="gs">' + st + '</div>' +
        '<button class="mini" data-gv="' + g.id + '">보기</button> ' +
        (!g.response_id ? '<button class="mini danger" data-gd="' + g.id + '">지우기</button>' : '') + '</div>';
    });
    if (!D.gifts.length) h += '<p class="muted">아직 없습니다.</p>';
    v.innerHTML = h + '</div></div>';

    var inp = $('gfile'), drop = $('drop');
    $('pick').onclick = function () { inp.click(); };
    inp.onchange = function () { uploadGifts(Array.prototype.slice.call(inp.files)); inp.value = ''; };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('on');
      uploadGifts(Array.prototype.filter.call(e.dataTransfer.files, function (f) { return /^image\//.test(f.type); }));
    });
    v.querySelectorAll('[data-gv]').forEach(function (b) { b.onclick = function () { viewGift(Number(b.getAttribute('data-gv'))); }; });
    v.querySelectorAll('[data-gd]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('이 기프티콘 이미지를 지울까요? (아직 안 나간 것만 지워집니다)')) return;
        deleteGifts([Number(b.getAttribute('data-gd'))]);
      };
    });
  }
  function uploadGifts(files) {
    if (!files.length) return;
    var msg = $('upmsg'); msg.textContent = files.length + '장 올리는 중…';
    return rpc('survey_admin_upload_paths', { p_token: token, p_count: files.length }).then(function (d) {
      var done = [], fail = 0, i = 0;
      function one() {
        if (i >= files.length) return Promise.resolve();
        var f = files[i], p = d.paths[i]; i++;
        return sb.storage.from(CFG.bucket).upload(p, f, { contentType: f.type || 'image/png', upsert: false }).then(function (r) {
          if (r.error) fail++; else done.push({ path: p, label: f.name });
          msg.textContent = i + ' / ' + files.length + '장';
        }).then(one);
      }
      return one().then(function () {
        if (!done.length) throw new Error('올리기 실패');
        return rpc('survey_admin_gift_register', { p_token: token, p_items: done });
      }).then(function (r) {
        msg.textContent = '';
        toast(r.added + '장 등록' + (fail ? ' · 실패 ' + fail + '장' : ''));
        return load();
      });
    }).catch(function (e) { msg.textContent = ''; err(e); });
  }
  function viewGift(id) {
    rpc('survey_admin_gift_open', { p_token: token, p_ids: [id] }).then(function (d) {
      return sb.storage.from(CFG.bucket).createSignedUrl(d.paths[String(id)], 120);
    }).then(function (r) {
      if (r.error) throw r.error;
      modal('<img alt="기프티콘" src="' + esc(r.data.signedUrl) + '"><button class="mini" style="margin-top:10px" data-close>닫기</button>');
    }).catch(err);
  }
  function deleteGifts(ids) {
    return rpc('survey_admin_gift_delete', { p_token: token, p_ids: ids }).then(function (d) {
      if (d.paths && d.paths.length) return sb.storage.from(CFG.bucket).remove(d.paths).then(function () { return d; });
      return d;
    }).then(function (d) { toast((d.paths || []).length + '장 지웠습니다'); return load(); }).catch(err);
  }
  function modal(html) { $('modalbox').innerHTML = html; $('modal').hidden = false; }
  $('modal').addEventListener('click', function (e) { if (e.target.id === 'modal' || e.target.hasAttribute('data-close')) $('modal').hidden = true; });

  /* ============ 명단 ============ */
  function vRoster(v) {
    var R = D.roster;
    var chk = R.filter(function (r) { return /^확인 필요/.test(r.status); }).length, fail = R.filter(function (r) { return r.status === '읽기 실패'; }).length;
    var h = '<div class="cards">' + card('명단', R.length, '명') + card('확인 필요', chk, '명') + card('읽기 실패', fail, '명') + '</div>';
    h += '<div class="panel"><div class="toolbar"><b>명단_정리본 엑셀 다시 올리기</b><span class="small muted">열: 이름 / 휴대폰 / 출처 파일 / 상태 (/ 비고) — 올리면 지금 명단을 덮어씁니다</span><span class="sp"></span>' +
      '<button class="mini red" id="rpick">엑셀 올리기</button><input type="file" id="rfile" accept=".xlsx,.xls,.csv" hidden>' +
      '<button class="mini" id="rdown">지금 명단 엑셀로 받기</button></div>' +
      '<div class="wrap"><table class="t"><thead><tr><th>이름</th><th>휴대폰</th><th>출처 파일</th><th>상태</th><th>비고</th></tr></thead><tbody>' +
      R.map(function (r) {
        var cls = r.status === '정상' ? 'b-ok' : r.status === '읽기 실패' ? 'b-warn' : 'b-chk';
        return '<tr><td><b>' + esc(r.name) + '</b></td><td class="num">' + esc(fmtPhone(r.phone)) + '</td><td class="small">' + esc(r.source) + '</td><td><span class="badge ' + cls + '">' + esc(r.status) + '</span></td><td class="small muted">' + esc(r.note) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    v.innerHTML = h;
    $('rpick').onclick = function () { $('rfile').click(); };
    $('rfile').onchange = function () { var f = this.files[0]; this.value = ''; if (f) uploadRoster(f); };
    $('rdown').onclick = function () {
      var aoa = [['이름', '휴대폰', '출처 파일', '상태', '비고']].concat(R.map(function (r) { return [r.name, fmtPhone(r.phone), r.source, r.status, r.note]; }));
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '명단');
      XLSX.writeFile(wb, '명단_정리본.xlsx');
    };
  }
  function uploadRoster(file) {
    file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      var hi = -1, col = {};
      for (var i = 0; i < Math.min(rows.length, 10); i++) {
        var r = rows[i].map(function (x) { return String(x).replace(/\s/g, ''); });
        if (r.indexOf('이름') >= 0) {
          hi = i;
          col.name = r.indexOf('이름');
          col.phone = r.findIndex(function (x) { return /휴대폰|번호|전화/.test(x); });
          col.source = r.findIndex(function (x) { return /출처/.test(x); });
          col.status = r.findIndex(function (x) { return /상태/.test(x); });
          col.note = r.findIndex(function (x) { return /비고/.test(x); });
          break;
        }
      }
      if (hi < 0 || col.phone < 0) throw new Error('첫 줄에 「이름」「휴대폰」 열이 있어야 합니다');
      var out = rows.slice(hi + 1).map(function (r) {
        var g = function (k) { return col[k] >= 0 ? String(r[col[k]] || '').trim() : ''; };
        return { name: g('name'), phone: digits(g('phone')), source: g('source') || file.name, status: g('status') || '정상', note: g('note') };
      }).filter(function (x) { return x.name || x.phone; });
      if (!out.length) throw new Error('읽은 줄이 없습니다');
      if (!confirm('지금 명단(' + D.roster.length + '명)을 지우고 엑셀의 ' + out.length + '명으로 덮어쓸까요?')) return;
      return rpc('survey_admin_set_roster', { p_token: token, p_rows: out, p_replace: true }).then(function (d) { toast('명단 ' + d.count + '명으로 바꿨습니다'); return load(); });
    }).catch(err);
  }

  /* ============ 등급컷 ============ */
  function vCuts(v) {
    var C = D.settings.cuts || {};
    var h = '<div class="panel"><h3>등급컷 <small>원점수 · 그 점수 이상이면 그 등급 · 8등급 컷 미만은 9등급 · 빈칸이면 그 아래는 「컷 없음」</small></h3><div class="cutgrid">';
    EXAMS.forEach(function (e) {
      h += '<div><b>' + e[1] + '</b><table><tr><th></th>';
      for (var i = 1; i <= 8; i++) h += '<th>' + i + '</th>';
      h += '</tr>';
      ['hwa', 'eon'].forEach(function (s) {
        var arr = (C[e[0]] || {})[s] || [];
        h += '<tr><th>' + SUBJ_S[s] + '</th>';
        for (var i = 0; i < 8; i++) {
          var x = arr[i];
          h += '<td><input data-c="' + e[0] + '.' + s + '.' + i + '" inputmode="numeric" value="' + (x == null ? '' : x) + '"' + (x == null ? ' class="empty"' : '') + '></td>';
        }
        h += '</tr>';
      });
      h += '</table></div>';
    });
    h += '</div><div class="toolbar" style="margin-top:16px"><button class="mini red" id="cutsave">저장 (전체 다시 계산)</button><span class="small muted">저장하면 승인·통계·엑셀의 등급이 바로 새 컷으로 바뀝니다.</span></div></div>';
    v.innerHTML = h;
    $('cutsave').onclick = function () {
      var out = {}, bad = false;
      v.querySelectorAll('[data-c]').forEach(function (inp) {
        var k = inp.getAttribute('data-c').split('.'), val = inp.value.trim();
        out[k[0]] = out[k[0]] || {}; out[k[0]][k[1]] = out[k[0]][k[1]] || [];
        var n = val === '' ? null : Number(val);
        if (n != null && !(n >= 0 && n <= 100)) bad = true;
        out[k[0]][k[1]][Number(k[2])] = n;
      });
      if (bad) return toast('0~100 사이 숫자만 넣어 주세요');
      rpc('survey_admin_set_cuts', { p_token: token, p_cuts: out }).then(function () { toast('저장했습니다 · 등급을 다시 계산했습니다'); return load(); }).catch(err);
    };
  }

  /* ============ 설정 ============ */
  function vSettings(v) {
    v.innerHTML = '<div class="panel"><h3>설정</h3>' +
      '<div class="field-row"><label>기프티콘 이름</label><input id="sglabel" value="' + esc(D.settings.gift_label) + '" placeholder="메가커피"><span class="small muted">시작 화면 「1분 설문 · 완료하면 ○○ 기프티콘 증정」</span></div>' +
      '<div class="field-row"><label>설문 주소</label><input id="surl" value="' + esc(D.settings.survey_url) + '" placeholder="' + esc(surveyUrl()) + '"><span class="small muted">문자 안내 문구에 들어갑니다 (비우면 지금 주소)</span></div>' +
      (smsOn() ? '<div class="field-row"><label>승인 시 자동 문자</label><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ssms"' + (D.settings.sms_auto ? ' checked' : '') + '> 켜기</label>' +
        '<span class="small muted">승인하면 그 학생에게 솔라피로 기프티콘 안내 문자 1통 · ' + (D.settings.sms_ready ? '솔라피 키 등록됨' : '<b style="color:var(--red)">솔라피 키 없음</b>') + '</span></div>' : '') +
      '<div class="field-row"><label>새 비밀번호</label><input id="snpw" type="password" placeholder="바꿀 때만 · 8자 이상"><span class="small muted">바꾸면 모든 로그인이 끊깁니다</span></div>' +
      '<div class="toolbar"><button class="mini red" id="ssave">저장</button><button class="mini" id="slogout">로그아웃</button></div></div>';
    $('ssave').onclick = function () {
      var np = $('snpw').value;
      if (np && np.length < 8) return toast('비밀번호는 8자 이상');
      var ps = { gift_label: $('sglabel').value, survey_url: $('surl').value.trim(), new_password: np };
      if ($('ssms')) ps.sms_auto = $('ssms').checked;
      rpc('survey_admin_set_settings', { p_token: token, p: ps })
        .then(function () { if (np) { toast('비밀번호를 바꿨습니다. 다시 로그인해 주세요'); return logout(); } toast('저장했습니다'); return load(); }).catch(err);
    };
    $('slogout').onclick = logout;
    if ($('ssms')) $('ssms').onchange = function () {
      var on = this.checked;
      rpc('survey_admin_set_settings', { p_token: token, p: { sms_auto: on } }).then(function () { toast('승인 시 자동 문자 ' + (on ? '켬' : '끔')); return load(); }).catch(err);
    };
  }

  /* ---------- 시작 ---------- */
  if (token) { $('main').hidden = false; load(); } else showLogin();
})();
