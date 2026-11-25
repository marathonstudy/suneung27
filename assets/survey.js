/* 2027 수능 성적·후기 조사 — 학생 화면 (모바일, 한 화면에 한 문항)
   학생 화면에는 등급을 어디에도 보여주지 않는다. */
(function () {
  'use strict';
  var CFG = window.SURVEY_CFG;
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false, autoRefreshToken: false } });
  var $app = document.getElementById('app');

  var HELPFUL = ['1일 1지문 매일 루틴', '1:1 코칭·피드백', '24시간 질문', '한수 실전 모의고사',
    '해설 강의', 'EBS 수특·수완 정리', '학습 데이터 레포트', '완주 환급(동기부여)'];
  var SAT = [['😢', '아쉬워요'], ['🙁', '조금 아쉬움'], ['🙂', '보통'], ['😊', '좋아요'], ['😍', '최고예요']];
  var TOTAL = 12;

  var A = { name: '', phone: '', courses: [], start_when: null, subject: null,
    pre: { raw: '', grade: null, status: null },
    m6: { mode: 'raw', raw: '', grade: null, status: null }, m9: { mode: 'raw', raw: '', grade: null, status: null },
    sn_raw: '', satisfaction: null, helpful: [], review: '', message: '' };
  var giftLabel = '메가커피';
  var step = 0;            // 0 = 시작, 1..11 = 문항, 'done', 'gift', 'dup'
  var phoneState = { checked: '', exists: false, busy: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function fmtPhone(s) {
    var d = digits(s).slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  }
  function phoneOk(s) { return /^010\d{8}$/.test(digits(s)); }
  function rpc(fn, args) {
    return sb.rpc(fn, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  sb.rpc('survey_public_info').then(function (r) { if (r.data && r.data.gift_label) { giftLabel = r.data.gift_label; if (step === 0) render(); } });

  /* ---------- 틀 ---------- */
  function frame(inner, opts) {
    opts = opts || {};
    var top = '';
    if (opts.progress) {
      top = '<div class="top"><div class="top-row">' +
        '<button class="back" data-act="back" aria-label="뒤로">← 이전</button>' +
        '<span class="step-no">' + step + ' / ' + TOTAL + '</span></div>' +
        '<div class="bar"><i style="width:' + Math.round((step - 1) / TOTAL * 100) + '%"></i></div></div>';
    } else if (opts.back) {
      top = '<div class="top"><div class="top-row"><button class="back" data-act="home">← 처음으로</button></div></div>';
    }
    $app.innerHTML = top + '<div class="screen fade">' + inner + '</div>';
    window.scrollTo(0, 0);
    var bar = $app.querySelector('.bar > i');
    if (bar) requestAnimationFrame(function () { bar.style.width = Math.round(step / TOTAL * 100) + '%'; });
  }
  function go(s) { step = s; render(); }
  function next() { go(step + 1); }

  function render() {
    if (step === 0) return renderStart();
    if (step === 'done') return renderDone();
    if (step === 'gift') return renderGift();
    if (step === 'dup') return renderDup();
    // 순서: 이름·번호 → 강의 → 시작 → 과목 → 만족도 → 도움 → 후기 → 한마디 → 수강 전 → 6모 → 9모 → 수능(제출)
    ({ 1: q1, 2: q2, 3: q3, 4: q4, 5: q8, 6: q9, 7: q10, 8: q11, 9: qPre,
       10: function () { qMock('m6', '6월 모의평가 점수는?', '국어 점수를 알려 주세요.', '응시 안 함'); },
       11: function () { qMock('m9', '9월 모의평가 점수는?', '국어 점수를 알려 주세요.', '응시 안 함'); },
       12: q7 })[step]();
  }

  /* ---------- 5) 수강 전 점수: 등급 필수 · 원점수 선택 · 기억 안 남 ---------- */
  function qPre() {
    var m = A.pre, g = '';
    for (var i = 1; i <= 9; i++) g += '<button class="opt' + (m.grade === i ? ' on' : '') + '" data-act="pregrade" data-v="' + i + '">' + i + '등급</button>';
    frame('<h2 class="q-title">마라톤 시작 전,<br>가장 아쉬웠던 국어 시험<br>점수를 알려주세요.</h2><p class="q-sub">등급은 꼭, 원점수는 알면 적어 주세요.</p>' +
      '<div class="grid3">' + g + '</div>' +
      '<div class="field" style="margin-top:16px"><label for="raw">원점수 (선택)</label>' +
      '<input class="inp" id="raw" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0~100" value="' + esc(m.raw) + '"></div>' +
      '<div class="err" id="rawerr"></div>' +
      '<button class="btn" id="prego" data-act="prenext"' + (m.grade ? '' : ' disabled') + '>다음</button>' +
      '<div class="row2"><button class="btn ghost" data-act="preforgot" style="grid-column:1 / span 2">기억 안 남</button></div>', { progress: true });
    var el = document.getElementById('raw');
    el.addEventListener('input', function () {
      el.value = digits(el.value).slice(0, 3); m.raw = el.value;
      var bad = el.value !== '' && !(Number(el.value) <= 100);
      document.getElementById('rawerr').textContent = bad ? '0부터 100까지 넣어 주세요.' : '';
      document.getElementById('prego').disabled = !m.grade || bad;
    });
  }

  /* ---------- 시작 ---------- */
  function renderStart() {
    frame(
      '<div class="hero">' +
      '<div class="brand">MARATHON KOREAN · 2027 수능</div>' +
      '<div class="chars"><img src="assets/rabbit.png" alt="마라토니"><img src="assets/turtle.png" alt="마라부기"></div>' +
      '<h1>수능 수고 많았습니다</h1>' +
      '<div class="pill">1분 설문 · 완료하면<br>' + esc(giftLabel) + ' 기프티콘 증정</div>' +
      '</div>' +
      '<div class="actions">' +
      '<button class="btn" data-act="begin">설문 시작하기</button>' +
      '<p class="privacy">이름·번호는 기프티콘 발송과 중복 확인에만 쓰이며, 발송 후 삭제됩니다.</p>' +
      '<button class="linkbtn" data-act="gift">이미 참여했어요 · 기프티콘 확인</button>' +
      '</div>');
  }

  /* ---------- 1) 이름 + 번호 ---------- */
  function q1() {
    frame(
      '<h2 class="q-title">이름과 휴대폰 번호를<br>알려 주세요</h2>' +
      '<p class="q-sub">기프티콘을 받을 번호예요.</p>' +
      '<div class="field"><label for="nm">이름</label><input class="inp" id="nm" autocomplete="name" maxlength="20" placeholder="홍길동" value="' + esc(A.name) + '"></div>' +
      '<div class="field"><label for="ph">휴대폰 번호</label><input class="inp" id="ph" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" value="' + esc(fmtPhone(A.phone)) + '"></div>' +
      '<div id="dupbox"></div>' +
      '<div class="actions"><button class="btn" id="go1" data-act="q1next" disabled>다음</button></div>', { progress: true });
    var nm = document.getElementById('nm'), ph = document.getElementById('ph');
    nm.addEventListener('input', function () { A.name = nm.value; upd1(); });
    ph.addEventListener('input', function () {
      var pos = ph.value.length === ph.selectionStart;
      ph.value = fmtPhone(ph.value); A.phone = digits(ph.value);
      if (pos) ph.setSelectionRange(ph.value.length, ph.value.length);
      upd1();
      if (phoneOk(A.phone) && phoneState.checked !== A.phone) checkPhone(A.phone);
    });
    if (!A.name) nm.focus();
    upd1();
    if (phoneOk(A.phone) && phoneState.checked !== A.phone) checkPhone(A.phone);
  }
  function upd1() {
    var b = document.getElementById('go1'); if (!b) return;
    var ready = A.name.trim().length >= 2 && phoneOk(A.phone) && phoneState.checked === A.phone && !phoneState.exists && !phoneState.busy;
    b.disabled = !ready;
    var box = document.getElementById('dupbox');
    if (phoneState.checked === A.phone && phoneState.exists) {
      box.innerHTML = '<div class="notice"><b>이미 참여하셨습니다</b>이 번호로 낸 설문이 있어요.</div>' +
        '<button class="btn soft" style="margin-top:12px" data-act="gift">기프티콘 확인하기</button>';
    } else if (phoneState.busy) {
      box.innerHTML = '<p class="hint">번호 확인 중…</p>';
    } else if (A.phone.length >= 3 && A.phone.length === 11 && !phoneOk(A.phone)) {
      box.innerHTML = '<p class="err">010으로 시작하는 번호를 넣어 주세요.</p>';
    } else box.innerHTML = '';
  }
  function checkPhone(p) {
    phoneState.busy = true; upd1();
    rpc('survey_check_phone', { p_phone: p }).then(function (d) {
      if (A.phone !== p) return;
      phoneState = { checked: p, exists: !!(d && d.exists), busy: false }; upd1();
    }).catch(function () {
      phoneState.busy = false;
      var box = document.getElementById('dupbox');
      if (box) box.innerHTML = '<p class="err">인터넷 연결을 확인해 주세요.</p>';
    });
  }

  /* ---------- 2) 수강 강의 (복수) ---------- */
  function q2() {
    var o = [['online', '온라인'], ['offline', '현장강의']];
    frame('<h2 class="q-title">어떤 강의를 들었나요?</h2><p class="q-sub">둘 다 들었으면 둘 다 눌러 주세요.</p>' +
      '<div class="opts">' + o.map(function (x) {
        var on = A.courses.indexOf(x[0]) >= 0;
        return '<button class="opt' + (on ? ' on' : '') + '" data-act="course" data-v="' + x[0] + '"><span class="chk">' + (on ? '✓' : '') + '</span>' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn" data-act="next"' + (A.courses.length ? '' : ' disabled') + '>다음</button></div>', { progress: true });
  }

  /* ---------- 3) 시작 시점 ---------- */
  function q3() {
    var o = [['sep_early', '9월 초'], ['sep_mid', '9월 중순', '9평 이후'], ['oct', '10월 이후']];
    frame('<h2 class="q-title">언제부터 들었나요?</h2><p class="q-sub">파이널 수강을 시작한 때예요.</p>' +
      '<div class="opts">' + o.map(function (x) {
        return '<button class="opt' + (A.start_when === x[0] ? ' on' : '') + '" data-act="pick" data-k="start_when" data-v="' + x[0] + '"><span>' + x[1] + (x[2] ? '<small>' + x[2] + '</small>' : '') + '</span></button>';
      }).join('') + '</div>', { progress: true });
  }

  /* ---------- 4) 선택 과목 ---------- */
  function q4() {
    var o = [['hwa', '화법과 작문'], ['eon', '언어와 매체']];
    frame('<h2 class="q-title">선택 과목은?</h2><p class="q-sub">수능에서 고른 과목이에요.</p>' +
      '<div class="opts">' + o.map(function (x) {
        return '<button class="opt' + (A.subject === x[0] ? ' on' : '') + '" data-act="pick" data-k="subject" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>', { progress: true });
  }

  /* ---------- 5) 6월 · 6) 9월 모평 ---------- */
  function qMock(key, title, sub, noneLabel) {
    var m = A[key];
    var body;
    if (m.mode === 'raw') {
      body = '<input class="inp big" id="raw" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0~100" value="' + esc(m.status === 'raw' ? m.raw : '') + '">' +
        '<div class="unit">원점수 (100점 만점)</div><div class="err" id="rawerr"></div>' +
        '<button class="btn" id="rawgo" data-act="rawnext" data-k="' + key + '" style="margin-top:14px" disabled>다음</button>';
    } else {
      var g = '';
      for (var i = 1; i <= 9; i++) g += '<button class="opt' + (m.status === 'grade' && m.grade === i ? ' on' : '') + '" data-act="grade" data-k="' + key + '" data-v="' + i + '">' + i + '등급</button>';
      body = '<div class="grid3">' + g + '</div>';
    }
    frame('<h2 class="q-title">' + title + '</h2><p class="q-sub">' + sub + '</p>' +
      '<div class="seg"><button class="' + (m.mode === 'raw' ? 'on' : '') + '" data-act="mode" data-k="' + key + '" data-v="raw">원점수로 입력</button>' +
      '<button class="' + (m.mode === 'grade' ? 'on' : '') + '" data-act="mode" data-k="' + key + '" data-v="grade">등급으로 입력</button></div>' +
      body +
      '<div class="row2"><button class="btn ghost' + (m.status === 'none' ? ' on' : '') + '" data-act="mockst" data-k="' + key + '" data-v="none">' + noneLabel + '</button>' +
      '<button class="btn ghost" data-act="mockst" data-k="' + key + '" data-v="forgot">기억 안 남</button></div>', { progress: true });
    bindRaw(key);
  }
  function bindRaw(key) {
    var el = document.getElementById('raw'); if (!el) return;
    var btn = document.getElementById('rawgo'), err = document.getElementById('rawerr');
    function chk() {
      el.value = digits(el.value).slice(0, 3);
      var v = el.value === '' ? NaN : Number(el.value);
      var ok = v >= 0 && v <= 100;
      btn.disabled = !ok;
      err.textContent = el.value !== '' && !ok ? '0부터 100까지 넣어 주세요.' : '';
      return ok;
    }
    el.addEventListener('input', chk);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && chk()) btn.click(); });
    chk();
    if (!el.value) el.focus();
  }

  /* ---------- 7) 수능 가채점 ---------- */
  function q7() {
    frame('<h2 class="q-title">수능 가채점<br>원점수는?</h2><p class="q-sub">국어 원점수만 넣어 주세요.</p>' +
      '<input class="inp big" id="raw" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="0~100" value="' + esc(A.sn_raw) + '">' +
      '<div class="unit">원점수 (100점 만점)</div><div class="err" id="rawerr"></div>' +
      '<div class="err" id="suberr"></div>' +
      '<div class="actions"><button class="btn" id="rawgo" data-act="snsubmit" disabled>제출하기</button></div>', { progress: true });
    bindRaw('sn');
  }

  /* ---------- 8) 만족도 ---------- */
  function q8() {
    frame('<h2 class="q-title">마라톤 학습,<br>얼마나 만족했나요?</h2><p class="q-sub">5점이 가장 좋아요.</p>' +
      '<div class="stars">' + SAT.map(function (s, i) {
        return '<button class="opt' + (A.satisfaction === i + 1 ? ' on' : '') + '" data-act="pick" data-k="satisfaction" data-v="' + (i + 1) + '">' + s[0] + '<small>' + (i + 1) + '점</small></button>';
      }).join('') + '</div>' +
      '<div class="hint" style="display:flex;justify-content:space-between"><span>아쉬워요</span><span>최고예요</span></div>', { progress: true });
  }

  /* ---------- 9) 도움된 부분 (복수) ---------- */
  function q9() {
    frame('<h2 class="q-title">가장 도움된 부분은?</h2><p class="q-sub">여러 개 골라도 돼요.</p>' +
      '<div class="opts">' + HELPFUL.map(function (h, i) {
        var on = A.helpful.indexOf(h) >= 0;
        return '<button class="opt' + (on ? ' on' : '') + '" data-act="help" data-i="' + i + '"><span class="chk">' + (on ? '✓' : '') + '</span>' + h + '</button>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn" data-act="next"' + (A.helpful.length ? '' : ' disabled') + '>다음</button></div>', { progress: true });
  }

  /* ---------- 10) 후기 ---------- */
  var LEADS = ['제일 힘들었던 건 ', '도움이 됐던 건 ', '후배에게 하고 싶은 말은 '];
  // 말머리만 있고 뒤에 내용이 없으면 그 말머리는 지운다
  function cleanReview(t) {
    var re = new RegExp('(' + LEADS.map(function (l) { return l.trim(); }).join('|') + ')\\s*$');
    return String(t || '').split('\n').map(function (orig) {
      var line = orig, prev;
      do { prev = line; line = line.replace(re, '').replace(/\s+$/, ''); } while (line !== prev);
      return line === '' && orig.trim() !== '' ? null : line;   // 말머리만 있던 줄은 통째로 뺌
    }).filter(function (l) { return l !== null; }).join('\n').trim();
  }
  function q10() {
    frame('<h2 class="q-title">마라톤 하면서<br>가장 기억에 남는 건?</h2>' +
      '<p class="q-sub">점수와 상관없이, 솔직한 이야기가 후배들에게 가장 큰 도움이 됩니다.</p>' +
      '<div class="leads">' + LEADS.map(function (l, i) { return '<button class="lead" data-act="lead" data-i="' + i + '">' + esc(l.trim()) + '</button>'; }).join('') + '</div>' +
      '<textarea class="inp" id="tx" maxlength="2000" placeholder="예) 처음엔 귀찮았는데 어느 순간 지문 읽는 게 편해졌어요">' + esc(A.review) + '</textarea>' +
      '<p class="hint">남긴 후기는 이름을 가려 소개될 수 있습니다.</p>' +
      '<div class="actions"><button class="btn" data-act="textnext" data-k="review">다음</button>' +
      '<button class="linkbtn" data-act="skip" data-k="review">건너뛰기</button></div>', { progress: true });
  }

  /* ---------- 11) 종현샘께 한마디 ---------- */
  function q11() {
    frame('<h2 class="q-title">종현샘께 한마디</h2><p class="q-sub">종현샘이 직접 읽어봅니다!</p>' +
      '<textarea class="inp" id="tx" maxlength="2000" placeholder="자유롭게 적어 주세요">' + esc(A.message) + '</textarea>' +
      '<div class="actions"><button class="btn" data-act="textnext" data-k="message">다음</button>' +
      '<button class="linkbtn" data-act="skip" data-k="message">건너뛰기</button></div>', { progress: true });
  }

  function submit() {
    var btn = document.getElementById('rawgo');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 보내는 중'; }
    function mock(m) {
      if (m.status === 'raw') return { raw: Number(m.raw), grade: null, status: 'raw' };
      if (m.status === 'grade') return { raw: null, grade: m.grade, status: 'grade' };
      return { raw: null, grade: null, status: m.status };
    }
    var m6 = mock(A.m6), m9 = mock(A.m9);
    // 수강 전: 등급 필수 + 원점수(선택)는 둘 다 저장 · 기억 안 남이면 둘 다 비움
    var preForgot = A.pre.status === 'forgot';
    var p = { name: A.name.trim(), phone: A.phone, courses: A.courses, start_when: A.start_when, subject: A.subject,
      pre_raw: !preForgot && A.pre.raw !== '' ? Number(A.pre.raw) : null, pre_grade: preForgot ? null : A.pre.grade, pre_status: preForgot ? 'forgot' : 'grade',
      m6_raw: m6.raw, m6_grade: m6.grade, m6_status: m6.status, m9_raw: m9.raw, m9_grade: m9.grade, m9_status: m9.status,
      sn_raw: Number(A.sn_raw), satisfaction: A.satisfaction, helpful: A.helpful, review: cleanReview(A.review), message: A.message.trim() };
    rpc('survey_submit', { p: p }).then(function (d) {
      if (d && d.ok) return go('done');
      if (d && d.reason === 'duplicate') return go('dup');
      throw new Error(d && d.reason || 'fail');
    }).catch(function () {
      var e = document.getElementById('suberr');
      if (e) e.textContent = '보내지 못했어요. 잠시 뒤 다시 눌러 주세요.';
      if (btn) { btn.disabled = false; btn.textContent = '다시 제출하기'; }
    });
  }

  /* ---------- 완료 · 중복 ---------- */
  function renderDone() {
    var bar = '';
    $app.innerHTML = bar + '<div class="screen fade"><div class="hero" style="padding-top:40px">' +
      '<div class="chars"><img src="assets/turtle.png" alt="마라부기"><img src="assets/rabbit.png" alt="마라토니"></div>' +
      '<h1>제출 완료!</h1><p class="q-sub" style="font-size:18px">확인 후 기프티콘을 보내드립니다.</p></div>' +
      '<div class="actions"><button class="btn ghost" data-act="gift">기프티콘 확인 화면으로</button></div></div>';
  }
  function renderDup() {
    frame('<div class="hero" style="padding-top:30px"><h1 style="font-size:26px">이미 참여하셨습니다</h1>' +
      '<p class="q-sub">이 번호로 낸 설문이 있어요.</p></div>' +
      '<div class="actions"><button class="btn" data-act="gift">기프티콘 확인하기</button></div>', { back: true });
  }

  /* ---------- 기프티콘 확인 ---------- */
  function renderGift() {
    frame('<h2 class="q-title">기프티콘 확인</h2><p class="q-sub">설문에 넣은 이름과 번호를 넣어 주세요.</p>' +
      '<div class="field"><label for="gnm">이름</label><input class="inp" id="gnm" autocomplete="name" maxlength="20" value="' + esc(A.name) + '"></div>' +
      '<div class="field"><label for="gph">휴대폰 번호</label><input class="inp" id="gph" type="tel" inputmode="numeric" maxlength="13" placeholder="010-0000-0000" value="' + esc(fmtPhone(A.phone)) + '"></div>' +
      '<button class="btn" id="gbtn" data-act="giftcheck">확인하기</button>' +
      '<div id="gres"></div>', { back: true });
    var ph = document.getElementById('gph');
    ph.addEventListener('input', function () { ph.value = fmtPhone(ph.value); });
  }
  function giftCheck() {
    var nm = document.getElementById('gnm').value.trim(), ph = digits(document.getElementById('gph').value);
    var res = document.getElementById('gres'), btn = document.getElementById('gbtn');
    if (nm.length < 2 || !phoneOk(ph)) { res.innerHTML = '<p class="err">이름과 010 번호를 넣어 주세요.</p>'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 확인 중';
    rpc('survey_gift_check', { p_name: nm, p_phone: ph }).then(function (d) {
      var st = d && d.status;
      if (st === 'approved' && d.path) {
        return sb.storage.from(CFG.bucket).createSignedUrl(d.path, 300).then(function (r) {
          if (r.error || !r.data) throw r.error || new Error('sign');
          res.innerHTML = '<img class="gift-img" alt="기프티콘" src="' + esc(r.data.signedUrl) + '">' +
            '<p class="save-hint">길게 눌러 저장하세요</p>' +
            '<p class="hint" style="text-align:center">이 화면은 잠깐만 열려요. 지금 저장해 두세요.</p>';
        });
      }
      if (st === 'pending') res.innerHTML = '<div class="notice gray"><b>확인 중입니다.</b>조금만 기다려 주세요.</div>';
      else if (st === 'rejected') res.innerHTML = '<div class="notice"><b>카카오 채널로 문의해 주세요</b>확인이 더 필요해요.</div>' +
        '<a class="btn soft" style="margin-top:12px;text-align:center;text-decoration:none;line-height:30px" href="' + esc(CFG.kakao) + '" target="_blank" rel="noopener">카카오 채널 문의하기</a>';
      else res.innerHTML = '<div class="notice gray"><b>참여 기록이 없어요.</b>이름과 번호를 다시 확인해 주세요.</div>';
    }).catch(function () {
      res.innerHTML = '<p class="err">불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.</p>';
    }).then(function () { btn.disabled = false; btn.textContent = '확인하기'; });
  }

  /* ---------- 클릭 ---------- */
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), k = b.getAttribute('data-k'), v = b.getAttribute('data-v');
    switch (act) {
      case 'begin': return go(1);
      case 'home': history.replaceState(null, '', location.pathname + location.search); return go(0);
      case 'gift': return go('gift');
      case 'back': return go(step - 1);
      case 'next': return next();
      case 'q1next': A.name = A.name.trim(); return next();
      case 'course':
        var i = A.courses.indexOf(v);
        if (i >= 0) A.courses.splice(i, 1); else A.courses.push(v);
        return render();
      case 'pick':
        A[k] = k === 'satisfaction' ? Number(v) : v; render();
        return setTimeout(next, 140);
      case 'mode': A[k].mode = v; return render();
      case 'pregrade': A.pre.grade = Number(v); A.pre.status = 'grade'; return render();
      case 'prenext': A.pre.status = 'grade'; return next();
      case 'preforgot': A.pre.status = 'forgot'; A.pre.grade = null; A.pre.raw = ''; return next();
      case 'grade': A[k].grade = Number(v); A[k].status = 'grade'; A[k].raw = ''; render(); return setTimeout(next, 140);
      case 'mockst': A[k].status = v; A[k].raw = ''; A[k].grade = null; return next();
      case 'rawnext':
        var val = document.getElementById('raw').value;
        if (k === 'sn') A.sn_raw = val; else { A[k].raw = val; A[k].status = 'raw'; A[k].grade = null; }
        return next();
      case 'help':
        var h = HELPFUL[Number(b.getAttribute('data-i'))], j = A.helpful.indexOf(h);
        if (j >= 0) A.helpful.splice(j, 1); else A.helpful.push(h);
        return render();
      case 'textnext': A[k] = document.getElementById('tx').value; return next();
      case 'skip': A[k] = ''; return next();
      case 'snsubmit': A.sn_raw = document.getElementById('raw').value; return submit();
      case 'lead':   // 말머리만 넣고 커서를 뒤에
        var tx = document.getElementById('tx'), lead = LEADS[Number(b.getAttribute('data-i'))];
        var cur = tx.value.replace(/\s+$/, '');
        tx.value = (cur ? cur + '\n' : '') + lead;
        A.review = tx.value;
        tx.focus(); tx.setSelectionRange(tx.value.length, tx.value.length);
        tx.scrollTop = tx.scrollHeight;
        return;
      case 'giftcheck': return giftCheck();
    }
  });
  // 뒤로 가기 문항에서 지금 쓰던 글은 남겨 둔다
  $app.addEventListener('input', function (e) {
    if (e.target.id === 'tx') { if (step === 7) A.review = e.target.value; if (step === 8) A.message = e.target.value; }
  });

  step = /#gift/.test(location.hash) ? 'gift' : 0;
  render();
})();
