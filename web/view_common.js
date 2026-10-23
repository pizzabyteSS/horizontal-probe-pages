// ============================================================
// web/src/view_common.js — 結果の画面に共通の部品（段階2・段階3a-2）
// 設計：docs/web-screen-items.md §2（共通情報）・§4（表示のための加工）、docs/web-pdf-plan.md §4.3・§4.5・§4.7
//   値は必ず textContent で書く（鑑定文や応答の文字を HTML として解釈させない）
//   項目（開閉の単位）：{ key, title, closable, className, parts: [部品] }。画面・PDF・画像・印刷・自分用の文章が同じ項目を読む
//   部品：{ type: 'table', headers, rows, className } ／ { type: 'lines', text, className } ／
//         { type: 'heading', level, text, className } ／ { type: 'chart', title, points, color }
//   文の部品に editKey・editLabel があれば書き直せる（段階3b。text_edit.js）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // 共通情報の行（_data の行番号。api_master.js の _convertResultToDataRows_ の 35〜43行）
  var COMMON_ROW = { BIRTH_YEAR: 35, BIRTH_MONTH: 36, BIRTH_DAY: 37, SEX: 38, START_DATE: 39, BIRTH_TIME: 41, BIRTH_PLACE: 42, STYLE: 43 };
  var INFO_SECTION_KEY = 'info';
  // 横に長い表：この列数以上は、PDF・自分用の文章で行ごとのまとまりにする（印刷は表のまま。2026-10-21）（docs/web-pdf-plan.md §4.3）
  var WIDE_COLUMN_MIN = 7;
  var NOTE_HEADER = '解説';   // 行ごとのまとまりで全幅の段落にする列

  /** 要素を1つ作る。text があれば textContent に入れる。 */
  function createElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  /** 見出し付きのまとまり（section）を作って container に足し、中身を入れる先を返す。 */
  function appendSection(container, title) {
    var section = createElement('section', 'result-block');
    section.appendChild(createElement('h3', 'result-block-title', title));
    container.appendChild(section);
    return section;
  }

  /**
   * 表を作って parent に足す。headers は見出しの文字の配列（先頭は行の見出しの列）。
   * rows は [行の見出し, 値, 値, …] の配列。値は文字にそろえてから渡す。
   */
  function appendTable(parent, headers, rows, className) {
    var wrap = createElement('div', 'table-wrap');
    var table = createElement('table', 'result-table' + (className ? ' ' + className : ''));
    if (headers && headers.length) {
      var head = createElement('thead');
      var headRow = createElement('tr');
      for (var h = 0; h < headers.length; h++) headRow.appendChild(createElement('th', '', headers[h]));
      head.appendChild(headRow);
      table.appendChild(head);
    }
    var body = createElement('tbody');
    for (var r = 0; r < rows.length; r++) {
      var tr = createElement('tr');
      for (var c = 0; c < rows[r].length; c++) {
        tr.appendChild(createElement(c === 0 ? 'th' : 'td', '', rows[r][c]));
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    parent.appendChild(wrap);
    return table;
  }

  /** 改行を含む文を段落に分けて parent に足す。 */
  function appendLines(parent, text, className) {
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) parent.appendChild(createElement('p', className || 'result-text', lines[i]));
  }

  /**
   * 共通情報（鑑定日・氏名・性別・生年月日・出生時刻・出生地・流派）。GSS 版の _osGetCommonInfo_ に対応。
   * 氏名は画面に入力された値（サーバーには送らない。docs/product-spec.md §1）。それ以外は _data の 35〜43行。
   */
  function readCommonInfo(table, name) {
    return {
      kanteiDate: VIEW.formatYmd(table.get(COMMON_ROW.START_DATE, 2), table.get(COMMON_ROW.START_DATE, 3), table.get(COMMON_ROW.START_DATE, 4)),
      name: VIEW.formatOrDash(name),
      sex: VIEW.formatOrDash(table.get(COMMON_ROW.SEX, 2)),
      birthDate: VIEW.formatYmd(table.get(COMMON_ROW.BIRTH_YEAR, 2), table.get(COMMON_ROW.BIRTH_MONTH, 2), table.get(COMMON_ROW.BIRTH_DAY, 2)),
      birthTime: VIEW.formatOrDash(table.get(COMMON_ROW.BIRTH_TIME, 2)),
      birthPlace: VIEW.formatOrDash(table.get(COMMON_ROW.BIRTH_PLACE, 2)),
      style: VIEW.formatOrDash(table.get(COMMON_ROW.STYLE, 2))
    };
  }

  /** 鑑定情報の項目（閉じられない。docs/product-spec.md §4.2：鑑定日と計算に使った入力を必ず載せる）。 */
  function buildInfoSection(info) {
    return {
      key: INFO_SECTION_KEY, title: '鑑定情報', closable: false, parts: [{
        type: 'table', headers: null, className: 'is-info', rows: [
          ['鑑定日', info.kanteiDate],
          ['氏名', info.name],
          ['性別', info.sex],
          ['生年月日', info.birthDate],
          ['出生時刻', info.birthTime],
          ['出生地', info.birthPlace],
          ['流派', info.style]
        ]
      }]
    };
  }

  function appendCommonInfo(container, info) {
    renderSection(container, buildInfoSection(info));
  }

  // ---- 横に長い表（7列以上）の「行ごとのまとまり」。PDF・自分用の文章で使う（docs/web-pdf-plan.md §4.3） ----
  function countColumns(part) {
    var count = part.headers ? part.headers.length : 0;
    for (var r = 0; r < part.rows.length; r++) count = Math.max(count, part.rows[r].length);
    return count;
  }

  /** 見出しのある表で、列が WIDE_COLUMN_MIN 以上なら行ごとのまとまりにする。 */
  function isWideTable(part) {
    return !!(part.headers && part.headers.length) && countColumns(part) >= WIDE_COLUMN_MIN;
  }

  /**
   * 表の各行を { title：「見出し：値」, pairs：[[列名, 値]…], note：解説（なければ ''）, noteLabel } にする。
   * 値と並びは画面の表と同じ（列名は表の見出し）。
   */
  function buildWideRecords(part) {
    var headers = part.headers;
    var noteCol = headers.indexOf(NOTE_HEADER);
    return part.rows.map(function (row) {
      var pairs = [];
      for (var c = 1; c < row.length; c++) {
        if (c === noteCol) continue;
        pairs.push([headers[c] === undefined ? '' : String(headers[c]), String(row[c])]);
      }
      return {
        title: String(headers[0]) + '：' + String(row[0]),
        pairs: pairs,
        noteLabel: NOTE_HEADER,
        note: noteCol >= 0 && row[noteCol] !== undefined ? String(row[noteCol]) : ''
      };
    });
  }

  /** 行ごとのまとまりの「列名：値」を1行の文にする（PDF・自分用の文章。全角の空白で区切る）。 */
  function formatRecordPairs(pairs) {
    return pairs.map(function (pair) { return pair[0] + '：' + pair[1]; }).join('\u3000');
  }

  /** 部品を1つ parent に書く。 */
  function renderPart(parent, part) {
    if (part.type === 'table') {
      appendTable(parent, part.headers, part.rows, part.className);   // 印刷も表のまま（運勢表は横向きのページ。app.css）
    } else if (part.type === 'lines' && part.editKey) {
      VIEW.renderEditableLines(parent, part);   // 書き直せる文（段階3b。text_edit.js）
    } else if (part.type === 'lines') {
      appendLines(parent, part.text, part.className);
    } else if (part.type === 'heading') {
      parent.appendChild(createElement('h' + part.level, part.className, part.text));
    } else if (part.type === 'chart') {
      VIEW.appendLineChart(parent, part.title, part.points, part.color);
    }
  }

  /**
   * 項目を1つ container に書く（section・h3 の見出し・閉じるボタン・部品）。閉じられる項目には data-section-key と
   * 閉じるボタンを付ける。開閉の状態は applyClosedSections で当てる。
   */
  function renderSection(container, section) {
    var element = appendSection(container, section.title);
    if (section.className) element.className += ' ' + section.className;
    element.setAttribute('data-section-key', section.key);
    if (section.closable) {
      var toggle = createElement('button', 'section-toggle');
      toggle.type = 'button';
      toggle.setAttribute('data-section-key', section.key);
      element.appendChild(toggle);
      writeToggleState(element, toggle, false);
    }
    section.parts.forEach(function (part) { renderPart(element, part); });
    return element;
  }

  function renderSections(container, sections) {
    container.textContent = '';
    sections.forEach(function (section) { renderSection(container, section); });
  }

  function writeToggleState(element, toggle, isClosed) {
    element.className = element.className.replace(/\s*\bis-closed\b/g, '') + (isClosed ? ' is-closed' : '');
    toggle.setAttribute('aria-expanded', isClosed ? 'false' : 'true');
    toggle.textContent = isClosed ? '開く（いまは送らない・印刷しない）' : '閉じる（送らない）';
  }

  /** root の中の閉じられる項目に、closedKeys（{ key: true }）の開閉を当てる。 */
  function applyClosedSections(root, closedKeys) {
    var toggles = root.querySelectorAll('button.section-toggle');
    for (var i = 0; i < toggles.length; i++) {
      var key = toggles[i].getAttribute('data-section-key');
      writeToggleState(toggles[i].parentNode, toggles[i], !!closedKeys[key]);
    }
  }

  // ---- 確かめる画面（ページの中の小さな窓） ----
  // window.confirm は使わない：アプリの中のブラウザ（Claude のブラウザなど）では窓が出ずに「いいえ」になり、
  //   鑑定し直す・作業中の鑑定を消す・原文に戻すが黙って効かなかった（2026-10-23 ガクさんの実機確認）
  var openConfirm = null;   // 開いている窓（同時に1つだけ）

  /**
   * message を出して確かめる。options：{ okLabel（既定「はい」）, cancelLabel（既定「やめる」） }。
   * 返す値：Promise<true（はい）/ false（やめる・Esc）>。開いている間は、後ろの画面を押せない
   */
  function askConfirm(message, options) {
    var opts = options || {};
    if (openConfirm) openConfirm.close(false);   // 前の窓は「やめる」として閉じる
    return new Promise(function (resolve) {
      var overlay = createElement('div', 'confirm-overlay');
      var box = createElement('div', 'confirm-box');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      var text = createElement('p', 'confirm-message', message);
      text.id = 'outConfirmMessage';
      box.setAttribute('aria-describedby', text.id);
      box.appendChild(text);
      var buttons = createElement('div', 'confirm-buttons');
      var cancel = createElement('button', 'btn btn-sub confirm-cancel', opts.cancelLabel || 'やめる');
      var ok = createElement('button', 'btn confirm-ok', opts.okLabel || 'はい');
      cancel.type = 'button';
      ok.type = 'button';
      buttons.appendChild(cancel);
      buttons.appendChild(ok);
      box.appendChild(buttons);
      overlay.appendChild(box);
      var previousFocus = document.activeElement;
      var state = {
        close: function (answer) {
          if (openConfirm !== state) return;
          openConfirm = null;
          document.removeEventListener('keydown', handleKey, true);
          document.removeEventListener('focusin', handleFocusIn, true);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          // 窓を開く前の場所へ戻す（キーボードで続けて操作できるように）
          if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
          resolve(answer);
        }
      };
      // 開いている間は、キーボードの移動を窓の2つのボタンの中に留める（後ろの画面を操作させない。Codex P2）
      function handleKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); state.close(false); return; }
        if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === ok ? cancel : ok).focus();
        }
      }
      function handleFocusIn(event) {
        if (!box.contains(event.target)) ok.focus();
      }
      ok.addEventListener('click', function () { state.close(true); });
      cancel.addEventListener('click', function () { state.close(false); });
      document.addEventListener('keydown', handleKey, true);
      document.addEventListener('focusin', handleFocusIn, true);
      openConfirm = state;
      document.body.appendChild(overlay);
      if (typeof ok.focus === 'function') ok.focus();
    });
  }

  VIEW.askConfirm = askConfirm;
  VIEW.createElement = createElement;
  VIEW.appendSection = appendSection;
  VIEW.appendTable = appendTable;
  VIEW.appendLines = appendLines;
  VIEW.readCommonInfo = readCommonInfo;
  VIEW.appendCommonInfo = appendCommonInfo;
  VIEW.buildInfoSection = buildInfoSection;
  VIEW.isWideTable = isWideTable;
  VIEW.buildWideRecords = buildWideRecords;
  VIEW.formatRecordPairs = formatRecordPairs;
  VIEW.renderSection = renderSection;
  VIEW.renderSections = renderSections;
  VIEW.applyClosedSections = applyClosedSections;
  VIEW.INFO_SECTION_KEY = INFO_SECTION_KEY;
})();
