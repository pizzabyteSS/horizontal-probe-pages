// ============================================================
// web/src/app.js — Web版の画面の流れ（画面の切り替え・ログイン・鑑定・結果の表示・項目の開閉・鑑定文の書き直し・作業中の鑑定の途中保存・計測の記録）
// 設計：docs/web-screen-plan.md §4 段階1〜段階3と「画面の構成」、docs/web-pdf-plan.md §5 の 3a-2・3a-3、docs/product-spec.md §4.1・§4.2
//   画面：ログイン → メニュー →（① 鑑定する／② 設定 → デザイン・マニュアル）。計測（#measure）はメニューに出さない。
//   1つのページの中で画面を1つずつ出し、ページ内の印（#menu など）で切り替える（ブラウザの戻るで行き来できる）。
//   ログインしていないときは、どの画面を開いてもログインを出す（画面に鑑定が出ているときの「鑑定する」だけは、期限が切れても出したまま）
//   ログイン（web_login）→ 鑑定（web_kantei）を呼び、結果を表示する（data_table.js・view_*.js）。所要時間と応答の大きさは記録に残す
//   結果は項目の一覧（view_result.js）にしてから画面に書き、同じ一覧を「送る・印刷」の欄（send_panel.js）に渡す
//   トークンはメモリにだけ持つ（読み込み直したらログインからやり直す）。端末に残すのは「前回の呼び出しの時刻」と
//   作業中の鑑定1件（work_draft.js。ログインした ID の分だけ「続きから」で再開できる）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  // ---- 定数 ----
  var CONFIG = window.HZ_WEB_CONFIG || {};
  var VIEW = window.HZ_WEB_VIEW || {};
  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/AKfyc[A-Za-z0-9_-]+\/exec$/;
  var LIMIT_MS = { READY: 5000, COLD: 5000, MEDIAN: 3000 };   // 2026-10-16 決定（docs/web-server-plan.md §3.5）
  var COLD_IDLE_MINUTES = 30;
  var STREAK_COUNT = 5;
  var LAST_CALL_STORAGE_KEY = 'hzWeb.lastCallAt';
  var VERDICT_OUT_OF_SCOPE = '判定外';
  // 入力の初期値（hzGate の case A と同じ）。氏名は送る項目に入れない（サーバーも受け取らない）
  var SAMPLE_INPUT = {
    year: 1985, month: 7, day: 14, hour: 10, min: 30, sex: '女性', birthPlace: '東京都',
    zokanStyle: '鳥海流', startYear: 2026, startMonth: 10, startDay: 1
  };
  // 結果のまとまり（上から並べる順）：[書き先の ID, まとまりの種類（meishiki・report・運勢表の taiun など）, 見出しの ID]。
  //   鑑定情報は先頭の outInfo に1回だけ
  var RESULT_GROUPS = [
    ['outMeishiki', 'meishiki', 'ttlMeishiki'],
    ['outTaiun', 'taiun', 'ttlTaiun'],
    ['outNenun', 'nenun', 'ttlNenun'],
    ['outGetsuun', 'getsuun', 'ttlGetsuun'],
    ['outNichiun', 'nichiun', 'ttlNichiun'],
    ['outReport', 'report', 'ttlReport']
  ];
  // 画面：{ ページ内の印（#の後ろ）: 画面の要素の ID }。login・agree は印で開くものではなく、
  //   ログインしていないときはログイン、ログインした ID がいまの版の規約に同意していないときは同意を出す。terms はログインの前でも開ける
  var SCREENS = {
    login: 'scrLogin', agree: 'scrAgree', menu: 'scrMenu', kantei: 'scrKantei', settings: 'scrSettings',
    design: 'scrDesign', manual: 'scrManual', terms: 'scrTerms', measure: 'scrMeasure'
  };
  var UNROUTED_SCREENS = { login: true, agree: true };
  var DEFAULT_ROUTE = 'menu';
  // 入力欄の対応：[送るキー, 要素の ID, 数値として送るか]
  var INPUT_FIELDS = [
    ['year', 'inpYear', true], ['month', 'inpMonth', true], ['day', 'inpDay', true],
    ['hour', 'inpHour', true], ['min', 'inpMin', true], ['sex', 'selSex', false],
    ['birthPlace', 'inpBirthPlace', false], ['zokanStyle', 'selZokanStyle', false],
    ['startYear', 'inpStartYear', true], ['startMonth', 'inpStartMonth', true], ['startDay', 'inpStartDay', true]
  ];
  var ERROR_MESSAGES = {
    bad_credentials: 'ID またはパスワードが違います',
    locked: 'しばらくログインできません（失敗が続いたため）',
    invalid_token: 'ログインの期限が切れました。もう一度ログインしてください',
    terms_required: '利用規約・プライバシーポリシーへの同意が必要です（内容を改めました）。お読みいただき、同意してから鑑定してください',
    terms_version: '画面が古いため同意できませんでした。ページを読み込み直してください',
    rate_limited: '短い時間に呼び出しが多すぎます',
    busy: '混み合っています。少し待ってからやり直してください',
    invalid_input: '入力に誤りがあります',
    server_error: 'サーバーで失敗しました',
    network_error: '通信できませんでした',
    not_json: '応答を読めませんでした'
  };

  // 入力の誤りの理由（サーバーの detail。master_gss/web_api.js の _hzValidateWebInput_）
  var INPUT_ERROR_MESSAGES = {
    birth_date_invalid: '生年月日が正しくありません（西暦・実在する日付）',
    start_date_invalid: '開始日が正しくありません（西暦・実在する日付）',
    start_date_before_birth: '開始日は生年月日と同じ日かそれより後にしてください',
    hour_invalid: '時は 0〜23 で入力してください',
    min_invalid: '分は 0〜59 で入力してください',
    sex_invalid: '性別を選んでください',
    zokan_style_invalid: '蔵干の流派を選んでください',
    birth_place_invalid: '出生地が長すぎます',
    birth_place_unknown: '出生地は都道府県名か「不明」で入力してください',
    out_of_supported_range: '計算できる範囲（西暦 1913〜2068年）の外です'
  };

  // 続きから再開できなかったとき、自分に送る文章の本文の代わりに入れる文。
  //   原文（書き直す前の本文）は同じ入力から作り直せるため端末に残さない（docs/product-spec.md §4.1「原文は…別に保存しない」）。
  //   この手段で守るのは、作り直せない鑑定者の手の入った分（書き直した文・メモ・相手に送った時点の控え）
  var DRAFT_NO_BODY_TEXT = '（続きから再開できなかったため、この時点の本文は作り直していません。鑑定し直すときは、先頭の行の入力を使ってください）';

  // ---- 状態（メモリだけ） ----
  var session = createEmptySession();
  var isBusy = false;
  var records = [];
  var closedKeys = {};      // 閉じた項目（{ key: true }）。鑑定ごとに開いた状態から始める
  var textEdits = {};       // 書き直した文（{ editKey: { label, text } }。text_edit.js）。鑑定ごとに原文から始める
  var sendPanel = null;     // 「送る・印刷」の欄（init で作る）
  // 画面に出している鑑定（{ workId, ownerId, input, name, kanteiAt, model, digests, originals, knownRev, isStale, saveFailed }）。変わるたびに端末に残し直す
  //   model・digests・originals（書き直せる文の原文）は原文のまま。書き直しは textEdits に別に持つ
  //   knownRev：この画面が知っている端末の1件の版の印（新しい鑑定は送った時点の版、なければ ''。続きからは残っていた版。
  //     残すたびに新しい版にする）。書く・消す前に端末の版と比べ、違えば別のタブ・画面が書いたか消したとみなす
  //   isStale：上の照らし合わせで違っていた（この画面からは書かない）　saveFailed：最後に残そうとして残せなかった（容量・設定）
  var currentWork = null;
  var lastSavePromise = Promise.resolve();   // 最後に頼んだ保存（排他を待つ間は終わっていない）。続けて鑑定するとき、終わりを待って版を読む
  // 入力欄（氏名・生年月日など）を使った ID。ログインの期限切れで session が空になっても覚えておき、
  // 別の ID でログインしたら入力欄を空にする（前の ID のお客さんの入力を見せない）
  var formOwnerId = '';
  // 続きから再開できなかったとき（{ canResume, draft }）。欄に知らせと自分に送る手段を出している
  //   ログインの期限切れで session が空になっても欄を出し続ける（同じ人の操作の続き。別の ID でログインしたら消す）
  var draftProblem = null;
  var pendingFresh = null;  // 原文が変わっていたときに作り直した結果（{ table, input, name }）。古い1件を消したら新しい鑑定として出す
  var needsRelogin = false; // 「ログインし直す」を押した（画面に鑑定が出ていてもログインを出す）
  var shownScreen = '';     // いま出している画面（SCREENS のキー）
  var isConfirming = false; // 確かめる窓を開いている（その間は同じ操作を受け付けない）

  // ---- 小道具 ----
  function byId(id) { return document.getElementById(id); }

  // termsOk：いまの版の規約に同意済み。termsVersion：サーバーのいまの版（画面の版 VIEW.TERMS_VERSION と比べる）
  function createEmptySession() { return { token: '', expiresAt: 0, used: null, loginId: '', termsOk: false, termsVersion: '' }; }

  function hasSession() { return session.token !== '' && session.expiresAt > Date.now(); }

  /** ログインしているが、いまの版の規約に同意していない（同意するまで鑑定しない）。 */
  function needsAgreement() { return hasSession() && !session.termsOk; }

  /** サーバーの規約の版と、この画面が持つ本文の版が違う（古い画面のまま同意させない）。 */
  function isTermsStale() { return session.termsVersion !== '' && session.termsVersion !== VIEW.TERMS_VERSION; }

  function msSince(startMs) { return Math.round(performance.now() - startMs); }

  function calcMedian(list) {
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function judgeWithin(ms, limitMs) { return ms <= limitMs ? '合格' : '不合格'; }

  function countUtf8Bytes(text) { return new Blob([text]).size; }

  function describeError(json) {
    var base = ERROR_MESSAGES[json.error] || ('失敗（' + String(json.error) + '）');
    if (!json.detail) return base;
    return base + '：' + (INPUT_ERROR_MESSAGES[json.detail] || json.detail);
  }

  function describeDisplayMode() {
    var standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return standalone ? 'ホーム画面から起動' : 'ブラウザ';
  }

  // ---- 端末に残す値（前回の呼び出しの時刻。作業中の鑑定は work_draft.js） ----
  function readLastCallAt() {
    try { return Number(localStorage.getItem(LAST_CALL_STORAGE_KEY)) || 0; } catch (e) { return 0; }
  }

  function writeLastCallAt(ms) {
    try { localStorage.setItem(LAST_CALL_STORAGE_KEY, String(ms)); } catch (e) { /* 保存できなくても計測は続ける */ }
  }

  /** 前回の呼び出しからの時間と、「冷えた1回目」の条件（30分以上）を満たすか。記録がなければ満たさない扱い。 */
  function checkIdle(lastCallAt, nowMs) {
    if (!lastCallAt) return { isCold: false, text: '冷えた条件：不明（この端末での呼び出しの記録なし）' };
    var minutes = Math.floor((nowMs - lastCallAt) / 60000);
    var isCold = minutes >= COLD_IDLE_MINUTES;
    return { isCold: isCold, text: '冷えた条件：' + (isCold ? '満たす' : '満たさない') + '（前回の呼び出しから' + minutes + '分）' };
  }

  /** T8(1)（冷えた1回目）の合否。冷えた条件を満たさないときは合否を付けない（「判定外」）。 */
  function judgeCold(ms, idle) {
    return idle.isCold ? judgeWithin(ms, LIMIT_MS.COLD) : VERDICT_OUT_OF_SCOPE;
  }

  // ---- 通信 ----
  /** /exec に1回送る。所要時間は送信から応答の受信（本文の読み終わり）まで。 */
  function postAction(body) {
    var idle = checkIdle(readLastCallAt(), Date.now());
    // 送る前に時刻を残す（応答の前に画面が閉じられても、呼び出しがあったことを次の「冷えた条件」に反映する）
    writeLastCallAt(Date.now());
    var startMs = performance.now();
    return fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 事前の確認（preflight）を起こさない形
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }).then(function (response) {
      return response.text();
    }).then(function (text) {
      var json;
      try { json = JSON.parse(text); } catch (e) { json = { ok: false, error: 'not_json' }; }
      return { ms: msSince(startMs), bytes: countUtf8Bytes(text), json: json, idle: idle };
    }, function () {
      return { ms: msSince(startMs), bytes: 0, json: { ok: false, error: 'network_error' }, idle: idle };
    }).then(function (result) {
      writeLastCallAt(Date.now());   // 応答の受信の時刻で更新する（次の呼び出しまでの間隔は、この時刻から数える）
      return result;
    });
  }

  // ---- 入力 ----
  /**
   * 月・日・時・分の選択肢を作る（2026-10-21 ガクさん：全角などの打ち間違いを減らすため選ぶ形に）。
   * data-range="最小-最大"・data-unit（表示の単位）・data-unknown（あれば先頭に値が空の選択肢）
   */
  function buildNumberSelects() {
    var selects = document.querySelectorAll('select[data-range]');
    for (var i = 0; i < selects.length; i++) {
      var select = selects[i];
      var range = select.getAttribute('data-range').split('-');
      var unit = select.getAttribute('data-unit') || '';
      var unknown = select.getAttribute('data-unknown');
      if (unknown) select.appendChild(new Option(unknown, ''));
      for (var n = Number(range[0]); n <= Number(range[1]); n++) select.appendChild(new Option(n + unit, String(n)));
    }
  }

  function fillInputForm(input) {
    INPUT_FIELDS.forEach(function (field) {
      var value = input[field[0]];
      byId(field[1]).value = (value === undefined || value === null) ? '' : String(value);
    });
  }

  /** 全角の数字・空白を半角にする（入力の案内どおり、全角でも受け付ける）。 */
  function toHalfWidth(text) {
    return String(text).replace(/[０-９]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
  }

  var KANJI_DIGITS = '〇一二三四五六七八九';

  /** 年の欄の文字を半角の数字4桁までにする（全角・漢数字は数字に直し、ほかの字は捨てる）。 */
  function normalizeYearText(text) {
    return toHalfWidth(text).replace(/[〇一二三四五六七八九]/g, function (ch) {
      return String(KANJI_DIGITS.indexOf(ch));
    }).replace(/[^0-9]/g, '').slice(0, 4);
  }

  /**
   * 年の欄は、打った字をその場で半角の数字に直す（PC では「198６」のように全角が混ざって入るため。2026-10-23 ガクさん）。
   * 変換の途中（IME で確定前）は触らず、確定したとき・欄を離れたときに直す
   */
  function bindYearInputs() {
    ['inpYear', 'inpStartYear'].forEach(function (id) {
      var input = byId(id);
      var apply = function () {
        var fixed = normalizeYearText(input.value);
        if (fixed !== input.value) input.value = fixed;
      };
      input.addEventListener('input', function (event) { if (!event.isComposing) apply(); });
      input.addEventListener('compositionend', apply);
      input.addEventListener('blur', apply);
    });
  }

  function readInputForm() {
    var input = {};
    INPUT_FIELDS.forEach(function (field) {
      var raw = toHalfWidth(byId(field[1]).value).trim();
      input[field[0]] = (field[2] && raw !== '') ? Number(raw) : raw;
    });
    return input;
  }

  /** この端末の今日（日本時間）の { year, month, day }。 */
  function readJstToday() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date());
    var pick = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return Number(parts[i].value);
      return 0;
    };
    return { year: pick('year'), month: pick('month'), day: pick('day') };
  }

  /** 運勢表の開始日を、この端末の今日（日本時間）にする。 */
  function fillStartDateToday() {
    var today = readJstToday();
    byId('inpStartYear').value = String(today.year);
    byId('inpStartMonth').value = String(today.month);
    byId('inpStartDay').value = String(today.day);
  }

  // ---- 記録 ----
  function addRecord(label, ms, verdict, detail) {
    var record = { at: new Date(), label: label, ms: ms, verdict: verdict, detail: detail || '' };
    records.push(record);
    renderRecord(record);
  }

  function renderRecord(record) {
    var item = document.createElement('li');
    item.appendChild(document.createTextNode(formatRecordHead(record)));
    if (record.verdict) {
      var verdict = document.createElement('span');
      verdict.className = record.verdict === '合格' ? 'is-ok' : (record.verdict === '不合格' ? 'is-ng' : 'is-note');
      verdict.textContent = ' ' + record.verdict;
      item.appendChild(verdict);
    }
    if (record.detail) item.appendChild(document.createTextNode(' — ' + record.detail));
    byId('outRecords').appendChild(item);
  }

  function formatRecordHead(record) {
    return record.at.toLocaleTimeString('ja-JP') + ' ' + record.label + (record.ms === null ? '' : ' ' + record.ms + 'ms');
  }

  function formatRecordLine(record) {
    return formatRecordHead(record) + (record.verdict ? ' ' + record.verdict : '') + (record.detail ? ' — ' + record.detail : '');
  }

  function buildRecordsText() {
    var header = [
      'ページ: ' + location.origin + location.pathname,
      'ビルド: ' + (CONFIG.commit || '不明') + ' ' + (CONFIG.builtAt || ''),
      '表示: ' + describeDisplayMode() + ' ' + window.innerWidth + 'x' + window.innerHeight,
      'UA: ' + navigator.userAgent
    ];
    return header.concat(records.map(formatRecordLine)).join('\n');
  }

  // ---- 利用者に見せる知らせ（計測の記録は折りたたみの中にあるため、失敗などはここに出す） ----
  /** targetId の欄に知らせを書く。isError なら目立たせる。 */
  function renderMessage(targetId, text, isError) {
    var element = byId(targetId);
    element.textContent = text;
    element.className = 'message' + (isError ? ' is-ng' : '');
  }

  // ---- 画面の切り替え ----
  /** ページ内の印から開く画面の名前（知らない印・空はメニュー）。 */
  function readRouteName() {
    var name = String(location.hash || '').replace(/^#/, '');
    return Object.prototype.hasOwnProperty.call(SCREENS, name) && !UNROUTED_SCREENS[name] ? name : DEFAULT_ROUTE;
  }

  /** ログインなしで出せる画面か（画面に鑑定が出ているときの「鑑定する」だけ。結果の表示・送る・印刷にサーバーは要らない）。 */
  function canShowRoute(name) {
    return hasSession() || (name === 'kantei' && currentWork !== null);
  }

  /** いまの印とログインの状態から、出す画面を1つ決めて出す。 */
  function renderRoute() {
    var route = readRouteName();
    var screen = route;
    if (route === 'terms') screen = 'terms';   // 規約・ポリシーはログインの前でも読める
    else if (needsRelogin || !canShowRoute(route)) screen = 'login';
    else if (needsAgreement()) screen = 'agree';
    Object.keys(SCREENS).forEach(function (name) { byId(SCREENS[name]).hidden = name !== screen; });
    byId('lnkMenu').hidden = screen === 'login' || screen === 'agree' || screen === 'menu';
    byId('btnLoginBack').hidden = !(needsRelogin && canShowRoute(route));
    byId('outReloginNote').hidden = hasSession() || !currentWork;
    if (screen !== shownScreen) {
      shownScreen = screen;
      document.documentElement.scrollTop = 0;   // 画面が変わったら上から見せる
      document.body.scrollTop = 0;
    }
  }

  /** name の画面へ移る（印を変えるとブラウザの戻るで前の画面に戻れる）。 */
  function goTo(name) {
    if (location.hash !== '#' + name) location.hash = '#' + name;
    renderRoute();
  }

  /** 「鑑定する」の画面の目次（結果があるときだけ出す）。 */
  function renderToc() {
    byId('navToc').hidden = byId('secResult').hidden;
  }

  /** 目次の項目：同じページの中の、その場所へ移る。 */
  function handleTocClick(event) {
    var item = event.target && event.target.closest ? event.target.closest('[data-scroll-to]') : null;
    if (item) scrollToElement(item.getAttribute('data-scroll-to'));
  }

  function scrollToElement(id) {
    var target = byId(id);
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function handleReloginClick() {
    needsRelogin = true;
    renderRoute();
  }

  function handleLoginBackClick() {
    needsRelogin = false;
    renderRoute();
  }

  // ---- 鑑定結果 ----
  /** 前の鑑定の結果を消す（前のお客さんの内容を残さない。docs/web-screen-items.md §1 の 0）。 */
  function clearResult() {
    byId('outInfo').textContent = '';
    renderClientLines(null);
    RESULT_GROUPS.forEach(function (group) { byId(group[0]).textContent = ''; });
    byId('secResult').hidden = true;
    closedKeys = {};
    textEdits = {};
    currentWork = null;
    if (sendPanel) sendPanel.clear();
    renderToc();
    renderReportCount();
  }

  /**
   * 画面に出す鑑定。kanteiAt はミニ年運の「今年」を決めた時刻（続きからでも同じ時刻で作り直し、同じ原文にする）。
   * draft を渡すと（続きから）その作業の番号と版を引き継ぐ。省くと新しい作業になり、baseRev（送った時点の端末の1件の版）を控える
   */
  function createWork(input, name, kanteiAt, model, draft, baseRev) {
    return {
      workId: draft ? draft.workId : VIEW.createWorkId(), ownerId: session.loginId, input: input, name: name,
      kanteiAt: kanteiAt, model: model, digests: VIEW.buildSectionDigests(model), originals: VIEW.collectEditables(model),
      knownRev: draft ? draft.rev : (baseRev || ''), isStale: false, saveFailed: false
    };
  }

  /** 端末にいま残っている1件の版の印（なければ ''）。 */
  function readStoredRev() {
    var stored = VIEW.readWorkDraft();
    return stored ? stored.rev : '';
  }

  /** 印刷に出す「〇〇 様　鑑定日 …」（命式・運勢表と鑑定書の始まり。PDF の頭と同じ中身。2026-10-23 ガクさん）。model がなければ消す。 */
  function renderClientLines(model) {
    var text = '';
    if (model) {
      var info = model.info;
      var parts = [];
      if (info.name && info.name !== '-') parts.push(info.name + ' 様');
      parts.push('鑑定日 ' + (info.kanteiDate || '-'));
      text = parts.join('　');
    }
    byId('outClientLineCalc').textContent = text;
    byId('outClientLineReport').textContent = text;
  }

  /** 鑑定を画面に書き、端末に残す。draft があれば（続きから）閉じた項目・書き直し・メモ・控えを当てる。 */
  function showWork(work, draft) {
    VIEW.renderResultInfo(byId('outInfo'), work.model);
    renderClientLines(work.model);
    RESULT_GROUPS.forEach(function (group) { VIEW.renderResultGroup(byId(group[0]), work.model, group[1]); });
    closedKeys = {};
    if (draft) Object.keys(draft.closedKeys).forEach(function (key) { closedKeys[key] = true; });
    applyClosedKeys();
    textEdits = draft ? VIEW.copyTextEdits(draft.edits) : {};
    VIEW.applyTextEditsToDom(byId('secResult'), textEdits, work.originals);
    byId('secResult').hidden = false;
    sendPanel.setResult(work.model);
    if (draft) sendPanel.restoreWorkState({ memo: draft.memo, sent: VIEW.readDraftSent(draft) });
    currentWork = work;
    renderToc();
    renderReportCount();
    saveCurrentWork();
  }

  /**
   * 応答の dataRows から仮想の _data を新しく作り、結果の画面に書く。失敗しても画面の流れは止めない。
   * name・input は送った時点の氏名と入力（応答を待つ間に書き換えられても、送った入力と違うものを付けない）。
   */
  function renderResult(dataRows, name, input, baseRev) {
    try {
      var now = new Date();
      var model = VIEW.buildResultModel(VIEW.buildDataTable(dataRows), name, now);
      showWork(createWork(input, name, now.getTime(), model, null, baseRev), null);
      return true;
    } catch (e) {
      clearResult();
      addRecord('表示', null, '', '結果を表示できませんでした');
      return false;
    }
  }

  // ---- 作業中の鑑定（端末に1件。docs/product-spec.md §4.2、work_draft.js） ----
  /** 端末に残っている、いまログインしている ID の作業中の鑑定（別の ID の分は、ないものとして扱い中身を見せない）。 */
  function readOwnDraft() {
    var draft = VIEW.readWorkDraft();
    return draft && hasSession() && draft.ownerId === session.loginId ? draft : null;
  }

  /** 端末の1件の版が、この画面の知っている版と違えば古い画面として扱う（以後は書かない）。 */
  function checkWorkStale() {
    if (!currentWork || currentWork.isStale) return;
    if (readStoredRev() !== currentWork.knownRev) currentWork.isStale = true;
  }

  /** 画面に出している鑑定を端末に残し直す。別のタブで新しい作業に置き換わっていたら上書きしない。 */
  function saveCurrentWork() {
    var target = currentWork;
    if (!target) return;
    // 照らし合わせと書くを、ほかのタブと割り込まれずに一続きで行う（Codex P1。work_draft.js の runWithDraftLock）
    lastSavePromise = VIEW.runWithDraftLock(function () {
      if (currentWork !== target) return;   // 待つ間に別の鑑定に変わった（新しい鑑定は自分で残す）
      checkWorkStale();
      if (!target.isStale) {
        var work = sendPanel.readWorkState();   // 書く時点の最新の欄・控え・開閉
        var rev = VIEW.createWorkId();
        var saved = VIEW.writeWorkDraft(VIEW.buildWorkDraft(target, {
          rev: rev, closedKeys: closedKeys, edits: textEdits, memo: work.memo, sent: work.sent
        }));
        target.saveFailed = !saved;
        if (saved) target.knownRev = rev;
      }
      renderDraftCard();
    });
  }

  /**
   * 端末の1件が rev の版のときだけ消す（別のタブ・画面が書き換えた新しい内容は消さない）。
   * 返す値：'removed'（消えた。もともと残っていなかったときも）・'changed'（別の版に変わっていたので消さない）・'failed'（消せなかった）
   */
  function clearStoredDraftIfRev(rev) {
    var stored = VIEW.readWorkDraft();
    // 読めないとき（保存が使えなくなった・読めない形）も「残っていない」とは決めず、消して確かめる（Codex P2）
    if (!stored) return VIEW.clearWorkDraft() ? 'removed' : 'failed';
    if (stored.rev !== rev) return 'changed';
    return VIEW.clearWorkDraft() ? 'removed' : 'failed';
  }

  /** 別のタブ・画面で端末の保存が変わった。 */
  function handleStorageChange(event) {
    if (event.key !== null && event.key !== VIEW.DRAFT_STORAGE_KEY) return;
    checkWorkStale();
    renderDraftCard();
  }

  /** 「作業中の鑑定」の欄の状態とボタン（知らせと自分に送る手段は showDraftProblem が書く）。 */
  function renderDraftCard() {
    var status = '';
    var canResume = false;
    // 画面に出している鑑定の状態は、ログインの期限が切れても出す（端末への保存にサーバーは要らない。Codex P2）
    if (currentWork && currentWork.isStale) {
      status = '別の画面（タブ）で作業中の鑑定が置き換わったか消されたため、この画面の鑑定は端末に残していません（この画面での変更は残りません）。' +
        '続けるときは、先に自分用の記録を残してください';
    } else if (currentWork) {
      status = !currentWork.saveFailed
        ? 'いま開いている鑑定（' + currentWork.model.info.name + '）をこの端末に残しています'
        : 'いま開いている鑑定を端末に残せませんでした（ブラウザの設定や容量のため）。画面を閉じると消えるため、先に自分用の記録を残してください';
    } else {
      var draft = draftProblem ? draftProblem.draft : readOwnDraft();
      if (draft) {
        status = '作業中の鑑定があります：' + draft.info.name + '・生年月日 ' + draft.info.birthDate +
          '・最後に保存 ' + VIEW.formatJstDateTime(new Date(draft.savedAt));
        // 続きからは計算し直すためログインが要る（期限切れなら、ログインし直すと出る）
        canResume = hasSession() && (!draftProblem || draftProblem.canResume);
      }
    }
    byId('secDraft').hidden = status === '';
    byId('outDraftStatus').textContent = status;
    byId('btnDraftOpen').hidden = !currentWork;
    byId('btnDraftResume').hidden = !canResume;
    byId('btnDraftResume').disabled = isBusy;
    byId('btnDraftClear').hidden = status === '';
    byId('btnDraftClear').disabled = isBusy;
  }

  /** 続きから再開できなかった。知らせと、残っている書き直し・メモ・控えを自分に送る手段を出す（端末の1件は消さない）。 */
  function showDraftProblem(draft, message, canResume) {
    draftProblem = { canResume: canResume, draft: draft };
    renderMessage('outDraftMessage', message, true);
    VIEW.renderShareTextParts(byId('outDraftRecordParts'), VIEW.buildRecordMessages({
      info: draft.info, sent: VIEW.readDraftSent(draft), noBodyNote: DRAFT_NO_BODY_TEXT,
      edits: VIEW.listTextEdits(draft.edits), memo: draft.memo
    }));
    renderDraftCard();
  }

  function clearDraftProblem() {
    draftProblem = null;
    pendingFresh = null;
    renderMessage('outDraftMessage', '', false);
    byId('outDraftRecordParts').textContent = '';
    byId('outDraftRecordParts').removeAttribute('data-generation');
  }

  /**
   * 新しく鑑定する前に、端末の作業中の鑑定が置き換わってよいか確かめる（ページの中の窓。VIEW.askConfirm）。
   * 返す値：Promise。やめたら null（サーバーへは送らない）。よければ、確かめる前に読んだ1件の版（なければ ''）。
   *   この版を鑑定の基準にする（確認を開いている間に別のタブが書いた、見ていない作業は置き換えない。Codex P1）
   */
  function confirmReplaceWork() {
    var draft = VIEW.readWorkDraft();
    var rev = draft ? draft.rev : '';
    if (!draft && !currentWork) return Promise.resolve(rev);
    var message = draft && draft.ownerId !== session.loginId
      ? 'この端末には、別の ID の作業中の鑑定が1件残っています。新しく鑑定すると、それは消えて置き換わります。よろしいですか'
      : '作業中の鑑定を端末から消して、新しく鑑定します（消す前に自分用の記録を残しておくと控えが残ります）。よろしいですか';
    // 確かめている間の基準は、確かめる前の状態（画面の鑑定と版）で控える
    var base = captureReplaceBase(rev);
    isConfirming = true;
    return VIEW.askConfirm(message, { okLabel: '新しく鑑定する' }).then(function (isOk) {
      isConfirming = false;
      return isOk ? base : null;
    });
  }

  /**
   * 置き換えの基準を控える。rev は確かめる前に読んだ版。そのときの端末の1件がこの画面の鑑定なら、それも控える
   * （確かめたあとに待っていた自分の保存が版を進めても、その保存のあとの版を基準にできる。Codex P2）
   */
  function captureReplaceBase(rev) {
    return { rev: rev, own: currentWork && currentWork.knownRev === rev ? currentWork : null };
  }

  /** 控えた基準から、鑑定の基準にする版を読む（待っていた保存のあとに呼ぶ）。別のタブが書いて古い画面になっていたら、確かめた版のまま。 */
  function readReplaceBase(base) {
    return base.own && !base.own.isStale ? base.own.knownRev : base.rev;
  }

  function handleDraftResumeClick() {
    if (isBusy || !hasSession()) return;
    var draft = readOwnDraft();
    if (!draft) { renderDraftCard(); return; }
    clearDraftProblem();
    clearResult();
    fillInputForm(draft.input);
    byId('inpName').value = draft.name;
    formOwnerId = session.loginId;
    setBusy(true);
    renderMessage('outDraftMessage', '計算し直しています…', false);
    // 送るのは残した入力だけ（氏名・メモ・控えは送らない）
    postAction({ action: 'web_kantei', token: session.token, input: draft.input }).then(function (result) {
      var json = result.json;
      updateUsage(json);
      if (!json.ok) {
        updateSessionFromError(json);
        addRecord('続きから', result.ms, '', describeError(json));
        showDraftProblem(draft, '続きから再開できませんでした（' + describeError(json) + '。あとで「続きから」をやり直せます）。端末の作業中の鑑定は消していません。' +
          '残っている書き直し・メモ・控えは、下から自分用の記録として送れます', true);
        return;
      }
      addRecord('続きから', result.ms, '', '今月 ' + json.used + '回');
      resumeFromRows(draft, json.dataRows || []);
    }).then(function () { setBusy(false); });
  }

  /** 計算し直した結果に、残っていた閉じた項目・書き直し・欄・控えを当てる。原文の要約値が1つでも違えば当てない。 */
  function resumeFromRows(draft, dataRows) {
    var table;
    var work;
    try {
      table = VIEW.buildDataTable(dataRows);
      work = createWork(draft.input, draft.name, draft.kanteiAt, VIEW.buildResultModel(table, draft.name, new Date(draft.kanteiAt)), draft);
    } catch (e) {
      showDraftProblem(draft, '続きから再開できませんでした（結果を表示できませんでした）。端末の作業中の鑑定は消していません。残っている書き直し・メモ・控えは、下から自分用の記録として送れます', true);
      return;
    }
    // 送ったのは残した入力そのものなので、入力は一致している。あとは原文がすべて同じときだけ当てる
    if (!VIEW.isSameDigests(draft.digests, work.digests)) {
      showDraftProblem(draft, 'アプリが更新されたため、続きから再開できません（書き直し・閉じた項目などは当てていません）。残っている書き直し・メモ・控えを下から自分用の記録として送ってから、' +
        '「作業中の鑑定を消す」を押してください。消すと、いま計算し直した結果を新しい鑑定として出します', false);
      pendingFresh = { table: table, input: draft.input, name: draft.name };
      return;
    }
    showWork(work, draft);
    renderMessage('outDraftMessage', '', false);
    renderMessage('outKanteiMessage', '続きから再開しました', false);
    goTo('kantei');   // 再開した鑑定の画面へ移り、結果を見せる
    scrollToElement('secResult');
  }

  /**
   * 「作業中の鑑定を消す」（メニューの欄のボタンと、自分に送ったあとのボタン）。
   * messageId は結果を知らせる欄（押したボタンのある画面の欄）
   */
  function requestClearWork(messageId) {
    if (isBusy || isConfirming) return;
    // 確かめる前の対象を控える（窓を開いている間・排他を待つ間に、別のタブが書いた見ていない作業は消さない。Codex P1・P2）。
    // 画面の鑑定の版は排他の中で読む（先に並んでいた保存で版が進んでいることがあるため）
    var own = currentWork || draftProblem ? null : readOwnDraft();
    var target = {
      work: currentWork, fresh: pendingFresh, messageId: messageId,
      rev: draftProblem ? draftProblem.draft.rev : (own ? own.rev : null)
    };
    isConfirming = true;
    VIEW.askConfirm('作業中の鑑定をこの端末から消しますか。画面の結果・メモ・控えも消えます', { okLabel: '消す' }).then(function (isOk) {
      isConfirming = false;
      if (isOk && !isBusy) clearWorkConfirmed(target);
    });
  }

  function clearWorkConfirmed(target) {
    // 消し終わるまで、ほかの操作（新しい鑑定など）をさせない
    setBusy(true);
    // 照らし合わせと消すを、ほかのタブと割り込まれずに一続きで行う
    VIEW.runWithDraftLock(function () { clearWorkInLock(target); }).then(function () { setBusy(false); });
  }

  /** 「作業中の鑑定を消す」の中身（runWithDraftLock の中で行う）。target は requestClearWork で控えた対象。 */
  function clearWorkInLock(target) {
    var fresh = target.fresh;
    // 消すのは、この画面が知っている版のままのときだけ（別のタブ・画面が書き換えた新しい内容は消さない）
    var outcome = 'removed';
    if (target.work) outcome = clearStoredDraftIfRev(target.work.knownRev);
    else if (target.rev !== null) outcome = clearStoredDraftIfRev(target.rev);
    if (outcome === 'failed') {
      // 消せなかった（ブラウザの設定など）。画面はそのままにして、消せていないことを知らせる
      renderMessage(target.messageId,
        '端末から消せませんでした（ブラウザの設定のため）。作業中の鑑定は端末に残っています。ブラウザのサイトのデータを消すと消えます', true);
      return;
    }
    clearDraftProblem();
    clearResult();
    if (outcome === 'removed' && fresh) showFreshResult(fresh);
    else if (outcome === 'removed') renderMessage(target.messageId, '作業中の鑑定を端末から消しました', false);
    else {
      // 別のタブ・画面が書き換えていた。そちらの作業は残し、計算し直した結果も出さない（上書きしないため）
      renderMessage(target.messageId, '画面の結果を消しました。端末の作業中の鑑定は別の画面で変わっていたため、そのまま残しています', false);
    }
    renderDraftCard();
  }

  /** 原文が変わっていたときに作り直した結果を、新しい鑑定として出す（月の回数を使い直さないため）。 */
  function showFreshResult(fresh) {
    try {
      var now = new Date();
      showWork(createWork(fresh.input, fresh.name, now.getTime(), VIEW.buildResultModel(fresh.table, fresh.name, now), null, readStoredRev()), null);
      renderMessage('outKanteiMessage', '作業中の鑑定を消し、計算し直した結果を新しい鑑定として出しました', false);
      goTo('kantei');
    } catch (e) {
      clearResult();
      renderMessage('outKanteiMessage', '作業中の鑑定を消しました（計算し直した結果は表示できませんでした）', true);
    }
  }

  /** 閉じた項目を画面に当てる。まとまりの項目がすべて閉じていたら、その見出しも印刷に出さない（中身のない見出しを残さない）。 */
  function applyClosedKeys() {
    VIEW.applyClosedSections(byId('secResult'), closedKeys);
    RESULT_GROUPS.forEach(function (group) {
      var blocks = byId(group[0]).querySelectorAll('.result-block[data-section-key]');
      var allClosed = blocks.length > 0;
      for (var i = 0; i < blocks.length; i++) if (!/\bis-closed\b/.test(blocks[i].className)) allClosed = false;
      // 見出しの元のクラス（鑑定書の report-title など）は残し、is-all-closed だけを付け外しする（Codex P2）
      byId(group[2]).classList.toggle('is-all-closed', allClosed);
      // 鑑定書の章がすべて閉じていたら、鑑定書のまとまりごと印刷に出さない（屋号の帯だけのページを作らない。Codex P2）
      if (group[1] === 'report') byId('secReport').classList.toggle('is-all-closed', allClosed);
    });
  }

  /**
   * 鑑定書の字数（項目・鑑定文・合計）。鑑定士は字数を品質の目安にし、「3000字以上」のように字数で納めるため出す（2026-10-21・22 ガクさん）。
   * 上（画面だけ）は送る分と、閉じた章があれば全体も。鑑定書の最後（印刷・納品物）は送る分だけ
   */
  function renderReportCount() {
    var element = byId('outReportCount');
    var endText = '';
    element.textContent = '';
    if (currentWork) {
      // 合計を大きく、内訳と数え方は小さく分ける（1行に詰めると読みにくかった。2026-10-23 ガクさん）
      var count = VIEW.countReportChars(currentWork.model, textEdits, closedKeys);
      element.appendChild(VIEW.createElement('span', 'report-count-total', '相手に送る分 ' + count.open.total + '字'));
      element.appendChild(VIEW.createElement('span', 'report-count-detail',
        '項目 ' + count.open.items + '字 ＋ 鑑定文 ' + count.open.body + '字' +
        (count.all.total !== count.open.total ? '（鑑定書全体は ' + count.all.total + '字）' : '')));
      element.appendChild(VIEW.createElement('span', 'report-count-rule', '項目名・見出し・空白・改行は数えません'));
      endText = '本鑑定書の文字数： ' + VIEW.formatReportCharCount(count.open);
    }
    byId('outReportCountEnd').textContent = endText;
  }

  /** 鑑定文の書き直しが変わった（text_edit.js）。作ったファイルと文章は作り直しになる。 */
  function handleTextEditChanged() {
    sendPanel.notifyTextChanged();
    renderReportCount();
    saveCurrentWork();
  }

  /** 送る項目の一覧（send_panel.js）で、keys の項目をまとめて閉じる・開く。本文の「閉じる」と同じ扱い。 */
  function setSectionsClosed(keys, isClosed) {
    if (!currentWork) return;
    keys.forEach(function (key) { if (isClosed) closedKeys[key] = true; else delete closedKeys[key]; });
    handleClosedKeysChanged();
  }

  function handleClosedKeysChanged() {
    applyClosedKeys();
    sendPanel.notifyItemsChanged();
    renderReportCount();
    saveCurrentWork();
  }

  /** 項目の「閉じる／開く」。閉じた項目は送る・印刷に載せない。作ったファイルと文章は作り直しになる。 */
  function handleSectionToggleClick(event) {
    var toggle = event.target && event.target.closest ? event.target.closest('button.section-toggle') : null;
    if (!toggle) return;
    var key = toggle.getAttribute('data-section-key');
    if (closedKeys[key]) delete closedKeys[key]; else closedKeys[key] = true;
    handleClosedKeysChanged();
  }

  function readNameInput() { return String(byId('inpName').value).trim(); }

  // ---- 画面の状態 ----
  function setBusy(flag) {
    isBusy = flag;
    refreshControls();
  }

  function refreshControls() {
    var canCall = !isBusy && isEndpointConfigured();
    byId('btnLogin').disabled = !canCall;
    byId('btnKanteiOnce').disabled = !(canCall && hasSession() && !needsAgreement());
    byId('btnKanteiStreak').disabled = !(canCall && hasSession() && !needsAgreement());
    byId('btnAgree').disabled = !(canCall && needsAgreement() && !isTermsStale());
    byId('btnAgreeDecline').disabled = isBusy;
    if (needsAgreement() && isTermsStale()) renderMessage('outAgreeMessage', ERROR_MESSAGES.terms_version, true);
    renderSession();
    renderDraftCard();
    renderRoute();   // ログインの期限が切れたら、ログインを出す
  }

  function renderSession() {
    var text = '未ログイン';
    if (hasSession()) {
      // 鑑定の回数は無制限のため、回数は出さない（2026-10-21 決定。docs/product-spec.md §8 の 4）
      text = session.loginId + '・' + new Date(session.expiresAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + 'まで';
    }
    byId('outSession').textContent = text;
  }

  function isEndpointConfigured() { return ENDPOINT_PATTERN.test(String(CONFIG.endpoint || '')); }

  /** 失敗の応答をログインの状態に反映する（期限切れは忘れる。規約の版が上がったら同意し直すまで鑑定しない）。 */
  function updateSessionFromError(json) {
    if (json.error === 'invalid_token') session = createEmptySession();
    if (json.error === 'terms_required') {
      session.termsOk = false;
      session.termsVersion = String(json.termsVersion || '');
    }
  }

  function updateUsage(json) {
    if (typeof json.used === 'number') session.used = json.used;
  }

  // ---- 操作 ----
  function handleLoginClick() {
    if (isBusy) return;
    var id = String(byId('inpLoginId').value).trim();
    var pw = String(byId('inpLoginPw').value);
    if (id === '' || pw === '') {
      addRecord('ログイン', null, '', 'ID とパスワードを入れてください');
      renderMessage('outLoginMessage', 'ID とパスワードを入れてください', true);
      return;
    }
    setBusy(true);
    postAction({ action: 'web_login', id: id, pw: pw }).then(function (result) {
      byId('inpLoginPw').value = '';   // パスワードは画面に残さない
      var json = result.json;
      if (json.ok) {
        // 同意の要否を返さないサーバー（同意の仕組みの前の版）では、同意済みとして扱う
        session = { token: json.token, expiresAt: json.expiresAt, used: json.used, loginId: id,
          termsOk: json.agreeRequired !== true, termsVersion: String(json.termsVersion || '') };
        renderMessage('outAgreeMessage', '', false);
        needsRelogin = false;
        clearDraftProblem();
        if ((formOwnerId && formOwnerId !== id) || (currentWork && currentWork.ownerId !== id)) {
          // 別の ID に前の ID の結果・入力を見せない（期限切れで session が空になっていても formOwnerId で分かる）
          clearResult();
          fillInputForm(SAMPLE_INPUT);
          byId('inpName').value = '';
        }
        formOwnerId = id;
        addRecord('T8(1) ログイン', result.ms, judgeCold(result.ms, result.idle), result.idle.text + '・応答 ' + result.bytes + 'バイト');
        renderMessage('outLoginMessage', 'ログインしました', false);
      } else {
        addRecord('ログイン', result.ms, '', describeError(json));
        renderMessage('outLoginMessage', describeError(json), true);
      }
    }).then(function () { setBusy(false); });
  }

  /** 同意の画面の「同意する」：画面に出した版をサーバーに送る。同意できたら、開こうとしていた画面へ進む。 */
  function handleAgreeClick() {
    if (isBusy || !needsAgreement() || isTermsStale()) return;
    setBusy(true);
    renderMessage('outAgreeMessage', '同意を送っています…', false);
    postAction({ action: 'web_agree', token: session.token, version: VIEW.TERMS_VERSION }).then(function (result) {
      var json = result.json;
      if (json.ok) {
        session.termsOk = true;
        addRecord('同意', result.ms, '', '第' + String(json.termsVersion) + '版');
        renderMessage('outAgreeMessage', '', false);
        return;
      }
      updateSessionFromError(json);
      if (json.error === 'terms_version') session.termsVersion = String(json.termsVersion || '');
      addRecord('同意', result.ms, '', describeError(json));
      // 期限切れならログインの画面に出す（同意の画面は閉じる）
      renderMessage(hasSession() ? 'outAgreeMessage' : 'outLoginMessage', describeError(json), true);
    }).then(function () { setBusy(false); });
  }

  /** 同意の画面の「同意しない」：ログインを取り消す（同意しないと鑑定できないため）。 */
  function handleAgreeDeclineClick() {
    session = createEmptySession();
    renderMessage('outLoginMessage', '同意いただけない場合は、本サービスをご利用いただけません。ログインを取り消しました', true);
    refreshControls();
  }

  /** web_kantei を1回呼び、記録を残す。isColdTrial なら T8(1) の合否を付ける。成功なら所要時間、失敗なら null を返す。 */
  /** baseRev は置き換えてよいと確かめた端末の1件の版（readReplaceBase の返す値）。 */
  /** request（{ name, input }）を渡すと、その氏名と入力で鑑定する（押した時点の値。待つ間に書き換えられても変えない）。 */
  function runKanteiOnce(label, isColdTrial, baseRev, request) {
    clearResult();
    clearDraftProblem();
    var name = request ? request.name : readNameInput();   // 送る時点の氏名を控える（サーバーには送らない）
    var input = request ? request.input : readInputForm();
    formOwnerId = session.loginId;
    // baseRev：置き換えを確かめた1件の版。待つ間に別のタブが書いていたら、結果を端末に残さない
    renderMessage('outKanteiMessage', '鑑定しています…', false);
    // 端末の作業中の鑑定は、新しい結果を出せたときに置き換わる（失敗したら前の1件が残り、続きから再開できる）
    return postAction({ action: 'web_kantei', token: session.token, input: input }).then(function (result) {
      var json = result.json;
      if (!json.ok) {
        updateSessionFromError(json);
        updateUsage(json);
        addRecord(label, result.ms, '', describeError(json));
        renderMessage('outKanteiMessage', describeError(json), true);
        return null;
      }
      updateUsage(json);
      var detail = result.idle.text + '・応答 ' + result.bytes + 'バイト・dataRows ' + (json.dataRows || []).length + '行・今月 ' + json.used + '回';
      addRecord(label, result.ms, isColdTrial ? judgeCold(result.ms, result.idle) : '', detail);
      var shown = renderResult(json.dataRows || [], name, input, baseRev);
      renderMessage('outKanteiMessage', shown ? '鑑定しました。結果は下に並んでいます（上の目次で移れます）' : '結果を表示できませんでした', !shown);
      return result.ms;
    });
  }

  function handleKanteiOnceClick() {
    if (isBusy || isConfirming || !hasSession()) return;
    var request = { name: readNameInput(), input: readInputForm() };   // 押した時点の氏名と入力
    confirmReplaceWork().then(function (base) {
      if (base === null || isBusy || !hasSession()) return;
      startKanteiOnce(base, request);
    });
  }

  function startKanteiOnce(base, request) {
    setBusy(true);
    // 待っている自分の保存が終わってから、基準の版を読む（Codex P2）
    lastSavePromise.then(function () {
      return runKanteiOnce('T8(1) 計算1回', true, readReplaceBase(base), request);
    }).then(function () {
      setBusy(false);
      if (currentWork) scrollToElement('secResult');   // 結果の先頭へ移る（入力は目次の「入力」で戻れる）
    });
  }

  function handleKanteiStreakClick() {
    if (isBusy || isConfirming || !hasSession()) return;
    confirmReplaceWork().then(function (base) {
      if (base === null || isBusy || !hasSession()) return;
      startKanteiStreak(base);
    });
  }

  function startKanteiStreak(base) {
    setBusy(true);
    var times = [];
    var chain = Promise.resolve(true);
    for (var i = 1; i <= STREAK_COUNT; i++) {
      chain = chain.then(createStreakStep(i, times, base));
    }
    chain.then(function (completed) {
      if (completed) {
        var median = calcMedian(times);
        addRecord('T8(2) 中央値', median, judgeWithin(median, LIMIT_MS.MEDIAN), times.join(', ') + ' ms');
      } else {
        addRecord('T8(2) 続けて' + STREAK_COUNT + '回', null, '', '途中で失敗したため中断しました');
      }
      setBusy(false);
    });
  }

  /**
   * 続けて呼ぶときの i 回目。前の回が失敗していたら呼ばずに false を渡す。
   * 1回目は控えた基準（待っていた保存のあとの版。Codex P2）、2回目からは前の回の保存が終わってから、この画面が知っている版を基準にする
   */
  function createStreakStep(index, times, base) {
    return function (previousOk) {
      if (!previousOk) return false;
      return lastSavePromise.then(function () {
        var baseRev = index === 1 || !currentWork ? readReplaceBase(base) : currentWork.knownRev;
        return runKanteiOnce('続けて ' + index + '/' + STREAK_COUNT, false, baseRev);
      }).then(function (ms) {
        if (ms === null) return false;
        times.push(ms);
        return true;
      });
    };
  }

  function handleCopyRecordsClick() {
    var text = buildRecordsText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        addRecord('記録をコピーしました', null, '', '');
      }, function () { copyByTextarea(text); });
    } else {
      copyByTextarea(text);
    }
  }

  /** クリップボード API が使えないときの代わり（選択してコピー）。 */
  function copyByTextarea(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
    document.body.removeChild(area);
    addRecord(copied ? '記録をコピーしました' : '記録をコピーできませんでした', null, '', '');
  }

  // ---- 開始 ----
  function init() {
    buildNumberSelects();
    fillInputForm(SAMPLE_INPUT);
    byId('btnLogin').addEventListener('click', handleLoginClick);
    byId('btnKanteiOnce').addEventListener('click', handleKanteiOnceClick);
    byId('btnKanteiStreak').addEventListener('click', handleKanteiStreakClick);
    byId('btnCopyRecords').addEventListener('click', handleCopyRecordsClick);
    byId('btnStartToday').addEventListener('click', fillStartDateToday);
    bindYearInputs();
    byId('secResult').addEventListener('click', handleSectionToggleClick);
    byId('navToc').addEventListener('click', handleTocClick);
    byId('btnRelogin').addEventListener('click', handleReloginClick);
    byId('btnLoginBack').addEventListener('click', handleLoginBackClick);
    byId('btnAgree').addEventListener('click', handleAgreeClick);
    byId('btnAgreeDecline').addEventListener('click', handleAgreeDeclineClick);
    VIEW.renderTermsDocument(byId('outAgreeTerms'));
    VIEW.renderTermsDocument(byId('outTermsDoc'));
    byId('btnDraftOpen').addEventListener('click', function () { goTo('kantei'); });
    byId('btnDraftResume').addEventListener('click', handleDraftResumeClick);
    byId('btnDraftClear').addEventListener('click', function () { requestClearWork('outDraftMessage'); });
    VIEW.attachTextEditor(byId('secResult'), {
      getEdits: function () { return textEdits; },
      getOriginals: function () { return currentWork ? currentWork.originals : {}; },
      onChanged: handleTextEditChanged
    });
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hashchange', renderRoute);
    var brandPanel = VIEW.createBrandPanel({
      onChanged: function () { sendPanel.notifyBrandChanged(); }
    });
    sendPanel = VIEW.createSendPanel({
      getClosedKeys: function () { return closedKeys; },
      getTextEdits: function () { return textEdits; },
      getBrand: brandPanel.getBrand,
      addRecord: addRecord,
      onWorkChanged: saveCurrentWork,
      onClearWorkRequest: function () { requestClearWork('outKanteiMessage'); },
      onSetClosed: setSectionsClosed
    });
    if (!isEndpointConfigured()) {
      addRecord('設定', null, '', '呼び先が未設定です（tools/web-build.sh でビルドしたものを開いてください）');
      renderMessage('outLoginMessage', '呼び先が未設定のため使えません', true);
    }
    refreshControls();
    window.setInterval(refreshControls, 60000);   // 期限切れになったら表示とボタンを更新する
    var readyMs = Math.round(performance.now());   // ページの読み込み開始から、操作できる状態になるまで
    byId('outReadyTime').textContent = readyMs + ' ms';
    addRecord('T1 操作できるまで', readyMs, judgeWithin(readyMs, LIMIT_MS.READY), describeDisplayMode());
  }

  init();
})();
