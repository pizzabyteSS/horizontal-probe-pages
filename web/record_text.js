// ============================================================
// web/src/record_text.js — 自分に送る文章（記録）を作る（段階3a-2）
// 設計：docs/product-spec.md §4.1 の 3（自分に送る）
//   先頭に検索用の1行（氏名・生年月日・出生時刻・出生地・性別・流派・鑑定日）、続けて鑑定の全文（控え）、メモ
//   本文は閉じた項目も含めて常に全体を載せ、相手に送らない（送らなかった）項目には印を付ける（2026-10-21 ガクさん）
//   LINE 用は1通に入りきらないときは数通に分け（メール用は1通にまとめる。2026-10-22 ガクさん）、すべての通の先頭に検索用の1行と (i/N)、最後の通の末尾に終わりの印を入れる
//   続きから再開できなかったとき（原文を作り直せないとき）は、書き直した文を別に並べる（段階3b）
//   ここでは文字を組み立てるだけ（送るのは send_panel.js）。作った文章はメモリに置くだけ
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // 1通の上限の字数（検索用の1行・通し番号・終わりの印を含む）。LINE の1通の上限は完成品の実機確認で確かめ、
  // 断られれば下げる（docs/product-spec.md §4.1・§7【仮説】）
  var MESSAGE_MAX_CHARS = 4000;
  var MIN_BODY_CHARS = 200;        // 上限を小さくしすぎても、1通に本文がこれだけは入るようにする
  var RECORD_LABEL = '【鑑定記録】';
  var NOT_SENT_MARK = '【相手に送らない項目】';   // 閉じた項目の見出しに付ける（文章では色を付けられないため印にする）
  var NUMBER_RESERVE = '(999/999)';   // 通し番号の字数の見積もり（通の数が決まる前に、本文に使える字数を決めるため）
  var FORMAT_LABELS = { pdf: 'PDF', images: '画像' };
  var SURROGATE_OR_CHAR = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g;

  /** 字数（サロゲートペアは1字）。 */
  function countTextChars(text) {
    var chars = String(text).match(SURROGATE_OR_CHAR);
    return chars ? chars.length : 0;
  }

  /** 改行を空白にして1行にする（検索用の1行・表のセル）。 */
  function toOneLine(text) {
    return String(text).replace(/\s*[\r\n]+\s*/g, ' ');
  }

  /** 日本時間の「2026/10/21 10:30」。 */
  function formatJstDateTime(date) {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  /** 検索用の1行。info は view_common.js の readCommonInfo。 */
  function buildSearchLine(info) {
    return toOneLine(RECORD_LABEL + [
      info.name, '生年月日 ' + info.birthDate, '出生時刻 ' + info.birthTime, '出生地 ' + info.birthPlace,
      '性別 ' + info.sex, '流派 ' + info.style, '鑑定日 ' + info.kanteiDate
    ].join('｜'));
  }

  function pushTextLines(lines, text) {
    if (VIEW.isBlank(text) || !String(text).replace(/\s/g, '')) return;
    String(text).split('\n').forEach(function (line) { lines.push(line); });
  }

  /** 表：横に長い表は行ごとのまとまり（PDF と同じ）、それ以外は「行の見出し：値 / 値」。 */
  function pushTableLines(lines, part) {
    if (VIEW.isWideTable(part)) {
      VIEW.buildWideRecords(part).forEach(function (record) {
        lines.push('◇' + toOneLine(record.title));
        if (record.pairs.length) lines.push(toOneLine(VIEW.formatRecordPairs(record.pairs)));
        if (record.note && record.note !== '-') lines.push(record.noteLabel + '：' + toOneLine(record.note));
      });
      return;
    }
    if (part.headers && part.headers.length > 1) lines.push('（' + part.headers.slice(1).map(toOneLine).join(' / ') + '）');
    part.rows.forEach(function (row) {
      lines.push(toOneLine(row[0]) + '：' + row.slice(1).map(toOneLine).join(' / '));
    });
  }

  /**
   * 項目を文章にする（画面・PDF と同じ並び。グラフは表と同じ数値のため省く）。項目の間は空の行。
   * closedKeys（{ key: true }）を渡すと、閉じた項目の見出しに NOT_SENT_MARK を付ける
   */
  function buildSectionsText(sections, closedKeys) {
    var closed = closedKeys || {};
    var lines = [];
    sections.forEach(function (section, i) {
      if (i) lines.push('');
      lines.push('【' + section.title + '】' + (section.closable && closed[section.key] ? NOT_SENT_MARK : ''));
      section.parts.forEach(function (part) {
        if (part.type === 'heading') lines.push('〈' + part.text + '〉');
        else if (part.type === 'lines') pushTextLines(lines, part.text);
        else if (part.type === 'table') pushTableLines(lines, part);
      });
    });
    return lines.join('\n');
  }

  /** limit 字ごとに切る（1行が1通より長いときだけ使う）。 */
  function splitByChars(line, limit) {
    var chars = String(line).match(SURROGATE_OR_CHAR) || [];
    var out = [];
    for (var i = 0; i < chars.length; i += limit) out.push(chars.slice(i, i + limit).join(''));
    return out;
  }

  function buildNumber(index, total) { return '(' + index + '/' + total + ')'; }
  function buildEndMark(total) { return '— 記録ここまで（' + total + '/' + total + '）—'; }

  /** 本文の行を、1通に使える字数（budget）ごとのまとまりに分ける。行の途中では切らない（1行が長すぎるときだけ切る）。 */
  function packLines(lines, budget) {
    var chunks = [];
    var current = [];
    var used = 0;
    lines.forEach(function (line) {
      var pieces = countTextChars(line) > budget ? splitByChars(line, budget) : [line];
      pieces.forEach(function (piece) {
        if (!current.length && piece === '') return;   // 通の頭に空の行を置かない
        var add = countTextChars(piece) + (current.length ? 1 : 0);
        if (current.length && used + add > budget) {
          chunks.push(current);
          current = [];
          used = 0;
          if (piece === '') return;
          add = countTextChars(piece);
        }
        current.push(piece);
        used += add;
      });
    });
    if (current.length || !chunks.length) chunks.push(current);
    return chunks;
  }

  /**
   * 自分に送る文章（1通以上）。options：
   *   info：鑑定情報　sent：相手に送った控え（{ text, format, sentAt }。なければ null）　currentText：いまの全体の文章（閉じた項目に印）
   *   memo：メモ（鑑定者用）　maxChars：1通の上限（省いたら MESSAGE_MAX_CHARS）　isSingle：分けずに1通にまとめる（メール用）
   *   edits：書き直した文の一覧（[{ label, text }]。text_edit.js の listTextEdits）。続きから再開できなかったときだけ渡す
   *     （ふつうは本文・控えが書き直した後の文のため要らない）
   *   noBodyNote：本文を作り直せなかったときに、本文の代わりに書く一文（currentText は使わない）
   * 返す値：文章の配列（i 番目が i+1 通目）
   */
  function buildRecordMessages(options) {
    var maxChars = options.isSingle ? Infinity : (options.maxChars || MESSAGE_MAX_CHARS);
    var searchLine = buildSearchLine(options.info);
    var body = [];
    // 本文はいつも全文。送ったか・印の意味を2行で言い切る（2026-10-22 ガクさん：送った文か全文か分かりづらい）
    if (options.sent) {
      body.push('■ 鑑定の全文（' + formatJstDateTime(options.sent.sentAt) + ' に相手へ ' +
        (FORMAT_LABELS[options.sent.format] || options.sent.format) + ' で送った時点の内容）');
      body.push(NOT_SENT_MARK + 'の付いた項目は、相手に送っていません。', '');
      body = body.concat(String(options.sent.text).split('\n'));
    } else {
      body.push('■ 鑑定の全文（相手にはまだ送っていません）');
      if (options.noBodyNote) body.push(options.noBodyNote);   // 続きから再開できず、本文を作り直せなかったとき
      else {
        body.push(NOT_SENT_MARK + 'の付いた項目は、いま送る項目から外している項目です。', '');
        body = body.concat(String(options.currentText || '').split('\n'));
      }
    }
    if (options.edits && options.edits.length) {
      body.push('', '■ 書き直した鑑定文（' + options.edits.length + 'か所）');
      options.edits.forEach(function (edit) {
        body.push('〈' + toOneLine(edit.label) + '〉');
        body = body.concat(String(edit.text).replace(/\s/g, '') ? String(edit.text).split('\n') : ['（文を消しています）']);
      });
    }
    body.push('', '■ メモ（自分用）');
    var memo = String(options.memo || '');
    body = body.concat(memo.replace(/\s/g, '') ? memo.split('\n') : ['（なし）']);

    var reserve = countTextChars(searchLine + ' ' + NUMBER_RESERVE) + 1 + 1 + countTextChars(buildEndMark(999));
    var budget = Math.max(MIN_BODY_CHARS, maxChars - reserve);
    var chunks = packLines(body, budget);
    return chunks.map(function (chunk, i) {
      var head = searchLine + ' ' + buildNumber(i + 1, chunks.length);
      var tail = i === chunks.length - 1 ? '\n' + buildEndMark(chunks.length) : '';
      return head + '\n' + chunk.join('\n') + tail;
    });
  }

  VIEW.RECORD_MESSAGE_MAX_CHARS = MESSAGE_MAX_CHARS;
  VIEW.NOT_SENT_MARK = NOT_SENT_MARK;
  VIEW.countTextChars = countTextChars;
  VIEW.formatJstDateTime = formatJstDateTime;
  VIEW.buildSearchLine = buildSearchLine;
  VIEW.buildSectionsText = buildSectionsText;
  VIEW.buildRecordMessages = buildRecordMessages;
})();
