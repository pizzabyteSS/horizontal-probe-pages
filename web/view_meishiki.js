// ============================================================
// web/src/view_meishiki.js — 命式詳細（段階2。段階3a-2 で項目の形に分けた）
// 設計：docs/web-screen-items.md §3.1。GSS 版の writeS02Sheet_（master_gss/output_sheets.js）と同じ行・列を読み、同じ並びで出す
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // _data の行番号（master_gss/output_data.js の DATA_ROW と、writeS02Sheet_ に直書きされた行）
  var ROW = {
    STEM: 3, BRANCH: 4, KANSHI: 5, STEM_IDX: 6, BRANCH_IDX: 7, TSUHEN: 11, JUNIUN: 12, URA_JUNIUN: 17,
    ZOKAN: 8, ZOKAN_TSUHEN: 14,
    KUUBOU: 20, ISHIKI: 21, GOSHUGOSIN: 28,
    STAR_START: 325, STAR_COUNT: 4,
    BALANCE_START: 238,
    NIKKAN_LEFT_START: 393, NIKKAN_LEFT_COUNT: 12, NIKKAN_SUMMARY_START: 406,
    TSUHEN_DIST_START: 309, YOJIN_MATRIX_START: 364, YOJIN: 321, KIJIN: 322,
    TAIUN_DIR: 380, TAIUN_AGE: 381,
    TAIUN_HEADER: 82, TAIUN_START: 83, TAIUN_COUNT: 11,   // 立運前＋大運10行（docs/web-screen-items.md §5.2）
    NENUN_HEADER: 102, NENUN_START: 103, NENUN_COUNT: 60, MINI_NENUN_COUNT: 10,   // ミニ年運は10年（GSS 版は5年。2026-10-21 ガクさん）
    GETSUUN_HEADER: 172, GETSUUN_START: 173, GETSUUN_COUNT: 12
  };
  var PILLAR_HEADERS = ['', '年柱', '月柱', '日柱', '時柱'];
  var GOGYO_NAMES = ['木', '火', '土', '金', '水'];                                   // writeS02Sheet_ の gogyoNames
  var TSUHEN_NAMES = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '印綬'];   // 同 tsuhenNames
  var ISHIKI_NONE = '該当なし';
  var KUUBOU_NONE = 'なし';

  /**
   * 命式詳細の項目（開閉の単位は画面の見出しのまとまり。docs/web-pdf-plan.md §4.5）。now はミニ年運の「今年」を決める時刻。
   * 鑑定情報は含めない（view_common.js の buildInfoSection）。
   */
  function buildMeishikiSections(table, now) {
    return [
      buildPillars(table),
      buildKuubou(table),
      buildGogyoBalance(table),
      buildGuardian(table),
      buildNikkanStrength(table),
      buildTsuhenDistribution(table),
      buildYojin(table),
      buildTaiunMini(table),
      buildNenunMini(table, VIEW.readJstYear(now)),
      buildGetsuunMini(table)
    ];
  }

  /** 命式詳細を container に書く。name は画面に入力された氏名、now はミニ年運の「今年」を決める時刻。 */
  function renderMeishiki(container, table, name, now) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(VIEW.readCommonInfo(table, name))].concat(buildMeishikiSections(table, now)));
  }

  /** 項目の形にする（key は meishiki.<名前>）。 */
  function createSection(name, title, parts) {
    return { key: 'meishiki.' + name, title: title, closable: true, parts: parts };
  }

  function tablePart(headers, rows, className) {
    return { type: 'table', headers: headers, rows: rows, className: className };
  }

  function linesPart(text) {
    return { type: 'lines', text: text };
  }

  /** B〜E列（年柱〜時柱）を「-」付きで読む。 */
  function readPillarCells(table, rowNo) {
    return table.getRow(rowNo, 2, 4).map(VIEW.formatOrDash);
  }

  // 四柱の表（GSS 版 C7:F23）
  function buildPillars(table) {
    var rows = [
      ['天干'].concat(readPillarCells(table, ROW.STEM)),
      ['地支'].concat(readPillarCells(table, ROW.BRANCH)),
      ['干支'].concat(readPillarCells(table, ROW.KANSHI)),
      ['干支番号'].concat(buildKanshiNumbers(table)),
      ['通変星'].concat(readPillarCells(table, ROW.TSUHEN)),
      // 蔵干は節入り後日数で選んだ1干（_data の8行目・14行目。9・10・15・16行目は空。2026-10-25）
      ['蔵干'].concat(readPillarCells(table, ROW.ZOKAN)),
      ['蔵干通変星'].concat(readPillarCells(table, ROW.ZOKAN_TSUHEN)),
      ['十二運'].concat(readPillarCells(table, ROW.JUNIUN)),
      ['裏十二運'].concat(readPillarCells(table, ROW.URA_JUNIUN))
    ];
    for (var i = 0; i < ROW.STAR_COUNT; i++) {
      var label = VIEW.formatOrEmpty(table.get(ROW.STAR_START + i, 1)) || '特殊星';
      rows.push([label].concat(readPillarCells(table, ROW.STAR_START + i)));
    }
    return createSection('pillars', '命式', [tablePart(PILLAR_HEADERS, rows, 'is-pillars')]);
  }

  /** 六十干支の番号（6行の天干の番号・7行の地支の番号から。docs/web-screen-items.md §5.1）。 */
  function buildKanshiNumbers(table) {
    var out = [];
    for (var col = 2; col <= 5; col++) {
      out.push(VIEW.formatKanshiNumber(table.get(ROW.STEM_IDX, col), table.get(ROW.BRANCH_IDX, col)));
    }
    return out;
  }

  // 空亡＋命式内位相法（GSS 版 B25。位相法が「該当なし」なら空亡だけ）
  function buildKuubou(table) {
    var kuubou = VIEW.formatOrEmpty(table.get(ROW.KUUBOU, 2));
    var ishiki = VIEW.formatOrEmpty(table.get(ROW.ISHIKI, 2));
    var text = '空亡: ' + (kuubou || KUUBOU_NONE);
    if (ishiki && ishiki !== ISHIKI_NONE) text += '\n' + ishiki;
    return createSection('kuubou', '空亡・命式内位相法', [linesPart(text)]);
  }

  // 五行バランス（GSS 版 C30:F34。_data の B＝合計・C＝天干・D＝地支・E＝蔵干を、天干・地支・蔵干・合計の順に出す）
  function buildGogyoBalance(table) {
    var block = table.getBlock(ROW.BALANCE_START, 2, GOGYO_NAMES.length, 4);
    var rows = block.map(function (values, i) {
      return [GOGYO_NAMES[i], VIEW.formatOrDash(values[1]), VIEW.formatOrDash(values[2]), VIEW.formatOrDash(values[3]), VIEW.formatOrDash(values[0])];
    });
    return createSection('gogyo', '五行バランス', [tablePart(['', '天干', '地支', '蔵干', '合計'], rows)]);
  }

  // 守護神（GSS 版 E37:E38。28行の D・E）
  function buildGuardian(table) {
    return createSection('guardian', '守護神', [tablePart(null, [
      ['第一候補', VIEW.formatOrDash(table.get(ROW.GOSHUGOSIN, 4))],
      ['第二候補', VIEW.formatOrDash(table.get(ROW.GOSHUGOSIN, 5))]
    ])]);
  }

  // 日干強弱（GSS 版 D42:F53・I42:I46。左は B＝判定対象・D＝スコア寄与・C＝解釈補助、右は 406〜409行の B と 410行の C）
  function buildNikkanStrength(table) {
    var left = table.getBlock(ROW.NIKKAN_LEFT_START, 1, ROW.NIKKAN_LEFT_COUNT, 5).map(function (values) {
      return [VIEW.formatOrDash(values[0]), VIEW.formatOrDash(values[1]), VIEW.formatOrDash(values[3]), VIEW.formatOrDash(values[2])];
    });
    var summary = [];
    for (var i = 0; i < 4; i++) {
      var rowNo = ROW.NIKKAN_SUMMARY_START + i;
      summary.push([VIEW.formatOrDash(table.get(rowNo, 1)), VIEW.formatOrDash(table.get(rowNo, 2))]);
    }
    summary.push(['5段階判定', VIEW.formatOrDash(table.get(ROW.NIKKAN_SUMMARY_START + 4, 3))]);
    return createSection('nikkan', '日干強弱', [tablePart(['項目', '判定対象', 'スコア寄与', '解釈補助'], left), tablePart(null, summary)]);
  }

  // 通変星分布（GSS 版 C57:E67。309〜319行の B:D。空はそのまま）
  function buildTsuhenDistribution(table) {
    var block = table.getBlock(ROW.TSUHEN_DIST_START, 2, TSUHEN_NAMES.length + 1, 3);
    var rows = block.map(function (values, i) {
      return [i < TSUHEN_NAMES.length ? TSUHEN_NAMES[i] : '合計'].concat(values.map(VIEW.formatOrEmpty));
    });
    return createSection('tsuhen', '通変星分布', [tablePart(['', '天干', '蔵干（本気）', '合計'], rows)]);
  }

  // 用神（GSS 版 C71:E75 のマトリクスは空のまま出す。E76・E77 の用神・喜神は「-」付き）
  function buildYojin(table) {
    var block = table.getBlock(ROW.YOJIN_MATRIX_START, 2, GOGYO_NAMES.length, 3);
    var rows = block.map(function (values, i) { return [GOGYO_NAMES[i]].concat(values.map(VIEW.formatOrEmpty)); });
    return createSection('yojin', '用神', [tablePart(['', '強弱', '不足', '合計'], rows), tablePart(null, [
      ['用神', VIEW.formatOrDash(table.get(ROW.YOJIN, 2))],
      ['喜神', VIEW.formatOrDash(table.get(ROW.KIJIN, 2))]
    ])]);
  }

  /** 見出しの行（A列から count 列）を文字にする。 */
  function readHeaders(table, rowNo, colNo, count) {
    return table.getRow(rowNo, colNo, count).map(VIEW.formatOrEmpty);
  }

  // 順逆・立運とミニ大運（GSS 版 B80・B82:J91。83〜93行の B:J、空の行は飛ばす。GSS 版は 92行まで：§5.2）
  function buildTaiunMini(table) {
    var direction = VIEW.formatOrDash(table.get(ROW.TAIUN_DIR, 2));
    var age = VIEW.formatOrDash(table.get(ROW.TAIUN_AGE, 2));
    var rows = [];
    var block = table.getBlock(ROW.TAIUN_START, 1, ROW.TAIUN_COUNT, 10);
    for (var i = 0; i < block.length; i++) {
      if (!VIEW.hasAnyValue(block[i])) continue;
      rows.push(block[i].slice(1).map(VIEW.formatOrDash));
    }
    return createSection('taiun', '大運', [
      linesPart('順逆: ' + direction + ' / 立運: ' + age + '歳'),
      tablePart(readHeaders(table, ROW.TAIUN_HEADER, 2, 9), rows, 'is-wide')
    ]);
  }

  // ミニ年運（GSS 版 B95:K99。103〜162行のうち、A列の先頭4桁の年が今年（日本時間）以上の最初の10行。GSS 版は5行）
  function buildNenunMini(table, currentYear) {
    var rows = [];
    var block = table.getBlock(ROW.NENUN_START, 1, ROW.NENUN_COUNT, 10);
    for (var i = 0; i < block.length && rows.length < ROW.MINI_NENUN_COUNT; i++) {
      var match = String(block[i][0]).match(/^(\d{4})/);
      if (match && Number(match[1]) >= currentYear) rows.push(block[i].map(VIEW.formatOrDash));
    }
    return createSection('nenun', '年運（今年から10年）', [tablePart(readHeaders(table, ROW.NENUN_HEADER, 1, 10), rows, 'is-wide')]);
  }

  // ミニ月運（GSS 版 B103:K114。173〜184行の A:J、空の行は飛ばす。A列「2026年10月」は文字のまま出す。docs/web-screen-items.md §5 の 4）
  function buildGetsuunMini(table) {
    var rows = [];
    var block = table.getBlock(ROW.GETSUUN_START, 1, ROW.GETSUUN_COUNT, 11);   // 空の行の判定は A:K（GSS 版と同じ）、出すのは A:J
    for (var i = 0; i < block.length; i++) {
      if (!VIEW.hasAnyValue(block[i])) continue;
      rows.push(block[i].slice(0, 10).map(VIEW.formatOrDash));
    }
    return createSection('getsuun', '月運（12か月）', [tablePart(readHeaders(table, ROW.GETSUUN_HEADER, 1, 10), rows, 'is-wide')]);
  }

  VIEW.buildMeishikiSections = buildMeishikiSections;
  VIEW.renderMeishiki = renderMeishiki;
})();
