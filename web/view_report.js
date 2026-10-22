// ============================================================
// web/src/view_report.js — 鑑定書（段階2。段階3a-2 で項目の形に分けた）
// 設計：docs/web-screen-items.md §3.6・§4・§6。GSS 版の writeS04Sheet（master_gss/output_report.js）と同じキー・列を読む
//   - _data の A列をキーにして読む（下の行が勝つ）。B列が基本、例外は C列（KANTEI_REPORT_CH7_DECADE・_YEAR）と D列（十二運＝日柱）
//   - …_KEY の記号は漢字の表示名に変える（output_report.js の labelNikkan_ ほか＋サーバーが出すのに表にない記号。§5.3）。表にない値はそのまま
//   - 空の値は空のまま出す（GSS 版の safe_）
//   - 章の題名・主項目と副項目の名前・本文の題名は、鑑定書シートの雛形の文字（「鑑定書シート_最終実装表」2026-03-18）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // _data の列（buildKeyMap が返す配列の添字。0＝B列）
  var COL_B = 0;
  var COL_C = 1;
  var COL_D = 2;

  // ---- 記号 → 表示名（output_report.js の label…_ と同じ中身） ----
  var LABEL_NIKKAN = { KOU: '甲', OTSU: '乙', HEI: '丙', TEI: '丁', BO: '戊', KI: '己', KO: '庚', SHIN: '辛', JIN: '壬', CI: '癸' };
  var LABEL_STRENGTH = { STRONG: '強い', MID_STRONG: 'やや強い', BALANCED: '中和', MID_WEAK: 'やや弱い', WEAK: '弱い' };
  var LABEL_NISSHI = {
    KO: '子', USHI: '丑', TORA: '寅', U: '卯', TATSU: '辰', MI: '巳',
    UMA: '午', HITSUJI: '未', SARU: '申', TORI: '酉', INU: '戌', I: '亥'
  };
  var LABEL_TSUHEN = {
    HIKEN: '比肩', GOZAI: '劫財', SHOKUJIN: '食神', SHOKAN: '傷官', HENZAI: '偏財',
    SEIZAI: '正財', HENKAN: '偏官', SEIKAN: '正官', HENIN: '偏印', INJU: '印綬'
  };
  var LABEL_GOGYO = { WOOD: '木', FIRE: '火', EARTH: '土', METAL: '金', WATER: '水' };
  // 財星・五行の偏りは、サーバーが実際に出す記号（api_master.js の _writeKanteiRawToData_：HENZAI_DOM・SEIZAI_DOM・EVEN・
  // STRONG_BIAS）も足す。GSS 版の対応表にはなく、記号のまま出ている（docs/web-screen-items.md §5.3）
  var LABEL_ZAI_TYPE = {
    ZAI_DOM: '財星優勢', HENZAI_DOM: '偏財優勢', SEIZAI_DOM: '正財優勢',
    ZAI_BALANCED: '財星中和', ZAI_LOW: '財星弱め', ZAI_NONE: '財星希薄'
  };
  var LABEL_BIAS = {
    NO_BIAS: '偏りなし', EVEN: '偏りなし', LOW_BIAS: '軽い偏り', MID_BIAS: '中程度の偏り',
    HIGH_BIAS: '強い偏り', STRONG_BIAS: '強い偏り'
  };
  var LABEL_RHYTHM = { STABLE: '安定型', UNSTABLE: '波が出やすい', ACTIVE: '活動型', STORE: '蓄積型', ADJUST: '調整型' };
  var LABEL_ISOHOU = {
    NONE: 'なし', TENCHU: '天剋地冲', TENKAN_CHONG: '天干冲', SHIGOU: '支合', SANGO: '三合',
    RIKUGO: '六合', CHONG: '冲', GAI: '害', KEI: '刑', HA: '破'
  };
  var LABEL_KUUBOU = { NEUSHI: '子丑', TORAU: '寅卯', TATSUMI: '辰巳', UMAHITSUJI: '午未', SARUTORI: '申酉', INUI: '戌亥' };

  // キー → 使う対応表（output_report.js の rawLabel_。RHYTHM_TYPE_KEY は対応表だけあり、どの欄にも出していない）
  var LABEL_TABLE_BY_KEY = {
    NIKKAN_KEY: LABEL_NIKKAN,
    STR_LABEL_KEY: LABEL_STRENGTH,
    NISSHI_KEY: LABEL_NISSHI,
    GETSU_TSUHEN_KEY: LABEL_TSUHEN,
    DIST_CORE_KEY: LABEL_TSUHEN,
    YOJIN_PRIMARY_KEY: LABEL_GOGYO,
    GOSHUGO_PRIMARY_KEY: LABEL_GOGYO,
    ZAI_TYPE_KEY: LABEL_ZAI_TYPE,
    BIAS_TYPE_KEY: LABEL_BIAS,
    RHYTHM_TYPE_KEY: LABEL_RHYTHM,
    YEAR_ISOHOU_KEY: LABEL_ISOHOU,
    KUUBOU_TYPE_KEY: LABEL_KUUBOU
  };

  // ---- 章ごとの読み元（output_report.js の put_ のセルの順） ----
  // items：[名前, 診断結果のキー, 意味のキー, 診断結果の列]。列を省いたら B列
  // reports：[本文の題名, 本文のキー, 列]。列を省いたら B列
  var CHAPTERS = [
    {
      title: '第1章｜性格と才能', summaryKey: 'KANTEI_SUMMARY_CH1',
      mainItems: [['日干', 'NIKKAN_KEY', 'KANTEI_MEANING_NIKKAN'], ['日干身強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['あなたの基本性質', 'KANTEI_REPORT_CH1_BASIC'], ['あなたの強み', 'KANTEI_REPORT_CH1_STRENGTH'], ['才能を活かす鍵', 'KANTEI_REPORT_CH1_TALENT']]
    },
    {
      title: '第2章｜恋愛・結婚の傾向', summaryKey: 'KANTEI_SUMMARY_CH2',
      mainItems: [['日支', 'NISSHI_KEY', 'KANTEI_MEANING_NISSHI'], ['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD']],
      subItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      reports: [['恋愛の傾向', 'KANTEI_REPORT_CH2_LOVE'], ['結婚の傾向', 'KANTEI_REPORT_CH2_MARRIAGE']]
    },
    {
      title: '第3章｜仕事運と適職', summaryKey: 'KANTEI_SUMMARY_CH3',
      mainItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['用神候補', 'YOJIN_PRIMARY_KEY', 'KANTEI_MEANING_YOJIN']],
      reports: [['向いている働き方、活躍しやすい環境', 'KANTEI_REPORT_CH3_WORK']]
    },
    {
      title: '第4章｜金運と財の築き方', summaryKey: 'KANTEI_SUMMARY_CH4',
      mainItems: [['財星の出方', 'ZAI_TYPE_KEY', 'KANTEI_MEANING_ZAI_TYPE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['金運の傾向', 'KANTEI_REPORT_CH4_MONEY']]
    },
    {
      title: '第5章｜家庭運と家族関係', summaryKey: 'KANTEI_SUMMARY_CH5',
      mainItems: [['日支', 'NISSHI_KEY', 'KANTEI_MEANING_NISSHI'], ['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD']],
      subItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['家庭で表れやすい傾向', 'KANTEI_REPORT_CH5_FAMILY']]
    },
    {
      title: '第6章｜健康運と心身の傾向', summaryKey: 'KANTEI_SUMMARY_CH6',
      mainItems: [['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      // 十二運（表）は 12行「十二運」の D列（日柱）をそのまま出す（output_report.js 376行）
      subItems: [['十二運（表）', '十二運', 'KANTEI_MEANING_JUNIUN', COL_D], ['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE']],
      reports: [['心身の傾向', 'KANTEI_REPORT_CH6_HEALTH']]
    },
    {
      title: '第7章｜運勢の流れ', summaryKey: 'KANTEI_SUMMARY_CH7',
      // 大運・年運の総合ラベルは意味の欄がない（output_report.js 387・388行は D列だけ）
      mainItems: [['大運総合ラベル', 'DECADE_SUMMARY_LABEL', null], ['年運総合ラベル', 'YEAR_SUMMARY_LABEL', null]],
      subItems: [['位相法', 'YEAR_ISOHOU_KEY', 'KANTEI_MEANING_ISOHOU'], ['空亡', 'KUUBOU_TYPE_KEY', 'KANTEI_MEANING_KUUBOU']],
      // 第7章の本文は C列（output_report.js 393・394行）
      reports: [['大運の傾向', 'KANTEI_REPORT_CH7_DECADE', COL_C], ['年運の傾向', 'KANTEI_REPORT_CH7_YEAR', COL_C]]
    },
    {
      title: '第8章｜開運のヒントと注意点', summaryKey: 'KANTEI_SUMMARY_CH8',
      mainItems: [['守護神候補', 'GOSHUGO_PRIMARY_KEY', 'KANTEI_MEANING_GOSHUGO'], ['用神候補', 'YOJIN_PRIMARY_KEY', 'KANTEI_MEANING_YOJIN']],
      subItems: [['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      reports: [
        ['気をつけたい傾向', 'KANTEI_REPORT_CH8_WARN'], ['開運のヒント', 'KANTEI_REPORT_CH8_KAIUN'],
        ['天中殺の過ごし方', 'KANTEI_REPORT_CH8_TENCHU'], ['エネルギーを整える習慣', 'KANTEI_REPORT_CH8_ENERGY']
      ]
    }
  ];

  /** 空・null・'null'・'undefined' は空文字、そうでなければ文字にする（GSS 版の safe_）。 */
  function formatReportValue(value) {
    if (VIEW.isBlank(value)) return '';
    var text = String(value);
    return text === 'null' || text === 'undefined' ? '' : text;
  }

  /** キーの値（col 列。省いたら B列）。 */
  function readKeyValue(keyMap, key, col) {
    if (!key || !Object.prototype.hasOwnProperty.call(keyMap, key)) return '';
    return formatReportValue(keyMap[key][col === undefined ? COL_B : col]);
  }

  /** 診断結果の表示名：記号のキーは対応表で漢字に変える。表にない値はそのまま（GSS 版の rawLabel_）。 */
  function formatResultLabel(keyMap, key, col) {
    var raw = readKeyValue(keyMap, key, col);
    var table = Object.prototype.hasOwnProperty.call(LABEL_TABLE_BY_KEY, key) ? LABEL_TABLE_BY_KEY[key] : null;
    return table && Object.prototype.hasOwnProperty.call(table, raw) ? table[raw] : raw;
  }

  /** 主項目・副項目の表の行：[名前, 診断結果, 意味]。 */
  function buildItemRows(keyMap, items) {
    return items.map(function (item) {
      return [item[0], formatResultLabel(keyMap, item[1], item[3]), item[2] ? readKeyValue(keyMap, item[2]) : ''];
    });
  }

  /** 鑑定書の中身（画面に書く前の形）。試験と段階3 の PDF でも同じものを使えるように分けておく。 */
  function buildReport(table) {
    var keyMap = table.buildKeyMap();
    return CHAPTERS.map(function (chapter) {
      return {
        title: chapter.title,
        summary: readKeyValue(keyMap, chapter.summaryKey),
        mainRows: buildItemRows(keyMap, chapter.mainItems),
        subRows: buildItemRows(keyMap, chapter.subItems),
        reports: chapter.reports.map(function (report) {
          return { title: report[0], text: readKeyValue(keyMap, report[1], report[2]) };
        })
      };
    });
  }

  /**
   * 書き直せる文の部品（段階3b。text_edit.js）。editKey は鑑定書の文のキー（KANTEI_SUMMARY_CH1 など。章の中で重ならない）、
   * editLabel は自分用の文章などで、どの文かを示す名前（「第1章｜性格と才能／あなたの傾向」）
   */
  function buildEditableLines(text, editKey, editLabel) {
    return { type: 'lines', text: text, className: 'result-text report-text', editKey: editKey, editLabel: editLabel };
  }

  /**
   * 1つの章の項目（開閉の単位は章。key は report.ch<n>）：あなたの傾向 → 主項目・副項目 → 鑑定結果。
   * 画面の見出しは h4（あなたの傾向・鑑定結果）と h5（本文の題名）。
   * 書き直せるのは文（あなたの傾向・鑑定結果の本文）だけ。表（診断結果・意味）は計算の結果のため書き直さない（docs/product-spec.md §4.1）
   */
  function buildChapterSection(chapter, index) {
    var source = CHAPTERS[index];
    var parts = [
      { type: 'heading', level: 4, text: 'あなたの傾向', className: 'report-heading' },
      buildEditableLines(chapter.summary, source.summaryKey, chapter.title + '／あなたの傾向'),
      { type: 'table', headers: ['主項目', '診断結果', '意味'], rows: chapter.mainRows, className: 'is-report' },
      { type: 'table', headers: ['副項目', '診断結果', '意味'], rows: chapter.subRows, className: 'is-report' },
      { type: 'heading', level: 4, text: '鑑定結果', className: 'report-heading' }
    ];
    chapter.reports.forEach(function (report, i) {
      parts.push({ type: 'heading', level: 5, text: report.title, className: 'report-subheading' });
      parts.push(buildEditableLines(report.text, source.reports[i][1], chapter.title + '／' + report.title));
    });
    return { key: 'report.ch' + (index + 1), title: chapter.title, closable: true, className: 'report-chapter', parts: parts };
  }

  /** 鑑定書の項目（8章）。鑑定情報は含めない。 */
  function buildReportSections(table) {
    return buildReport(table).map(buildChapterSection);
  }

  /** 鑑定書を container に書く。name は送った時点の氏名。 */
  function renderReport(container, table, name) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(VIEW.readCommonInfo(table, name))].concat(buildReportSections(table)));
  }

  VIEW.buildReport = buildReport;
  VIEW.buildReportSections = buildReportSections;
  VIEW.renderReport = renderReport;
})();
