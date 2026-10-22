// ============================================================
// web/src/work_draft.js — 作業中の鑑定1件の端末への途中保存（段階3a-3）
// 設計：docs/product-spec.md §4.2、docs/web-pdf-plan.md §5 の 3a-3
//   端末（ブラウザ）全体で1件だけ、ログインした ID と一緒に残す。サーバーには送らない
//   残すもの：入力（名前・生年月日・出生時刻・出生地・性別・流派・開始日）・鑑定した時刻・鑑定情報・閉じた項目・
//     書き直した文（段階3b。原文は作り直せるため残さない）・鑑定者用の欄・相手に送った時点の控え・項目ごとの原文の要約値
//   要約値は原文（項目の中身）の文字列から作る。開き直したときに同じ入力で作り直した原文と比べ、
//     1つでも違えば（計算・鑑定文DBが直されたとき）閉じた項目・書き直しなどを自動では当てない
//   作業ごとに番号（workId）、残すたびに版の印（rev）を付ける。タブを2つ開いたとき、古いタブが新しい内容を上書き・消去しないよう、
//   app.js が書く・消す前に、端末の1件がその画面の知っている版のままかを照らし合わせる。照らし合わせと書く・消すは、
//   ブラウザの排他（Web Locks）の中で一続きに行い、別のタブが間に割り込めないようにする（runWithDraftLock）
//   ここでは読み書きと要約値だけを扱う（画面の流れは app.js）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var DRAFT_STORAGE_KEY = 'hzWeb.workDraft';
  var DRAFT_VERSION = 2;   // 残す形を変えたら上げる（違う版は読まない）。2：書き直した文（edits）を足した
  var DRAFT_VERSION_NO_EDITS = 1;   // 書き直しを足す前の形。書き直しなしとして読む（要約値が変わるため、続きからは再開できない旨を出す）
  var DRAFT_LOCK_NAME = 'hzWeb.workDraft';   // 同じ端末（オリジン）のタブで共有する排他の名前

  /** 文字列の要約値（53ビットの数を16進で。改ざんを防ぐためではなく、原文が変わったかを知るため）。 */
  function hashText(text) {
    var h1 = 0xdeadbeef;
    var h2 = 0x41c6ce57;
    var source = String(text);
    for (var i = 0; i < source.length; i++) {
      var code = source.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  /** 項目ごとの原文の要約値（{ key: 要約値 }。鑑定情報を除くすべての項目。見出しと部品の中身から作る）。 */
  function buildSectionDigests(model) {
    var digests = {};
    model.groups.forEach(function (group) {
      group.sections.forEach(function (section) {
        digests[section.key] = hashText(JSON.stringify({ title: section.title, parts: section.parts }));
      });
    });
    return digests;
  }

  /** 要約値がすべて同じか（項目の数・key も同じであること）。 */
  function isSameDigests(saved, rebuilt) {
    var savedKeys = Object.keys(saved || {}).sort();
    var rebuiltKeys = Object.keys(rebuilt || {}).sort();
    if (savedKeys.length !== rebuiltKeys.length) return false;
    for (var i = 0; i < savedKeys.length; i++) {
      if (savedKeys[i] !== rebuiltKeys[i] || saved[savedKeys[i]] !== rebuilt[rebuiltKeys[i]]) return false;
    }
    return true;
  }

  /** 作業の番号・版の印（その端末の中で重ならなければよい）。 */
  function createWorkId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

  /** 日時として表せる時刻（ミリ秒）か（表せないと日時の表示で止まるため、そういう保存は読まない）。 */
  function isValidTime(value) { return typeof value === 'number' && isFinite(value) && Math.abs(value) <= 8.64e15; }

  /** 読んだものが残す形どおりか（違う版・壊れたものは無いものとして扱う）。 */
  function isValidDraft(draft) {
    if (!isPlainObject(draft)) return false;
    var hasValidEdits = draft.v === DRAFT_VERSION ? VIEW.isValidTextEdits(draft.edits) : (draft.v === DRAFT_VERSION_NO_EDITS && draft.edits === undefined);
    return hasValidEdits && typeof draft.ownerId === 'string' && draft.ownerId !== '' &&
      typeof draft.workId === 'string' && draft.workId !== '' && typeof draft.rev === 'string' && draft.rev !== '' &&
      isPlainObject(draft.input) && isPlainObject(draft.info) && isPlainObject(draft.closedKeys) && isPlainObject(draft.digests) &&
      isValidTime(draft.kanteiAt) && isValidTime(draft.savedAt) && typeof draft.name === 'string' && typeof draft.memo === 'string' &&
      (draft.sent === null || (isPlainObject(draft.sent) && typeof draft.sent.text === 'string' && isValidTime(draft.sent.sentAt)));
  }

  /** 残っている作業中の鑑定（なければ・読めなければ null）。 */
  function readWorkDraft() {
    var text;
    try { text = localStorage.getItem(DRAFT_STORAGE_KEY); } catch (e) { return null; }
    if (!text) return null;
    var draft;
    try { draft = JSON.parse(text); } catch (e) { return null; }
    if (!isValidDraft(draft)) return null;
    if (draft.v === DRAFT_VERSION_NO_EDITS) draft.edits = {};
    return draft;
  }

  /** 作業中の鑑定を残す（前の1件は置き換わる）。残せたかを返す（容量不足・保存できない設定のときは false）。 */
  function writeWorkDraft(draft) {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 作業中の鑑定を消す。消えたかを返す（消したあとに読み直して確かめる。消せない設定のときは false）。 */
  function clearWorkDraft() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return localStorage.getItem(DRAFT_STORAGE_KEY) === null;
    } catch (e) {
      return false;
    }
  }

  /**
   * task（照らし合わせてから書く・消す処理。同期で終える）を、同じ端末のほかのタブと順番に1つずつ行う。
   * Web Locks のない古いブラウザ（Safari 15.3 以前など）・使えない画面では、そのまま行う（照らし合わせだけは効く）。
   * task は1回だけ行う。返す値：終わったら解決する Promise
   */
  function runWithDraftLock(task) {
    var done = false;
    var runOnce = function () {
      if (done) return;
      done = true;
      try { task(); } catch (e) { /* 書けなかったことは task の中で知らせる */ }
    };
    var locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    if (locks && typeof locks.request === 'function') {
      try {
        return locks.request(DRAFT_LOCK_NAME, function () { runOnce(); }).then(runOnce, runOnce);
      } catch (e) { /* 下でそのまま行う */ }
    }
    runOnce();
    return Promise.resolve();
  }

  /**
   * 残す形にする。work：{ workId, ownerId, input, name, kanteiAt, model, digests }（app.js の作業中の鑑定）
   * extra：{ rev（この保存の版の印）, closedKeys, edits（書き直し。text_edit.js）, memo, sent（{ text, format, sentAt: Date } または null） }
   */
  function buildWorkDraft(work, extra) {
    var closedKeys = {};
    Object.keys(extra.closedKeys || {}).forEach(function (key) { if (extra.closedKeys[key]) closedKeys[key] = true; });
    return {
      v: DRAFT_VERSION,
      workId: work.workId,
      rev: extra.rev,
      ownerId: work.ownerId,
      savedAt: Date.now(),
      kanteiAt: work.kanteiAt,
      input: work.input,
      name: work.name,
      info: work.model.info,
      closedKeys: closedKeys,
      edits: VIEW.copyTextEdits(extra.edits),
      memo: String(extra.memo || ''),
      sent: extra.sent ? { text: extra.sent.text, format: extra.sent.format, sentAt: extra.sent.sentAt.getTime() } : null,
      digests: work.digests
    };
  }

  /** 残した控えを画面で使う形（sentAt を日時に）に戻す。 */
  function readDraftSent(draft) {
    return draft.sent ? { text: draft.sent.text, format: draft.sent.format, sentAt: new Date(draft.sent.sentAt) } : null;
  }

  VIEW.DRAFT_STORAGE_KEY = DRAFT_STORAGE_KEY;
  VIEW.runWithDraftLock = runWithDraftLock;
  VIEW.createWorkId = createWorkId;
  VIEW.hashText = hashText;
  VIEW.buildSectionDigests = buildSectionDigests;
  VIEW.isSameDigests = isSameDigests;
  VIEW.readWorkDraft = readWorkDraft;
  VIEW.writeWorkDraft = writeWorkDraft;
  VIEW.clearWorkDraft = clearWorkDraft;
  VIEW.buildWorkDraft = buildWorkDraft;
  VIEW.readDraftSent = readDraftSent;
})();
