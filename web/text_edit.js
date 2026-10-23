// ============================================================
// web/src/text_edit.js — 鑑定文の書き直し（段階3b）
// 設計：docs/product-spec.md §4.1 の 2（書き直す・原文を見る・原文に戻す）・§4.2（書き直した文も作業中の鑑定に残す）
//   書き直せるのは、項目の部品のうち editKey の付いた文（鑑定書の「あなたの傾向」と鑑定結果の本文。view_report.js）だけ
//   項目の一覧（view_result.js の buildResultModel）は原文のまま変えない。書き直しは { editKey: { label, text } } で別に持ち、
//     画面・PDF・画像・印刷・自分用の文章を作るときに当てる（applyTextEdits）。原文の要約値（work_draft.js）は原文から作る
//   原文は同じ入力から毎回作り直せるため、端末に残すのは書き直した文だけ（label は、原文を作り直せないときに
//     自分用の文章でどの文かを示すために一緒に残す）。原文と同じ文に戻したら、書き直しなしとして消す
//   ここでは書き直しの中身と画面の部品・操作を扱う（どこに残すか・何を作り直すかは app.js・send_panel.js）
//   各文の字数（空白・改行は数えない）をボタンの並びに出す。鑑定士は字数を品質の目安にするため（2026-10-21 ガクさん）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var BUTTON_LABELS = {
    open: '書き直す', close: '書き直しを閉じる',
    showOriginal: '原文を見る', hideOriginal: '原文を隠す',
    revert: '原文に戻す'
  };
  var EDITED_NOTE = '（書き直しています）';
  var EMPTY_NOTE = '（文が空です。このままだと、この文は送る・印刷に載りません）';
  var REVERTED_NOTE = '原文に戻しました';
  var REVERT_CONFIRM = 'この文を原文に戻しますか（書き直した文は消えます）';

  function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  /** 浅い写し（Object.assign の代わり）。 */
  function copyObject(source) {
    var out = {};
    Object.keys(source).forEach(function (key) { out[key] = source[key]; });
    return out;
  }

  /** 改行を \n にそろえる（端末によって \r\n で来ることがあるため）。 */
  function normalizeNewlines(text) {
    return String(text).replace(/\r\n?/g, '\n');
  }

  // ---- 中身（画面に依らない） ----
  /** 書き直せる文の原文（{ editKey: { label, text } }）。 */
  function collectEditables(model) {
    var out = {};
    model.groups.forEach(function (group) {
      group.sections.forEach(function (section) {
        section.parts.forEach(function (part) {
          if (part.editKey) out[part.editKey] = { label: String(part.editLabel || ''), text: String(part.text) };
        });
      });
    });
    return out;
  }

  var REPORT_SECTION_PREFIX = 'report.';   // 鑑定書の章（view_report.js の項目のキー）

  /** 表の行のうち、項目名（1列目）を除いた診断結果・意味の字数。 */
  function countTableValueChars(rows) {
    return (rows || []).reduce(function (n, row) {
      for (var c = 1; c < row.length; c++) n += countBodyChars(row[c] === undefined || row[c] === null ? '' : row[c]);
      return n;
    }, 0);
  }

  function createCharCount() { return { items: 0, body: 0, total: 0 }; }

  /**
   * 鑑定書の字数。書き直しを当てた後の文で数える。項目名・見出し・空白・改行は数えない（2026-10-22 ガクさん）
   *   items：主項目・副項目の表の診断結果と意味　body：鑑定文（あなたの傾向・鑑定結果の本文）　total：両方の合計
   * 返す値：{ open：送る章の分, all：全章 }。model は原文のまま、edits は書き直し（省いてよい）、closedKeys は閉じた項目
   */
  function countReportChars(model, edits, closedKeys) {
    var out = { open: createCharCount(), all: createCharCount() };
    var closed = closedKeys || {};
    var edited = applyTextEdits(model, edits);
    edited.groups.forEach(function (group) {
      group.sections.forEach(function (section) {
        if (String(section.key).indexOf(REPORT_SECTION_PREFIX) !== 0) return;
        var isOpen = !section.closable || !closed[section.key];
        section.parts.forEach(function (part) {
          var field = part.type === 'table' ? 'items' : part.editKey ? 'body' : '';
          if (!field) return;
          var n = field === 'items' ? countTableValueChars(part.rows) : countBodyChars(part.text);
          [out.all].concat(isOpen ? [out.open] : []).forEach(function (count) { count[field] += n; count.total += n; });
        });
      });
    });
    return out;
  }

  /** 字数の書き方：「項目 412字 ＋ 鑑定文 538字 ＝ 合計 950字」（空白の所で折り返す）。 */
  function formatReportCharCount(count) {
    return '項目 ' + count.items + '字 ＋ 鑑定文 ' + count.body + '字 ＝ 合計 ' + count.total + '字';
  }

  /** 書き直しを当てた項目の一覧（model は変えない。書き直した部品とその項目だけを写して替える）。 */
  function applyTextEdits(model, edits) {
    var map = edits || {};
    if (!Object.keys(map).length) return model;
    return {
      info: model.info,
      groups: model.groups.map(function (group) {
        return { kind: group.kind, sections: group.sections.map(function (section) { return applySectionEdits(section, map); }) };
      })
    };
  }

  function applySectionEdits(section, map) {
    var isChanged = false;
    var parts = section.parts.map(function (part) {
      if (!part.editKey || !hasOwn(map, part.editKey)) return part;
      isChanged = true;
      var copy = copyObject(part);
      copy.text = map[part.editKey].text;
      return copy;
    });
    if (!isChanged) return section;
    var out = copyObject(section);
    out.parts = parts;
    return out;
  }

  /**
   * key の文を text に書き直す。原文と同じなら書き直しなしにする（消す）。edits を直接変える。
   * 返す値：書き直しの中身が変わったか
   */
  function writeTextEdit(edits, originals, key, text) {
    if (!hasOwn(originals, key)) return false;
    var value = normalizeNewlines(text);
    if (value === originals[key].text) {
      if (!hasOwn(edits, key)) return false;
      delete edits[key];
      return true;
    }
    if (hasOwn(edits, key) && edits[key].text === value) return false;
    edits[key] = { label: originals[key].label, text: value };
    return true;
  }

  /** 端末から読んだ書き直しが形どおりか（{ key: { label: 文字, text: 文字 } }）。 */
  function isValidTextEdits(edits) {
    if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return false;
    return Object.keys(edits).every(function (key) {
      var edit = edits[key];
      return !!edit && typeof edit === 'object' && typeof edit.label === 'string' && typeof edit.text === 'string';
    });
  }

  /** 写し（画面の書き直しと、残した書き直しを分けるため）。 */
  function copyTextEdits(edits) {
    var out = {};
    Object.keys(edits || {}).forEach(function (key) { out[key] = { label: edits[key].label, text: edits[key].text }; });
    return out;
  }

  /** 書き直した文を、名前（章／題名）の順に並べる（原文を作り直せないとき、自分用の文章に載せる）。 */
  function listTextEdits(edits) {
    return Object.keys(edits || {}).map(function (key) { return edits[key]; }).sort(function (a, b) {
      return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
    });
  }

  // ---- 画面の部品 ----
  function createButton(className, text) {
    var button = VIEW.createElement('button', 'btn-edit ' + className, text);
    button.type = 'button';
    return button;
  }

  /**
   * 書き直せる文を parent に書く（view_common.js の renderPart から呼ぶ）。
   * いまの文（印刷にも出る）・書き直しの印・ボタン（書き直す・原文を見る・原文に戻す）・原文・書き直しの入力欄
   */
  function renderEditableLines(parent, part) {
    var block = VIEW.createElement('div', 'edit-block');
    block.setAttribute('data-edit-key', part.editKey);
    block.setAttribute('data-line-class', part.className || 'result-text');
    var current = VIEW.createElement('div', 'edit-current');
    VIEW.appendLines(current, part.text, part.className);
    block.appendChild(current);
    var note = VIEW.createElement('p', 'edit-note', EDITED_NOTE);
    note.hidden = true;
    block.appendChild(note);
    var controls = VIEW.createElement('div', 'edit-controls');
    controls.appendChild(createButton('edit-open', BUTTON_LABELS.open));
    var showOriginal = createButton('edit-show-original', BUTTON_LABELS.showOriginal);
    showOriginal.hidden = true;
    controls.appendChild(showOriginal);
    var revert = createButton('edit-revert', BUTTON_LABELS.revert);
    revert.hidden = true;
    controls.appendChild(revert);
    controls.appendChild(VIEW.createElement('span', 'edit-count', formatCharCount(part.text)));
    block.appendChild(controls);
    var original = VIEW.createElement('div', 'edit-original');
    original.hidden = true;
    original.appendChild(VIEW.createElement('p', 'edit-original-label', '原文'));
    VIEW.appendLines(original, part.text, 'result-text edit-original-text');
    block.appendChild(original);
    var input = VIEW.createElement('textarea', 'edit-input');
    input.rows = 6;
    input.hidden = true;
    input.setAttribute('aria-label', String(part.editLabel || '') + 'の書き直し');
    block.appendChild(input);
    parent.appendChild(block);
  }

  function findChild(block, className) { return block.querySelector('.' + className); }

  var SURROGATE_OR_CHAR = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g;

  /** 鑑定文の字数（空白・改行は数えない。サロゲートペアは1字）。 */
  function countBodyChars(text) {
    var chars = String(text).replace(/\s/g, '').match(SURROGATE_OR_CHAR);
    return chars ? chars.length : 0;
  }

  function formatCharCount(text) { return countBodyChars(text) + '字'; }

  /** 1つの文の表示を、書き直し（なければ原文）に合わせる。入力欄の中身は変えない（書いている途中の文を消さないため）。 */
  function renderEditBlock(block, edits, originals) {
    var key = block.getAttribute('data-edit-key');
    if (!hasOwn(originals, key)) return;
    var isEdited = hasOwn(edits, key);
    var current = findChild(block, 'edit-current');
    var text = isEdited ? edits[key].text : originals[key].text;
    current.textContent = '';
    // 消して空にしたときは、空であることをはっきり出す（原文が出ているように見えて紛らわしかった。2026-10-23）
    if (isEdited && !countBodyChars(text)) current.appendChild(VIEW.createElement('p', 'edit-empty', EMPTY_NOTE));
    else VIEW.appendLines(current, text, block.getAttribute('data-line-class'));
    findChild(block, 'edit-count').textContent = formatCharCount(text);
    block.className = 'edit-block' + (isEdited ? ' is-edited' : '') + (/\bis-editing\b/.test(block.className) ? ' is-editing' : '');
    findChild(block, 'edit-note').hidden = !isEdited;
    findChild(block, 'edit-show-original').hidden = !isEdited;
    findChild(block, 'edit-revert').hidden = !isEdited;
    if (!isEdited) showOriginal(block, false);
  }

  /** 文の下に、操作の結果を少しの間だけ出す（原文に戻したことが分かるように）。 */
  function flashNote(block, text) {
    var flash = findChild(block, 'edit-flash');
    if (!flash) {
      flash = VIEW.createElement('span', 'edit-flash');
      flash.setAttribute('role', 'status');
      findChild(block, 'edit-controls').appendChild(flash);
    }
    flash.textContent = text;
    var shown = text;
    window.setTimeout(function () { if (flash.textContent === shown) flash.textContent = ''; }, 4000);
  }

  /** root の中の書き直せる文すべてに、書き直しを当てる（鑑定を書いたあと・続きからのあとに呼ぶ）。 */
  function applyTextEditsToDom(root, edits, originals) {
    var blocks = root.querySelectorAll('.edit-block');
    for (var i = 0; i < blocks.length; i++) renderEditBlock(blocks[i], edits, originals);
  }

  function showOriginal(block, isShown) {
    findChild(block, 'edit-original').hidden = !isShown;
    findChild(block, 'edit-show-original').textContent = isShown ? BUTTON_LABELS.hideOriginal : BUTTON_LABELS.showOriginal;
  }

  /** 書き直しの入力欄を開く・閉じる。開くときは、いまの文（書き直しか原文）を入れる。 */
  function openEditor(block, isOpen, text) {
    var input = findChild(block, 'edit-input');
    if (isOpen) input.value = text;
    input.hidden = !isOpen;
    findChild(block, 'edit-open').textContent = isOpen ? BUTTON_LABELS.close : BUTTON_LABELS.open;
    block.className = block.className.replace(/\s*\bis-editing\b/g, '') + (isOpen ? ' is-editing' : '');
    if (isOpen && typeof input.focus === 'function') input.focus();
  }

  /**
   * root（鑑定結果の欄）の書き直しの操作を受け付ける。deps：
   *   getEdits()：画面の書き直し（{ key: { label, text } }。直接変える）　getOriginals()：原文（collectEditables）
   *   onChanged()：書き直しが変わった（作ったものを捨て、端末に残し直す）
   */
  function attachTextEditor(root, deps) {
    root.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('button.btn-edit') : null;
      if (!button) return;
      var block = button.closest('.edit-block');
      var key = block.getAttribute('data-edit-key');
      var edits = deps.getEdits();
      var originals = deps.getOriginals();
      if (!hasOwn(originals, key)) return;
      if (/\bedit-open\b/.test(button.className)) {
        var isOpen = findChild(block, 'edit-input').hidden;
        openEditor(block, isOpen, hasOwn(edits, key) ? edits[key].text : originals[key].text);
      } else if (/\bedit-show-original\b/.test(button.className)) {
        showOriginal(block, findChild(block, 'edit-original').hidden);
      } else if (/\bedit-revert\b/.test(button.className)) {
        VIEW.askConfirm(REVERT_CONFIRM, { okLabel: '原文に戻す' }).then(function (isOk) {
          // 確かめている間に別の鑑定に替わっていたら何もしない（その画面の書き直し・原文で確かめ直す）
          if (!isOk || deps.getEdits() !== edits || !block.isConnected) return;
          if (!writeTextEdit(edits, originals, key, originals[key].text)) return;
          if (!findChild(block, 'edit-input').hidden) findChild(block, 'edit-input').value = originals[key].text;
          renderEditBlock(block, edits, originals);
          flashNote(block, REVERTED_NOTE);
          deps.onChanged();
        });
      }
    });
    root.addEventListener('input', function (event) {
      var input = event.target;
      if (!input || !/\bedit-input\b/.test(input.className || '')) return;
      var block = input.closest('.edit-block');
      var edits = deps.getEdits();
      var originals = deps.getOriginals();
      if (!writeTextEdit(edits, originals, block.getAttribute('data-edit-key'), input.value)) return;
      renderEditBlock(block, edits, originals);
      deps.onChanged();
    });
  }

  VIEW.collectEditables = collectEditables;
  VIEW.countReportChars = countReportChars;
  VIEW.formatReportCharCount = formatReportCharCount;
  VIEW.countBodyChars = countBodyChars;
  VIEW.applyTextEdits = applyTextEdits;
  VIEW.writeTextEdit = writeTextEdit;
  VIEW.isValidTextEdits = isValidTextEdits;
  VIEW.copyTextEdits = copyTextEdits;
  VIEW.listTextEdits = listTextEdits;
  VIEW.renderEditableLines = renderEditableLines;
  VIEW.applyTextEditsToDom = applyTextEditsToDom;
  VIEW.attachTextEditor = attachTextEditor;
})();
