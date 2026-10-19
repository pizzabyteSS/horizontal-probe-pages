// ============================================================
// web/src/app.js — Web版 段階1（計測用の最小の画面）
// 設計：docs/web-screen-plan.md §4 段階1
//   ログイン（web_login）→ 計算（web_kantei）を呼び、所要時間と応答の大きさを記録する。応答の中身は整形しない
//   トークンはメモリにだけ持つ（読み込み直したらログインからやり直す）。端末に残すのは「前回の呼び出しの時刻」だけ
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  // ---- 定数 ----
  var CONFIG = window.HZ_WEB_CONFIG || {};
  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/AKfyc[A-Za-z0-9_-]+\/exec$/;
  var LIMIT_MS = { READY: 5000, COLD: 5000, MEDIAN: 3000 };   // 2026-10-16 決定（docs/web-server-plan.md §3.5）
  var COLD_IDLE_MINUTES = 30;
  var STREAK_COUNT = 5;
  var LAST_CALL_STORAGE_KEY = 'hzWeb.lastCallAt';
  var VERDICT_OUT_OF_SCOPE = '判定外';
  // 計測用の固定の入力（hzGate の case A と同じ）。氏名の欄は作らない（サーバーも受け取らない）
  var SAMPLE_INPUT = {
    year: 1985, month: 7, day: 14, hour: 10, min: 30, sex: '女性', birthPlace: '東京都',
    zokanStyle: '鳥海流', startYear: 2026, startMonth: 10, startDay: 1
  };
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
    limit: '今月の回数を使い切りました',
    rate_limited: '短い時間に呼び出しが多すぎます',
    busy: '混み合っています。少し待ってからやり直してください',
    invalid_input: '入力に誤りがあります',
    server_error: 'サーバーで失敗しました',
    network_error: '通信できませんでした',
    not_json: '応答を読めませんでした'
  };

  // ---- 状態（メモリだけ） ----
  var session = createEmptySession();
  var isBusy = false;
  var records = [];

  // ---- 小道具 ----
  function byId(id) { return document.getElementById(id); }

  function createEmptySession() { return { token: '', expiresAt: 0, used: null, limit: null }; }

  function hasSession() { return session.token !== '' && session.expiresAt > Date.now(); }

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
    return json.detail ? base + '：' + json.detail : base;
  }

  function describeDisplayMode() {
    var standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return standalone ? 'ホーム画面から起動' : 'ブラウザ';
  }

  // ---- 端末に残す値（前回の呼び出しの時刻だけ） ----
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
  function fillInputForm(input) {
    INPUT_FIELDS.forEach(function (field) {
      var value = input[field[0]];
      byId(field[1]).value = (value === undefined || value === null) ? '' : String(value);
    });
  }

  function readInputForm() {
    var input = {};
    INPUT_FIELDS.forEach(function (field) {
      var raw = String(byId(field[1]).value).trim();
      input[field[0]] = (field[2] && raw !== '') ? Number(raw) : raw;
    });
    return input;
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

  // ---- 画面の状態 ----
  function setBusy(flag) {
    isBusy = flag;
    refreshControls();
  }

  function refreshControls() {
    var canCall = !isBusy && isEndpointConfigured();
    byId('btnLogin').disabled = !canCall;
    byId('btnKanteiOnce').disabled = !(canCall && hasSession());
    byId('btnKanteiStreak').disabled = !(canCall && hasSession());
    renderSession();
  }

  function renderSession() {
    var text = '未ログイン';
    if (hasSession()) {
      text = 'ログイン中（今月 ' + session.used + '/' + session.limit + ' 回・期限 ' +
        new Date(session.expiresAt).toLocaleTimeString('ja-JP') + '）';
    }
    byId('outSession').textContent = text;
  }

  function isEndpointConfigured() { return ENDPOINT_PATTERN.test(String(CONFIG.endpoint || '')); }

  function forgetSessionIfInvalid(json) {
    if (json.error === 'invalid_token') session = createEmptySession();
  }

  function updateUsage(json) {
    if (typeof json.used === 'number') session.used = json.used;
    if (typeof json.limit === 'number') session.limit = json.limit;
  }

  // ---- 操作 ----
  function handleLoginClick() {
    if (isBusy) return;
    var id = String(byId('inpLoginId').value).trim();
    var pw = String(byId('inpLoginPw').value);
    if (id === '' || pw === '') {
      addRecord('ログイン', null, '', 'ID とパスワードを入れてください');
      return;
    }
    setBusy(true);
    postAction({ action: 'web_login', id: id, pw: pw }).then(function (result) {
      byId('inpLoginPw').value = '';   // パスワードは画面に残さない
      var json = result.json;
      if (json.ok) {
        session = { token: json.token, expiresAt: json.expiresAt, used: json.used, limit: json.limit };
        addRecord('T8(1) ログイン', result.ms, judgeCold(result.ms, result.idle), result.idle.text + '・応答 ' + result.bytes + 'バイト');
      } else {
        addRecord('ログイン', result.ms, '', describeError(json));
      }
    }).then(function () { setBusy(false); });
  }

  /** web_kantei を1回呼び、記録を残す。isColdTrial なら T8(1) の合否を付ける。成功なら所要時間、失敗なら null を返す。 */
  function runKanteiOnce(label, isColdTrial) {
    return postAction({ action: 'web_kantei', token: session.token, input: readInputForm() }).then(function (result) {
      var json = result.json;
      if (!json.ok) {
        forgetSessionIfInvalid(json);
        updateUsage(json);
        addRecord(label, result.ms, '', describeError(json));
        return null;
      }
      updateUsage(json);
      var detail = result.idle.text + '・応答 ' + result.bytes + 'バイト・dataRows ' + (json.dataRows || []).length + '行・今月 ' + json.used + '/' + json.limit;
      addRecord(label, result.ms, isColdTrial ? judgeCold(result.ms, result.idle) : '', detail);
      return result.ms;
    });
  }

  function handleKanteiOnceClick() {
    if (isBusy || !hasSession()) return;
    setBusy(true);
    runKanteiOnce('T8(1) 計算1回', true).then(function () { setBusy(false); });
  }

  function handleKanteiStreakClick() {
    if (isBusy || !hasSession()) return;
    if (session.limit !== null && session.used !== null && session.limit - session.used < STREAK_COUNT) {
      addRecord('T8(2) 続けて' + STREAK_COUNT + '回', null, '', '今月の残りが足りません（' + session.used + '/' + session.limit + '）');
      return;
    }
    setBusy(true);
    var times = [];
    var chain = Promise.resolve(true);
    for (var i = 1; i <= STREAK_COUNT; i++) {
      chain = chain.then(createStreakStep(i, times));
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

  /** 続けて呼ぶときの i 回目。前の回が失敗していたら呼ばずに false を渡す。 */
  function createStreakStep(index, times) {
    return function (previousOk) {
      if (!previousOk) return false;
      return runKanteiOnce('続けて ' + index + '/' + STREAK_COUNT, false).then(function (ms) {
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
    fillInputForm(SAMPLE_INPUT);
    byId('btnLogin').addEventListener('click', handleLoginClick);
    byId('btnKanteiOnce').addEventListener('click', handleKanteiOnceClick);
    byId('btnKanteiStreak').addEventListener('click', handleKanteiStreakClick);
    byId('btnCopyRecords').addEventListener('click', handleCopyRecordsClick);
    if (!isEndpointConfigured()) addRecord('設定', null, '', '呼び先が未設定です（tools/web-build.sh でビルドしたものを開いてください）');
    refreshControls();
    window.setInterval(refreshControls, 60000);   // 期限切れになったら表示とボタンを更新する
    var readyMs = Math.round(performance.now());   // ページの読み込み開始から、操作できる状態になるまで
    byId('outReadyTime').textContent = readyMs + ' ms';
    addRecord('T1 操作できるまで', readyMs, judgeWithin(readyMs, LIMIT_MS.READY), describeDisplayMode());
  }

  init();
})();
