// ============================================================
// web/src/pdf_document.js — 鑑定書 PDF・画像の中身を組み立て、ファイルにする入口（段階3a-1・3a-2）
// 設計：docs/web-pdf-plan.md §4.2〜§4.6、docs/product-spec.md §4.1・§4.2
//   中身は画面と同じ項目の一覧（view_result.js の buildResultModel）のうち、開いている項目だけ（3a-2）
//   1ページ目の最初に鑑定情報を必ず置く（閉じられない。R4）。各ページの上に屋号・氏名 様・鑑定日、下に n / N
//   表はすべて表のまま載せる（行ごとのまとまりは見づらいため。2026-10-21 ガクさん）。
//   運勢表（大運表〜日運表）は列が多いため A4 横のページに置く。命式詳細のミニ表（大運・年運・月運）は縦のページのまま
//   作ったものはメモリに置くだけで、端末にもサーバーにも残さない
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var DOCUMENT_TITLE = '鑑定書';
  var CALC_TITLE = '命式・運勢表';   // 計算結果と鑑定書の両方を載せるときの、1ページ目の題名
  var REPORT_SECTION_PREFIX = 'report.';   // 鑑定書の章（view_report.js の項目のキー）
  var FILE_PREFIX = '鑑定書';
  var UNSAFE_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;   // ファイル名に使えない字
  var LANDSCAPE_SECTION_PREFIX = 'fortune.';   // 横向きのページに置く項目（運勢表。view_fortune.js の項目のキー）

  /** 改行を含む文を段落の部品にする（空の文は足さない）。 */
  function pushParagraph(blocks, text) {
    if (VIEW.isBlank(text) || !String(text).replace(/\s/g, '')) return;
    blocks.push({ type: 'paragraph', text: String(text) });
  }

  /** 項目の部品を PDF の部品にする。画面の h4 → 見出し2、h5 → 見出し3。 */
  function pushPartBlocks(blocks, part) {
    if (part.type === 'heading') blocks.push({ type: 'heading', level: part.level >= 5 ? 3 : 2, text: part.text });
    else if (part.type === 'lines') pushParagraph(blocks, part.text);
    else if (part.type === 'chart') blocks.push({ type: 'chart', title: part.title, points: part.points, color: part.color });
    else if (part.type === 'table') blocks.push({ type: 'table', headers: part.headers, rows: part.rows });
  }

  /** 項目1つ（題名は見出し1）。 */
  function buildSectionBlocks(section) {
    var blocks = [{ type: 'heading', level: 1, text: section.title }];
    section.parts.forEach(function (part) { pushPartBlocks(blocks, part); });
    return blocks;
  }

  function isLandscapeSection(section) { return String(section.key).indexOf(LANDSCAPE_SECTION_PREFIX) === 0; }

  /**
   * PDF・画像の中身（ページに割る前）。model は view_result.js の buildResultModel。options：
   *   closedKeys：閉じた項目（{ key: true }。載せない）　brand：屋号・色・ロゴ（brand.js の getBrand。省いたら載せない）
   * 1ページ目の最初に題名と鑑定情報（閉じられない）、続けて開いている項目を画面のタブの順に。鑑定者用の欄は model に含まれない
   * 返す値：{ header: { name, kanteiDate, brandName, brandColor, brandLogo: { width, height } または null }, blocks: [部品] }
   */
  function buildReportDocument(model, options) {
    var opts = options || {};
    var sections = VIEW.listOpenSections(model, opts.closedKeys || {});
    var isReport = function (section) { return String(section.key).indexOf(REPORT_SECTION_PREFIX) === 0; };
    // 計算結果と鑑定書の両方を載せるときは、鑑定書を新しいページの題名「鑑定書」から始める
    //   （計算結果の後にいきなり第1章が来て、鑑定書の始まりが分からなかった。2026-10-23 ガクさん）
    var hasBoth = sections.some(isReport) && sections.some(function (section) { return !isReport(section); });
    var blocks = [{ type: 'title', text: hasBoth ? CALC_TITLE : DOCUMENT_TITLE }].concat(buildSectionBlocks(VIEW.buildInfoSection(model.info)));
    var orientation = 'portrait';
    var reportStarted = false;
    sections.forEach(function (section) {
      if (hasBoth && !reportStarted && isReport(section)) {
        reportStarted = true;
        blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
        blocks.push({ type: 'title', text: DOCUMENT_TITLE });
        orientation = 'portrait';
      }
      // 運勢表は横向きのページ。向きが変わるところで部品 page を入れる（その項目は新しいページから始まる）
      var wanted = isLandscapeSection(section) ? 'landscape' : 'portrait';
      if (wanted !== orientation) { blocks.push({ type: 'page', orientation: wanted }); orientation = wanted; }
      blocks = blocks.concat(buildSectionBlocks(section));
    });
    // 鑑定書の章が1つでも開いていれば、最後に字数（項目・鑑定文・合計）を載せる。納品物の字数として（2026-10-22 ガクさん）
    var count = VIEW.countReportChars(model, null, opts.closedKeys || {}).open;
    if (count.total > 0) {
      if (orientation !== 'portrait') blocks.push({ type: 'page', orientation: 'portrait' });
      blocks.push({ type: 'note', text: '本鑑定書の文字数： ' + VIEW.formatReportCharCount(count) });
    }
    var brand = opts.brand || {};
    var header = {
      name: model.info.name, kanteiDate: model.info.kanteiDate, brandName: brand.name || '', brandColor: brand.color || '', brandFontFamily: brand.fontFamily || '',
      brandLogo: brand.logo ? { width: brand.logo.width, height: brand.logo.height } : null
    };
    return { header: header, blocks: blocks };
  }

  /** ファイル名の本体：鑑定書_<氏名>_<鑑定日>（氏名がなければ省く。使えない字は _ にする）。 */
  function buildFileStem(header) {
    var parts = [FILE_PREFIX];
    if (header.name && header.name !== '-') parts.push(header.name);
    if (header.kanteiDate && header.kanteiDate !== '-') parts.push(header.kanteiDate);
    return parts.join('_').replace(UNSAFE_FILE_CHARS, '_').replace(/\s+/g, ' ');
  }

  /** ロゴを描くために読む（ロゴがなければ null）。読めなければ理由 logo で止める（ロゴのない鑑定書を黙って作らない）。 */
  function loadBrandLogo(opts) {
    var logo = opts.brand && opts.brand.logo;
    if (!logo) return Promise.resolve(null);
    var load = opts.loadImage || VIEW.loadLogoImage;
    return Promise.resolve().then(function () { return load(logo.dataUrl); }).then(null, function () {
      throw VIEW.createPdfError('logo', 'ロゴを読めませんでした');
    });
  }

  /**
   * 鑑定書の PDF か画像を作る。model は view_result.js の buildResultModel。options：
   *   format：'pdf'（既定）か 'images'　closedKeys：閉じた項目　brand：屋号・色・ロゴ　onProgress(済んだページ数, 全ページ数)　isCancelled()
   *   measure・createCanvas・encodeJpeg・loadImage(データ URL)：手元の試験で差し替える（省いたらブラウザのもの）
   * 返す値：Promise<{ pageCount, files: [{ fileName, mimeType, bytes }] }>。失敗の理由は error.code（'canvas'・'encode'・'cancelled'・'logo'）
   */
  function createReportFiles(model, options) {
    var opts = options || {};
    return Promise.resolve().then(function () {
      var doc = buildReportDocument(model, opts);
      var measure = opts.measure;
      var measureCanvas = null;
      var pages;
      try {
        if (!measure) {
          measureCanvas = VIEW.createPdfCanvas(1, 1);
          measure = VIEW.createCanvasMeasure(measureCanvas);
        }
        pages = VIEW.layoutPdfDocument(doc, measure);
      } finally {
        if (measureCanvas) VIEW.releasePdfCanvas(measureCanvas);   // 失敗しても測る用のキャンバスは返す
      }
      var stem = buildFileStem(doc.header);
      return loadBrandLogo(opts).then(function (logoImage) {
        return VIEW.renderPdfPagesToJpeg(pages, Object.assign({}, opts, { logoImage: logoImage }));
      }).then(function (images) {
        if (opts.format === 'images') {
          return {
            pageCount: pages.length,
            files: images.map(function (image, i) {
              return { fileName: stem + '_' + (i + 1) + 'of' + images.length + '.jpg', mimeType: 'image/jpeg', bytes: image.bytes };
            })
          };
        }
        var pdf = VIEW.buildPdfFromJpegs(images, VIEW.PDF_PAGE.widthPt, VIEW.PDF_PAGE.heightPt);
        return { pageCount: pages.length, files: [{ fileName: stem + '.pdf', mimeType: 'application/pdf', bytes: pdf }] };
      });
    });
  }

  VIEW.buildReportDocument = buildReportDocument;
  VIEW.buildReportFileStem = buildFileStem;
  VIEW.createReportFiles = createReportFiles;
})();
