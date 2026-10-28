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
    NONE: 'なし', TENCHU: '天剋地冲', TENKAN_CHONG: '天干冲', SHIGOU: '支合', SANGO: '三合・半会',
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
  // tip：根拠の表の上に置く豆知識（Web 版だけの文。ガクさん確認済み 2026-10-27。claude/DRAFT_2026-10-27_report-notes-glossary.md）
  // figures：根拠の枠の中、豆知識と表の間に置く図（段階2。FIGURE_BUILDERS の名前。同じ図は1つの章にだけ置く）
  // icon：章のアイコンと色（段階3：案8。色は章を見分けるためで、題名の色＝屋号の色とは別。落ち着いた色にそろえる）
  var CHAPTERS = [
    {
      title: '第1章｜性格と才能', summaryKey: 'KANTEI_SUMMARY_CH1', icon: { name: 'star', color: '#3f6fb0' },
      figures: ['pillars', 'meter'],
      tip: '日干＝生まれた日の天干。あなた自身を表す文字で、読み解きの中心になります。日干強弱＝日干のエネルギーの強さ。強いほど自分の力で進み、弱いほど周りの助けを活かして伸びます。',
      mainItems: [['日干', 'NIKKAN_KEY', 'KANTEI_MEANING_NIKKAN'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['あなたの基本性質', 'KANTEI_REPORT_CH1_BASIC'], ['あなたの強み', 'KANTEI_REPORT_CH1_STRENGTH'], ['才能を活かす鍵', 'KANTEI_REPORT_CH1_TALENT']]
    },
    {
      title: '第2章｜恋愛・結婚の傾向', summaryKey: 'KANTEI_SUMMARY_CH2', icon: { name: 'heart', color: '#c25572' },
      tip: '日支＝生まれた日の地支。日干のすぐ下にあり、配偶者など身近な人との関わりを見る場所です。天干通変星＝月柱の天干の通変星。日干から見た関係を表す星で、社会での振る舞いを表します。',
      mainItems: [['日支', 'NISSHI_KEY', 'KANTEI_MEANING_NISSHI'], ['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD']],
      subItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      reports: [['恋愛の傾向', 'KANTEI_REPORT_CH2_LOVE'], ['結婚の傾向', 'KANTEI_REPORT_CH2_MARRIAGE']]
    },
    {
      title: '第3章｜仕事運と適職', summaryKey: 'KANTEI_SUMMARY_CH3', icon: { name: 'briefcase', color: '#3b8a78' },
      tip: '通変星分布＝命式の中でいちばん目立つ通変星。得意な役割や働き方の癖が表れます。',
      mainItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['用神候補', 'YOJIN_PRIMARY_KEY', 'KANTEI_MEANING_YOJIN']],
      reports: [['向いている働き方、活躍しやすい環境', 'KANTEI_REPORT_CH3_WORK']]
    },
    {
      title: '第4章｜金運と財の築き方', summaryKey: 'KANTEI_SUMMARY_CH4', icon: { name: 'coin', color: '#b4852c' },
      tip: '財星の出方＝お金や財に関わる星（偏財・正財）が、命式にどう出ているかです。',
      mainItems: [['財星の出方', 'ZAI_TYPE_KEY', 'KANTEI_MEANING_ZAI_TYPE'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      subItems: [['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['金運の傾向', 'KANTEI_REPORT_CH4_MONEY']]
    },
    {
      title: '第5章｜家庭運と家族関係', summaryKey: 'KANTEI_SUMMARY_CH5', icon: { name: 'house', color: '#c9733d' },
      tip: '日支は家庭やパートナーとの関わり、天干通変星（月柱の天干の通変星）は家族の中での振る舞い方の手がかりになります。',
      mainItems: [['日支', 'NISSHI_KEY', 'KANTEI_MEANING_NISSHI'], ['天干通変星', 'GETSU_TSUHEN_KEY', 'KANTEI_MEANING_TENGAN_GOD']],
      subItems: [['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE'], ['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS']],
      reports: [['家庭で表れやすい傾向', 'KANTEI_REPORT_CH5_FAMILY']]
    },
    {
      title: '第6章｜健康運と心身の傾向', summaryKey: 'KANTEI_SUMMARY_CH6', icon: { name: 'leaf', color: '#4c8f46' },
      figures: ['gogyo'],
      tip: '五行バランス＝木・火・土・金・水の5つの要素の偏り。多い・少ない要素が、心身の傾向にも表れるとされます。',
      mainItems: [['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      // 十二運（表）は 12行「十二運」の D列（日柱）をそのまま出す（output_report.js 376行）
      subItems: [['十二運（表）', '十二運', 'KANTEI_MEANING_JUNIUN', COL_D], ['通変星分布', 'DIST_CORE_KEY', 'KANTEI_MEANING_DIST_CORE']],
      reports: [['心身の傾向', 'KANTEI_REPORT_CH6_HEALTH']]
    },
    {
      title: '第7章｜運勢の流れ', summaryKey: 'KANTEI_SUMMARY_CH7', icon: { name: 'trend', color: '#5b5fb8' },
      figures: ['decade', 'nenun'], markLegend: true,
      tip: '大運＝10年ごとの運気の流れ。年運＝1年ごとの運気。位相法＝その年の干支と命式の組み合わせ、空亡＝運気が空回りしやすい時期の目印です。',
      // 大運・年運の総合ラベルの意味は運表の解説（KANTEI_REPORT_CH7_* の B列＝period summary の text1。output_report.js の E123・E124）
      mainItems: [['大運総合ラベル', 'DECADE_SUMMARY_LABEL', 'KANTEI_REPORT_CH7_DECADE'], ['年運総合ラベル', 'YEAR_SUMMARY_LABEL', 'KANTEI_REPORT_CH7_YEAR']],
      subItems: [['位相法', 'YEAR_ISOHOU_KEY', 'KANTEI_MEANING_ISOHOU'], ['空亡', 'KUUBOU_TYPE_KEY', 'KANTEI_MEANING_KUUBOU']],
      // 第7章の本文は C列（output_report.js 393・394行）
      reports: [['大運の傾向', 'KANTEI_REPORT_CH7_DECADE', COL_C], ['年運の傾向', 'KANTEI_REPORT_CH7_YEAR', COL_C]]
    },
    {
      title: '第8章｜開運のヒントと注意点', summaryKey: 'KANTEI_SUMMARY_CH8', icon: { name: 'sparkle', color: '#9358ad' },
      tip: '守護神候補＝命式の弱いところを補い、守ってくれる五行。用神候補＝命式のバランスを整えるのに役立つ五行です。',
      mainItems: [['守護神候補', 'GOSHUGO_PRIMARY_KEY', 'KANTEI_MEANING_GOSHUGO'], ['用神候補', 'YOJIN_PRIMARY_KEY', 'KANTEI_MEANING_YOJIN']],
      subItems: [['五行バランス', 'BIAS_TYPE_KEY', 'KANTEI_MEANING_BIAS'], ['日干強弱', 'STR_LABEL_KEY', 'KANTEI_MEANING_STRENGTH']],
      reports: [
        ['気をつけたい傾向', 'KANTEI_REPORT_CH8_WARN'], ['開運のヒント', 'KANTEI_REPORT_CH8_KAIUN'],
        ['天中殺の過ごし方', 'KANTEI_REPORT_CH8_TENCHU'], ['エネルギーを整える習慣', 'KANTEI_REPORT_CH8_ENERGY']
      ]
    }
  ];

  // ---- 図（段階2：鑑定書のわかりやすさ。設計 claude/DESIGN_2026-10-27_report-readability.md 案4〜7） ----
  // 画面と PDF で同じ部品（view_figure.js の figure、年運は view_chart.js の chart）。図は計算の結果のため書き直さず、字数にも数えない
  var NENUN_CHART_TITLE = '年運の流れ';
  var NENUN_MARK_LABEL = '今年';
  var FIGURE_BUILDERS = {
    pillars: function (table) { return VIEW.buildPillarsFigure(VIEW.readPillarFigureData(table)); },
    meter: function (table) {
      var strength = VIEW.readStrength(table);
      return strength.label ? VIEW.buildMeterFigure(strength) : null;   // 判定がなければ描かない
    },
    gogyo: function (table) { return VIEW.buildGogyoFigure(VIEW.readGogyoCounts(table)); },
    decade: function (table) {
      var bands = VIEW.readTaiunBands(table);
      return bands.length ? VIEW.buildDecadeFigure(bands) : null;
    },
    nenun: function (table) {
      var trend = VIEW.readNenunTrend(table);
      if (!trend.points.length) return null;
      return { type: 'chart', title: NENUN_CHART_TITLE, points: trend.points, color: VIEW.FORTUNE_COLOR_NENUN,
        markIndex: trend.markIndex, markLabel: NENUN_MARK_LABEL };
    }
  };

  /** 章の図の部品（描けない図は省く）。 */
  function buildChapterFigures(table, chapter) {
    return (chapter.figures || []).map(function (name) { return FIGURE_BUILDERS[name](table); }).filter(Boolean);
  }

  // ---- Web 版だけの部品（段階1：鑑定書のわかりやすさ。設計 claude/DESIGN_2026-10-27_report-readability.md） ----
  // 文はすべて鑑定文と同じく書き直せる（editKey。2026-10-27 ガクさん）。Web 版の文のキーは WEB_ で始める（_data のキーと重ねない）
  // 「本鑑定書の文字数」には数えない（isExtra。豆知識・用語ミニ辞典・ひと目でわかるあなた・今日からできること。2026-10-27 ガクさん）
  // 本文を再び載せる所（一言）は、本文と同じキーにする（どちらで書き直しても両方が同じ文になる）。今日からできることは1文目だけで別のキー
  var GLANCE = {
    key: 'report.glance', title: 'ひと目でわかるあなた',
    // キーワード3つ：日干・日干強弱・月柱の天干の通変星（案A。オーソドックスで正確な組み合わせ。2026-10-27 ガクさん）
    keywordItems: [['日干', 'NIKKAN_KEY'], ['日干強弱', 'STR_LABEL_KEY'], ['月柱の天干の通変星', 'GETSU_TSUHEN_KEY']],
    keywordEditKey: 'WEB_GLANCE_KEYWORDS', fortuneEditKey: 'WEB_GLANCE_FORTUNE'
  };
  var KEYWORD_SEPARATOR = '｜';
  var TIP_EDIT_KEY_PREFIX = 'WEB_TIP_CH';   // 章ごとの豆知識（WEB_TIP_CH1〜8）
  var BASIS_HEADING = '鑑定の根拠';
  // 用語ミニ辞典：一般的な読み方の目安。見出しの行（■）と「用語：意味」の行（用語を太字）。2026-10-27 ガクさん確認済み
  var GLOSSARY = {
    key: 'report.glossary', title: '用語ミニ辞典', editKey: 'WEB_GLOSSARY',
    lead: '一般的な読み方の目安です。ひとつの文字だけで決まるものではなく、命式全体の組み合わせで読みます。流派によって解釈が異なることがあり、傾向をつかむためのものです。',
    groups: [
      ['読み方の基本', [
        ['四柱推命', '生まれた年・月・日・時刻の4つの柱から、性格や運気の流れを読む占術'],
        ['命式', '4つの柱を表にしたもの。鑑定の土台'],
        ['年柱・月柱・日柱・時柱', '年柱は先祖や幼少期、月柱は社会や仕事、日柱は自分自身と配偶者、時柱は子どもや晩年を表す、とされます'],
        ['天干・地支・干支', '柱の上の文字（10種）、下の文字（12種）、その組み合わせ（60通り）'],
        ['陰陽', '天干・地支それぞれが持つ、動（陽）と静（陰）の性質'],
        ['五行', '木・火・土・金・水。互いに生み出す関係（相生）と抑える関係（相剋）がある'],
        ['日干・日支', '日柱の天干（あなた自身）と地支（身近な人との関わり）']
      ]],
      ['天干（10種）', [
        ['甲', '木の陽。大樹。まっすぐ伸びる、リーダー気質'], ['乙', '木の陰。草花。しなやかで協調的'],
        ['丙', '火の陽。太陽。明るく華やか、面倒見がよい'], ['丁', '火の陰。灯火。繊細で情熱を内に秘める'],
        ['戊', '土の陽。山。どっしりして頼られる'], ['己', '土の陰。田畑。受け入れて育てる'],
        ['庚', '金の陽。鉄・刃物。決断力があり意志が強い'], ['辛', '金の陰。宝石。感性が鋭く美意識が高い'],
        ['壬', '水の陽。大海。スケールが大きく自由'], ['癸', '水の陰。雨や露。知的で静かに染み込む']
      ]],
      ['地支（12種）', [
        ['子（ね・水）', '真冬'], ['丑（うし・土）', '晩冬'], ['寅（とら・木）', '初春'], ['卯（う・木）', '春'],
        ['辰（たつ・土）', '晩春'], ['巳（み・火）', '初夏'], ['午（うま・火）', '真夏'], ['未（ひつじ・土）', '晩夏'],
        ['申（さる・金）', '初秋'], ['酉（とり・金）', '秋'], ['戌（いぬ・土）', '晩秋'], ['亥（い・水）', '初冬']
      ]],
      ['命式の星と運', [
        ['通変星', '日干とほかの干の関係を表す10種の星。社会や人との関わり方の傾向を見る'],
        ['比肩・劫財', '自分と同じ性質。自立心、対抗心'], ['食神・傷官', '自分が生み出すもの。表現力、感性'],
        ['偏財・正財', '自分が得るもの。お金、実利'], ['偏官・正官', '自分を律するもの。責任、地位'],
        ['偏印・印綬', '自分を支えるもの。学び、守り'],
        ['十二運', 'エネルギーの強弱を、人の一生にたとえた12段階（長生・沐浴・冠帯・建禄・帝旺・衰・病・死・墓・絶・胎・養）。帝旺・建禄は強く、墓・絶は静かなど'],
        ['十二運の「死」', '命が終わるという意味ではなく、勢いが静まり、内面が深まる段階。落ち着いて物事を見極める力'],
        ['蔵干', '地支の中に隠れている天干。内面や隠れた資質'],
        ['身強弱', '日干のエネルギーの強さ。強いほど自力型、弱いほど周りの力を活かす型'],
        ['用神・喜神・守護神', '命式のバランスを整え、助けてくれる五行'],
        ['財星', 'お金や財に関わる通変星（偏財・正財）'],
        ['大運・年運・月運・日運', '10年・1年・1か月・1日ごとの運気の流れ'],
        ['位相法', '干支どうしの組み合わせ（合・冲・刑・害・破）から、出来事の起こりやすさを見る'],
        ['空亡（天中殺）', '運気が空回りしやすい時期の目印'],
        ['宿命中殺', '生まれつき命式の中に空亡の地支があること（生年中殺・生月中殺・生日中殺）。その柱が表すことに、独特の出方をしやすい目印']
      ]]
    ]
  };
  var GLOSSARY_GROUP_MARK = '■ ';   // 見出しの行（「：」がないので太字にならない）
  // 用語ミニ辞典の最後のまとまり：この鑑定書（命式・運勢表）に出た特殊星だけを1行ずつ（2026-10-28 ガクさん承認）。
  //   名前が怖く聞こえる星があるため、前置きの1行を付ける。意味は master_gss/star_table_data.js の備考を、読む人向けに和らげた言い方
  var STAR_GROUP_TITLE = 'この鑑定書に出てくる特殊星';
  var STAR_GROUP_LEAD = '名前が強く聞こえる星もありますが、凶の意味とは限りません。ほかの星との組み合わせで働き方が変わる目印です。';
  var STAR_NOTES = [
    ['桃花殺', '人を惹きつける魅力。異性との縁が生まれやすい'], ['三貴人', '天干に貴人の組み合わせがそろう。大きな引き立てを受けやすい'],
    ['天乙貴人', '最高の吉星とされる。困ったときに助けが入りやすい'], ['福星貴人', '生涯を通じて福に恵まれやすい'],
    ['天官貴人', '名誉や地位、役職での成功に縁がある'], ['天厨貴人', '衣食住に困りにくい'],
    ['文昌貴人', '学問・芸術・文章の才能'], ['十干禄', '着実に発展し、経済的に安定しやすい'],
    ['金与禄', '良縁や家庭の安定、資産に恵まれやすい'], ['暗禄', '目立たないところからの支援や、思わぬ幸運'],
    ['羊刃', '意志がとても強い。良くも悪くも結果がはっきり出やすい'], ['飛刃', '気の短さや出費に注意。吉星と重なると突破力になる'],
    ['紅艶殺', '愛嬌と色気。人を惹きつける魅力'], ['流霞殺', '気持ちに流されやすい。人間関係では落ち着いた判断を'],
    ['魁罡', '強い個性と、大きな成功をつかむ力'], ['日徳', '穏やかで徳があり、福に恵まれやすい'],
    ['禄馬貴人', '動くほど収入や機会につながりやすい'], ['日刃', '気性が強く、行動力がある'],
    ['陰差', '人との縁で行き違いが起きやすい。確認を丁寧に（女性に見る星）'],
    ['陽差', '人との縁で行き違いが起きやすい。確認を丁寧に（男性に見る星）'],
    ['妨害殺', '物事が思うように進みにくいことがある。慎重に進めると吉'], ['淫欲殺', '情愛が深い'],
    ['日座中殺', '日柱にかかる中殺。足元が揺らぎやすいので、生活の土台を大切に'],
    ['日居中殺', '日柱にかかる中殺。家庭やパートナーとの縁を丁寧に育てたい'],
    ['日貴', '品があり、目上から引き立てを受けやすい'], ['天徳貴人', '災いを避ける守りの星'],
    ['月徳貴人', '協力者に恵まれやすい守りの星'], ['天徳合', '天徳貴人の働きを補い、強める'], ['月徳合', '月徳貴人の働きを補い、強める'],
    ['華蓋', 'ひとりで考える力。芸術や精神的なものへの才能'], ['咸池', '恋愛や社交で華やかさが出やすい'],
    ['駅馬', '移動が多く、活動の範囲が広がりやすい'], ['劫殺', '外からの急な変化や刺激が入りやすい。備えがあれば転機になる'],
    ['亡神', '考えすぎや焦りが出やすい。休む時間を大切に'], ['白虎', '焦りから物事が荒れやすい。落ち着いて進めると吉'],
    ['血刃', '日常の油断によるミスや、体調管理に気をつけたい'], ['隔角', '身内や家庭との距離感を大切に'],
    ['孤辰', 'ひとりの時間を必要とする傾向'], ['寡宿', 'ひとりで抱え込みやすい傾向'],
    ['囚獄', '契約・約束・締め切りなどの決まりごとに気をつけたい'], ['黄旛', '責任感の強さが、頑固さに見えやすい'],
    ['弔客', '共感する力が強いぶん、気疲れしやすい'], ['死符', '区切りをつけて手放し、新しくする好機'],
    ['病符', '疲れやすさに注意。ペース配分を大切に']
  ];
  // 性別で出方が変わる星：鑑定する人の性別（_data の性別。'男性'・'女性'）と同じときだけ、意味の後ろに添える（2026-10-28 ガクさん承認）
  var STAR_SEX_NOTES = { '孤辰': ['男性', '（男性に強く出やすい）'], '寡宿': ['女性', '（女性に強く出やすい）'] };
  var STAR_SPLIT = /[・、,\/\s]+/;
  var MEISHIKI_STAR_ROW = 325;   // 命式の特殊星（325〜328行。星の名前は A列、柱ごとの印は B〜E列。view_meishiki.js の STAR_START）
  var MEISHIKI_STAR_COUNT = 4;
  // 最後のページ「今日からできること」：本文の1文目だけを短く載せる（全文の再掲だったため。2026-10-28 ガクさん承認）。
  //   [題名, 本文のキー]。キーは CHAPTERS の reports と同じ。書き直しは本文とは別の文（WEB_TODAY_ ＋ 本文のキー）
  var TODAY = {
    key: 'report.today', title: '今日からできること', editKeyPrefix: 'WEB_TODAY_',
    items: [
      ['才能を活かす鍵', 'KANTEI_REPORT_CH1_TALENT'], ['開運のヒント', 'KANTEI_REPORT_CH8_KAIUN'],
      ['天中殺の過ごし方', 'KANTEI_REPORT_CH8_TENCHU'], ['エネルギーを整える習慣', 'KANTEI_REPORT_CH8_ENERGY']
    ]
  };
  // 第8章「天中殺の過ごし方」の本文の前に置く、計算で出す1行（書き直さない・字数に数えない。2026-10-28 ガクさん承認）。
  //   空亡の2支（KUUBOU_TYPE_KEY）と鑑定開始年から、今が天中殺か・次はいつかを書く。年の区切りは立春（四柱推命の年）
  var TENCHU_REPORT_KEY = 'KANTEI_REPORT_CH8_TENCHU';
  var KUUBOU_BRANCHES = { NEUSHI: [0, 1], TORAU: [2, 3], TATSUMI: [4, 5], UMAHITSUJI: [6, 7], SARUTORI: [8, 9], INUI: [10, 11] };
  var BRANCH_CHARS = '子丑寅卯辰巳午未申酉戌亥';

  /** 西暦の年の地支（0＝子。2020年＝子）。 */
  function branchOfYear(year) { return ((year - 4) % 12 + 12) % 12; }

  // 天中殺の年の1行の後ろに添える、月・日の天中殺の説明（2026-10-28 ガクさん承認）
  var TENCHU_MONTH_DAY_TEXT = '月運表・日運表の空亡の欄に「天中殺」とある月・日も、同じく空回りしやすい時期の目印です（総合の記号は運気の点数どおりに付けています）。';

  /** 天中殺の年の1行（空亡か年が読めなければ ''）。 */
  function buildTenchuYearText(kuubouKey, startYear) {
    var pair = Object.prototype.hasOwnProperty.call(KUUBOU_BRANCHES, kuubouKey) ? KUUBOU_BRANCHES[kuubouKey] : null;
    var year = parseInt(startYear, 10);
    if (!pair || isNaN(year)) return '';
    var head = 'あなたの天中殺は' + BRANCH_CHARS.charAt(pair[0]) + '年・' + BRANCH_CHARS.charAt(pair[1]) + '年です（年の区切りは立春）。';
    var branch = branchOfYear(year);
    if (branch === pair[0]) return head + '今年（' + year + '年）から' + (year + 1) + '年までの2年間がその時期にあたります。' + TENCHU_MONTH_DAY_TEXT;
    if (branch === pair[1]) return head + '今年（' + year + '年）は天中殺の2年目にあたります。' + TENCHU_MONTH_DAY_TEXT;
    var first = year + (pair[0] - branch + 12) % 12;
    return head + '次は' + first + '〜' + (first + 1) + '年で、今年（' + year + '年）は該当しません。' + TENCHU_MONTH_DAY_TEXT;
  }

  /** 文の1文目（「。」まで。なければ全文）。 */
  function firstSentence(text) {
    var match = String(text || '').match(/^[^。]*。/);
    return match ? match[0] : String(text || '');
  }

  /** 命式と運勢表（画面に出る行）に出た特殊星の [名前, 意味]（STAR_NOTES の順）。 */
  function collectStarNotes(table) {
    var found = {};
    var cells = [];
    table.getBlock(MEISHIKI_STAR_ROW, 1, MEISHIKI_STAR_COUNT, 5).forEach(function (row) { cells = cells.concat(row); });
    cells = cells.concat(VIEW.listFortuneCells(table));
    cells.forEach(function (cell) {
      String(cell === null || cell === undefined ? '' : cell).split(STAR_SPLIT).forEach(function (token) { if (token) found[token] = true; });
    });
    var sex = VIEW.readCommonInfo(table, '').sex;
    return STAR_NOTES.filter(function (note) { return found[note[0]]; }).map(function (note) {
      var sexNote = Object.prototype.hasOwnProperty.call(STAR_SEX_NOTES, note[0]) ? STAR_SEX_NOTES[note[0]] : null;
      return sexNote && sexNote[0] === sex ? [note[0], note[1] + sexNote[1]] : note;
    });
  }

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
    var tenchuYear = buildTenchuYearText(readKeyValue(keyMap, 'KUUBOU_TYPE_KEY'), VIEW.readStartYearFortune(table).year);
    return CHAPTERS.map(function (chapter) {
      return {
        title: chapter.title, tenchuYear: tenchuYear,
        summary: readKeyValue(keyMap, chapter.summaryKey),
        tip: chapter.tip,
        figures: buildChapterFigures(table, chapter),
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
   * editLabel は自分用の文章などで、どの文かを示す名前（「第1章｜性格と才能／あなたの傾向」）。options：
   *   isExtra：「本鑑定書の文字数」に数えない文（Web 版だけの文と本文の再掲）
   *   tone：PDF の字の形（'tip'＝小さめの灰色、'lead'＝大きめの太字、'terms'＝各行の「：」の前を太字。省いたら本文）　className：画面の class を足す
   */
  function buildEditableLines(text, editKey, editLabel, options) {
    var opts = options || {};
    var part = {
      type: 'lines', text: text, className: 'result-text report-text' + (opts.className ? ' ' + opts.className : ''),
      editKey: editKey, editLabel: editLabel
    };
    if (opts.isExtra) part.isExtra = true;
    if (opts.tone) part.tone = opts.tone;
    return part;
  }

  /** 書き直さない短い説明（キーワードの用語など）。PDF は小さめの灰色。 */
  function buildTipLine(text) {
    return { type: 'lines', text: text, className: 'result-text report-tip', tone: 'tip' };
  }

  function buildHeading(level, text) {
    return { type: 'heading', level: level, text: text, className: level >= 5 ? 'report-subheading' : 'report-heading' };
  }

  /**
   * 1つの章の項目（開閉の単位は章。key は report.ch<n>）：あなたの傾向 → 鑑定結果 → 鑑定の根拠（薄い色の枠。豆知識・図・主項目・副項目）。
   * 枠は部品 boxStart〜boxEnd で囲む（画面は div、PDF は塗りの四角。中の部品は今までどおり1列に並ぶ）。
   * 画面の見出しは h4（あなたの傾向・鑑定結果・鑑定の根拠）と h5（本文の題名）。
   * 書き直せるのは文（あなたの傾向・鑑定結果の本文・豆知識）だけ。表（診断結果・意味）は計算の結果のため書き直さない（docs/product-spec.md §4.1）
   */
  function buildChapterSection(chapter, index) {
    var source = CHAPTERS[index];
    // 要の一文（あなたの傾向）は章の色の線を左に付けた枠で目立たせる（段階3：案8）
    var parts = [
      { type: 'boxStart', className: 'report-key', tone: 'key', color: source.icon.color },
      buildHeading(4, 'あなたの傾向'),
      buildEditableLines(chapter.summary, source.summaryKey, chapter.title + '／あなたの傾向'),
      { type: 'boxEnd' },
      buildHeading(4, '鑑定結果')
    ];
    chapter.reports.forEach(function (report, i) {
      parts.push(buildHeading(5, report.title));
      if (source.reports[i][1] === TENCHU_REPORT_KEY && chapter.tenchuYear) {
        parts.push({ type: 'lines', text: chapter.tenchuYear, className: 'result-text report-text report-tenchu-year' });
      }
      parts.push(buildEditableLines(report.text, source.reports[i][1], chapter.title + '／' + report.title));
    });
    parts.push({ type: 'boxStart', className: 'report-basis' });
    parts.push(buildHeading(4, BASIS_HEADING));
    parts.push(buildEditableLines(chapter.tip, TIP_EDIT_KEY_PREFIX + (index + 1), chapter.title + '／豆知識',
      { isExtra: true, tone: 'tip', className: 'report-tip' }));
    chapter.figures.forEach(function (figure) { parts.push(figure); });
    if (source.markLegend) parts.push(buildTipLine(VIEW.SUMMARY_MARK_LEGEND));   // 総合ラベルの ◎○△注 の決まり
    parts.push({ type: 'table', headers: ['主項目', '診断結果', '意味'], rows: chapter.mainRows, className: 'is-report' });
    parts.push({ type: 'table', headers: ['副項目', '診断結果', '意味'], rows: chapter.subRows, className: 'is-report' });
    parts.push({ type: 'boxEnd' });
    return { key: 'report.ch' + (index + 1), title: chapter.title, icon: source.icon, closable: true, className: 'report-chapter', parts: parts };
  }

  /** 今年の運気の文：「2026年の運気：…（運気の点数 62）」と「いまの10年（大運）：…」。 */
  function buildGlanceFortuneText(keyMap, fortune) {
    var yearLabel = formatResultLabel(keyMap, 'YEAR_SUMMARY_LABEL') || '-';
    var decadeLabel = formatResultLabel(keyMap, 'DECADE_SUMMARY_LABEL') || '-';
    var head = fortune.year ? fortune.year + '年の運気：' : '今年の運気：';
    var score = fortune.score ? '（運気の点数 ' + fortune.score + '）' : '';
    return head + yearLabel + score + '\nいまの10年（大運）：' + decadeLabel;
  }

  /**
   * 1ページ目「ひと目でわかるあなた」（一言・キーワード3つ・今年の運気）。一言は第1章「あなたの傾向」の再掲（同じキー）。
   * 今年は鑑定開始年（年運表の1行目と同じ年。view_fortune.js の readStartYearFortune）
   */
  function buildGlanceSection(table, chapters) {
    var keyMap = table.buildKeyMap();
    var title = GLANCE.title;
    var keywords = GLANCE.keywordItems.map(function (item) { return formatResultLabel(keyMap, item[1]) || '-'; });
    var terms = GLANCE.keywordItems.map(function (item) { return item[0]; });
    return {
      key: GLANCE.key, title: title, closable: true, className: 'report-extra report-glance', parts: [
        buildHeading(4, 'あなたを一言で'),
        buildEditableLines(chapters[0].summary, CHAPTERS[0].summaryKey, title + '／一言', { isExtra: true }),
        buildHeading(4, 'キーワード'),
        buildTipLine(terms.join(KEYWORD_SEPARATOR)),
        buildEditableLines(keywords.join(KEYWORD_SEPARATOR), GLANCE.keywordEditKey, title + '／キーワード',
          { isExtra: true, tone: 'lead', className: 'report-keywords' }),
        buildHeading(4, '今年の運気'),
        buildEditableLines(buildGlanceFortuneText(keyMap, VIEW.readStartYearFortune(table)), GLANCE.fortuneEditKey, title + '／今年の運気',
          { isExtra: true })
      ]
    };
  }

  /**
   * 巻末の用語ミニ辞典（1つの書き直せる文。1行目に断り、続けてまとまりごとに空の行・見出し（■）・「用語：意味」を1行ずつ）。
   * 最後に、この鑑定書に出た特殊星のまとまり（前置きの1行のあと。出た星がなければ載せない）
   */
  function buildGlossarySection(table) {
    var lines = [GLOSSARY.lead];
    GLOSSARY.groups.forEach(function (group) {
      lines.push('', GLOSSARY_GROUP_MARK + group[0]);
      group[1].forEach(function (entry) { lines.push(entry[0] + '：' + entry[1]); });
    });
    var stars = collectStarNotes(table);
    if (stars.length) {
      lines.push('', GLOSSARY_GROUP_MARK + STAR_GROUP_TITLE, STAR_GROUP_LEAD);
      stars.forEach(function (note) { lines.push(note[0] + '：' + note[1]); });
    }
    var text = lines.join('\n');
    return {
      key: GLOSSARY.key, title: GLOSSARY.title, closable: true, className: 'report-extra report-glossary', parts: [
        // 用語は太字（「用語：意味」の「：」の前。画面は has-terms、PDF は tone 'terms'。段階3）
        buildEditableLines(text, GLOSSARY.editKey, GLOSSARY.title, { isExtra: true, tone: 'terms', className: 'report-glossary-text has-terms' })
      ]
    };
  }

  /** 最後のページ「今日からできること」（本文の1文目。本文とは別の文として書き直せる。字数に数えない）。 */
  function buildTodaySection(table) {
    var keyMap = table.buildKeyMap();
    var parts = [];
    TODAY.items.forEach(function (item) {
      parts.push(buildHeading(5, item[0]));
      parts.push(buildEditableLines(firstSentence(readKeyValue(keyMap, item[1])), TODAY.editKeyPrefix + item[1],
        TODAY.title + '／' + item[0], { isExtra: true }));
    });
    return { key: TODAY.key, title: TODAY.title, closable: true, className: 'report-extra report-today', parts: parts };
  }

  /** 鑑定書の項目：ひと目でわかるあなた → 8章 → 用語ミニ辞典 → 今日からできること。鑑定情報は含めない。 */
  function buildReportSections(table) {
    var chapters = buildReport(table);
    return [buildGlanceSection(table, chapters)]
      .concat(chapters.map(buildChapterSection))
      .concat([buildGlossarySection(table), buildTodaySection(table)]);
  }

  /** 鑑定書を container に書く。name は送った時点の氏名。 */
  function renderReport(container, table, name) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(VIEW.readCommonInfo(table, name))].concat(buildReportSections(table)));
  }

  VIEW.REPORT_GLANCE_KEY = GLANCE.key;
  VIEW.REPORT_TODAY_KEY = TODAY.key;
  VIEW.buildReport = buildReport;
  VIEW.buildReportSections = buildReportSections;
  VIEW.renderReport = renderReport;
})();
