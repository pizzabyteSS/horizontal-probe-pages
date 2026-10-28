// ============================================================
// web/src/view_figure.js — 鑑定書の図（段階2：鑑定書のわかりやすさ。設計 claude/DESIGN_2026-10-27_report-readability.md 案4〜7）
//   図は部品 { type: 'figure', kind, title, data }。kind：
//     'pillars'（命式の4本の柱。日柱を強調）・'gogyo'（五行バランスの5色の棒）・'meter'（日干の強さのメーター）・
//     'decade'（大運の10年ごとの帯。いまの10年に「今ここ」）
//   形（どこに何を描くか）は layoutFigure が1か所で決め、画面（SVG。このファイル）と PDF（キャンバス。pdf_draw.js）が同じ形を描く
//   形の座標は幅 width の中の単位。画面は SCREEN_WIDTH、PDF は PDF_DESIGN_WIDTH で組み、それぞれの幅に拡大して描く
//   色の 'accent' は強調の色（画面は設定の色 --color-brand、PDF は屋号の色。どちらも決めていなければ FIGURE_ACCENT_DEFAULT）
//   描く形：{ t: 'rect', x, y, w, h, fill, stroke, sw, r, opacity } / { t: 'text', x, y（字の縦の真ん中）, text, size, weight, anchor, color } /
//           { t: 'line', x1, y1, x2, y2, stroke, sw } / { t: 'poly', points: [[x, y]…], fill } / { t: 'path', d（SVG のパス）, fill, stroke, sw }
//   章のアイコン（段階3）も同じ形で描く（layoutIcon。24×24 の中。色は章の色で、屋号の色には変えない）
//   値は textContent で書く（応答の文字を HTML として解釈させない）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SCREEN_WIDTH = 400;           // 画面の図の幅（スマホ縦で字が小さくなりすぎない幅）
  var PDF_DESIGN_WIDTH = 640;       // PDF の図の幅（本文の幅に広げると、字が表の字と同じくらいになる）
  var FIGURE_ACCENT_DEFAULT = '#0969da';   // 色を決めていないときの強調の色（app.css の --color-accent）
  var ACCENT = 'accent';
  var PAD = 10;                     // 図の白地の内側の余白
  var TITLE_HEIGHT = 26;
  var COLOR_TEXT = '#1f2328';
  var COLOR_SUB = '#59636e';
  var COLOR_LINE = '#d1d9e0';
  var COLOR_BG = '#ffffff';
  var DAY_PILLAR_NOTE = 'あなた自身';

  // 五行の色（濃い色＝棒・字、薄い色＝柱の文字の地）
  var GOGYO_ORDER = ['木', '火', '土', '金', '水'];
  var GOGYO_COLOR = { '木': '#2e8b57', '火': '#d1483b', '土': '#b7832f', '金': '#7d8794', '水': '#2f6fb5' };
  var GOGYO_TINT = { '木': '#e3f3e8', '火': '#fbe5e2', '土': '#f6ecd6', '金': '#eceef1', '水': '#e1ebf7' };
  var STEM_GOGYO = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
  var BRANCH_GOGYO = {
    '寅': '木', '卯': '木', '巳': '火', '午': '火', '辰': '土', '戌': '土', '丑': '土', '未': '土',
    '申': '金', '酉': '金', '亥': '水', '子': '水'
  };

  // 日干の強さのメーター：5段階（サーバーの判定 calcNikkanStrength_ のラベル）。針はラベルの区間に置き、区間の中は点数で動かす
  var METER_LABELS = ['弱い', 'やや弱い', '中和', 'やや強い', '強い'];
  var METER_EDGES = [-10, -5, -2, 2, 5, 10];   // 区間の境目（constants.js の NIKKAN_STRENGTH_THRESHOLDS：5・2。外側は ±10 で止める）
  var METER_FILLS = ['#dbe5f1', '#e8eef6', '#eef1f4', '#f7eee2', '#f1dfc8'];

  // ---- 図ごとの形 ----
  function text(x, y, value, size, options) {
    var opts = options || {};
    return { t: 'text', x: x, y: y, text: String(value), size: size, weight: opts.weight || 'normal',
      anchor: opts.anchor || 'middle', color: opts.color || COLOR_TEXT };
  }

  /** 命式の4本の柱（年柱・月柱・日柱・時柱の順。表と同じ）。日柱は強調の色の枠と題名。柱の字の地は五行の薄い色。 */
  function layoutPillars(data, width) {
    var shapes = [];
    var pillars = data.pillars || [];
    var colWidth = width / Math.max(1, pillars.length);
    var tile = Math.min(colWidth - 20, 88);
    pillars.forEach(function (pillar, i) {
      var cx = colWidth * (i + 0.5);
      if (pillar.isDay) {
        shapes.push({ t: 'rect', x: colWidth * i + 4, y: 0, w: colWidth - 8, h: 206, fill: 'none', stroke: ACCENT, sw: 2.5, r: 8 });
      }
      shapes.push(text(cx, 14, pillar.label, 13, { weight: 'bold', color: pillar.isDay ? ACCENT : COLOR_TEXT }));
      // 日柱の天干は日干（あなた自身）。通変星の代わりにそう書く
      shapes.push(pillar.isDay ? text(cx, 36, DAY_PILLAR_NOTE, 12, { weight: 'bold', color: ACCENT }) : text(cx, 36, pillar.tsuhen, 12, { color: COLOR_SUB }));
      [[pillar.stem, STEM_GOGYO, 50], [pillar.branch, BRANCH_GOGYO, 112]].forEach(function (cell) {
        var gogyo = cell[1][cell[0]] || '';
        shapes.push({ t: 'rect', x: cx - tile / 2, y: cell[2], w: tile, h: 54, fill: GOGYO_TINT[gogyo] || COLOR_BG, stroke: COLOR_LINE, sw: 1, r: 6 });
        shapes.push(text(cx, cell[2] + 27, cell[0], 28, { weight: 'bold' }));
        if (gogyo) shapes.push(text(cx + tile / 2 - 6, cell[2] + 46, gogyo, 10, { anchor: 'end', color: GOGYO_COLOR[gogyo] }));
      });
      shapes.push(text(cx, 186, pillar.juniun, 12, { color: COLOR_SUB }));
    });
    return { height: 206, shapes: shapes };
  }

  /** 五行バランス：木火土金水の数を5色の横棒で（いちばん多い数を棒の長さいっぱいにする）。 */
  function layoutGogyo(data, width) {
    var shapes = [];
    var counts = data.counts || {};
    var most = GOGYO_ORDER.reduce(function (n, name) { return Math.max(n, Number(counts[name]) || 0); }, 0);
    var barLeft = 36;
    var barMax = width - barLeft - 36;
    GOGYO_ORDER.forEach(function (name, i) {
      var y = i * 30;
      var value = Number(counts[name]) || 0;
      var length = most > 0 ? barMax * value / most : 0;
      shapes.push(text(12, y + 13, name, 15, { weight: 'bold', color: GOGYO_COLOR[name] }));
      shapes.push({ t: 'rect', x: barLeft, y: y + 3, w: barMax, h: 20, fill: '#f3f4f6', stroke: 'none', r: 4 });
      if (length > 0) shapes.push({ t: 'rect', x: barLeft, y: y + 3, w: length, h: 20, fill: GOGYO_COLOR[name], stroke: 'none', r: 4 });
      shapes.push(text(barLeft + length + 6, y + 13, String(value), 13, { anchor: 'start', weight: 'bold' }));
    });
    shapes.push(text(0, 162, data.caption || '', 11, { anchor: 'start', color: COLOR_SUB }));
    return { height: 172, shapes: shapes };
  }

  /** 日干の強さのメーター：5段階の帯と、点数の位置の針。 */
  function layoutMeter(data, width) {
    var shapes = [];
    var segment = width / METER_LABELS.length;
    var index = METER_LABELS.indexOf(data.label);
    var score = Number(data.score);
    METER_LABELS.forEach(function (label, i) {
      shapes.push({ t: 'rect', x: segment * i, y: 34, w: segment, h: 22, fill: METER_FILLS[i], stroke: COLOR_LINE, sw: 1 });
      shapes.push(text(segment * (i + 0.5), 70, label, 12,
        { weight: i === index ? 'bold' : 'normal', color: i === index ? COLOR_TEXT : COLOR_SUB }));
    });
    if (index >= 0) {
      // 区間の中の位置：点数を区間の境目で割合にする（端に寄りすぎないよう 0.1〜0.9 に収める）
      var low = METER_EDGES[index];
      var high = METER_EDGES[index + 1];
      var ratio = isNaN(score) ? 0.5 : Math.max(0.1, Math.min(0.9, (Math.max(low, Math.min(high, score)) - low) / (high - low)));
      var x = segment * (index + ratio);
      shapes.push({ t: 'line', x1: x, y1: 30, x2: x, y2: 60, stroke: ACCENT, sw: 3 });
      shapes.push({ t: 'poly', points: [[x - 7, 20], [x + 7, 20], [x, 30]], fill: ACCENT });
      var valueText = isNaN(score) ? data.label : '点数 ' + data.score;
      shapes.push(text(Math.max(32, Math.min(width - 32, x)), 9, valueText, 12, { weight: 'bold', color: ACCENT }));
    }
    return { height: 80, shapes: shapes };
  }

  /** 大運の帯：10年ごとのマス（濃さ＝運気の点数）。いまの10年は強調の枠と「今ここ」。下に各10年の始まりの年齢。 */
  function layoutDecade(data, width) {
    var shapes = [];
    var bands = data.bands || [];
    var cell = width / Math.max(1, bands.length);
    bands.forEach(function (band, i) {
      var x = cell * i;
      var score = Number(band.score);
      var hasScore = band.score !== '' && !isNaN(score);
      shapes.push({ t: 'rect', x: x + 1, y: 18, w: cell - 2, h: 40, fill: hasScore ? ACCENT : '#eef1f4', stroke: 'none',
        opacity: hasScore ? 0.12 + 0.6 * Math.max(0, Math.min(100, score)) / 100 : 1 });
      shapes.push(text(x + cell / 2, 38, hasScore ? String(band.score) : '-', 12, { weight: 'bold' }));
      if (band.isCurrent) {
        shapes.push({ t: 'rect', x: x + 1, y: 18, w: cell - 2, h: 40, fill: 'none', stroke: ACCENT, sw: 2.5 });
        shapes.push(text(x + cell / 2, 7, '今ここ', 11, { weight: 'bold', color: ACCENT }));
      }
      shapes.push(text(x + cell / 2, 70, band.startLabel, 11,
        { weight: band.isCurrent ? 'bold' : 'normal', color: band.isCurrent ? COLOR_TEXT : COLOR_SUB }));
    });
    shapes.push(text(0, 92, data.caption || '', 11, { anchor: 'start', color: COLOR_SUB }));
    return { height: 102, shapes: shapes };
  }

  // ---- 章のアイコン（段階3：案8。色の丸に白い記号。自作の簡単な形） ----
  var ICON_SIZE = 24;
  var ICON_WHITE = '#ffffff';
  var ICON_GLYPHS = {
    star: [{ t: 'poly', points: starPoints(12, 12.5, 7, 3), fill: ICON_WHITE }],
    heart: [{ t: 'path', d: 'M12 19 C5.5 14.5 4 11 5.5 8.3 C7 5.8 10.5 6.2 12 8.8 C13.5 6.2 17 5.8 18.5 8.3 C20 11 18.5 14.5 12 19 Z', fill: ICON_WHITE }],
    briefcase: [
      { t: 'rect', x: 9.5, y: 6.5, w: 5, h: 3.5, fill: 'none', stroke: ICON_WHITE, sw: 1.6, r: 1 },
      { t: 'rect', x: 6, y: 9, w: 12, h: 8.5, fill: ICON_WHITE, stroke: 'none', r: 1.5 }
    ],
    coin: [
      { t: 'rect', x: 6.5, y: 6.5, w: 11, h: 11, fill: 'none', stroke: ICON_WHITE, sw: 1.8, r: 5.5 },
      { t: 'rect', x: 11, y: 9, w: 2, h: 6, fill: ICON_WHITE, stroke: 'none', r: 1 }
    ],
    house: [{ t: 'poly', points: [[5.5, 12], [12, 6], [18.5, 12], [17, 12], [17, 18], [7, 18], [7, 12]], fill: ICON_WHITE }],
    leaf: [
      { t: 'path', d: 'M7 17.5 C6.5 10.5 10.5 6.5 18 6 C18 13.5 14 17.5 7 17.5 Z', fill: ICON_WHITE },
      { t: 'line', x1: 7.5, y1: 17, x2: 13.5, y2: 11, stroke: '#00000033', sw: 1.2 }
    ],
    trend: [
      { t: 'path', d: 'M5.5 16.5 L9.5 12.5 L12.5 14.5 L17 9', fill: 'none', stroke: ICON_WHITE, sw: 2.2 },
      { t: 'poly', points: [[18.5, 7.5], [14.2, 8], [18, 11.8]], fill: ICON_WHITE }
    ],
    sparkle: [{ t: 'poly', points: starPoints(12, 12, 7, 2.2, 4), fill: ICON_WHITE }]
  };

  /** 星形の点（中心 cx・cy、外の半径 outer、内の半径 inner、とがりの数 count。既定は5）。 */
  function starPoints(cx, cy, outer, inner, count) {
    var n = count || 5;
    var points = [];
    for (var i = 0; i < n * 2; i++) {
      var radius = i % 2 ? inner : outer;
      var angle = -Math.PI / 2 + Math.PI * i / n;
      points.push([Math.round((cx + radius * Math.cos(angle)) * 100) / 100, Math.round((cy + radius * Math.sin(angle)) * 100) / 100]);
    }
    return points;
  }

  /** 章のアイコンの形（24×24。色の丸＋白い記号）。知らない名前は null。 */
  function layoutIcon(icon) {
    var glyph = icon && ICON_GLYPHS[icon.name];
    if (!glyph) return null;
    return { width: ICON_SIZE, height: ICON_SIZE, shapes: [{ t: 'rect', x: 1, y: 1, w: 22, h: 22, fill: icon.color, stroke: 'none', r: 11 }].concat(glyph) };
  }

  /** 章のアイコンの SVG（見出しの字の前に置く。読み上げでは飛ばす）。 */
  function buildIconSvg(icon) {
    var shape = layoutIcon(icon);
    if (!shape) return null;
    var svg = createSvg('svg', { viewBox: '0 0 ' + ICON_SIZE + ' ' + ICON_SIZE, class: 'section-icon', 'aria-hidden': 'true', focusable: 'false' });
    shape.shapes.forEach(function (item) { svg.appendChild(buildSvgShape(item)); });
    return svg;
  }

  var LAYOUTS = { pillars: layoutPillars, gogyo: layoutGogyo, meter: layoutMeter, decade: layoutDecade };

  /**
   * 図の形。part は部品 { type: 'figure', kind, title, data }、width は図の幅（単位）。
   * 返す値：{ width, height, shapes }（白地・題名を含む。座標は図の左上が 0）。知らない kind は null
   */
  function layoutFigure(part, width) {
    var layout = LAYOUTS[part.kind];
    if (!layout) return null;
    var body = layout(part.data || {}, width - PAD * 2);
    var top = PAD + (part.title ? TITLE_HEIGHT : 0);
    var height = top + body.height + PAD;
    var shapes = [{ t: 'rect', x: 0.5, y: 0.5, w: width - 1, h: height - 1, fill: COLOR_BG, stroke: COLOR_LINE, sw: 1, r: 6 }];
    if (part.title) shapes.push(text(PAD, PAD + 10, part.title, 14, { anchor: 'start', weight: 'bold' }));
    body.shapes.forEach(function (shape) { shapes.push(offsetShape(shape, PAD, top)); });
    return { width: width, height: height, shapes: shapes };
  }

  /** 形を dx・dy だけずらした写し。 */
  function offsetShape(shape, dx, dy) {
    var out = {};
    for (var name in shape) if (Object.prototype.hasOwnProperty.call(shape, name)) out[name] = shape[name];
    if (shape.t === 'line') { out.x1 += dx; out.x2 += dx; out.y1 += dy; out.y2 += dy; }
    else if (shape.t === 'path') return out;   // パスはずらさない（章のアイコンだけが使い、ずらさない）
    else if (shape.t === 'poly') out.points = shape.points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
    else { out.x += dx; out.y += dy; }
    return out;
  }

  // ---- 画面（SVG） ----
  function createSvg(tag, attributes) {
    var element = document.createElementNS(SVG_NS, tag);
    for (var name in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, name) && attributes[name] !== undefined) element.setAttribute(name, String(attributes[name]));
    }
    return element;
  }

  /** 色の指定（'accent' は設定の色の CSS 変数。SVG の属性では変数が使えないため style に書く）。 */
  function svgPaint(property, color) {
    if (color === ACCENT) return property + ': var(--color-brand, ' + FIGURE_ACCENT_DEFAULT + ')';
    return property + ': ' + (color || 'none');
  }

  function buildSvgShape(shape) {
    if (shape.t === 'rect') {
      var styles = [svgPaint('fill', shape.fill), svgPaint('stroke', shape.stroke)];
      if (shape.opacity !== undefined) styles.push('fill-opacity: ' + shape.opacity);
      return createSvg('rect', { x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.r, 'stroke-width': shape.sw || 0, style: styles.join('; ') });
    }
    if (shape.t === 'line') {
      return createSvg('line', { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, 'stroke-width': shape.sw || 1, style: svgPaint('stroke', shape.stroke) });
    }
    if (shape.t === 'path') {
      return createSvg('path', { d: shape.d, 'stroke-width': shape.sw || 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        style: svgPaint('fill', shape.fill) + '; ' + svgPaint('stroke', shape.stroke) });
    }
    if (shape.t === 'poly') {
      return createSvg('polygon', { points: shape.points.map(function (p) { return p[0] + ',' + p[1]; }).join(' '), style: svgPaint('fill', shape.fill) });
    }
    var anchor = shape.anchor === 'start' ? 'start' : shape.anchor === 'end' ? 'end' : 'middle';
    var element = createSvg('text', { x: shape.x, y: shape.y, 'text-anchor': anchor, 'dominant-baseline': 'central', 'font-size': shape.size,
      'font-weight': shape.weight, class: 'figure-text', style: svgPaint('fill', shape.color) });
    element.textContent = shape.text;
    return element;
  }

  /** 図を parent に足す（幅いっぱいに広げ、広い画面では SCREEN_WIDTH の1.2倍まで）。描けない図は足さない。 */
  function appendFigure(parent, part) {
    var shape = layoutFigure(part, SCREEN_WIDTH);
    if (!shape) return null;
    var figure = VIEW.createElement('figure', 'figure figure-' + part.kind);
    var svg = createSvg('svg', { viewBox: '0 0 ' + shape.width + ' ' + shape.height, role: 'img', 'aria-label': part.title || '' });
    shape.shapes.forEach(function (item) { svg.appendChild(buildSvgShape(item)); });
    figure.appendChild(svg);
    parent.appendChild(figure);
    return figure;
  }

  // ---- 図の部品を作る（view_report.js が読んだ値を渡す） ----
  /** pillars：[{ label：'年柱'など, stem, branch, tsuhen, juniun, isDay }]。 */
  function buildPillarsFigure(pillars) {
    return { type: 'figure', kind: 'pillars', title: '命式（4本の柱）', data: { pillars: pillars } };
  }

  /** counts：{ 木: 数, … }。 */
  function buildGogyoFigure(counts) {
    return { type: 'figure', kind: 'gogyo', title: '五行のバランス', data: { counts: counts, caption: '天干・地支に出ている数（蔵干は含みません）' } };
  }

  /** strength：{ score：点数の文字, label：'強い'など }。 */
  function buildMeterFigure(strength) {
    return { type: 'figure', kind: 'meter', title: '日干の強さ', data: { score: strength.score, label: strength.label } };
  }

  /** bands：[{ startLabel：'18歳'など, score：運気の点数の文字（空なら ''）, isCurrent }]。 */
  function buildDecadeFigure(bands) {
    return { type: 'figure', kind: 'decade', title: '大運（10年ごとの流れ）',
      data: { bands: bands, caption: 'マスの数字は運気の点数（濃いほど高い）。下は始まりの年齢' } };
  }

  VIEW.FIGURE_ACCENT = ACCENT;
  VIEW.FIGURE_ACCENT_DEFAULT = FIGURE_ACCENT_DEFAULT;
  VIEW.FIGURE_PDF_DESIGN_WIDTH = PDF_DESIGN_WIDTH;
  VIEW.layoutFigure = layoutFigure;
  VIEW.layoutIcon = layoutIcon;
  VIEW.buildIconSvg = buildIconSvg;
  VIEW.appendFigure = appendFigure;
  VIEW.buildPillarsFigure = buildPillarsFigure;
  VIEW.buildGogyoFigure = buildGogyoFigure;
  VIEW.buildMeterFigure = buildMeterFigure;
  VIEW.buildDecadeFigure = buildDecadeFigure;
})();
