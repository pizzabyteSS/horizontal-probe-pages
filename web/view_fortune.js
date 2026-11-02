// ============================================================
// web/src/view_fortune.js — 大運表・年運表・月運表・日運表（段階2。段階3a-2 で項目の形に分けた）
// 設計：docs/web-screen-items.md §3.2〜§3.5・§4・§5 の 4。GSS 版の writeTaiunSheet_・writeYearlySheet_・
//   writeMonthlySheet_・writeDailySheet_（master_gss/output_sheets.js）と同じ行・列を読み、同じ並びで出す
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var COLUMN_COUNT = 16;   // A:P
  var START_DATE_ROW = 39; // 鑑定開始日（年運表の開始行を決める）
  // 各要素の評価（M〜P。GSS 版で表の右側に並べていた内訳）は、別の表にせず本表の同じ欄の2行目に入れる（REVIEW A-17。2026-11-02）。
  //   [本表の見出し, M〜P の添字, 2行目の前に付ける字]。総合（K）は本表の総合と同じ値なので重ねない
  //   位相法の評価は日支（生まれた日の十二支）との関係だけで決める（api_master.js _isohouCode_）。本表の位相法の欄はほかの柱も含むので「日支：」を付ける（PR-文①）
  var EVAL_CELLS = [['通変星', 12, ''], ['十二運', 13, ''], ['位相法', 14, '日支：'], ['空亡', 15, '']];
  var EVAL_NOTE = '通変星・十二運・位相法・空亡の欄の2行目は、その要素の評価です。位相法の2行目「日支：」は、その時期の干支とあなたの日支（生まれた日の十二支）との関係だけで見た評価で、1行目にはほかの柱との関係も載せています。';

  // グラフの線の色（4つの表で1色にそろえる。GSS 版は表ごとに色が違った。REVIEW A-14）
  var CHART_COLOR = '#5C6BC0';

  // 各表の読み元・見出し・グラフ（GSS 版の各関数の定数とコメントの列名）。markLabel：グラフの「今」の印の字（REVIEW A-14）
  var FORTUNE = {
    taiun: {
      title: '大運表', chartTitle: '大運バイオリズム', color: CHART_COLOR, markLabel: '今', startRow: 83, rowCount: 11,   // 立運前＋大運10行（§5.2）
      headers: ['年齢帯', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '総合', '解説'],
      scoreCol: 6
    },
    nenun: {
      title: '年運表', chartTitle: '年運バイオリズム', color: CHART_COLOR, markLabel: '今年', startRow: 103, rowCount: 60, displayCount: 12,
      headers: ['年', '年齢', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '大運干支', '総合', '解説'],
      scoreCol: 5,
      note: '年運の1年は、立春（2月4日ごろ）から翌年の立春の前日までです。年齢は、その年の誕生日を迎えたあとの満年齢です。'
    },
    getsuun: {
      title: '月運表', chartTitle: '月運バイオリズム', color: CHART_COLOR, markLabel: '今月', startRow: 173, rowCount: 12,
      headers: ['年月', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '年運干支', '総合', '解説'],
      scoreCol: 5,
      note: '月運の1か月は、節入り（毎月の節気の日。月の上旬）から次の節入りの前日までです。暦の月の1日とは区切りがずれます。'
    },
    nichiun: {
      title: '日運表', chartTitle: '日運バイオリズム', color: CHART_COLOR, markLabel: '鑑定日', startRow: 188, rowCount: 31,
      headers: ['日付', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '月運干支', '総合', '解説'],
      scoreCol: 5,
      note: '「月運干支」は、暦の月の1日ではなく節入り（毎月の節気の日）で切り替わります。'
    }
  };

  // 年運表・月運表・日運表で空亡（H列）が「天中殺」の行は、解説（L列）の前に注記を付ける（2026-10-28 ガクさん承認）。
  //   総合の記号はサーバーが一段下げて付ける（api_master.js の downgradePeriodMark_。2026-11-02）
  //   解説の文はサーバーが天中殺の行だけ見直す・整える文を選ぶ（api_master.js の buildPeriodTextKey_）
  var KUUBOU_COL = 7;
  var COMMENT_COL = 11;
  var TENCHU_MARK = '天中殺';

  /** 年運・月運・日運の本表のB〜L列（「-」付き）。天中殺の行は解説の前に unit（'年'・'月'・'日'）の注記を付ける。 */
  function buildPeriodCells(values, unit) {
    var cells = values.slice(1, 12).map(VIEW.formatOrDash);
    if (String(values[KUUBOU_COL] || '') === TENCHU_MARK) {
      var comment = VIEW.isBlank(values[COMMENT_COL]) ? '' : String(values[COMMENT_COL]);
      cells[COMMENT_COL - 1] = '【天中殺の' + unit + '】新しく始めることは慎重に。' + comment;
    }
    return cells;
  }

  /** 月運・日運の本表の行（見出し＋B〜L列）。 */
  function buildPeriodRow(label, values, unit) {
    return [label].concat(buildPeriodCells(values, unit));
  }

  /** 本表の行 row（見出し headers の順）の通変星・十二運・位相法・空亡の欄に、評価（M〜P）を2行目として足す（評価が空・「-」なら足さない）。 */
  function appendEvaluations(row, headers, values) {
    EVAL_CELLS.forEach(function (spec) {
      var col = headers.indexOf(spec[0]);
      var value = values[spec[1]];
      if (col < 0 || VIEW.isBlank(value) || String(value) === '-') return;
      row[col] = row[col] + '\n' + spec[2] + String(value);
    });
    return row;
  }

  /** グラフの点（GSS 版：見出しが空でなく、運気が数値になるものだけ）。足したら true。 */
  function pushChartPoint(points, label, score) {
    if (VIEW.isBlank(label) || VIEW.isBlank(score)) return false;
    var value = Number(score);
    if (isNaN(value)) return false;
    points.push({ label: String(label), value: value });
    return true;
  }

  /** 点を足し、isNow なら result.markIndex（グラフの「今」の印）をその点にする。 */
  function pushChartPointWithMark(result, label, score, isNow) {
    if (pushChartPoint(result.points, label, score) && isNow) result.markIndex = result.points.length - 1;
  }

  /** 鑑定日（39行 B:D）：{ year, month, day }（読めなければ値は NaN）。 */
  function readStartDate(table) {
    var read = function (col) { return parseInt(VIEW.toIntText(table.get(START_DATE_ROW, col)), 10); };
    return { year: read(2), month: read(3), day: read(4) };
  }

  /** 大運表：83〜93行 A:P（立運前＋大運10行。GSS 版は 92行までで最後の大運が抜ける。docs/web-screen-items.md §5.2）。空の行は飛ばす。 */
  function buildTaiun(table) {
    var spec = FORTUNE.taiun;
    var result = { rows: [], points: [], markIndex: -1 };
    var age = readStartAge(table);
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      if (!VIEW.hasAnyValue(values)) return;
      var label = VIEW.formatOrDash(values[1]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      var range = String(values[1] || '').match(/^(\d+)〜(\d+)歳/);
      result.rows.push(appendEvaluations(values.slice(1, 12).map(VIEW.formatOrDash), spec.headers, values));
      pushChartPointWithMark(result, label, score, !!range && age !== null && age >= parseInt(range[1], 10) && age <= parseInt(range[2], 10));
    });
    return result;
  }

  /**
   * 年運表：103〜162行 A:P のうち、A列の先頭4桁が鑑定開始年（39行 B）と一致する行から12行。見つからなければ先頭から。
   * A列「2026（41歳）」を年と年齢に分ける。
   */
  function buildNenun(table) {
    var spec = FORTUNE.nenun;
    var result = { rows: [], points: [], markIndex: -1 };
    var all = readNenunBlock(table);
    var found = findStartYearIndex(table, all);
    var startYear = readStartDate(table).year;
    for (var j = 0; j < spec.displayCount && found + j < all.length; j++) {
      var values = all[found + j];
      if (!VIEW.hasAnyValue(values)) continue;
      var rawA = String(values[0] || '');
      var yearMatch = rawA.match(/^(\d{4})/);
      var ageMatch = rawA.match(/（(.+)）/);
      var year = yearMatch ? yearMatch[1] : VIEW.formatOrDash(values[0]);
      var age = ageMatch ? ageMatch[1] : '-';
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      result.rows.push(appendEvaluations([year, age].concat(buildPeriodCells(values, '年')), spec.headers, values));
      pushChartPointWithMark(result, year, score, parseInt(year, 10) === startYear);
    }
    return result;
  }

  function readNenunBlock(table) {
    return table.getBlock(FORTUNE.nenun.startRow, 1, FORTUNE.nenun.rowCount, COLUMN_COUNT);
  }

  /** 年運表の行のうち、A列の先頭4桁が鑑定開始年（39行 B）と一致する行の添字（見つからなければ 0＝先頭）。 */
  function findStartYearIndex(table, all) {
    var startYear = parseInt(VIEW.toIntText(table.get(START_DATE_ROW, 2)), 10);
    for (var i = 0; i < all.length; i++) {
      var match = String(all[i][0] || '').match(/^(\d{4})/);
      if (match && parseInt(match[1], 10) === startYear) return i;
    }
    return 0;
  }

  /**
   * 鑑定開始年の年運（鑑定書の「ひと目でわかるあなた」の今年の運気。年運表の1行目と同じ行）。
   * 返す値：{ year：'2026' など（読めなければ ''）, score：運気の点数（空なら ''） }
   */
  function readStartYearFortune(table) {
    var all = readNenunBlock(table);
    var values = all[findStartYearIndex(table, all)] || [];
    var yearMatch = String(values[0] || '').match(/^(\d{4})/);
    var score = values[FORTUNE.nenun.scoreCol];
    return { year: yearMatch ? yearMatch[1] : '', score: VIEW.isBlank(score) ? '' : String(score) };
  }

  /** 月運表：173〜184行 A:P。空の行は飛ばす。A列「2026年10月」は文字のまま出す（§5 の 4）。 */
  function buildGetsuun(table) {
    var spec = FORTUNE.getsuun;
    var result = { rows: [], points: [], markIndex: -1 };
    var start = readStartDate(table);
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      if (!VIEW.hasAnyValue(values)) return;
      var label = VIEW.formatOrDash(values[0]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      var ym = String(values[0] || '').match(/^(\d{4})年(\d{1,2})月/);   // 「2026年10月」
      result.rows.push(appendEvaluations(buildPeriodRow(label, values, '月'), spec.headers, values));
      pushChartPointWithMark(result, label, score, !!ym && parseInt(ym[1], 10) === start.year && parseInt(ym[2], 10) === start.month);
    });
    return result;
  }

  /**
   * 日運の A列「2026/10/1」を「10月1日」にする。数字に分けて作り、Date では読まない（端末の時刻帯でずれないように。§5 の 4）。
   * 形が違えば文字のまま（GSS 版も日付として読めなければ文字のまま出す）。
   */
  function formatDayLabel(value) {
    var match = String(value).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    return match ? parseInt(match[2], 10) + '月' + parseInt(match[3], 10) + '日' : String(value);
  }

  /** 日運表：188行から最大31行 A:P。A列が空の行で打ち切る。 */
  function buildNichiun(table) {
    var spec = FORTUNE.nichiun;
    var result = { rows: [], points: [], markIndex: -1 };
    var start = readStartDate(table);
    var all = table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT);
    for (var i = 0; i < all.length; i++) {
      var values = all[i];
      if (!values[0]) break;
      var label = formatDayLabel(values[0]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      var ymd = String(values[0]).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);   // 「2026/10/1」
      result.rows.push(appendEvaluations(buildPeriodRow(label, values, '日'), spec.headers, values));
      pushChartPointWithMark(result, label, score, !!ymd && parseInt(ymd[1], 10) === start.year
        && parseInt(ymd[2], 10) === start.month && parseInt(ymd[3], 10) === start.day);
    }
    return result;
  }

  var BUILDERS = { taiun: buildTaiun, nenun: buildNenun, getsuun: buildGetsuun, nichiun: buildNichiun };

  // 総合（K列）の ◎○△注 の決まり（api_master.js の buildPeriodSummaryKey_・downgradePeriodMark_ と _textdb_summary_period_v1 の sub1_text。
  //   運気の点数と十二運で決まり、年運・月運・日運の天中殺・日柱との冲は一段下げる。2026-11-02 ガクさん決定）
  //   運気の点数の出し方は _writePeriodScoresToData_（案イ）
  var SUMMARY_MARK_LEGEND = '運気の点数＝その時期の干支が、あなたの用神・喜神（命式に欲しい五行）に合うか（6割）と、通変星の一般的な吉凶（4割）から出しています。'
    + '総合の記号：◎＝運気の点数が60以上で、十二運が勢いのある段階（長生・冠帯・建禄・帝旺）／'
    + '○＝60以上で、それ以外の十二運／△＝40〜59／注＝39以下（注意したい時期）。同じ点数でも十二運によって◎と○が分かれます。'
    + '年運・月運・日運は、天中殺の時期と日柱との冲（天剋地冲・納音を含む）の時期の記号を一段下げています（◎→○、○→△、△→注）。';

  // 大運表の先頭に置く順逆・立運（GSS 版 B80。380・381行の B）。命式詳細のミニ大運を外したので、ここへ移した（PR③、2026-10-28）
  var TAIUN_DIR_ROW = 380;
  var TAIUN_AGE_ROW = 381;

  /** 大運表の先頭の1行「順逆: 逆 / 立運: 8歳」。 */
  function buildTaiunDirectionText(table) {
    return '順逆: ' + VIEW.formatOrDash(table.get(TAIUN_DIR_ROW, 2)) + ' / 立運: ' + VIEW.formatOrDash(table.get(TAIUN_AGE_ROW, 2)) + '歳';
  }

  /** kind（taiun・nenun・getsuun・nichiun）の運勢表の項目（開閉の単位は表ごと。docs/web-pdf-plan.md §4.5）。key は fortune.<kind>。 */
  function buildFortuneSection(table, kind) {
    var spec = FORTUNE[kind];
    var data = BUILDERS[kind](table);
    var parts = kind === 'taiun' ? [{ type: 'lines', text: buildTaiunDirectionText(table) }] : [];
    return {
      key: 'fortune.' + kind, title: spec.title, closable: true, parts: parts.concat([
        { type: 'chart', title: spec.chartTitle, points: data.points, color: spec.color, markIndex: data.markIndex, markLabel: spec.markLabel },
        // textColumn：PDF で幅を優先して取る列（解説。REVIEW A-17）
        { type: 'table', headers: spec.headers, rows: data.rows, className: 'is-wide is-fortune', textColumn: spec.headers.length - 1 },
        { type: 'lines', text: SUMMARY_MARK_LEGEND + (spec.note ? spec.note : '') + EVAL_NOTE, className: 'result-text report-tip', tone: 'tip' }
      ])
    };
  }

  /** kind（taiun・nenun・getsuun・nichiun）の運勢表を container に書く。name は送った時点の氏名。 */
  function renderFortune(container, table, kind, name) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(VIEW.readCommonInfo(table, name)), buildFortuneSection(table, kind)]);
  }

  // ---- 鑑定書の図の値（段階2：鑑定書のわかりやすさ。第7章） ----
  var NENUN_TREND_BEFORE = 2;    // 年運の折れ線：今年の前の年をいくつ載せるか（今年の位置が分かるように）
  var NENUN_TREND_COUNT = 12;    // 年運の折れ線の年の数（年運表と同じ12年）

  /** 鑑定開始年の年齢（年運の A列「2026（41歳）」の41。読めなければ null）。 */
  function readStartAge(table) {
    var all = readNenunBlock(table);
    var match = String((all[findStartYearIndex(table, all)] || [])[0] || '').match(/（(\d+)歳）/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * 年運の折れ線：今年の NENUN_TREND_BEFORE 年前から NENUN_TREND_COUNT 年。返す値：{ points: [{ label, value }], markIndex：今年の点（なければ -1） }。
   * 点にするのは年運表のグラフと同じ（見出しが空でなく、運気が数値の行）
   */
  function readNenunTrend(table) {
    var all = readNenunBlock(table);
    var found = findStartYearIndex(table, all);
    var from = Math.max(0, found - NENUN_TREND_BEFORE);
    var points = [];
    var markIndex = -1;
    for (var i = from; i < all.length && i < from + NENUN_TREND_COUNT; i++) {
      var yearMatch = String(all[i][0] || '').match(/^(\d{4})/);
      if (!yearMatch) continue;
      var before = points.length;
      pushChartPoint(points, yearMatch[1], VIEW.formatOrDash(all[i][FORTUNE.nenun.scoreCol]));
      if (i === found && points.length > before) markIndex = before;   // 今年の運気が数値でなければ印を付けない
    }
    return { points: points, markIndex: markIndex };
  }

  /**
   * 大運の帯：大運表の行（立運前＋大運10）。返す値：[{ startLabel：'18歳'など, score：運気の点数（数値でなければ ''）, isCurrent }]。
   * いまの10年は、年齢帯 B列「18〜27歳」に鑑定開始年の年齢が入る行
   */
  function readTaiunBands(table) {
    var spec = FORTUNE.taiun;
    var age = readStartAge(table);
    var bands = [];
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      if (!VIEW.hasAnyValue(values)) return;
      var range = String(values[1] || '').match(/^(\d+)〜(\d+)歳/);
      if (!range) return;
      var from = parseInt(range[1], 10);
      var to = parseInt(range[2], 10);
      var score = values[spec.scoreCol];
      bands.push({
        startLabel: from + '歳', score: VIEW.isBlank(score) || isNaN(Number(score)) ? '' : String(score),
        isCurrent: age !== null && age >= from && age <= to
      });
    });
    return bands;
  }

  /**
   * いまの大運（年齢帯に鑑定開始年の年齢が入る行）。返す値：{ ageRange：'36〜45歳', branch：地支, isTenchu：空亡の欄が天中殺か }（なければ null）。
   * 第8章「天中殺の過ごし方」の1行で、大運が天中殺に当たることを書くため（PR-文①）
   */
  function readCurrentTaiun(table) {
    var spec = FORTUNE.taiun;
    var age = readStartAge(table);
    if (age === null) return null;
    var found = null;
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      var range = String(values[1] || '').match(/^(\d+)〜(\d+)歳/);
      if (found || !range || age < parseInt(range[1], 10) || age > parseInt(range[2], 10)) return;
      found = { ageRange: range[1] + '〜' + range[2] + '歳', branch: String(values[3] || ''), isTenchu: String(values[KUUBOU_COL + 1] || '') === TENCHU_MARK };
    });
    return found;
  }

  /** 4つの運勢表の、画面に出る行のすべてのセル（鑑定書の用語ミニ辞典で、出てくる特殊星を拾うため）。 */
  function listFortuneCells(table) {
    var cells = [];
    VIEW.FORTUNE_KINDS.forEach(function (kind) {
      BUILDERS[kind](table).rows.forEach(function (row) { cells = cells.concat(row); });
    });
    return cells;
  }

  VIEW.SUMMARY_MARK_LEGEND = SUMMARY_MARK_LEGEND;
  VIEW.listFortuneCells = listFortuneCells;
  VIEW.readNenunTrend = readNenunTrend;
  VIEW.readTaiunBands = readTaiunBands;
  VIEW.readCurrentTaiun = readCurrentTaiun;
  VIEW.FORTUNE_COLOR_NENUN = FORTUNE.nenun.color;
  VIEW.FORTUNE_KINDS = ['taiun', 'nenun', 'getsuun', 'nichiun'];
  VIEW.buildFortuneSection = buildFortuneSection;
  VIEW.readStartYearFortune = readStartYearFortune;
  VIEW.renderFortune = renderFortune;
  VIEW.formatDayLabel = formatDayLabel;
})();
