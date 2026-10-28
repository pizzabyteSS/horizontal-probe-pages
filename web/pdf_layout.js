// ============================================================
// web/src/pdf_layout.js — 鑑定書 PDF・画像のページ割り（段階3a-1。3a-2 で切らないまとまり units の段落を足した）
// 設計：docs/web-pdf-plan.md §4.2・§4.3
//   中身（部品の並び）を A4 のページに割り、ページごとに「どこに何を描くか」の一覧を返す。描くのは pdf_draw.js
//   文字の幅は measure(文字, フォント) で受け取る（画面ではキャンバスで測る。手元の試験では差し替える）
//   決まり：どの行も本文の幅を超えない（ぶら下げなし）／段落は行の単位、表は行の単位で次のページへ送る／
//   表がページをまたいだら見出しの行を繰り返す／見出しはその後ろに最低2行が入らなければ次のページへ送る／
//   グラフ・図は1ページに収める
//   ページの向き：既定は A4 縦。部品 { type: 'page', orientation: 'landscape' } で以降を A4 横にする（運勢表。2026-10-21）。
//   各ページは向き・大きさを持つ（pages[i].width・height・widthPt・heightPt）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // ---- ページの形（A4 縦 595×842 ポイントの2倍。docs/web-pdf-plan.md §4.2） ----
  var PAGE_WIDTH = 1190;
  var PAGE_HEIGHT = 1684;
  var PAGE_WIDTH_PT = 595.28;
  var PAGE_HEIGHT_PT = 841.89;
  var MARGIN = 48;
  var ORIENTATION_PORTRAIT = 'portrait';
  var ORIENTATION_LANDSCAPE = 'landscape';
  var HEADER_HEIGHT = 56;     // 上の屋号・氏名・鑑定日と区切り線
  var LOGO_HEIGHT = 72;       // ロゴを描く高さ（段階3a-4。ロゴがあるときは上の枠をこの分だけ広げる）
  var LOGO_MAX_WIDTH_RATIO = 0.3;   // ロゴの幅の上限（本文の幅に対する割合。横に長いロゴは高さを縮める）
  var LOGO_GAP = 16;          // ロゴと屋号の間
  var HEADER_HEIGHT_WITH_LOGO = LOGO_HEIGHT + 24;
  var FOOTER_HEIGHT = 40;     // 下の n / N
  var CONTENT_LEFT = MARGIN;
  var CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;   // 縦の本文の幅（ロゴの大きさの上限にも使う。横のページも同じ大きさのロゴ）
  var BODY_TOP = MARGIN + HEADER_HEIGHT;   // ロゴがないときの本文の上端（ロゴがあるときは readBodyTop）
  var BODY_BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;   // 縦の本文の下端

  /** 向きごとのページの形（大きさ・本文の幅・本文の下端）。 */
  function createPageGeometry(orientation) {
    var isLandscape = orientation === ORIENTATION_LANDSCAPE;
    var width = isLandscape ? PAGE_HEIGHT : PAGE_WIDTH;
    var height = isLandscape ? PAGE_WIDTH : PAGE_HEIGHT;
    return {
      orientation: isLandscape ? ORIENTATION_LANDSCAPE : ORIENTATION_PORTRAIT,
      width: width, height: height,
      widthPt: isLandscape ? PAGE_HEIGHT_PT : PAGE_WIDTH_PT, heightPt: isLandscape ? PAGE_WIDTH_PT : PAGE_HEIGHT_PT,
      contentWidth: width - MARGIN * 2, bodyBottom: height - MARGIN - FOOTER_HEIGHT
    };
  }
  var GEOMETRY = { portrait: createPageGeometry(ORIENTATION_PORTRAIT), landscape: createPageGeometry(ORIENTATION_LANDSCAPE) };

  // ---- 文字（端末のフォント。docs/web-pdf-plan.md §4.2） ----
  var FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
  var LINE_RATIO = 1.6;       // 行間（字の大きさの倍）
  var STYLE = {
    title: { size: 40, weight: 'bold', color: '#1f2328', before: 0, after: 16 },
    heading1: { size: 32, weight: 'bold', color: '#1f2328', before: 28, after: 8 },
    heading2: { size: 27, weight: 'bold', color: '#1f2328', before: 18, after: 4 },
    heading3: { size: 26, weight: 'bold', color: '#59636e', before: 12, after: 2 },
    body: { size: 26, weight: 'normal', color: '#1f2328', before: 0, after: 10 },
    tip: { size: 22, weight: 'normal', color: '#59636e', before: 0, after: 8 },      // 豆知識・用語の添え書き（tone 'tip'）
    lead: { size: 32, weight: 'bold', color: '#1f2328', before: 0, after: 12 },     // ひと目でわかるあなたのキーワード（tone 'lead'）
    table: { size: 22, weight: 'normal', color: '#1f2328' },
    tableHead: { size: 22, weight: 'bold', color: '#1f2328' },
    page: { size: 20, weight: 'normal', color: '#59636e' },
    note: { size: 20, weight: 'normal', color: '#59636e', before: 40, after: 0 }
  };
  var CELL_PADDING = 10;
  var TABLE_AFTER = 16;
  var TABLE_LINE_COLOR = '#d1d9e0';
  var TABLE_HEAD_FILL = '#eef1f4';
  var TABLE_ROW_HEAD_FILL = '#f6f8fa';
  var TABLE_HEAD_BRAND_TEXT = '#ffffff';   // 色を決めたときの表の見出しの字（色は brand.js の候補。どれも白地で読める＝白字も読める）
  var CHART_HEIGHT = 460;     // 題名を含むグラフ1つの高さ
  var CHART_AFTER = 16;
  var FIGURE_AFTER = 16;      // 鑑定書の図（部品 figure）の下の余白
  var MARK_COLOR_DEFAULT = '#0969da';   // 年運の「今年」の印の色（屋号の色がなければ。view_figure.js の FIGURE_ACCENT_DEFAULT と同じ）
  var MIN_LINES_AFTER_HEADING = 2;
  var NOTE_RULE_GAP = 12;     // 注記の区切り線と文の間
  // 枠（部品 boxStart〜boxEnd。鑑定書の「鑑定の根拠」）：本文の幅の外へ少し広げて塗る（中の部品の幅・位置は変えない）
  var BOX_FILL = '#f4f6f8';
  var BOX_STROKE = '#d1d9e0';
  var BOX_OUTSET = 16;        // 本文の左右から外へ広げる幅（余白 MARGIN の内側に収まる）
  var BOX_PAD = 16;           // 枠の上下の内側の余白
  var BOX_AFTER = 16;         // 枠の下の余白
  var BOX_CELL_FILL = '#ffffff';   // 枠の中の表の値のセル（塗りなしだと枠の色が透けて読みにくい）
  // 要の一文の枠（tone 'key'。段階3）：薄い地に、左へ章の色の線
  var KEY_BOX_FILL = '#fafbfc';
  var KEY_BOX_STROKE = '#e6e1d6';
  var KEY_BAR_WIDTH = 8;
  var ICON_GAP = 14;          // 章のアイコンと見出しの字の間
  var TERM_SEPARATOR = '：';  // tone 'terms'：各行の「：」の前（用語）を太字にする（用語ミニ辞典）

  // ---- 禁則（docs/web-pdf-plan.md §4.3） ----
  var NO_LINE_START = '、。，．・：；？！ー）」』】〕〉》ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ,.:;?!)]}';
  var NO_LINE_END = '（「『【〔〈《([{';
  var WORD_CHAR = /[A-Za-z0-9]/;
  var UNIT_SEPARATOR = '\u3000';   // 切ってはいけないまとまりの間（全角の空白。行の頭と終わりには置かない）

  /** フォントの指定（キャンバスの font）。 */
  function formatFont(style) {
    return style.weight + ' ' + style.size + 'px ' + FONT_FAMILY;
  }

  function lineHeightOf(style) { return Math.round(style.size * LINE_RATIO); }

  /** 文字を1字ずつに分ける（サロゲートペアは1字として扱う）。 */
  function splitChars(text) {
    return String(text).match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || [];
  }

  /** 1字の幅を測る（同じ字は測り直さない）。 */
  function createCharMeasure(measure) {
    var cache = {};
    return function (ch, font) {
      var key = font + '\u0000' + ch;
      if (!Object.prototype.hasOwnProperty.call(cache, key)) cache[key] = measure(ch, font);
      return cache[key];
    };
  }

  function isNoLineStart(ch) { return ch !== undefined && NO_LINE_START.indexOf(ch) >= 0; }
  function isNoLineEnd(ch) { return ch !== undefined && NO_LINE_END.indexOf(ch) >= 0; }
  function isWordChar(ch) { return ch !== undefined && WORD_CHAR.test(ch); }

  /**
   * chars[start..] の1行の終わり（含まない添字）を決める。幅を超えない最長の位置（limit まで）から始め、
   * 半角の英数字の続きを切らない・禁則を守る位置まで戻す（追い出し）。戻すと1字も残らないときは幅で切る。
   */
  function findLineEnd(chars, start, maxWidth, charWidth, font, limit) {
    var width = 0;
    var end = start;
    while (end < limit) {
      var w = charWidth(chars[end], font);
      if (end > start && width + w > maxWidth) break;
      width += w;
      end++;
    }
    if (end >= chars.length) return end;
    var fitEnd = end;
    // 半角の英数字の続きは、行の頭から始まるもの（1行より長い）でなければ途中で切らない
    if (isWordChar(chars[end]) && isWordChar(chars[end - 1])) {
      var wordStart = end - 1;
      while (wordStart > start && isWordChar(chars[wordStart - 1])) wordStart--;
      if (wordStart > start) end = wordStart;
    }
    // 次の行の頭に置けない字・この行の終わりに置けない字があれば、この行の末尾の字を次の行へ送る
    while (end - 1 > start && (isNoLineStart(chars[end]) || isNoLineEnd(chars[end - 1]))) end--;
    if (isNoLineStart(chars[end]) || isNoLineEnd(chars[end - 1])) return fitEnd;
    return end;
  }

  /**
   * 文を maxWidth に収まる行に分ける。改行はそのまま段落の区切り（空の行は空の行として残す）。
   * 字ごとの幅の和で割ったあと、行全体を測り直して幅を超えていれば1字ずつ減らす（字の詰めの差の分）。
   */
  function wrapText(text, maxWidth, measure, font, charWidth) {
    var widthOfChar = charWidth || createCharMeasure(measure);
    var lines = [];
    String(text).split('\n').forEach(function (paragraph) {
      var chars = splitChars(paragraph);
      if (!chars.length) { lines.push(''); return; }
      var start = 0;
      while (start < chars.length) {
        var end = findLineEnd(chars, start, maxWidth, widthOfChar, font, chars.length);
        var line = chars.slice(start, end).join('');
        while (end - start > 1 && measure(line, font) > maxWidth) {
          end = findLineEnd(chars, start, maxWidth, widthOfChar, font, end - 1);
          line = chars.slice(start, end).join('');
        }
        lines.push(line);
        start = end;
      }
    });
    return lines;
  }

  /**
   * 切ってはいけないまとまり（units。行ごとのまとまりの「列名：値」）を UNIT_SEPARATOR でつないで行に分ける。
   * まとまりの間でだけ改行し、1つのまとまりが1行より長いときだけ wrapText で幅に分ける（docs/web-pdf-plan.md §4.3）。
   */
  function wrapUnits(units, maxWidth, measure, font, charWidth) {
    var lines = [];
    var line = '';
    units.forEach(function (unit) {
      var candidate = line ? line + UNIT_SEPARATOR + unit : unit;
      if (measure(candidate, font) <= maxWidth) { line = candidate; return; }
      if (line) lines.push(line);
      if (measure(unit, font) <= maxWidth) { line = unit; return; }
      var parts = wrapText(unit, maxWidth, measure, font, charWidth);
      lines = lines.concat(parts.slice(0, -1));
      line = parts[parts.length - 1];
    });
    if (line) lines.push(line);
    return lines;
  }

  /** maxWidth に収まらなければ末尾を「…」にして縮める。 */
  function fitText(text, maxWidth, measure, font) {
    var value = String(text);
    if (measure(value, font) <= maxWidth) return value;
    var chars = splitChars(value);
    while (chars.length && measure(chars.join('') + '…', font) > maxWidth) chars.pop();
    return chars.join('') + '…';
  }

  // ---- 表の列の幅 ----
  /**
   * 列の幅を決める。各列の自然な幅（折り返さない幅＋余白）の合計が本文の幅に収まれば比例して広げる。
   * 収まらなければ、広い列から同じ上限で削る（上限 c を、min(自然な幅, c) の合計が本文の幅になるように決める）。
   * contentWidth は本文の幅（ページの向きで変わる。省いたら縦）
   */
  function computeColumnWidths(table, measure, contentWidth) {
    var available = contentWidth || GEOMETRY.portrait.contentWidth;   // 割る幅（本文の幅）
    var count = Math.max(table.headers ? table.headers.length : 0, table.rows.reduce(function (n, row) { return Math.max(n, row.length); }, 0));
    var natural = [];
    for (var c = 0; c < count; c++) {
      var widest = 0;
      if (table.headers) widest = measure(String(table.headers[c] || ''), formatFont(STYLE.tableHead));
      table.rows.forEach(function (row) {
        String(row[c] === undefined ? '' : row[c]).split('\n').forEach(function (part) {
          widest = Math.max(widest, measure(part, formatFont(c === 0 ? STYLE.tableHead : STYLE.table)));
        });
      });
      natural.push(Math.min(available, Math.ceil(widest) + CELL_PADDING * 2));
    }
    var total = natural.reduce(function (a, b) { return a + b; }, 0);
    if (total <= available) {
      return natural.map(function (w) { return w * available / total; });
    }
    var low = 0;
    var high = available;
    for (var i = 0; i < 40; i++) {
      var cap = (low + high) / 2;
      var sum = natural.reduce(function (a, w) { return a + Math.min(w, cap); }, 0);
      if (sum > available) high = cap; else low = cap;
    }
    var widths = natural.map(function (w) { return Math.min(w, low); });
    var rest = available - widths.reduce(function (a, b) { return a + b; }, 0);
    widths[widths.length - 1] += rest;   // 端数を最後の列に足して本文の幅にそろえる
    return widths;
  }

  // ---- ページへの配置 ----
  /** 本文の上端（ロゴがあれば上の枠を広げた分だけ下げる）。 */
  function readBodyTop(header) {
    return header && header.brandLogo ? MARGIN + HEADER_HEIGHT_WITH_LOGO : BODY_TOP;
  }

  /** 新しいページ（向きの形を写す）。 */
  function createPage(geo) {
    return { items: [], orientation: geo.orientation, width: geo.width, height: geo.height, widthPt: geo.widthPt, heightPt: geo.heightPt };
  }

  function createCursor(bodyTop) {
    // box：枠の中にいる間の { y：このページで枠が始まる高さ }（枠の外なら null）
    var cursor = { pages: [], page: null, y: bodyTop, geo: GEOMETRY.portrait, bodyHeight: GEOMETRY.portrait.bodyBottom - bodyTop, box: null };
    /** いまのページに、枠の y〜y1 の塗りを足す（ページの項目の先頭に置き、表・文字より先に描く）。 */
    cursor.closeBoxSegment = function (y1) {
      if (!cursor.box || y1 <= cursor.box.y) return;
      var isKey = cursor.box.tone === 'key';
      var box = { kind: 'box', x: CONTENT_LEFT - BOX_OUTSET, y: cursor.box.y, w: cursor.geo.contentWidth + BOX_OUTSET * 2,
        h: y1 - cursor.box.y, fill: isKey ? KEY_BOX_FILL : BOX_FILL, stroke: isKey ? KEY_BOX_STROKE : BOX_STROKE, tag: { role: 'box' } };
      if (isKey && cursor.box.color) { box.barColor = cursor.box.color; box.barWidth = KEY_BAR_WIDTH; }
      cursor.page.items.unshift(box);
    };
    /** 新しいページ。枠の中でページが変わったら、前のページの枠を下端まで塗り、新しいページの上から枠を続ける。 */
    cursor.newPage = function () {
      if (cursor.box && cursor.page) cursor.closeBoxSegment(cursor.geo.bodyBottom);
      cursor.page = createPage(cursor.geo);
      cursor.pages.push(cursor.page);
      cursor.y = bodyTop;
      if (cursor.box) {
        cursor.box.y = bodyTop;
        cursor.y = bodyTop + BOX_PAD / 2;
      }
    };
    /** 以降のページの向きを変える。いまのページが空ならそのページを替え、そうでなければ次のページから。 */
    /** 以降のページの向きを変える。breakBefore なら向きが同じでも新しいページから始める（ページが空なら何もしない）。 */
    cursor.setOrientation = function (orientation, breakBefore) {
      var geo = GEOMETRY[orientation] || GEOMETRY.portrait;
      if (geo === cursor.geo) {
        if (breakBefore && cursor.page.items.length) cursor.newPage();
        return;
      }
      cursor.geo = geo;
      cursor.bodyHeight = geo.bodyBottom - bodyTop;
      if (!cursor.page.items.length) cursor.pages.pop();
      cursor.newPage();
    };
    cursor.isTop = function () { return cursor.y === bodyTop; };
    cursor.remaining = function () { return cursor.geo.bodyBottom - cursor.y; };
    cursor.add = function (item) { cursor.page.items.push(item); };
    cursor.newPage();
    return cursor;
  }

  function addTextItem(cursor, x, y, text, style, measure, tag) {
    var font = formatFont(style);
    cursor.add({ kind: 'text', x: x, y: y, lineHeight: lineHeightOf(style), text: text, font: font,
      color: style.color, width: measure(text, font), tag: tag });
  }

  /** 段落・見出しの行（本文の幅 contentWidth で割ったもの）。 */
  function wrapBlockLines(block, style, measure, charWidth, contentWidth) {
    if (block.units) return wrapUnits(block.units, contentWidth, measure, formatFont(style), charWidth);
    return wrapText(block.text, contentWidth, measure, formatFont(style), charWidth);
  }

  function styleOfBlock(block) {
    if (block.type === 'title') return STYLE.title;
    if (block.type === 'heading') return STYLE['heading' + (block.level || 1)] || STYLE.heading1;
    if (block.type === 'paragraph' && (block.tone === 'tip' || block.tone === 'lead')) return STYLE[block.tone];
    return STYLE.body;
  }

  /** 表の1行の形：各セルの行と、その行の高さ。 */
  function measureTableRow(cells, widths, isHead, measure, charWidth) {
    var lines = widths.map(function (w, c) {
      var style = isHead || c === 0 ? STYLE.tableHead : STYLE.table;
      return wrapText(cells[c] === undefined ? '' : cells[c], w - CELL_PADDING * 2, measure, formatFont(style), charWidth);
    });
    var most = lines.reduce(function (n, cellLines) { return Math.max(n, cellLines.length); }, 1);
    return { cells: lines, lineCount: most, height: most * lineHeightOf(STYLE.table) + CELL_PADDING * 2 };
  }

  /**
   * ブロックの最初の部分の高さ（見出しの直後に必要な高さ）。段落は2行ぶん（1行なら1行）、表は見出しの行と1行目、
   * グラフは全体、見出しはその高さと続くブロックの最初の部分。見出しが続くときは、続く見出しの上の余白も足す
   * （続く見出しはページの頭に来ないため、placeHeading で余白が付く）。
   */
  function measureBlockStart(blocks, index, measure, charWidth, widthsCache, bodyHeight, contentWidth) {
    var block = blocks[index];
    if (!block) return 0;
    if (block.type === 'paragraph') {
      var paragraphStyle = styleOfBlock(block);
      var lines = wrapBlockLines(block, paragraphStyle, measure, charWidth, contentWidth);
      return Math.min(MIN_LINES_AFTER_HEADING, lines.length) * lineHeightOf(paragraphStyle);
    }
    if (block.type === 'boxStart') {   // 枠の上の余白と、枠の中の最初の部品（見出しならその上の余白も）
      var inner = blocks[index + 1];
      var innerBefore = inner && (inner.type === 'title' || inner.type === 'heading') ? styleOfBlock(inner).before : 0;
      return BOX_PAD + innerBefore + measureBlockStart(blocks, index + 1, measure, charWidth, widthsCache, bodyHeight, contentWidth);
    }
    if (block.type === 'note') {   // 注記は区切り線ごと1つのまとまり（見出しだけをページの終わりに残さない。Codex P2）
      var noteLines = wrapBlockLines(block, STYLE.note, measure, charWidth, contentWidth);
      return STYLE.note.before + NOTE_RULE_GAP + noteLines.length * lineHeightOf(STYLE.note);
    }
    if (block.type === 'table') {
      var widths = widthsCache(block);
      var head = block.headers ? measureTableRow(block.headers, widths, true, measure, charWidth).height : 0;
      var first = block.rows.length ? measureTableRow(block.rows[0], widths, false, measure, charWidth).height : 0;
      return Math.min(head + first, bodyHeight);
    }
    if (block.type === 'chart') return CHART_HEIGHT;
    if (block.type === 'figure') return measureFigure(block, contentWidth).h;
    if (block.type === 'title' || block.type === 'heading') {
      var style = styleOfBlock(block);
      var own = wrapBlockLines(block, style, measure, charWidth, contentWidth).length * lineHeightOf(style) + style.after;
      var next = blocks[index + 1];
      var nextBefore = next && (next.type === 'title' || next.type === 'heading') ? styleOfBlock(next).before : 0;
      return own + nextBefore + measureBlockStart(blocks, index + 1, measure, charWidth, widthsCache, bodyHeight, contentWidth);
    }
    return 0;
  }

  function placeHeading(cursor, blocks, index, measure, charWidth, widthsCache) {
    var block = blocks[index];
    var style = styleOfBlock(block);
    var iconRoom = block.icon ? lineHeightOf(style) + ICON_GAP : 0;   // 章のアイコン（段階3）は1行目の字の前
    var lines = wrapBlockLines(block, style, measure, charWidth, cursor.geo.contentWidth - iconRoom);
    var before = cursor.isTop() ? 0 : style.before;
    var need = before + measureBlockStart(blocks, index, measure, charWidth, widthsCache, cursor.bodyHeight, cursor.geo.contentWidth);
    if (!cursor.isTop() && need > cursor.remaining()) { cursor.newPage(); before = 0; }
    cursor.y += before;
    if (block.icon) addIconItem(cursor, block.icon, CONTENT_LEFT, cursor.y, lineHeightOf(style), index);
    lines.forEach(function (line) {
      addTextItem(cursor, CONTENT_LEFT + iconRoom, cursor.y, line, style, measure, { block: index, role: 'heading' });
      cursor.y += lineHeightOf(style);
    });
    cursor.y += style.after;
  }

  /** 章のアイコンを足す（図と同じ描き方。形は view_figure.js の layoutIcon。色は章の色のまま）。 */
  function addIconItem(cursor, icon, x, y, size, index) {
    var shape = VIEW.layoutIcon(icon);
    if (!shape) return;
    cursor.add({ kind: 'figure', x: x, y: y, w: size, h: size, scale: size / shape.width, shapes: shape.shapes, accent: icon.color, isIcon: true,
      tag: { block: index, role: 'icon' } });
  }

  /**
   * 各行の「：」の前（用語）を太字にする段落（tone 'terms'。用語ミニ辞典）。太字の分だけ幅を狭めて割り、
   * 行の頭が用語のとき（元の行の1行目）は、用語を太字・残りを本文の字で並べて描く
   */
  function placeTermParagraph(cursor, blocks, index, measure, charWidth) {
    var block = blocks[index];
    var style = STYLE.body;
    var bold = { size: style.size, weight: 'bold', color: style.color };
    var lineHeight = lineHeightOf(style);
    var lineNo = 0;
    String(block.text).split('\n').forEach(function (source) {
      var at = source.indexOf(TERM_SEPARATOR);
      var term = at > 0 ? source.slice(0, at) : '';
      var extra = term ? Math.max(0, measure(term, formatFont(bold)) - measure(term, formatFont(style))) : 0;
      wrapText(source, cursor.geo.contentWidth - extra, measure, formatFont(style), charWidth).forEach(function (line, i) {
        if (lineHeight > cursor.remaining()) cursor.newPage();
        var tag = { block: index, role: 'line', line: lineNo++ };
        if (i === 0 && term && line.indexOf(term) === 0) {
          addTextItem(cursor, CONTENT_LEFT, cursor.y, term, bold, measure, tag);
          var rest = line.slice(term.length);
          if (rest) addTextItem(cursor, CONTENT_LEFT + measure(term, formatFont(bold)), cursor.y, rest, style, measure, tag);
        } else {
          addTextItem(cursor, CONTENT_LEFT, cursor.y, line, style, measure, tag);
        }
        cursor.y += lineHeight;
      });
    });
    cursor.y += style.after;
  }

  function placeParagraph(cursor, blocks, index, measure, charWidth) {
    var block = blocks[index];
    if (block.tone === 'terms') { placeTermParagraph(cursor, blocks, index, measure, charWidth); return; }
    var style = styleOfBlock(block);
    var lineHeight = lineHeightOf(style);
    wrapBlockLines(block, style, measure, charWidth, cursor.geo.contentWidth).forEach(function (line, i) {
      if (lineHeight > cursor.remaining()) cursor.newPage();
      addTextItem(cursor, CONTENT_LEFT, cursor.y, line, style, measure, { block: index, role: 'line', line: i });
      cursor.y += lineHeight;
    });
    cursor.y += style.after;
  }

  /**
   * 枠の始まり。枠の上の余白と中の最初の部品が入らなければ、次のページから始める（枠の上の端だけをページの終わりに残さない）
   */
  function placeBoxStart(cursor, blocks, index, measure, charWidth, widthsCache) {
    var need = measureBlockStart(blocks, index, measure, charWidth, widthsCache, cursor.bodyHeight, cursor.geo.contentWidth);
    if (!cursor.isTop() && need > cursor.remaining()) cursor.newPage();
    cursor.box = { y: cursor.y, tone: blocks[index].tone || '', color: blocks[index].color || '' };
    cursor.y += BOX_PAD;
  }

  /** 枠の終わり。前の部品の下の余白を枠の下の余白にして塗り、枠の下に余白を空ける。 */
  function placeBoxEnd(cursor) {
    if (!cursor.box) return;
    cursor.closeBoxSegment(Math.min(cursor.y, cursor.geo.bodyBottom));
    cursor.box = null;
    cursor.y += BOX_AFTER;
  }

  /**
   * 末尾の注記（鑑定書の字数。2026-10-22 ガクさん）。本文と混ざらないよう、上に余白と区切り線を置き、小さめの字で右に寄せる。
   * 注記がページに収まらなければ次のページへ送る
   */
  function placeNote(cursor, blocks, index, measure, charWidth) {
    var style = STYLE.note;
    var font = formatFont(style);
    var lineHeight = lineHeightOf(style);
    var lines = wrapBlockLines(blocks[index], style, measure, charWidth, cursor.geo.contentWidth);
    if (style.before + NOTE_RULE_GAP + lines.length * lineHeight > cursor.remaining() && !cursor.isTop()) cursor.newPage();
    if (!cursor.isTop()) cursor.y += style.before;
    var right = CONTENT_LEFT + cursor.geo.contentWidth;
    cursor.add({ kind: 'line', x1: CONTENT_LEFT, y1: cursor.y, x2: right, y2: cursor.y, y: cursor.y, h: 1, color: TABLE_LINE_COLOR, tag: { block: index, role: 'rule' } });
    cursor.y += NOTE_RULE_GAP;
    lines.forEach(function (line, i) {
      addTextItem(cursor, right - measure(line, font), cursor.y, line, style, measure, { block: index, role: 'line', line: i });
      cursor.y += lineHeight;
    });
    cursor.y += style.after;
  }

  /** 表の1行（または長すぎる行の一部 fromLine〜toLine）を描く項目を足す。 */
  function addTableRowItems(cursor, shape, widths, isHead, fromLine, toLine, measure, tag) {
    var lineHeight = lineHeightOf(STYLE.table);
    var height = (toLine - fromLine) * lineHeight + CELL_PADDING * 2;
    var x = CONTENT_LEFT;
    widths.forEach(function (w, c) {
      var fill = isHead ? TABLE_HEAD_FILL : (c === 0 ? TABLE_ROW_HEAD_FILL : (cursor.box ? BOX_CELL_FILL : null));
      cursor.add({ kind: 'cell', x: x, y: cursor.y, w: w, h: height, fill: fill, stroke: TABLE_LINE_COLOR, tag: tag, isTableHead: isHead });
      var style = isHead || c === 0 ? STYLE.tableHead : STYLE.table;
      shape.cells[c].slice(fromLine, toLine).forEach(function (line, i) {
        cursor.add({ kind: 'text', x: x + CELL_PADDING, y: cursor.y + CELL_PADDING + i * lineHeight, lineHeight: lineHeight,
          text: line, font: formatFont(style), color: style.color, width: measure(line, formatFont(style)), maxWidth: w - CELL_PADDING * 2, tag: tag, isTableHead: isHead });
      });
      x += w;
    });
    cursor.y += height;
  }

  function placeTable(cursor, blocks, index, measure, charWidth, widthsCache) {
    var block = blocks[index];
    var widths = widthsCache(block);
    var lineHeight = lineHeightOf(STYLE.table);
    var head = block.headers ? measureTableRow(block.headers, widths, true, measure, charWidth) : null;
    var headHeight = head ? head.height : 0;
    var placeHead = function () {
      if (head) addTableRowItems(cursor, head, widths, true, 0, head.lineCount, measure, { block: index, role: 'tableHead' });
    };
    var rows = block.rows.map(function (row) { return measureTableRow(row, widths, false, measure, charWidth); });
    // 見出しの行と1行目が入らなければ次のページから始める。1行目がページより高いときだけ、その最初の1行ぶんで判定する
    //   （1行目を丸ごとで判定しないと、見出しの行だけがページの下に残る。下の行の置き方と同じ境目。2026-10-28）
    var firstRowNeed = !rows.length ? 0
      : rows[0].height <= cursor.bodyHeight - headHeight ? rows[0].height : lineHeight + CELL_PADDING * 2;
    var firstNeed = headHeight + firstRowNeed;
    if (!cursor.isTop() && firstNeed > cursor.remaining()) cursor.newPage();
    placeHead();
    rows.forEach(function (shape, r) {
      var tag = { block: index, role: 'tableRow', row: r };
      if (shape.height <= cursor.remaining()) { addTableRowItems(cursor, shape, widths, false, 0, shape.lineCount, measure, tag); return; }
      if (shape.height <= cursor.bodyHeight - headHeight) {
        cursor.newPage();
        placeHead();
        addTableRowItems(cursor, shape, widths, false, 0, shape.lineCount, measure, tag);
        return;
      }
      // 1行がページより高いときだけ、セルの中を行の単位で分ける
      var from = 0;
      while (from < shape.lineCount) {
        var fit = Math.floor((cursor.remaining() - CELL_PADDING * 2) / lineHeight);
        if (fit < 1) { cursor.newPage(); placeHead(); continue; }
        var to = Math.min(shape.lineCount, from + fit);
        addTableRowItems(cursor, shape, widths, false, from, to, measure, { block: index, role: 'tableRow', row: r, part: from });
        from = to;
        if (from < shape.lineCount) { cursor.newPage(); placeHead(); }
      }
    });
    cursor.y += TABLE_AFTER;
  }

  function placeChart(cursor, blocks, index) {
    var block = blocks[index];
    if (!block.points || !block.points.length) return;
    if (CHART_HEIGHT > cursor.remaining()) cursor.newPage();
    cursor.add({ kind: 'chart', x: CONTENT_LEFT, y: cursor.y, w: cursor.geo.contentWidth, h: CHART_HEIGHT,
      title: block.title, points: block.points, color: block.color, markIndex: block.markIndex, markLabel: block.markLabel,
      markColor: MARK_COLOR_DEFAULT, tag: { block: index, role: 'chart' } });
    cursor.y += CHART_HEIGHT + CHART_AFTER;
  }

  /** 図の形と、本文の幅に広げた大きさ（view_figure.js の layoutFigure を PDF 用の幅で組み、scale 倍で描く）。 */
  function measureFigure(block, contentWidth) {
    var shape = VIEW.layoutFigure(block.figure, VIEW.FIGURE_PDF_DESIGN_WIDTH);
    if (!shape) return { shape: null, h: 0, scale: 1 };
    var scale = contentWidth / shape.width;
    return { shape: shape, h: Math.ceil(shape.height * scale), scale: scale };
  }

  /** 図は1ページに収める（入らなければ次のページへ）。 */
  function placeFigure(cursor, blocks, index) {
    var figure = measureFigure(blocks[index], cursor.geo.contentWidth);
    if (!figure.shape) return;
    if (!cursor.isTop() && figure.h > cursor.remaining()) cursor.newPage();
    cursor.add({ kind: 'figure', x: CONTENT_LEFT, y: cursor.y, w: cursor.geo.contentWidth, h: figure.h, scale: figure.scale,
      shapes: figure.shape.shapes, accent: VIEW.FIGURE_ACCENT_DEFAULT, tag: { block: index, role: 'figure' } });
    cursor.y += figure.h + FIGURE_AFTER;
  }

  /** ロゴを描く大きさ（高さ LOGO_HEIGHT。横に長すぎれば幅の上限に合わせて縮める）。 */
  function fitLogoBox(logo) {
    var maxWidth = CONTENT_WIDTH * LOGO_MAX_WIDTH_RATIO;
    var width = logo.width * LOGO_HEIGHT / logo.height;
    if (width <= maxWidth) return { w: width, h: LOGO_HEIGHT };
    return { w: maxWidth, h: logo.height * maxWidth / logo.width };
  }

  /**
   * 各ページの上（ロゴ・屋号・氏名 様・鑑定日）と下（n / N）を足す。
   * ロゴがあれば左上に描き、文字はロゴの高さの真ん中にそろえる。色があれば区切りの線をその色にする
   */
  function addPageFrames(pages, header, measure) {
    var font = formatFont(STYLE.page);
    var lineHeight = lineHeightOf(STYLE.page);
    var right = ' 鑑定日 ' + (header.kanteiDate || '-');
    var brand = header.brandName ? String(header.brandName) : '';
    // 屋号は選んだ書体で、少し太く大きく書く（屋号らしく見せる）
    var brandFont = header.brandFontFamily ? 'bold ' + STYLE.page.size + 'px ' + header.brandFontFamily : 'bold ' + STYLE.page.size + 'px ' + FONT_FAMILY;
    var logo = header.brandLogo ? fitLogoBox(header.brandLogo) : null;
    var bandHeight = logo ? LOGO_HEIGHT : lineHeight;
    var textY = MARGIN + (bandHeight - lineHeight) / 2;
    var logoRoom = logo ? logo.w + LOGO_GAP : 0;
    var ruleY = MARGIN + bandHeight + 8;
    pages.forEach(function (page, i) {
      var contentWidth = page.width - MARGIN * 2;   // ページの向きごとの本文の幅
      if (logo) page.items.push({ kind: 'image', x: CONTENT_LEFT, y: MARGIN + (LOGO_HEIGHT - logo.h) / 2, w: logo.w, h: logo.h, tag: { role: 'frame' } });
      var leftText = brand ? fitText(brand, Math.max(0, contentWidth * 0.45 - logoRoom), measure, brandFont) : '';
      var leftWidth = logoRoom + (leftText ? measure(leftText, brandFont) + 24 : 0);
      var nameText = header.name && header.name !== '-' ? header.name + ' 様　' : '';
      var rightRoom = contentWidth - leftWidth - measure(right, font);
      var rightText = (nameText ? fitText(nameText, Math.max(0, rightRoom), measure, font) : '') + right;
      var rightWidth = measure(rightText, font);
      if (leftText) page.items.push({ kind: 'text', x: CONTENT_LEFT + logoRoom, y: textY, lineHeight: lineHeight, text: leftText, font: brandFont, color: STYLE.page.color, width: measure(leftText, brandFont), tag: { role: 'frame' } });
      page.items.push({ kind: 'text', x: CONTENT_LEFT + contentWidth - rightWidth, y: textY, lineHeight: lineHeight, text: rightText, font: font, color: STYLE.page.color, width: rightWidth, tag: { role: 'frame' } });
      page.items.push({ kind: 'line', x1: CONTENT_LEFT, y1: ruleY, x2: CONTENT_LEFT + contentWidth, y2: ruleY, color: header.brandColor || TABLE_LINE_COLOR, tag: { role: 'frame' } });
      var footer = (i + 1) + ' / ' + pages.length;
      var footerWidth = measure(footer, font);
      page.items.push({ kind: 'text', x: (page.width - footerWidth) / 2, y: page.height - MARGIN - lineHeight, lineHeight: lineHeight, text: footer, font: font, color: STYLE.page.color, width: footerWidth, tag: { role: 'frame' } });
    });
  }

  /** 題名と大きな見出し（level 1）を色で書く（段階3a-4。色がなければ今までの色）。 */
  function applyBrandColor(pages, blocks, color) {
    if (!color) return;
    pages.forEach(function (page) {
      page.items.forEach(function (item) {
        // 図の強調（日柱・今ここ・針）と年運の「今年」の印も屋号の色にする（画面と同じ）
        if (item.kind === 'figure') { if (!item.isIcon) item.accent = color; return; }   // 章のアイコンは章の色のまま
        if (item.kind === 'chart') { item.markColor = color; return; }
        // 表の見出しの行も色で塗り、字を白にする（画面・印刷と同じ。灰色のままだとデザインが変わった感じがしなかった。2026-10-23 ガクさん）
        if (item.isTableHead) {
          if (item.kind === 'cell') { item.fill = color; item.stroke = color; } else if (item.kind === 'text') item.color = TABLE_HEAD_BRAND_TEXT;
          return;
        }
        if (!item.tag || item.tag.role !== 'heading') return;
        var block = blocks[item.tag.block];
        if (block.type === 'title' || (block.level || 1) === 1) item.color = color;
      });
    });
  }

  /**
   * 中身をページに割る。doc は { header: { name, kanteiDate, brandName, brandColor, brandLogo: { width, height } または null }, blocks: [部品] }。
   * 部品：{ type: 'title'|'heading', level, text } / { type: 'paragraph', text } / { type: 'note', text }（末尾の注記。右寄せ・小さめ・区切り線） /
   *       { type: 'table', headers: [..] または null, rows: [[..]] } / { type: 'chart', title, points: [{ label, value }], color, markIndex, markLabel } /
   *       { type: 'figure', figure: 画面の部品 figure }（鑑定書の図。1ページに収める。描く項目は { kind: 'figure', x, y, w, h, scale, shapes, accent }） /
   *       { type: 'page', orientation: 'portrait'|'landscape', breakBefore }（以降のページの向き。breakBefore なら新しいページから） /
   *       { type: 'boxStart' } … { type: 'boxEnd' }（間の部品を薄い色の枠で囲む。ページをまたげばページごとに塗る）。
   *       段落の tone：'tip'（小さめの灰色）・'lead'（大きめの太字）・'terms'（各行の「：」の前を太字）。
   *       見出しの icon：{ name, color }（章のアイコン。1行目の字の前）。枠の tone 'key'：要の一文の枠（左に color の線）
   *   枠は { kind: 'box', x, y, w, h, fill, stroke }（ページの項目の先頭）
   * 返す値：[{ items: [描く項目], orientation, width, height, widthPt, heightPt }]。項目の座標はページの左上が 0。
   *   ロゴは { kind: 'image' }（描くときに画像を渡す）
   */
  function layoutDocument(doc, measure) {
    var charWidth = createCharMeasure(measure);
    var widthsByBlock = {};
    var header = doc.header || {};
    var cursor = createCursor(readBodyTop(header));
    // 表の列の幅は、置くページの向きの本文の幅で決める
    var widthsCache = function (block) {
      var key = doc.blocks.indexOf(block) + ':' + cursor.geo.orientation;
      if (!widthsByBlock[key]) widthsByBlock[key] = computeColumnWidths(block, measure, cursor.geo.contentWidth);
      return widthsByBlock[key];
    };
    doc.blocks.forEach(function (block, index) {
      if (block.type === 'page') cursor.setOrientation(block.orientation, !!block.breakBefore);
      else if (block.type === 'title' || block.type === 'heading') placeHeading(cursor, doc.blocks, index, measure, charWidth, widthsCache);
      else if (block.type === 'paragraph') placeParagraph(cursor, doc.blocks, index, measure, charWidth);
      else if (block.type === 'note') placeNote(cursor, doc.blocks, index, measure, charWidth);
      else if (block.type === 'table') placeTable(cursor, doc.blocks, index, measure, charWidth, widthsCache);
      else if (block.type === 'chart') placeChart(cursor, doc.blocks, index);
      else if (block.type === 'figure') placeFigure(cursor, doc.blocks, index);
      else if (block.type === 'boxStart') placeBoxStart(cursor, doc.blocks, index, measure, charWidth, widthsCache);
      else if (block.type === 'boxEnd') placeBoxEnd(cursor);
    });
    placeBoxEnd(cursor);   // 閉じ忘れの枠は最後で閉じる
    // 最後のページが空（ちょうど前のページで終わった）なら捨てる
    if (cursor.pages.length > 1 && !cursor.page.items.length) cursor.pages.pop();
    addPageFrames(cursor.pages, header, measure);
    applyBrandColor(cursor.pages, doc.blocks, header.brandColor);
    return cursor.pages;
  }

  VIEW.PDF_PAGE_LANDSCAPE = GEOMETRY.landscape;
  VIEW.PDF_PAGE = {
    width: PAGE_WIDTH, height: PAGE_HEIGHT, widthPt: PAGE_WIDTH_PT, heightPt: PAGE_HEIGHT_PT,
    contentLeft: CONTENT_LEFT, contentWidth: CONTENT_WIDTH, bodyTop: BODY_TOP, bodyTopWithLogo: MARGIN + HEADER_HEIGHT_WITH_LOGO,
    bodyBottom: BODY_BOTTOM, margin: MARGIN, logoHeight: LOGO_HEIGHT, logoMaxWidth: CONTENT_WIDTH * LOGO_MAX_WIDTH_RATIO,
    fontFamily: FONT_FAMILY, noLineStart: NO_LINE_START, noLineEnd: NO_LINE_END
  };
  VIEW.wrapPdfText = wrapText;
  VIEW.wrapPdfUnits = wrapUnits;
  VIEW.PDF_UNIT_SEPARATOR = UNIT_SEPARATOR;
  VIEW.layoutPdfDocument = layoutDocument;
})();
