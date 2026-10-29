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
    BALANCE_START: 238, STRENGTH: 280,   // 身強弱（B＝点数・C＝5段階のラベル。api_master.js の _convertResultToDataRows_）
    NIKKAN_LEFT_START: 393, NIKKAN_LEFT_COUNT: 12, NIKKAN_SUMMARY_START: 406,
    TSUHEN_DIST_START: 309, YOJIN_MATRIX_START: 364, YOJIN: 321, KIJIN: 322
  };
  var PILLAR_HEADERS = ['', '年柱', '月柱', '日柱', '時柱'];
  var DAY_PILLAR_INDEX = 2;   // 年柱・月柱・日柱・時柱のうち日柱
  var GOGYO_NAMES = ['木', '火', '土', '金', '水'];                                   // writeS02Sheet_ の gogyoNames
  var TSUHEN_NAMES = ['比肩', '劫財', '食神', '傷官', '偏財', '正財', '偏官', '正官', '偏印', '印綬'];   // 同 tsuhenNames
  var ISHIKI_NONE = '該当なし';
  var KUUBOU_NONE = 'なし';
  var GOGYO_TOTAL_NOTE = '合計は天干・地支に出ている数です（蔵干は含みません）。';
  // 表の下の注記（2026-10-28。計算は変えず、読み方だけを書く）
  //   身強弱のしきい値は constants.js NIKKAN_STRENGTH_THRESHOLDS（5・2）と api_master.js calcNikkanStrength_ の判定に合わせる
  var NIKKAN_RANGE_NOTE = '5段階の目安：強い 5以上／やや強い 2以上5未満／中和 −2より大きく2未満／やや弱い −5より大きく−2以下／弱い −5以下。';
  //   用神の表は calcYojin_（強弱補正＝KYOJAKU_YOJIN_SCORES、不足補正＝0〜FUSOKU_MAX）
  var YOJIN_NOTE = '「強弱から見た必要度」は、日干が強ければ抑える五行に、弱ければ助ける五行に点が付きます（中和はすべて0）。'
    + '「不足の度合い」は、命式に少ない五行ほど高くなります（いちばん多い五行が0、いちばん少ない五行が3。すべて同じ数なら0）。'
    + '合計がいちばん大きい五行が用神、次が喜神です。';
  //   守護神は calcGuardianGod_（日干×月支の守護神の表）。用神とは選び方が違う
  var GUARDIAN_NOTE = '守護神は、日干と生まれ月の組み合わせから選ぶ天干です。命式の強弱と五行の偏りから選ぶ用神（五行）とは、選び方が違います。';

  /**
   * 命式詳細の項目（開閉の単位は画面の見出しのまとまり。docs/web-pdf-plan.md §4.5）。now は使わない（ミニ年運を外したため。呼び出し側に合わせて残す）。
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
      buildYojin(table)
    ];
  }

  /** 命式詳細を container に書く。name は画面に入力された氏名、now は使わない（呼び出し側に合わせて残す）。 */
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

  /** 表の下の小さな注記（PDF は小さめの灰色）。 */
  function tipPart(text) {
    return { type: 'lines', text: text, className: 'result-text report-tip', tone: 'tip' };
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
    return createSection('gogyo', '五行バランス', [tablePart(['', '天干', '地支', '蔵干', '合計'], rows), tipPart(GOGYO_TOTAL_NOTE)]);
  }

  // 守護神（GSS 版 E37:E38。28行の D・E）
  function buildGuardian(table) {
    return createSection('guardian', '守護神', [tablePart(null, [
      ['第一候補', VIEW.formatOrDash(table.get(ROW.GOSHUGOSIN, 4))],
      ['第二候補', VIEW.formatOrDash(table.get(ROW.GOSHUGOSIN, 5))]
    ]), tipPart(GUARDIAN_NOTE)]);
  }

  // 日干強弱の内訳の用語を、読む人向けの言い方にする（表示だけ。_data の文字は GSS 版と同じまま。2026-10-28 ガクさん承認）
  var NIKKAN_TERMS = {
    '月令ボーナス(+3/+1/0)': '生まれ月の加点（+3/+1/0）',
    '天干スコア': '天干の点数',
    '地支蔵干スコア（年・月・時）': '地支の蔵干の点数（年・月・時）',
    '月令スコア': '生まれ月の加点',
    '日支蔵干スコア（座下補正）': '日支の加点'
  };
  /** 日干強弱の表のセル（「-」付き）。NIKKAN_TERMS にある文字は言い換える。 */
  function formatNikkanCell(value) {
    var text = VIEW.formatOrDash(value);
    return Object.prototype.hasOwnProperty.call(NIKKAN_TERMS, text) ? NIKKAN_TERMS[text] : text;
  }

  // 日干強弱（GSS 版 D42:F53・I42:I46。左は B＝判定対象・D＝スコア寄与・C＝解釈補助、右は 406〜409行の B と 410行の C）
  function buildNikkanStrength(table) {
    var left = table.getBlock(ROW.NIKKAN_LEFT_START, 1, ROW.NIKKAN_LEFT_COUNT, 5).map(function (values) {
      return [formatNikkanCell(values[0]), formatNikkanCell(values[1]), formatNikkanCell(values[3]), formatNikkanCell(values[2])];
    });
    var summary = [];
    for (var i = 0; i < 4; i++) {
      var rowNo = ROW.NIKKAN_SUMMARY_START + i;
      summary.push([formatNikkanCell(table.get(rowNo, 1)), VIEW.formatOrDash(table.get(rowNo, 2))]);
    }
    summary.push(['5段階判定', VIEW.formatOrDash(table.get(ROW.NIKKAN_SUMMARY_START + 4, 3))]);
    return createSection('nikkan', '日干強弱', [tablePart(['項目', '判定対象', '点数', '解釈補助'], left), tablePart(null, summary), tipPart(NIKKAN_RANGE_NOTE)]);
  }

  // 通変星分布（GSS 版 C57:E67。309〜319行の B:D。空はそのまま）
  function buildTsuhenDistribution(table) {
    var block = table.getBlock(ROW.TSUHEN_DIST_START, 2, TSUHEN_NAMES.length + 1, 3);
    var rows = block.map(function (values, i) {
      return [i < TSUHEN_NAMES.length ? TSUHEN_NAMES[i] : '合計'].concat(values.map(VIEW.formatOrEmpty));
    });
    return createSection('tsuhen', '通変星分布', [tablePart(['', '天干', '蔵干', '合計'], rows)]);
  }

  // 用神（GSS 版 C71:E75 のマトリクスは空のまま出す。E76・E77 の用神・喜神は「-」付き）
  //   列は強弱補正・不足補正・合計（GSS 版の見出し）。「今の強さ」は五行の数と誤解されたので言い換えた（2026-10-28）
  function buildYojin(table) {
    var block = table.getBlock(ROW.YOJIN_MATRIX_START, 2, GOGYO_NAMES.length, 3);
    var rows = block.map(function (values, i) { return [GOGYO_NAMES[i]].concat(values.map(VIEW.formatOrEmpty)); });
    return createSection('yojin', '用神', [tablePart(['', '強弱から見た必要度', '不足の度合い', '合計'], rows), tablePart(null, [
      ['用神', VIEW.formatOrDash(table.get(ROW.YOJIN, 2))],
      ['喜神', VIEW.formatOrDash(table.get(ROW.KIJIN, 2))]
    ]), tipPart(YOJIN_NOTE)]);
  }

  // ---- 鑑定書の図の値（段階2：鑑定書のわかりやすさ。view_figure.js が描く） ----
  /** 命式の4本の柱：年柱〜時柱の天干・地支・通変星・十二運（表と同じ行。日柱は強調する）。 */
  function readPillarFigureData(table) {
    var stems = readPillarCells(table, ROW.STEM);
    var branches = readPillarCells(table, ROW.BRANCH);
    var tsuhens = readPillarCells(table, ROW.TSUHEN);
    var juniuns = readPillarCells(table, ROW.JUNIUN);
    return PILLAR_HEADERS.slice(1).map(function (label, i) {
      return { label: label, stem: stems[i], branch: branches[i], tsuhen: tsuhens[i], juniun: juniuns[i], isDay: i === DAY_PILLAR_INDEX };
    });
  }

  /** 五行の数（B列＝天干・地支の合計。命式詳細の「合計」と同じ）：{ 木: 数, … }。 */
  function readGogyoCounts(table) {
    var counts = {};
    table.getBlock(ROW.BALANCE_START, 2, GOGYO_NAMES.length, 1).forEach(function (values, i) {
      counts[GOGYO_NAMES[i]] = Number(values[0]) || 0;
    });
    return counts;
  }

  /** 身強弱：{ score：点数の文字（空なら ''）, label：'強い'など（空なら ''） }。 */
  function readStrength(table) {
    return { score: VIEW.formatOrEmpty(table.get(ROW.STRENGTH, 2)), label: VIEW.formatOrEmpty(table.get(ROW.STRENGTH, 3)) };
  }

  VIEW.readPillarFigureData = readPillarFigureData;
  VIEW.readGogyoCounts = readGogyoCounts;
  VIEW.readStrength = readStrength;
  VIEW.buildMeishikiSections = buildMeishikiSections;
  VIEW.renderMeishiki = renderMeishiki;
})();
