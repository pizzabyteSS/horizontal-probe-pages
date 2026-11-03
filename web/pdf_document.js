// ============================================================
// web/src/pdf_document.js — 鑑定書 PDF・画像の中身を組み立て、ファイルにする入口（段階3a-1・3a-2）
// 設計：docs/web-pdf-plan.md §4.2〜§4.6、docs/product-spec.md §4.1・§4.2
//   中身は画面と同じ項目の一覧（view_result.js の buildResultModel）のうち、開いている項目だけ（3a-2）
//   鑑定情報は必ず1ページ目に置く（閉じられない。R4）。鑑定書を含むときは、1ページ目を表紙（題名・氏名・命式の図・ひと目でわかるあなた・
//   鑑定情報）、2ページ目を目次にし、命式・運勢表は「資料編」の扉のあとに置く（REVIEW A-16）。鑑定書が先、命式・運勢表が後、
//   用語ミニ辞典は巻末（REVIEW A-15）
//   各ページの上に屋号・氏名 様・鑑定日、下に n / N
//   表はすべて表のまま載せる（行ごとのまとまりは見づらいため。2026-10-21 ガクさん）。
//   運勢表（大運表〜日運表）は列が多いため A4 横のページに置く（命式詳細のミニ表は PR③ で外した）
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

  /** 改行を含む文を段落の部品にする（空の文は足さない）。tone は字の形（'tip'・'lead'。省いたら本文）。 */
  function pushParagraph(blocks, text, tone) {
    if (VIEW.isBlank(text) || !String(text).replace(/\s/g, '')) return;
    var block = { type: 'paragraph', text: String(text) };
    if (tone) block.tone = tone;
    blocks.push(block);
  }

  /** 項目の部品を PDF の部品にする。画面の h4 → 見出し2、h5 → 見出し3。枠（boxStart・boxEnd）・図はそのまま渡す。 */
  function pushPartBlocks(blocks, part) {
    if (part.type === 'heading') blocks.push({ type: 'heading', level: part.level >= 5 ? 3 : 2, text: part.text });
    else if (part.type === 'lines') pushParagraph(blocks, part.text, part.tone);
    else if (part.type === 'boxStart') blocks.push({ type: 'boxStart', tone: part.tone, color: part.color });   // tone 'key'：要の一文の枠
    else if (part.type === 'boxEnd') blocks.push({ type: 'boxEnd' });
    else if (part.type === 'chart') {
      blocks.push({ type: 'chart', title: part.title, points: part.points, color: part.color, markIndex: part.markIndex, markLabel: part.markLabel });
    } else if (part.type === 'figure') blocks.push({ type: 'figure', figure: part });   // 鑑定書の図（形は view_figure.js の layoutFigure）
    else if (part.type === 'table') {
      var table = { type: 'table', headers: part.headers, rows: part.rows };
      if (typeof part.textColumn === 'number') table.textColumn = part.textColumn;   // 幅を優先して取る列（運勢表の解説。REVIEW A-17）
      blocks.push(table);
    }
  }

  /** 項目1つ（題名は見出し1。章のアイコンがあれば字の前に描く）。 */
  function buildSectionBlocks(section) {
    var heading = { type: 'heading', level: 1, text: section.title, keepSection: true };   // 小さい項目はページをまたがせない（pdf_layout.js）
    if (section.icon) heading.icon = section.icon;
    var blocks = [heading];
    section.parts.forEach(function (part) { pushPartBlocks(blocks, part); });
    return blocks;
  }

  function isLandscapeSection(section) { return String(section.key).indexOf(LANDSCAPE_SECTION_PREFIX) === 0; }

  // ---- 表紙・目次・資料編の扉（REVIEW A-16。2026-11-02） ----
  var TOC_TITLE = '目次';
  var DIVIDER_TITLE = '資料編';
  var DIVIDER_TEXT = 'ここからは、鑑定書のもとになった計算の結果です。命式（生まれたときの4本の柱）と、' +
    '大運・年運・月運・日運の表を載せています。鑑定書の内容を確かめたいときにご覧ください。';
  var COVER_FIGURE_RATIO = 0.7;    // 表紙の命式の図の幅（本文の幅に対する割合。1ページに収めるため少し小さく）
  var PILLARS_FIGURE_KIND = 'pillars';

  /** 鑑定書の命式の図（4本の柱。表紙に再掲する。閉じた章のものでも使う。なければ null）。 */
  function findPillarsFigure(model) {
    var found = null;
    VIEW.listAllSections(model).forEach(function (section) {
      (section.parts || []).forEach(function (part) {
        if (!found && part.type === 'figure' && part.kind === PILLARS_FIGURE_KIND) found = part;
      });
    });
    return found;
  }

  /** 表紙の部品：題名と氏名（部品 cover）→ 命式の図 → ひと目でわかるあなた → 鑑定情報（小さめの表）。 */
  function buildCoverBlocks(model, glance) {
    var blocks = [{ type: 'cover', title: DOCUMENT_TITLE, name: VIEW.isBlank(model.info.name) || model.info.name === '-' ? '' : model.info.name }];
    var pillars = findPillarsFigure(model);
    if (pillars) blocks.push({ type: 'figure', figure: pillars, widthRatio: COVER_FIGURE_RATIO });
    if (glance) blocks = blocks.concat(buildSectionBlocks(glance));
    // 鑑定情報は下に小さく：縦の「項目・値」の表を、見出しの行が項目・2行目が値の横の表にする（項目は同じ。1ページに収める）
    var info = buildSectionBlocks(VIEW.buildInfoSection(model.info)).map(function (block) {
      if (block.type !== 'table') return block;
      return { type: 'table', compact: true, headers: block.rows.map(function (row) { return row[0]; }), rows: [block.rows.map(function (row) { return row[1]; })] };
    });
    // 表紙は1ページに収める作り（ページを送らない）。項目ごと送る扱い（keepSection）は外す
    return blocks.concat(info).map(function (block) {
      if (block.keepSection) delete block.keepSection;
      return block;
    });
  }

  /**
   * 目次の項目：目次より後の大きな見出し（章・今日からできること・おわりに・表・用語ミニ辞典）と資料編の扉。
   * 資料編の中（扉から用語ミニ辞典の前まで）は一段下げる。target は部品の添字（ページ番号は pdf_layout.js が割ったあとに入れる）
   */
  function buildTocEntries(blocks, tocIndex, glossaryHeading) {
    var entries = [];
    var inMaterials = false;
    blocks.forEach(function (block, i) {
      if (i <= tocIndex) return;
      if (block.type === 'divider') {
        inMaterials = true;
        entries.push({ text: block.title + '　' + block.subtitle, target: i, indent: 0 });
      } else if (block.type === 'heading' && (block.level || 1) === 1) {
        if (block === glossaryHeading) inMaterials = false;
        entries.push({ text: block.text, target: i, indent: inMaterials ? 1 : 0 });
      }
    });
    return entries;
  }

  /**
   * PDF・画像の中身（ページに割る前）。model は view_result.js の buildResultModel。options：
   *   closedKeys：閉じた項目（{ key: true }。載せない）　brand：屋号・色・ロゴ（brand.js の getBrand。省いたら載せない）
   * 1ページ目の最初に題名と鑑定情報（閉じられない）、続けて開いている項目を画面のタブの順に。鑑定者用の欄は model に含まれない
   * 返す値：{ header: { name, kanteiDate, brandName, brandColor, brandLogo: { width, height } または null }, blocks: [部品] }
   */
  function buildReportDocument(model, options) {
    var opts = options || {};
    var isReport = function (section) { return String(section.key).indexOf(REPORT_SECTION_PREFIX) === 0; };
    // 鑑定書の章を先に、計算結果（命式・運勢表）を後に（鑑定書が37ページ目から始まっていた。2026-10-28 ガクさん承認）。
    //   それぞれの中は画面のタブの順のまま
    var openSections = VIEW.listOpenSections(model, opts.closedKeys || {});
    var sections = openSections.filter(isReport).concat(openSections.filter(function (section) { return !isReport(section); }));
    // 計算結果と鑑定書の両方を載せるときは、計算結果を新しいページの題名「命式・運勢表」から始める
    var hasBoth = sections.some(isReport) && sections.some(function (section) { return !isReport(section); });
    // 題名のすぐ下に「ひと目でわかるあなた」、鑑定情報はその下（2026-10-27 案1）
    var glance = sections.filter(function (section) { return section.key === VIEW.REPORT_GLANCE_KEY; })[0] || null;
    var hasReport = sections.some(isReport);
    // 鑑定書を含むときは、1ページ目を表紙（題名・氏名・命式の図・ひと目でわかるあなた・鑑定情報）、2ページ目を目次にする（REVIEW A-16）
    var blocks;
    var tocIndex = -1;
    if (hasReport) {
      blocks = buildCoverBlocks(model, glance);
      blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
      tocIndex = blocks.length;
      blocks.push({ type: 'toc', title: TOC_TITLE, entries: [] });
    } else {
      blocks = [{ type: 'title', text: CALC_TITLE }].concat(buildSectionBlocks(VIEW.buildInfoSection(model.info)));
    }
    var orientation = 'portrait';
    var calcStarted = false;
    // 鑑定書の章が1つでも開いていれば、鑑定書の最後（計算結果の前）に字数（項目・鑑定文・合計）を載せる。納品物の字数として（2026-10-22 ガクさん）
    var count = VIEW.countReportChars(model, null, opts.closedKeys || {}).open;
    var pushCharCount = function () {
      if (count.total <= 0) return;
      if (orientation !== 'portrait') { blocks.push({ type: 'page', orientation: 'portrait' }); orientation = 'portrait'; }
      blocks.push({ type: 'note', text: '本鑑定書の文字数： ' + VIEW.formatReportCharCount(count) });
    };
    // 表紙・目次のあと、続く項目は新しいページから（章の頭だけが前のページの下に残らない）
    if (hasReport) blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
    // 用語ミニ辞典は巻末（命式・運勢表のあと。REVIEW A-15）。字数の注記は今までどおり鑑定書の最後
    var glossary = sections.filter(function (section) { return section.key === VIEW.REPORT_GLOSSARY_KEY; })[0] || null;
    sections.forEach(function (section) {
      if (section === glance || section === glossary) return;
      // 「今日からできること」は鑑定書の最後のページ（新しいページから。2026-10-27 案9）。題名の直後なら改めない
      if (section.key === VIEW.REPORT_TODAY_KEY && blocks[blocks.length - 1].type !== 'title') {
        blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
        orientation = 'portrait';
      }
      if (hasBoth && !calcStarted && !isReport(section)) {
        calcStarted = true;
        pushCharCount();
        // 資料編の扉（1ページ。REVIEW A-16）。表は次のページから
        blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
        blocks.push({ type: 'divider', title: DIVIDER_TITLE, subtitle: CALC_TITLE, text: DIVIDER_TEXT });
        blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
        orientation = 'portrait';
      }
      // 運勢表は横向きのページ。向きが変わるところで部品 page を入れる（その項目は新しいページから始まる）
      var wanted = isLandscapeSection(section) ? 'landscape' : 'portrait';
      if (wanted !== orientation) { blocks.push({ type: 'page', orientation: wanted }); orientation = wanted; }
      blocks = blocks.concat(buildSectionBlocks(section));
    });
    if (!calcStarted) pushCharCount();
    var glossaryHeading = null;
    if (glossary) {
      blocks.push({ type: 'page', orientation: 'portrait', breakBefore: true });
      var glossaryBlocks = buildSectionBlocks(glossary);
      glossaryHeading = glossaryBlocks[0];
      blocks = blocks.concat(glossaryBlocks);
    }
    if (tocIndex >= 0) blocks[tocIndex].entries = buildTocEntries(blocks, tocIndex, glossaryHeading);
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
