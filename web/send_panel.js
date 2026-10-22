// ============================================================
// web/src/send_panel.js — 「送る・印刷」の欄（段階3a-2）
// 設計：docs/web-pdf-plan.md §4.6〜§4.8、docs/product-spec.md §4.1
//   送る項目：計算結果・鑑定書の項目の一覧でまとめて選ぶ（本文の各項目の「閉じる」と同じ開閉。2026-10-21）
//   欄の頭に流れ（① 相手に渡す項目を選ぶ ② 相手に渡す ③ 自分用の記録を残す）を出す（2026-10-22 ガクさん）
//   相手に渡す：「相手に渡す PDF を作る」（PDF 1つ。進み具合・やめる）→「共有する」と「保存する」→「相手に送った」
//     共有画面のない端末は「保存する」だけ。印刷も②に置く（PDF と同じ項目）
//     ページごとの画像は、ファイルが分かれて扱いにくいためやめた（2026-10-21 ガクさん）
//     「作る」と「共有する」は別のタップにする（共有画面はタップの直後にしか開けない。§2）
//     控え（相手に送った内容）は「相手に送った」を押したときだけ更新する。開閉・書き直しを変えたら作ったものは捨てる
//   載せる文は書き直した後の文（段階3b。text_edit.js の applyTextEdits）。state.model は原文のまま持つ
//   自分に送る：検索できる文章（record_text.js）を通ごとに共有・コピーし、どの通を渡したかを出す。
//     LINE 用は1通に入る長さで分け、メール用は1通にまとめる（2026-10-22 ガクさん）。メモはこの欄に置く
//     本文は閉じた項目も含めて常に全体（相手に送らない項目には印。2026-10-21）
//   印刷：ブラウザの印刷機能（見た目は app.css の @media print。§4.7）
//   作ったファイル・文章はメモリに置くだけ。控え・メモは app.js が作業中の鑑定として端末に残す（work_draft.js。3a-3）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var MAKE_LIMIT_MS = 10000;   // 「作る」から「共有する」が出るまでの合格の基準（docs/web-pdf-plan.md §4.6）
  var FORMAT_LABELS = { pdf: 'PDF', images: '画像' };   // images は前の版で残した控えを読むため
  var SEND_FORMAT = 'pdf';
  // 送る項目の一覧のまとまり：[見出し, まとまりの種類（view_result.js の RESULT_KINDS）]
  var SEND_ITEM_GROUPS = [
    { id: 'calc', title: '計算結果', kinds: ['meishiki', 'taiun', 'nenun', 'getsuun', 'nichiun'] },
    { id: 'report', title: '鑑定書', kinds: ['report'] }
  ];
  var MAKE_BUTTON = '「相手に渡す PDF を作る」';   // 案内の中で使うため、MAKE_ERROR_MESSAGES より先に置く（Codex P2）
  var MAKE_ERROR_MESSAGES = {
    canvas: 'この端末では作れませんでした（絵を描く機能が使えません）。別のブラウザで試すか、印刷をお使いください',
    encode: 'ファイルにできませんでした。もう一度' + MAKE_BUTTON + 'を押してください',
    cancelled: 'やめました。もう一度' + MAKE_BUTTON + 'から作れます',
    logo: 'ロゴの画像を読めませんでした。「屋号・ロゴ・色」でロゴを入れ直すか外してから、もう一度' + MAKE_BUTTON + 'を押してください'
  };

  // 中身が変わって、出した記録の文章を捨てたときの案内
  var REDO_RECORD_MESSAGE = '内容が変わったため、記録の文章を消しました。もう一度「LINE で送る」か「メールで送る」を押してください';
  var shareListGeneration = 0;   // 通の一覧を書き直した回数（前の一覧の共有の結果を、新しい一覧に書かないため）

  /** 文章をコピーする。結果（できたか）を Promise で返す。 */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return copyByTextarea(text); });
    }
    return Promise.resolve(copyByTextarea(text));
  }

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
    return copied;
  }

  /**
   * 自分に送る文章の通の一覧を list に書く（通ごとに「共有する」、共有画面のない端末は「コピーする」）。
   * onAllPassed()：すべての通を共有画面に渡すかコピーしたら1回呼ぶ（省いてよい）
   */
  function renderShareTextParts(list, messages, onAllPassed) {
    var generation = String(++shareListGeneration);
    var canShareText = !!navigator.share;
    var passed = {};
    var isNotified = false;
    list.textContent = '';
    list.setAttribute('data-generation', generation);
    var markPassed = function (index) {
      passed[index] = true;
      if (!isNotified && Object.keys(passed).length === messages.length && onAllPassed) {
        isNotified = true;
        onAllPassed();
      }
    };
    messages.forEach(function (message, i) {
      var item = VIEW.createElement('li', 'record-part');
      item.appendChild(VIEW.createElement('span', 'record-part-label', messages.length > 1 ? (i + 1) + '通目／' + messages.length + '通' : '1通'));
      var button = VIEW.createElement('button', 'btn btn-sub', canShareText ? '共有する' : 'コピーする');
      button.type = 'button';
      var status = VIEW.createElement('span', 'record-part-status', '');
      button.addEventListener('click', function () {
        var done = function (text, isPassed) {
          if (list.getAttribute('data-generation') !== generation) return;
          status.textContent = text;
          if (isPassed) markPassed(i);
        };
        if (navigator.share) {
          navigator.share({ text: message }).then(function () { done('共有画面に渡しました', true); }, function (error) {
            if (error && error.name === 'AbortError') return;
            copyText(message).then(function (copied) { done(copied ? 'コピーしました（共有できなかったため）' : '共有もコピーもできませんでした', copied); });
          });
        } else {
          copyText(message).then(function (copied) { done(copied ? 'コピーしました' : 'コピーできませんでした', copied); });
        }
      });
      item.appendChild(button);
      item.appendChild(status);
      // 何を送るのかが分かるように、中身を開いて見られるようにする（2026-10-21 ガクさん）
      var details = VIEW.createElement('details', 'record-part-body');
      details.appendChild(VIEW.createElement('summary', '', '中身を見る'));
      details.appendChild(VIEW.createElement('pre', 'record-part-text', message));
      item.appendChild(details);
      list.appendChild(item);
    });
  }

  /**
   * 欄を作る。deps：
   *   getClosedKeys()：閉じた項目（{ key: true }）　addRecord(名前, ms, 合否, 説明)：計測の記録（app.js）
   *   onWorkChanged()：メモ・控えが変わった（端末に残し直す）　onClearWorkRequest()：「この鑑定を端末から消す」を押した
   *   getBrand()：屋号・色・ロゴ（brand.js）　getTextEdits()：書き直し（text_edit.js。{ key: { label, text } }）
   *   onSetClosed(keys, isClosed)：送る項目の一覧で、keys の項目を閉じる（外す）・開く（入れる）
   * 返す値：{ setResult(model), clear(), notifyItemsChanged(), notifyTextChanged(), notifyBrandChanged(), readWorkState(), restoreWorkState(work) }
   */
  function createSendPanel(deps) {
    var state = createEmptyState();
    var lastMakeId = 0;   // 作る作業の番号。鑑定が変わっても 0 に戻さない（前の鑑定の作業が「いまの作業」に戻らないように）

    function byId(id) { return document.getElementById(id); }

    function createEmptyState() {
      return { model: null, makeId: -1, isMaking: false, cancelRequested: false, files: null, shareFiles: null,
        pending: null, sent: null, downloadUrls: [], savedIndexes: {}, messages: null };
    }

    function renderMessage(id, text, isError) {
      var element = byId(id);
      element.textContent = text;
      element.className = 'message' + (isError ? ' is-ng' : '');
    }

    /** 書き直しを当てた項目の一覧（その時点の書き直しの写しを当てる。あとで書き直しても変わらない）。 */
    function buildEditedModel() { return VIEW.applyTextEdits(state.model, VIEW.copyTextEdits(deps.getTextEdits())); }

    function copyKeys(keys) {
      var out = {};
      Object.keys(keys).forEach(function (key) { if (keys[key]) out[key] = true; });
      return out;
    }

    // ---- 相手に送る ----
    /** 作ったもの（と作りかけ）を捨てる。message があれば知らせる。 */
    function discardFiles(message) {
      var hadFiles = !!state.files || state.isMaking;
      if (state.isMaking) state.makeId = -1;   // 作りかけは結果を受け取らない（isCancelled も真になる）
      state.isMaking = false;
      state.files = null;
      state.shareFiles = null;
      state.pending = null;
      state.downloadUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      state.downloadUrls = [];
      state.savedIndexes = {};
      byId('outDownloadLinks').textContent = '';
      byId('outDownloadLinks').hidden = true;
      byId('btnShareFiles').hidden = true;
      byId('btnMarkSent').hidden = true;
      refreshMakeControls();
      if (message && hadFiles) renderMessage('outMakeMessage', message, false);
    }

    function refreshMakeControls() {
      byId('btnMakeFiles').disabled = state.isMaking || !state.model;
      byId('btnCancelMake').hidden = !state.isMaking;
    }

    function handleMakeFilesClick() {
      if (state.isMaking || !state.model) return;
      discardFiles('');
      var format = SEND_FORMAT;
      var closedKeys = copyKeys(deps.getClosedKeys());   // 作り始めた時点の開閉（あとの開閉は作りかけごと捨てる）
      var makeId = ++lastMakeId;
      var model = state.model;
      var edited = buildEditedModel();   // 作り始めた時点の書き直し（あとの書き直しは作りかけごと捨てる）
      var startMs = performance.now();
      // 作り始めた鑑定・作業のままのときだけ結果を受け取る
      var isCurrent = function () { return makeId === state.makeId && model === state.model; };
      state.makeId = makeId;
      state.isMaking = true;
      state.cancelRequested = false;
      refreshMakeControls();
      renderMessage('outMakeMessage', '作っています…', false);
      // 控えに使う中身は、作り始めた時点の全体と開閉（閉じた項目に印。作っている間に開閉を変えたら、作りかけごと捨てる）
      var text = VIEW.buildSectionsText(VIEW.listAllSections(edited), closedKeys);
      VIEW.createReportFiles(edited, {
        format: format,
        closedKeys: closedKeys,
        brand: deps.getBrand(),   // 作り始めた時点の屋号・色・ロゴ
        onProgress: function (done, total) {
          if (isCurrent()) renderMessage('outMakeMessage', '作っています… ' + done + ' / ' + total + ' ページ', false);
        },
        isCancelled: function () { return !isCurrent() || state.cancelRequested; }
      }).then(function (result) {
        if (!isCurrent()) return;
        var ms = Math.round(performance.now() - startMs);
        var bytes = result.files.reduce(function (n, file) { return n + file.bytes.length; }, 0);
        state.isMaking = false;
        state.files = result.files;
        state.pending = { text: text, format: format };
        refreshMakeControls();
        deps.addRecord('鑑定書を作る（' + FORMAT_LABELS[format] + '）', ms, ms <= MAKE_LIMIT_MS ? '合格' : '不合格',
          result.pageCount + 'ページ・' + (bytes / 1024 / 1024).toFixed(2) + 'MB');
        showShareOrDownload(result.pageCount);
      }, function (error) {
        if (!isCurrent()) return;
        state.isMaking = false;
        refreshMakeControls();
        var code = error && error.code;
        renderMessage('outMakeMessage', MAKE_ERROR_MESSAGES[code] || '作れませんでした。もう一度' + MAKE_BUTTON + 'を押してください', code !== 'cancelled');
        if (code !== 'cancelled') deps.addRecord('鑑定書を作る', null, '', '失敗（' + (code || (error && error.name) || '不明') + '）');
      });
    }

    function handleCancelMakeClick() {
      if (state.isMaking) state.cancelRequested = true;
    }

    /** 「保存する」はいつも出し、共有画面でファイルを渡せる端末なら「共有する」も出す（2026-10-22 ガクさん）。 */
    function showShareOrDownload(pageCount) {
      var label = FORMAT_LABELS[state.pending.format] + '（' + pageCount + 'ページ' +
        (state.files.length > 1 ? '・' + state.files.length + '枚' : '') + '）';
      state.shareFiles = createShareFiles(state.files);
      renderDownloadLinks();
      if (state.shareFiles && canShareFiles(state.shareFiles)) {
        byId('btnShareFiles').hidden = false;
        renderMessage('outMakeMessage', label + 'を作りました。「共有する」で LINE・メールなどの送り先を選ぶか、「保存する」で端末に残してください', false);
      } else {
        renderMessage('outMakeMessage', label + 'を作りました。この端末では共有画面が使えないため、「保存する」で端末に残してから送ってください', false);
      }
    }

    function createShareFiles(files) {
      try {
        return files.map(function (file) { return new File([file.bytes], file.fileName, { type: file.mimeType }); });
      } catch (e) {
        return null;
      }
    }

    function canShareFiles(shareFiles) {
      try {
        return !!(navigator.share && navigator.canShare && navigator.canShare({ files: shareFiles }));
      } catch (e) {
        return false;
      }
    }

    function handleShareFilesClick() {
      if (!state.shareFiles) return;
      navigator.share({ files: state.shareFiles }).then(function () {
        byId('btnMarkSent').hidden = false;
        renderMessage('outMakeMessage', '共有画面に渡しました。相手に届けたら「相手に送った」を押してください（押したときだけ控えを残します）', false);
      }, function (error) {
        if (error && error.name === 'AbortError') {
          renderMessage('outMakeMessage', '共有をやめました。もう一度「共有する」を押せます', false);
          return;
        }
        renderMessage('outMakeMessage', '共有できませんでした。代わりに「保存する」で端末に残してから送ってください', true);
      });
    }

    /** 保存のリンク（ファイルごと。1回のタップで1つずつ保存する）。 */
    function renderDownloadLinks() {
      var list = byId('outDownloadLinks');
      if (state.downloadUrls.length) { list.hidden = false; return; }
      list.textContent = '';
      state.files.forEach(function (file, index) {
        var url = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
        state.downloadUrls.push(url);
        var item = VIEW.createElement('li');
        var link = VIEW.createElement('a', 'btn btn-sub', state.files.length > 1 ? '保存する：' + file.fileName : '保存する');
        link.href = url;
        link.download = file.fileName;
        link.setAttribute('data-index', String(index));
        link.addEventListener('click', handleDownloadClick);
        item.appendChild(link);
        list.appendChild(item);
      });
      list.hidden = false;
    }

    /** 保存のリンクを押した。画像が複数枚なら、全ページを保存するまで「相手に送った」を出さない（一部だけ送って控えを残さないため）。 */
    function handleDownloadClick(event) {
      if (!state.files) return;
      state.savedIndexes[event.currentTarget.getAttribute('data-index')] = true;
      var saved = Object.keys(state.savedIndexes).length;
      var total = state.files.length;
      if (saved < total) {
        renderMessage('outMakeMessage', '保存 ' + saved + ' / ' + total + ' 枚。すべて保存すると「相手に送った」が出ます', false);
        return;
      }
      byId('btnMarkSent').hidden = false;
      renderMessage('outMakeMessage', '保存しました' + (total > 1 ? '（' + total + ' 枚すべて）' : '') +
        '。相手に送ったら「相手に送った」を押してください（押したときだけ控えを残します）', false);
    }

    function handleMarkSentClick() {
      if (!state.pending) return;
      state.sent = { text: state.pending.text, format: state.pending.format, sentAt: new Date() };
      byId('btnMarkSent').hidden = true;
      renderSentStatus();
      discardMessages(REDO_RECORD_MESSAGE);
      deps.onWorkChanged();
    }

    function renderSentStatus() {
      byId('outSentStatus').textContent = state.sent
        ? VIEW.formatJstDateTime(state.sent.sentAt) + ' に相手へ送りました（' + FORMAT_LABELS[state.sent.format] + '）。自分用の記録には、この時点の内容が入ります'
        : 'まだ相手に送っていません';
    }

    // ---- 自分に送る ----
    function discardMessages(message) {
      var had = !!state.messages;
      state.messages = null;
      byId('outRecordParts').textContent = '';
      byId('outRecordParts').removeAttribute('data-generation');
      byId('btnClearWorkAfterRecord').hidden = true;
      if (message && had) renderMessage('outRecordMessage', message, false);
    }

    /** 自分用の記録の文章を出す。isMail：メール用（1通にまとめる）。LINE 用は1通に入る長さで分ける。 */
    function makeRecord(isMail) {
      if (!state.model) return;
      state.messages = VIEW.buildRecordMessages({
        info: state.model.info,
        sent: state.sent,
        currentText: VIEW.buildSectionsText(VIEW.listAllSections(buildEditedModel()), deps.getClosedKeys()),
        memo: byId('inpMemo').value,
        isSingle: isMail
      });
      renderRecordParts();
      var verb = navigator.share ? '「共有する」を押し、' + (isMail ? 'メール' : 'LINE') + 'で自分宛てに送って' : '「コピーする」で写し、自分宛ての' + (isMail ? 'メール' : 'LINE') + 'に貼って送って';
      var count = state.messages.length;
      var lead = count > 1 ? count + '通に分けました。1通目から順に' + verb : (isMail ? '1通にまとめました。' : '1通に収まりました。') + verb;
      renderMessage('outRecordMessage', lead + 'ください。受け取ったら、最後に「記録ここまで」があるか確かめてください', false);
    }
    function handleMakeRecordClick() { makeRecord(false); }
    function handleMakeRecordMailClick() { makeRecord(true); }

    function renderRecordParts() {
      renderShareTextParts(byId('outRecordParts'), state.messages, function () {
        byId('btnClearWorkAfterRecord').hidden = false;
        renderMessage('outRecordMessage', 'すべての通を渡しました。受け取った側でそろっているか確かめたら、この鑑定を端末から消せます（消さなければ最後の1件として残ります）', false);
      });
    }

    function handleMemoInput() {
      discardMessages(REDO_RECORD_MESSAGE);
      deps.onWorkChanged();
    }

    // ---- 送る項目の一覧 ----
    /** 一覧を作り直す（新しい鑑定のとき）。各項目はチェックで「入れる」、まとまりごとに「すべて入れる・外す」。 */
    function renderSendItems() {
      var box = byId('outSendItems');
      box.textContent = '';
      if (!state.model) return;
      SEND_ITEM_GROUPS.forEach(function (group) {
        var sections = listGroupSections(group);
        if (!sections.length) return;
        var wrap = VIEW.createElement('div', 'send-group');
        wrap.setAttribute('data-send-group', group.id);
        var head = VIEW.createElement('div', 'send-group-head');
        head.appendChild(VIEW.createElement('span', 'send-group-title', group.title));
        head.appendChild(VIEW.createElement('span', 'send-group-count', ''));
        head.appendChild(createGroupButton('すべて入れる', group.id, false));
        head.appendChild(createGroupButton('すべて外す', group.id, true));
        wrap.appendChild(head);
        var list = VIEW.createElement('div', 'send-items');
        sections.forEach(function (section) {
          var label = VIEW.createElement('label', 'send-item');
          var check = VIEW.createElement('input');
          check.type = 'checkbox';
          check.setAttribute('data-section-key', section.key);
          label.appendChild(check);
          label.appendChild(VIEW.createElement('span', '', section.title));
          list.appendChild(label);
        });
        wrap.appendChild(list);
        box.appendChild(wrap);
      });
      refreshSendItems();
    }

    function createGroupButton(text, groupId, isClosed) {
      var button = VIEW.createElement('button', 'btn-edit send-group-button', text);
      button.type = 'button';
      button.setAttribute('data-send-group-id', groupId);
      button.setAttribute('data-send-close', isClosed ? '1' : '0');
      return button;
    }

    /** まとまりの閉じられる項目（鑑定情報など閉じられないものは一覧に出さない）。 */
    function listGroupSections(group) {
      var out = [];
      state.model.groups.forEach(function (modelGroup) {
        if (group.kinds.indexOf(modelGroup.kind) < 0) return;
        modelGroup.sections.forEach(function (section) { if (section.closable) out.push(section); });
      });
      return out;
    }

    /** 一覧のチェックと数を、いまの開閉に合わせる。 */
    function refreshSendItems() {
      if (!state.model) return;
      var closed = deps.getClosedKeys();
      var checks = byId('outSendItems').querySelectorAll('input[data-section-key]');
      for (var i = 0; i < checks.length; i++) checks[i].checked = !closed[checks[i].getAttribute('data-section-key')];
      SEND_ITEM_GROUPS.forEach(function (group) {
        var wrap = byId('outSendItems').querySelector('[data-send-group="' + group.id + '"]');
        if (!wrap) return;
        var sections = listGroupSections(group);
        var open = sections.filter(function (section) { return !closed[section.key]; }).length;
        wrap.querySelector('.send-group-count').textContent = open + ' / ' + sections.length + ' 項目を送る';
      });
    }

    function handleSendItemsChange(event) {
      var check = event.target;
      if (!check || check.type !== 'checkbox' || !check.getAttribute('data-section-key')) return;
      deps.onSetClosed([check.getAttribute('data-section-key')], !check.checked);
    }

    function handleSendItemsClick(event) {
      var button = event.target && event.target.closest ? event.target.closest('button.send-group-button') : null;
      if (!button || !state.model) return;
      var groupId = button.getAttribute('data-send-group-id');
      var group = SEND_ITEM_GROUPS.filter(function (g) { return g.id === groupId; })[0];
      var keys = listGroupSections(group).map(function (section) { return section.key; });
      deps.onSetClosed(keys, button.getAttribute('data-send-close') === '1');
    }

    /** 「鑑定書だけにする」：計算結果をすべて外し、鑑定書をすべて入れる。 */
    function handleReportOnlyClick() {
      if (!state.model) return;
      var keysOf = function (id) {
        return listGroupSections(SEND_ITEM_GROUPS.filter(function (g) { return g.id === id; })[0]).map(function (s) { return s.key; });
      };
      deps.onSetClosed(keysOf('calc'), true);
      deps.onSetClosed(keysOf('report'), false);
    }

    // ---- 外から呼ぶもの ----
    /** 新しい鑑定の結果を受け取る。前の鑑定のファイル・控え・文章・メモは消す（前のお客さんの内容を残さない）。 */
    function setResult(model) {
      clear();
      state.model = model;
      byId('secSend').hidden = false;
      renderSendItems();
      refreshMakeControls();
    }

    function clear() {
      discardFiles('');
      discardMessages('');
      state = createEmptyState();
      byId('inpMemo').value = '';
      ['outMakeMessage', 'outRecordMessage'].forEach(function (id) { renderMessage(id, '', false); });
      renderSentStatus();
      byId('secSend').hidden = true;
      byId('outSendItems').textContent = '';
      refreshMakeControls();
    }

    /** 端末に残す分（メモと控え）。 */
    function readWorkState() {
      return { memo: byId('inpMemo').value, sent: state.sent };
    }

    /** 端末に残っていたメモと控えを戻す（続きから。setResult のあとに呼ぶ）。sent は { text, format, sentAt: Date } か null。 */
    function restoreWorkState(work) {
      byId('inpMemo').value = work.memo || '';
      state.sent = work.sent || null;
      renderSentStatus();
    }

    /** 項目の開閉が変わった。作ったものと文章は中身が変わるため捨てる（控えは変えない）。 */
    function notifyItemsChanged() {
      refreshSendItems();
      discardFiles('相手に渡す項目が変わりました。もう一度' + MAKE_BUTTON + 'を押してください');
      discardMessages(REDO_RECORD_MESSAGE);
    }

    /** 鑑定文の書き直しが変わった。作ったものと文章は中身が変わるため捨てる（控えは変えない）。 */
    function notifyTextChanged() {
      discardFiles('鑑定文が変わりました。もう一度' + MAKE_BUTTON + 'を押してください');
      discardMessages(REDO_RECORD_MESSAGE);
    }

    /** 屋号・ロゴ・色が変わった。作ったもの・作りかけは前の設定のため捨てる（自分用の文章には載らないため残す。Codex P2）。 */
    function notifyBrandChanged() {
      discardFiles('屋号・ロゴ・色が変わりました。もう一度' + MAKE_BUTTON + 'を押してください');
    }

    byId('btnMakeFiles').addEventListener('click', handleMakeFilesClick);
    byId('btnCancelMake').addEventListener('click', handleCancelMakeClick);
    byId('btnShareFiles').addEventListener('click', handleShareFilesClick);
    byId('btnMarkSent').addEventListener('click', handleMarkSentClick);
    byId('btnMakeRecord').addEventListener('click', handleMakeRecordClick);
    byId('btnMakeRecordMail').addEventListener('click', handleMakeRecordMailClick);
    byId('btnPrint').addEventListener('click', function () { window.print(); });
    byId('inpMemo').addEventListener('input', handleMemoInput);
    byId('btnClearWorkAfterRecord').addEventListener('click', function () { deps.onClearWorkRequest(); });
    byId('outSendItems').addEventListener('change', handleSendItemsChange);
    byId('outSendItems').addEventListener('click', handleSendItemsClick);
    byId('btnReportOnly').addEventListener('click', handleReportOnlyClick);
    clear();

    return {
      setResult: setResult, clear: clear, notifyItemsChanged: notifyItemsChanged, notifyTextChanged: notifyTextChanged,
      notifyBrandChanged: notifyBrandChanged,
      readWorkState: readWorkState, restoreWorkState: restoreWorkState
    };
  }

  VIEW.createSendPanel = createSendPanel;
  VIEW.renderShareTextParts = renderShareTextParts;
})();
