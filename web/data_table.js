// ============================================================
// web/src/data_table.js — 応答の dataRows から「仮想の _data」を組み立てる（段階2）
// 設計：docs/web-screen-items.md §1・§4・§5、docs/web-screen-plan.md §2
//   GSS 版の Client が _data に書いたのと同じ結果を、ブラウザのメモリの中だけに作る
//   - 鑑定ごとに新しく作る（前の鑑定の値を残さない。§1 の 0）
//   - 同じ行番号が後から来たら、その値の個数ぶんの列だけ上書きする（§1 の 1）
//   - A列のキーで読むときは、下の行が勝つ（§1 の 2）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // 六十干支の番号（甲子＝1〜癸亥＝60）を求める式の係数。2026-10-20 ガクさん決定（docs/web-screen-items.md §5.1）
  var KANSHI_COUNT = 60;
  var STEM_COUNT = 10;
  var BRANCH_COUNT = 12;
  var JST_TIME_ZONE = 'Asia/Tokyo';

  /** 空のセルか（GSS 版の _osIsBlank_ と同じ。0 は空ではない）。 */
  function isBlank(value) { return value === '' || value === null || value === undefined; }

  /** 空なら「-」、そうでなければ文字にして返す（GSS 版の _osDisplayOrDash_）。 */
  function formatOrDash(value) { return isBlank(value) ? '-' : String(value); }

  /** 空なら空文字、そうでなければ文字にして返す（そのまま出す欄に使う）。 */
  function formatOrEmpty(value) { return isBlank(value) ? '' : String(value); }

  /** どれか1つでも空でない値があるか（GSS 版の _osRowHasAnyValue_）。 */
  function hasAnyValue(values) {
    for (var i = 0; i < values.length; i++) if (!isBlank(values[i])) return true;
    return false;
  }

  /** dataRows の1行を { rowNo, values } にそろえる。配列形式 [行番号, …] とオブジェクト形式 {rowNo, values} を受け付ける。 */
  function readDataRow(item) {
    if (Object.prototype.toString.call(item) === '[object Array]') {
      return { rowNo: Number(item[0]), values: item.slice(1) };
    }
    if (item && typeof item === 'object') {
      return { rowNo: Number(item.rowNo), values: (item.values || []).slice() };
    }
    return null;
  }

  /**
   * dataRows から仮想の _data を作る。返す値の get(行, 列) の列は A＝1。
   * 書き込みは GSS 版の writeClientDataRows_ と同じ：先頭から順に、各行の値の個数ぶんだけ A列から書く。
   */
  function buildDataTable(dataRows) {
    var cells = {};   // 行番号 → 値の配列（添字 0 が A列）
    var list = dataRows || [];
    for (var i = 0; i < list.length; i++) {
      var row = readDataRow(list[i]);
      if (!row || !(row.rowNo >= 1)) continue;
      var target = cells[row.rowNo] || (cells[row.rowNo] = []);
      for (var c = 0; c < row.values.length; c++) target[c] = row.values[c];
    }
    return createTable(cells);
  }

  function createTable(cells) {
    /** 1つのセル。値がなければ空文字（シートの空のセルと同じ）。 */
    function get(rowNo, colNo) {
      var row = cells[rowNo];
      if (!row) return '';
      var value = row[colNo - 1];
      return value === undefined || value === null ? '' : value;
    }

    /** 1行のうち、colNo から count 列ぶん。 */
    function getRow(rowNo, colNo, count) {
      var out = [];
      for (var c = 0; c < count; c++) out.push(get(rowNo, colNo + c));
      return out;
    }

    /** rowNo から rowCount 行・colNo から colCount 列ぶん（シートの getRange(...).getValues() と同じ形）。 */
    function getBlock(rowNo, colNo, rowCount, colCount) {
      var out = [];
      for (var r = 0; r < rowCount; r++) out.push(getRow(rowNo + r, colNo, colCount));
      return out;
    }

    /** A列の値 → その行の B〜E列。同じキーが複数の行にあれば下の行が勝つ（output_report.js と同じ読み方）。 */
    function buildKeyMap() {
      var map = {};
      var rowNos = Object.keys(cells).map(Number).sort(function (a, b) { return a - b; });
      for (var i = 0; i < rowNos.length; i++) {
        var key = get(rowNos[i], 1);
        if (isBlank(key)) continue;
        map[String(key)] = getRow(rowNos[i], 2, 4);
      }
      return map;
    }

    return { get: get, getRow: getRow, getBlock: getBlock, buildKeyMap: buildKeyMap };
  }

  /**
   * 六十干支の番号（甲子＝1〜癸亥＝60）。天干の番号 0〜9（6行）と地支の番号 0〜11（7行）から求める。
   * どちらかが空・範囲外・陰陽の組み合わせが合わないときは「-」（docs/web-screen-items.md §5.1）。
   */
  function formatKanshiNumber(stemIdx, branchIdx) {
    if (isBlank(stemIdx) || isBlank(branchIdx)) return '-';
    var stem = Number(stemIdx);
    var branch = Number(branchIdx);
    if (!isIndex(stem, STEM_COUNT) || !isIndex(branch, BRANCH_COUNT) || stem % 2 !== branch % 2) return '-';
    var number = ((6 * stem - 5 * branch) % KANSHI_COUNT + KANSHI_COUNT) % KANSHI_COUNT + 1;
    return String(number);
  }

  function isIndex(value, count) { return value === Math.floor(value) && value >= 0 && value < count; }

  /** 「Y年M月D日」。どれかが数字でなければ「-」（GSS 版の _osFormatYmd_）。 */
  function formatYmd(year, month, day) {
    var y = toIntText(year);
    var m = toIntText(month);
    var d = toIntText(day);
    if (!y || !m || !d) return '-';
    return y + '年' + m + '月' + d + '日';
  }

  /** 数字だけを取り出して整数の文字にする（GSS 版の _osToIntText_）。 */
  function toIntText(value) {
    if (isBlank(value)) return '';
    var digits = String(value).replace(/[^\d]/g, '');
    return digits ? String(parseInt(digits, 10)) : '';
  }

  /** 日本時間の今年（端末の時刻帯に左右されない）。GSS 版のミニ年運は Apps Script の時刻（日本時間）の今年を使う。 */
  function readJstYear(now) {
    var text = new Intl.DateTimeFormat('en-US', { timeZone: JST_TIME_ZONE, year: 'numeric' }).format(now || new Date());
    return Number(text.replace(/[^\d]/g, ''));
  }

  VIEW.isBlank = isBlank;
  VIEW.formatOrDash = formatOrDash;
  VIEW.formatOrEmpty = formatOrEmpty;
  VIEW.hasAnyValue = hasAnyValue;
  VIEW.buildDataTable = buildDataTable;
  VIEW.formatKanshiNumber = formatKanshiNumber;
  VIEW.formatYmd = formatYmd;
  VIEW.readJstYear = readJstYear;
  VIEW.toIntText = toIntText;
})();
