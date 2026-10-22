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
  // 表の右側（GSS 版で「総合」と同じ行に並べている列）：総合＝K、続く4つ＝M〜P
  var BREAKDOWN_HEADERS = ['総合', '通変星', '十二運', '位相法', '空亡'];

  // 各表の読み元・見出し・グラフ（GSS 版の各関数の定数とコメントの列名）
  var FORTUNE = {
    taiun: {
      title: '大運表', chartTitle: '大運バイオリズム', color: '#5C6BC0', startRow: 83, rowCount: 11,   // 立運前＋大運10行（§5.2）
      headers: ['年齢帯', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '総合', '解説'],
      scoreCol: 6
    },
    nenun: {
      title: '年運表', chartTitle: '年運バイオリズム', color: '#5C6BC0', startRow: 103, rowCount: 60, displayCount: 12,
      headers: ['年', '年齢', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '大運干支', '総合', '解説'],
      scoreCol: 5
    },
    getsuun: {
      title: '月運表', chartTitle: '月運バイオリズム', color: '#E91E63', startRow: 173, rowCount: 12,
      headers: ['年月', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '年運干支', '総合', '解説'],
      scoreCol: 5
    },
    nichiun: {
      title: '日運表', chartTitle: '日運バイオリズム', color: '#9C27B0', startRow: 188, rowCount: 31,
      headers: ['日付', '天干', '地支', '通変星', '十二運', '運気', '位相法', '空亡', '特殊星', '月運干支', '総合', '解説'],
      scoreCol: 5
    }
  };

  /** 表の右側の行：見出し・総合（K）・M〜P。 */
  function buildBreakdown(label, values) {
    return [label, VIEW.formatOrDash(values[10])].concat(values.slice(12, 16).map(VIEW.formatOrDash));
  }

  /** グラフの点（GSS 版：見出しが空でなく、運気が数値になるものだけ）。 */
  function pushChartPoint(points, label, score) {
    if (VIEW.isBlank(label) || VIEW.isBlank(score)) return;
    var value = Number(score);
    if (isNaN(value)) return;
    points.push({ label: String(label), value: value });
  }

  /** 大運表：83〜93行 A:P（立運前＋大運10行。GSS 版は 92行までで最後の大運が抜ける。docs/web-screen-items.md §5.2）。空の行は飛ばす。 */
  function buildTaiun(table) {
    var spec = FORTUNE.taiun;
    var result = { rows: [], breakdown: [], points: [] };
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      if (!VIEW.hasAnyValue(values)) return;
      var label = VIEW.formatOrDash(values[1]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      result.rows.push(values.slice(1, 12).map(VIEW.formatOrDash));
      result.breakdown.push(buildBreakdown(label, values));
      pushChartPoint(result.points, label, score);
    });
    return result;
  }

  /**
   * 年運表：103〜162行 A:P のうち、A列の先頭4桁が鑑定開始年（39行 B）と一致する行から12行。見つからなければ先頭から。
   * A列「2026（41歳）」を年と年齢に分ける。
   */
  function buildNenun(table) {
    var spec = FORTUNE.nenun;
    var result = { rows: [], breakdown: [], points: [] };
    var all = table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT);
    var startYear = parseInt(VIEW.toIntText(table.get(START_DATE_ROW, 2)), 10);
    var found = 0;
    for (var i = 0; i < all.length; i++) {
      var match = String(all[i][0] || '').match(/^(\d{4})/);
      if (match && parseInt(match[1], 10) === startYear) { found = i; break; }
    }
    for (var j = 0; j < spec.displayCount && found + j < all.length; j++) {
      var values = all[found + j];
      if (!VIEW.hasAnyValue(values)) continue;
      var rawA = String(values[0] || '');
      var yearMatch = rawA.match(/^(\d{4})/);
      var ageMatch = rawA.match(/（(.+)）/);
      var year = yearMatch ? yearMatch[1] : VIEW.formatOrDash(values[0]);
      var age = ageMatch ? ageMatch[1] : '-';
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      result.rows.push([year, age].concat(values.slice(1, 12).map(VIEW.formatOrDash)));
      result.breakdown.push(buildBreakdown(year, values));
      pushChartPoint(result.points, year, score);
    }
    return result;
  }

  /** 月運表：173〜184行 A:P。空の行は飛ばす。A列「2026年10月」は文字のまま出す（§5 の 4）。 */
  function buildGetsuun(table) {
    var spec = FORTUNE.getsuun;
    var result = { rows: [], breakdown: [], points: [] };
    table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT).forEach(function (values) {
      if (!VIEW.hasAnyValue(values)) return;
      var label = VIEW.formatOrDash(values[0]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      result.rows.push([label].concat(values.slice(1, 12).map(VIEW.formatOrDash)));
      result.breakdown.push(buildBreakdown(label, values));
      pushChartPoint(result.points, label, score);
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
    var result = { rows: [], breakdown: [], points: [] };
    var all = table.getBlock(spec.startRow, 1, spec.rowCount, COLUMN_COUNT);
    for (var i = 0; i < all.length; i++) {
      var values = all[i];
      if (!values[0]) break;
      var label = formatDayLabel(values[0]);
      var score = VIEW.formatOrDash(values[spec.scoreCol]);
      result.rows.push([label].concat(values.slice(1, 12).map(VIEW.formatOrDash)));
      result.breakdown.push(buildBreakdown(label, values));
      pushChartPoint(result.points, label, score);
    }
    return result;
  }

  var BUILDERS = { taiun: buildTaiun, nenun: buildNenun, getsuun: buildGetsuun, nichiun: buildNichiun };

  /** kind（taiun・nenun・getsuun・nichiun）の運勢表の項目（開閉の単位は表ごと。docs/web-pdf-plan.md §4.5）。key は fortune.<kind>。 */
  function buildFortuneSection(table, kind) {
    var spec = FORTUNE[kind];
    var data = BUILDERS[kind](table);
    return {
      key: 'fortune.' + kind, title: spec.title, closable: true, parts: [
        { type: 'chart', title: spec.chartTitle, points: data.points, color: spec.color },
        { type: 'table', headers: spec.headers, rows: data.rows, className: 'is-wide is-fortune' },
        // 内訳：総合と、通変星・十二運・位相法・空亡それぞれの評価（例「比肩：やや良い」）。本表の星の名前とは別の中身（GSS 版の右側の表）
        { type: 'heading', level: 4, text: '各要素の評価（内訳）', className: 'report-heading' },
        { type: 'table', headers: [spec.headers[0]].concat(BREAKDOWN_HEADERS), rows: data.breakdown, className: 'is-wide' }
      ]
    };
  }

  /** kind（taiun・nenun・getsuun・nichiun）の運勢表を container に書く。name は送った時点の氏名。 */
  function renderFortune(container, table, kind, name) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(VIEW.readCommonInfo(table, name)), buildFortuneSection(table, kind)]);
  }

  VIEW.FORTUNE_KINDS = ['taiun', 'nenun', 'getsuun', 'nichiun'];
  VIEW.buildFortuneSection = buildFortuneSection;
  VIEW.renderFortune = renderFortune;
  VIEW.formatDayLabel = formatDayLabel;
})();
