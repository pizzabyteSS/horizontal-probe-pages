// ============================================================
// web/src/view_chart.js — 運勢表の折れ線グラフ（段階2）
// 設計：docs/web-screen-items.md §3.2〜§3.5・§4。GSS 版の _buildLineChart_（master_gss/output_sheets.js）に合わせる
//   縦軸は 0〜100 で固定。横軸は各行の見出し（年齢帯・年・年月・日付）。外部のライブラリは使わず SVG で描く
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var AXIS_MIN = 0;     // GSS 版 vAxis.viewWindow
  var AXIS_MAX = 100;
  var AXIS_STEP = 20;
  var CHART_HEIGHT = 240;
  var PLOT_TOP = 12;
  var PLOT_LEFT = 36;
  var PLOT_RIGHT = 12;
  var POINT_GAP = 40;            // 1点あたりの横幅（点が多いときは枠の中で横に動かす）
  var MIN_CHART_WIDTH = 320;
  var AXIS_FONT_PX = 11;         // 横軸の文字の大きさ（app.css の .chart-axis と同じ）
  var LABEL_PADDING = 6;         // 隣の文字との間
  var POINT_RADIUS = 3;

  function createSvg(tag, attributes, text) {
    var element = document.createElementNS(SVG_NS, tag);
    for (var name in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, name)) element.setAttribute(name, String(attributes[name]));
    }
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  /** 値を縦軸の範囲に収める（範囲の外は端に描く）。 */
  function clampToAxis(value) { return Math.max(AXIS_MIN, Math.min(AXIS_MAX, value)); }

  /** 横軸の文字のおおよその幅（半角は字の大きさの約6割、全角は1字ぶん）。 */
  function estimateLabelWidth(label) {
    var width = 0;
    for (var i = 0; i < label.length; i++) width += label.charCodeAt(i) < 128 ? AXIS_FONT_PX * 0.6 : AXIS_FONT_PX;
    return width;
  }

  /**
   * 折れ線グラフを parent に足す。points は [{ label, value }]（value は数値）。点がなければ何も足さない。
   * color は GSS 版の色。title はグラフの見出し。
   */
  function appendLineChart(parent, title, points, color) {
    if (!points.length) return null;
    // 一番長い横軸の文字が1点ぶんの幅に収まらなければ斜めにし、下の余白をその長さに合わせる
    var longest = Math.max.apply(null, points.map(function (point) { return estimateLabelWidth(point.label); }));
    var isRotated = longest + LABEL_PADDING > POINT_GAP;
    var bottom = isRotated ? Math.ceil(longest * Math.SQRT1_2) + 24 : 28;
    var width = Math.max(MIN_CHART_WIDTH, PLOT_LEFT + PLOT_RIGHT + POINT_GAP * points.length);
    var plotWidth = width - PLOT_LEFT - PLOT_RIGHT;
    var plotHeight = CHART_HEIGHT - PLOT_TOP - bottom;
    var toX = function (i) { return PLOT_LEFT + plotWidth * (i + 0.5) / points.length; };
    var toY = function (v) { return PLOT_TOP + plotHeight * (AXIS_MAX - clampToAxis(v)) / (AXIS_MAX - AXIS_MIN); };

    var figure = VIEW.createElement('figure', 'chart');
    figure.appendChild(VIEW.createElement('figcaption', 'chart-title', title));
    var wrap = VIEW.createElement('div', 'chart-wrap');
    var svg = createSvg('svg', { viewBox: '0 0 ' + width + ' ' + CHART_HEIGHT, width: width, height: CHART_HEIGHT, role: 'img', 'aria-label': title });

    for (var tick = AXIS_MIN; tick <= AXIS_MAX; tick += AXIS_STEP) {
      var y = toY(tick);
      svg.appendChild(createSvg('line', { x1: PLOT_LEFT, x2: width - PLOT_RIGHT, y1: y, y2: y, class: 'chart-grid' }));
      svg.appendChild(createSvg('text', { x: PLOT_LEFT - 6, y: y + 4, class: 'chart-axis', 'text-anchor': 'end' }, tick));
    }

    var path = points.map(function (point, i) { return (i ? 'L' : 'M') + toX(i) + ' ' + toY(point.value); }).join(' ');
    svg.appendChild(createSvg('path', { d: path, class: 'chart-line', stroke: color }));

    points.forEach(function (point, i) {
      var x = toX(i);
      var dot = createSvg('circle', { cx: x, cy: toY(point.value), r: POINT_RADIUS, fill: color });
      dot.appendChild(createSvg('title', {}, point.label + '：' + point.value));
      svg.appendChild(dot);
      var labelY = PLOT_TOP + plotHeight + 16;
      var attributes = { x: x, y: labelY, class: 'chart-axis', 'text-anchor': isRotated ? 'end' : 'middle' };
      if (isRotated) attributes.transform = 'rotate(-45 ' + x + ' ' + labelY + ')';
      svg.appendChild(createSvg('text', attributes, point.label));
    });

    wrap.appendChild(svg);
    figure.appendChild(wrap);
    parent.appendChild(figure);
    return figure;
  }

  VIEW.appendLineChart = appendLineChart;
})();
