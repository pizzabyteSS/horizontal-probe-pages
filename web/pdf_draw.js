// ============================================================
// web/src/pdf_draw.js — 鑑定書 PDF・画像のページを描いて JPEG にする（段階3a-1）
// 設計：docs/web-pdf-plan.md §2・§4.3・§4.4・§4.5
//   pdf_layout.js が割ったページを、キャンバス1枚を使い回して1ページずつ描き、JPEG に書き出す
//   （iOS のキャンバスの大きさ・メモリの上限に当たらないため。終わったら 1×1 に縮めて解放する）
//   1ページごとに画面へ制御を返し（setTimeout）、進み具合を知らせ、「やめる」で止められる
//   グラフは view_chart.js と同じ点・色・縦軸 0〜100 で直接描く（SVG を絵にする処理は使わない）
//   鑑定書の図は view_figure.js の layoutFigure の形をそのまま描く（画面の SVG と同じ形）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var JPEG_QUALITY = 0.9;          // docs/web-pdf-plan.md §4.4
  var BACKGROUND = '#ffffff';

  // ---- グラフ（view_chart.js と同じ縦軸） ----
  var AXIS_MIN = 0;
  var AXIS_MAX = 100;
  var AXIS_STEP = 20;
  var CHART_TITLE_HEIGHT = 44;
  var CHART_LEFT = 56;
  var CHART_RIGHT = 16;
  var CHART_TOP_PAD = 12;
  var CHART_FONT_PX = 18;
  var CHART_GRID_COLOR = '#d1d9e0';
  var CHART_TEXT_COLOR = '#59636e';
  var POINT_RADIUS = 5;

  /** エラーに理由の記号を付ける（画面が理由を出し分けるため）。 */
  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function clampToAxis(value) { return Math.max(AXIS_MIN, Math.min(AXIS_MAX, value)); }

  /** グラフを描く：題名・横線と目盛り・折れ線・点・横軸の文字（混むときは斜め、さらに混むときは間引く）。 */
  function drawChart(ctx, item) {
    ctx.fillStyle = BACKGROUND;   // 白地（鑑定書の「鑑定の根拠」の枠の中でも線と字が読めるように）
    ctx.fillRect(item.x, item.y, item.w, item.h);
    var font = 'bold 24px ' + VIEW.PDF_PAGE.fontFamily;
    var axisFont = 'normal ' + CHART_FONT_PX + 'px ' + VIEW.PDF_PAGE.fontFamily;
    ctx.fillStyle = '#1f2328';
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(String(item.title || ''), item.x, item.y + CHART_TITLE_HEIGHT / 2);

    var points = item.points;
    ctx.font = axisFont;
    var longest = points.reduce(function (n, p) { return Math.max(n, ctx.measureText(String(p.label)).width); }, 0);
    var plotLeft = item.x + CHART_LEFT;
    var plotWidth = item.w - CHART_LEFT - CHART_RIGHT;
    var gap = plotWidth / points.length;
    var isRotated = longest + 8 > gap;
    var step = isRotated ? Math.max(1, Math.ceil((CHART_FONT_PX * 1.4) / gap)) : 1;   // 斜めでも重なるなら間引く
    var bottom = isRotated ? Math.ceil(longest * Math.SQRT1_2) + 24 : 36;
    var plotTop = item.y + CHART_TITLE_HEIGHT + CHART_TOP_PAD;
    var plotHeight = item.h - CHART_TITLE_HEIGHT - CHART_TOP_PAD - bottom;
    var toX = function (i) { return plotLeft + gap * (i + 0.5); };
    var toY = function (v) { return plotTop + plotHeight * (AXIS_MAX - clampToAxis(v)) / (AXIS_MAX - AXIS_MIN); };

    ctx.strokeStyle = CHART_GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = CHART_TEXT_COLOR;
    ctx.textAlign = 'right';
    for (var tick = AXIS_MIN; tick <= AXIS_MAX; tick += AXIS_STEP) {
      var y = toY(tick);
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      ctx.fillText(String(tick), plotLeft - 8, y);
    }

    if (item.markIndex >= 0 && item.markIndex < points.length) drawChartMark(ctx, item, toX(item.markIndex), plotTop, plotHeight);

    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach(function (point, i) {
      if (i) ctx.lineTo(toX(i), toY(point.value)); else ctx.moveTo(toX(i), toY(point.value));
    });
    ctx.stroke();

    ctx.fillStyle = item.color;
    points.forEach(function (point, i) {
      ctx.beginPath();
      ctx.arc(toX(i), toY(point.value), POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = CHART_TEXT_COLOR;
    var labelY = plotTop + plotHeight + 20;
    points.forEach(function (point, i) {
      if (i % step) return;
      var x = toX(i);
      if (isRotated) {
        ctx.save();
        ctx.translate(x, labelY);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.fillText(String(point.label), 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.fillText(String(point.label), x, labelY);
      }
    });
    ctx.textAlign = 'left';
  }

  /** 年運の「今年」などの印：点の位置に縦の破線と字。 */
  function drawChartMark(ctx, item, x, plotTop, plotHeight) {
    ctx.save();
    ctx.strokeStyle = item.markColor;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = item.markColor;
    ctx.font = 'bold ' + CHART_FONT_PX + 'px ' + VIEW.PDF_PAGE.fontFamily;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(item.markLabel || ''), x + 8, plotTop + 14);
    ctx.restore();
  }

  /** 色の指定（'accent' は強調の色＝屋号の色）。 */
  function resolveFigureColor(color, accent) { return color === VIEW.FIGURE_ACCENT ? accent : color; }

  /** 鑑定書の図（view_figure.js の layoutFigure の形）を scale 倍で描く。 */
  function drawFigure(ctx, item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.scale(item.scale, item.scale);
    item.shapes.forEach(function (shape) {
      if (shape.t === 'rect') {
        ctx.beginPath();
        if (shape.r && ctx.roundRect) ctx.roundRect(shape.x, shape.y, shape.w, shape.h, shape.r); else ctx.rect(shape.x, shape.y, shape.w, shape.h);
        if (shape.fill && shape.fill !== 'none') {
          ctx.globalAlpha = shape.opacity === undefined ? 1 : shape.opacity;
          ctx.fillStyle = resolveFigureColor(shape.fill, item.accent);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (shape.stroke && shape.stroke !== 'none' && shape.sw) {
          ctx.strokeStyle = resolveFigureColor(shape.stroke, item.accent);
          ctx.lineWidth = shape.sw;
          ctx.stroke();
        }
      } else if (shape.t === 'line') {
        ctx.strokeStyle = resolveFigureColor(shape.stroke, item.accent);
        ctx.lineWidth = shape.sw || 1;
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
      } else if (shape.t === 'path') {
        var path = new Path2D(shape.d);
        if (shape.fill && shape.fill !== 'none') { ctx.fillStyle = resolveFigureColor(shape.fill, item.accent); ctx.fill(path); }
        if (shape.stroke && shape.stroke !== 'none' && shape.sw) {
          ctx.strokeStyle = resolveFigureColor(shape.stroke, item.accent);
          ctx.lineWidth = shape.sw;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke(path);
        }
      } else if (shape.t === 'poly') {
        ctx.fillStyle = resolveFigureColor(shape.fill, item.accent);
        ctx.beginPath();
        shape.points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fill();
      } else if (shape.t === 'text' && shape.text) {
        ctx.fillStyle = resolveFigureColor(shape.color, item.accent);
        ctx.font = (shape.weight || 'normal') + ' ' + shape.size + 'px ' + VIEW.PDF_PAGE.fontFamily;
        ctx.textAlign = shape.anchor === 'start' ? 'left' : shape.anchor === 'end' ? 'right' : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shape.text, shape.x, shape.y);
      }
    });
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /** 1ページを描く（白で塗ってから、項目を順に描く）。logoImage はロゴの画像（kind 'image' の項目に描く。なければ描かない）。 */
  function drawPage(ctx, page, logoImage) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, page.width || VIEW.PDF_PAGE.width, page.height || VIEW.PDF_PAGE.height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    page.items.forEach(function (item) {
      if (item.kind === 'box') {   // 枠の塗り（pdf_layout.js がページの項目の先頭に置く。表・文字より先に描く）
        ctx.fillStyle = item.fill;
        ctx.fillRect(item.x, item.y, item.w, item.h);
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x + 0.5, item.y + 0.5, item.w, item.h);
        if (item.barColor) { ctx.fillStyle = item.barColor; ctx.fillRect(item.x, item.y, item.barWidth, item.h); }   // 要の一文の枠の左の線
      } else if (item.kind === 'cell') {
        if (item.fill) { ctx.fillStyle = item.fill; ctx.fillRect(item.x, item.y, item.w, item.h); }
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x + 0.5, item.y + 0.5, item.w, item.h);
      } else if (item.kind === 'line') {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1 + 0.5);
        ctx.lineTo(item.x2, item.y2 + 0.5);
        ctx.stroke();
      } else if (item.kind === 'chart') {
        drawChart(ctx, item);
      } else if (item.kind === 'figure') {
        drawFigure(ctx, item);
      } else if (item.kind === 'image' && logoImage) {
        ctx.drawImage(logoImage, item.x, item.y, item.w, item.h);
      }
    });
    // 文字は塗りの上に描く（表の背景で消えないように）
    page.items.forEach(function (item) {
      if (item.kind !== 'text' || !item.text) return;
      ctx.font = item.font;
      ctx.fillStyle = item.color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(item.text, item.x, item.y + item.lineHeight / 2);
    });
  }

  // ---- 既定の道具（ブラウザ）。手元の試験では差し替える ----
  function createBrowserCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** キャンバスを JPEG のバイト列にする（toBlob → ArrayBuffer）。 */
  function encodeBrowserJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(createError('encode', 'JPEG にできませんでした')); return; }
        var reader = new FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { reject(createError('encode', 'JPEG を読めませんでした')); };
        reader.readAsArrayBuffer(blob);
      }, 'image/jpeg', quality);
    });
  }

  /** 使い終えたキャンバスを 1×1 に縮めて、端末のメモリを返す（iOS Safari の上限対策）。 */
  function releaseCanvas(canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }

  /** 文字の幅を測る関数（ページ割りに渡す）。キャンバスで測る。 */
  function createCanvasMeasure(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) throw createError('canvas', 'キャンバスが使えません');
    var lastFont = '';
    return function (text, font) {
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      return ctx.measureText(text).width;
    };
  }

  function waitForNextTurn() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /**
   * ページを1つずつ描いて JPEG にする。返す値：Promise<[{ bytes, width, height, widthPt, heightPt }]>。
   * ページの大きさはページごと（縦・横。pdf_layout.js）。向きが変わるときはキャンバスの大きさを変える
   * options：onProgress(済んだページ数, 全ページ数)・isCancelled()（真なら止める。理由 'cancelled'）・
   *          logoImage（ロゴの画像。段階3a-4）・createCanvas(幅, 高さ)・encodeJpeg(キャンバス, 品質)（省いたらブラウザのもの）
   */
  function renderPagesToJpeg(pages, options) {
    var opts = options || {};
    var createCanvas = opts.createCanvas || createBrowserCanvas;
    var encodeJpeg = opts.encodeJpeg || encodeBrowserJpeg;
    var sizeOf = function (page) {
      return { width: page.width || VIEW.PDF_PAGE.width, height: page.height || VIEW.PDF_PAGE.height,
        widthPt: page.widthPt || VIEW.PDF_PAGE.widthPt, heightPt: page.heightPt || VIEW.PDF_PAGE.heightPt };
    };
    var first = pages.length ? sizeOf(pages[0]) : { width: VIEW.PDF_PAGE.width, height: VIEW.PDF_PAGE.height };
    var canvas = createCanvas(first.width, first.height);
    var ctx = canvas.getContext('2d');
    if (!ctx) { releaseCanvas(canvas); return Promise.reject(createError('canvas', 'キャンバスが使えません')); }
    var images = [];
    var renderAt = function (index) {
      if (index >= pages.length) return Promise.resolve(images);
      return waitForNextTurn().then(function () {
        if (opts.isCancelled && opts.isCancelled()) throw createError('cancelled', '作るのをやめました');
        var size = sizeOf(pages[index]);
        if (canvas.width !== size.width || canvas.height !== size.height) {
          canvas.width = size.width;     // 大きさを変えると中身は消える（drawPage が白で塗り直す）
          canvas.height = size.height;
        }
        drawPage(ctx, pages[index], opts.logoImage);
        return encodeJpeg(canvas, JPEG_QUALITY);
      }).then(function (bytes) {
        // JPEG にしている間に「やめる」を押されたら、そのページも捨てて止める（最後のページでも完成させない）
        if (opts.isCancelled && opts.isCancelled()) throw createError('cancelled', '作るのをやめました');
        var size = sizeOf(pages[index]);
        images.push({ bytes: bytes, width: size.width, height: size.height, widthPt: size.widthPt, heightPt: size.heightPt });
        if (opts.onProgress) opts.onProgress(index + 1, pages.length);
        return renderAt(index + 1);
      });
    };
    return renderAt(0).then(function (result) {
      releaseCanvas(canvas);
      return result;
    }, function (error) {
      releaseCanvas(canvas);
      throw error;
    });
  }

  VIEW.createPdfError = createError;
  VIEW.drawPdfPage = drawPage;
  VIEW.createCanvasMeasure = createCanvasMeasure;
  VIEW.createPdfCanvas = createBrowserCanvas;
  VIEW.releasePdfCanvas = releaseCanvas;
  VIEW.renderPdfPagesToJpeg = renderPagesToJpeg;
})();
