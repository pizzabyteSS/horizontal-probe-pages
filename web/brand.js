// ============================================================
// web/src/brand.js — 屋号・ロゴ・色（段階3a-4）
// 設計：docs/web-pdf-plan.md §5 の 3a-4・§4.2
//   鑑定者の屋号・ロゴ・色を、端末（ブラウザ）の設定として1つ残す（hzWeb.brand。お客さんの情報ではない）
//   鑑定書の PDF・画像の各ページの上、画面の鑑定結果の上、印刷の上に出す。色は見出しと区切りの線に使う
//   色は読みやすさを確かめた候補から選ぶ（白地の文字で明るさの比 4.5 以上。web_screen_test.js で確かめる）
//   ロゴは選んだ画像を縮めて PNG（大きすぎれば JPEG）にして残す。サーバーには送らない
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  var BRAND_STORAGE_KEY = 'hzWeb.brand';
  var BRAND_VERSION = 1;
  var BRAND_NAME_MAX = 40;              // 屋号の字数の上限（PDF の上の枠に収める。長いと「…」で縮める）
  var LOGO_MAX_WIDTH = 600;             // ロゴを残す大きさの上限（PDF では高さ 72 ピクセルで描く）
  var LOGO_MAX_HEIGHT = 240;
  var LOGO_MAX_DATA_URL_LENGTH = 700000;   // 残すロゴの上限（端末の保存の容量を作業中の鑑定と分け合うため）
  var LOGO_JPEG_QUALITY = 0.9;
  // iPhone の写真（HEIC・HEIF）も受け付ける。読めるかはブラウザしだい（Safari は読める。読めなければ理由 decode）
  var LOGO_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
  var LOGO_FILE_EXTENSIONS = /\.(png|jpe?g|webp|heic|heif)$/i;   // 種類が空で渡されたとき（HEIC で起きる）は名前で見る
  var LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

  // 色の候補（id は保存する値。value が空の「既定」は、今までの色のまま）。名前はふだんの言葉にする（2026-10-21 ガクさん）
  var BRAND_COLORS = [
    { id: '', label: '既定（青）', value: '' },
    { id: 'sumi', label: '黒', value: '#1f2328' },
    { id: 'ai', label: '青', value: '#1f4e8c' },
    { id: 'kon', label: '紺', value: '#23395d' },
    { id: 'midori', label: '緑', value: '#1f6b45' },
    { id: 'enji', label: 'ワインレッド', value: '#8e1f3a' },
    { id: 'murasaki', label: '紫', value: '#5a3d8c' },
    { id: 'cha', label: '茶色', value: '#7a4a1e' },
    { id: 'kincha', label: 'ゴールド', value: '#8a6200' }
  ];
  // 屋号の書体（端末にある書体だけを使う。外から読み込まない）。id は保存する値
  var BRAND_FONTS = [
    { id: '', label: 'ゴシック体（既定）', family: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif' },
    { id: 'mincho', label: '明朝体', family: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", serif' },
    { id: 'maru', label: '丸ゴシック体', family: '"Hiragino Maru Gothic ProN", "Zen Maru Gothic", "Kosugi Maru", "Hiragino Sans", sans-serif' }
  ];

  var LOGO_ERROR_MESSAGES = {
    type: 'PNG・JPEG・WebP・HEIC の画像を選んでください',
    decode: '画像を読めませんでした（このブラウザで読めない形式かもしれません）。PNG か JPEG の画像を選んでください',
    canvas: 'この端末では画像を縮められませんでした',
    size: '画像が大きすぎて残せません。もっと小さい画像を選んでください'
  };

  /** エラーに理由の記号を付ける。 */
  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function createEmptyBrand() { return { name: '', color: '', font: '', logo: null }; }

  function findFont(id) {
    for (var i = 0; i < BRAND_FONTS.length; i++) if (BRAND_FONTS[i].id === id) return BRAND_FONTS[i];
    return null;
  }

  /** 書体の id から書体の指定（知らない id は既定）。 */
  function readBrandFontFamily(id) { return (findFont(id) || BRAND_FONTS[0]).family; }

  function findColor(id) {
    for (var i = 0; i < BRAND_COLORS.length; i++) if (BRAND_COLORS[i].id === id) return BRAND_COLORS[i];
    return null;
  }

  /** 色の id から色の値（既定・知らない id は ''）。 */
  function readBrandColorValue(id) {
    var color = findColor(id);
    return color ? color.value : '';
  }

  /** 屋号を1行にして上限の字数に切る（字は見た目の1字ずつ数える）。 */
  function normalizeBrandName(text) {
    var oneLine = String(text === undefined || text === null ? '' : text).replace(/[\r\n\t]+/g, ' ').trim();
    return Array.from(oneLine).slice(0, BRAND_NAME_MAX).join('');
  }

  function isPositiveInt(value, max) { return typeof value === 'number' && value % 1 === 0 && value >= 1 && value <= max; }

  function isValidLogo(logo) {
    return !!logo && typeof logo.dataUrl === 'string' && logo.dataUrl.length <= LOGO_MAX_DATA_URL_LENGTH &&
      LOGO_DATA_URL_PATTERN.test(logo.dataUrl) && isPositiveInt(logo.width, LOGO_MAX_WIDTH) && isPositiveInt(logo.height, LOGO_MAX_HEIGHT);
  }

  /** 端末に残した設定（読めない・違う版・壊れた中身は既定）。 */
  function readBrand() {
    var text = null;
    try { text = localStorage.getItem(BRAND_STORAGE_KEY); } catch (e) { return createEmptyBrand(); }
    if (!text) return createEmptyBrand();
    var saved;
    try { saved = JSON.parse(text); } catch (e) { return createEmptyBrand(); }
    if (!saved || saved.v !== BRAND_VERSION) return createEmptyBrand();
    return {
      name: typeof saved.name === 'string' ? normalizeBrandName(saved.name) : '',
      color: typeof saved.color === 'string' && findColor(saved.color) ? saved.color : '',
      font: typeof saved.font === 'string' && findFont(saved.font) ? saved.font : '',   // 書体は後から足した（なければ既定）
      logo: isValidLogo(saved.logo) ? { dataUrl: saved.logo.dataUrl, width: saved.logo.width, height: saved.logo.height } : null
    };
  }

  /** 設定を端末に残す。すべて既定なら消す。残せたら true。 */
  function writeBrand(brand) {
    try {
      if (!brand.name && !brand.color && !brand.font && !brand.logo) {
        localStorage.removeItem(BRAND_STORAGE_KEY);
        return true;
      }
      localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ v: BRAND_VERSION, name: brand.name, color: brand.color, font: brand.font || '', logo: brand.logo }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** ロゴを残す大きさ（縦横の比を保って上限に収める。大きくはしない）。 */
  function fitLogoSize(width, height) {
    var scale = Math.min(1, LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  /** データ URL から画像を読む。返す値：Promise<読み込んだ画像>。読めなければ理由 failCode。 */
  function loadImageFromUrl(url, failCode) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(createError(failCode, '画像を読めませんでした')); };
      image.src = url;
    });
  }

  /** ロゴとして受け付けるファイルか（種類、種類が空なら名前の拡張子で見る）。 */
  function isLogoFile(file) {
    if (!file) return false;
    if (file.type) return LOGO_FILE_TYPES.indexOf(String(file.type).toLowerCase()) >= 0;
    return LOGO_FILE_EXTENSIONS.test(String(file.name || ''));
  }

  /** 選んだファイルを読み、縮めた PNG（大きすぎれば白地の JPEG）にする。返す値：Promise<{ dataUrl, width, height }>。 */
  function prepareLogoFile(file) {
    if (!isLogoFile(file)) return Promise.reject(createError('type', LOGO_ERROR_MESSAGES.type));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(createError('decode', LOGO_ERROR_MESSAGES.decode)); };
      reader.readAsDataURL(file);
    }).then(function (url) {
      return loadImageFromUrl(url, 'decode');
    }).then(function (image) {
      if (!image.naturalWidth || !image.naturalHeight) throw createError('decode', LOGO_ERROR_MESSAGES.decode);
      var size = fitLogoSize(image.naturalWidth, image.naturalHeight);
      var canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw createError('canvas', LOGO_ERROR_MESSAGES.canvas);
      ctx.drawImage(image, 0, 0, size.width, size.height);
      var dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > LOGO_MAX_DATA_URL_LENGTH) {
        // 写真のような画像は PNG が大きくなるため、白地に置いて JPEG にする
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        dataUrl = canvas.toDataURL('image/jpeg', LOGO_JPEG_QUALITY);
      }
      canvas.width = 1;
      canvas.height = 1;   // 解放する
      var logo = { dataUrl: dataUrl, width: size.width, height: size.height };
      if (!isValidLogo(logo)) throw createError('size', LOGO_ERROR_MESSAGES.size);
      return logo;
    });
  }

  /** PDF・画像に描くためにロゴを読む（読めなければ理由 logo）。 */
  function loadLogoImage(dataUrl) { return loadImageFromUrl(dataUrl, 'logo'); }

  /**
   * 「屋号・ロゴ・色」の欄と、鑑定結果の上の屋号の帯。返す値：{ getBrand }。
   * deps.onChanged()：設定が変わった（この画面で変えた・別のタブで変わった。作った鑑定書は前の設定のため捨てる）
   * 入力するたびに端末に残す。別のタブで変わったら読み直す（設定のため、後から書いたほうが残る）
   */
  function createBrandPanel(deps) {
    var brand = readBrand();
    var logoGeneration = 0;   // ロゴを選んだ・外した回数（前に選んだ画像の処理が後から終わっても当てない。Codex P2）

    function byId(id) { return document.getElementById(id); }

    function renderMessage(text, isError) {
      var el = byId('outBrandMessage');
      el.textContent = text;
      el.className = 'message' + (text ? (isError ? ' is-ng' : ' is-ok') : '');
    }

    /** 画面に当てる：帯・色・欄の中身。 */
    function render(withInputs) {
      var color = readBrandColorValue(brand.color);
      // 色を決めたときだけ data-brand-color を付ける（画面の上の帯・表の見出しの背景は、色を決めたときだけ塗る。app.css）
      if (color) {
        document.documentElement.style.setProperty('--color-brand', color);
        document.documentElement.setAttribute('data-brand-color', '');
      } else {
        document.documentElement.style.removeProperty('--color-brand');
        document.documentElement.removeAttribute('data-brand-color');
      }
      byId('outBrandBar').hidden = !brand.name && !brand.logo;
      byId('outBrandBarName').textContent = brand.name;
      setLogoImage(byId('imgBrandBarLogo'));
      setLogoImage(byId('imgBrandLogoPreview'));
      byId('btnBrandLogoClear').hidden = !brand.logo;
      // 屋号の書体（画面の鑑定書の帯・見本）
      var family = readBrandFontFamily(brand.font);
      byId('outBrandBarName').style.fontFamily = family;
      // 同じ画面の見本（鑑定書の頭・見出し・表の見出し。色は --color-brand で当たる）
      byId('outBrandSampleName').textContent = brand.name || '（屋号は未設定）';
      byId('outBrandSampleName').style.fontFamily = family;
      setLogoImage(byId('imgBrandSampleLogo'));
      if (withInputs) {
        byId('inpBrandName').value = brand.name;
        byId('selBrandColor').value = brand.color;
        byId('selBrandFont').value = brand.font || '';
      }
    }

    function setLogoImage(img) {
      img.hidden = !brand.logo;
      if (brand.logo) img.src = brand.logo.dataUrl;
      else img.removeAttribute('src');
    }

    /** 変えた設定を残して当てる。 */
    function update(change) {
      brand = Object.assign({}, brand, change);
      var saved = writeBrand(brand);
      render(false);
      deps.onChanged();
      renderMessage(saved ? '' : '端末に残せませんでした（ブラウザの設定や容量のため）。この画面を閉じるまでは使えます', !saved);
    }

    function handleLogoChange() {
      var input = byId('inpBrandLogo');
      var file = input.files && input.files[0];
      input.value = '';   // 同じ画像を選び直せるように
      if (!file) return;
      var generation = ++logoGeneration;
      renderMessage('ロゴを読んでいます…', false);
      VIEW.prepareLogoFile(file).then(function (logo) {
        if (generation !== logoGeneration) return;   // あとで別の画像を選んだ・外した
        update({ logo: logo });
        if (byId('outBrandMessage').className.indexOf('is-ng') < 0) renderMessage('ロゴを入れました', false);
      }, function (error) {
        if (generation !== logoGeneration) return;
        renderMessage(LOGO_ERROR_MESSAGES[error && error.code] || LOGO_ERROR_MESSAGES.decode, true);
      });
    }

    function handleStorageChange(event) {
      if (event.key !== null && event.key !== BRAND_STORAGE_KEY) return;
      brand = readBrand();
      render(true);
      deps.onChanged();
    }

    var select = byId('selBrandColor');
    BRAND_COLORS.forEach(function (color) {
      var option = document.createElement('option');
      option.value = color.id;
      option.textContent = color.label;
      select.appendChild(option);
    });
    var fontSelect = byId('selBrandFont');
    BRAND_FONTS.forEach(function (font) {
      var option = document.createElement('option');
      option.value = font.id;
      option.textContent = font.label;
      fontSelect.appendChild(option);
    });
    fontSelect.addEventListener('change', function () { update({ font: findFont(fontSelect.value) ? fontSelect.value : '' }); });
    byId('inpBrandName').addEventListener('input', function () { update({ name: normalizeBrandName(byId('inpBrandName').value) }); });
    select.addEventListener('change', function () { update({ color: findColor(select.value) ? select.value : '' }); });
    byId('inpBrandLogo').addEventListener('change', handleLogoChange);
    byId('btnBrandLogoClear').addEventListener('click', function () {
      logoGeneration++;   // 読んでいる途中の画像も当てない
      update({ logo: null });
    });
    window.addEventListener('storage', handleStorageChange);
    render(true);

    return {
      /** PDF・画像に載せる設定（{ name, color: 色の値, logo }）。 */
      getBrand: function () {
        return { name: brand.name, color: readBrandColorValue(brand.color), fontFamily: brand.font ? readBrandFontFamily(brand.font) : '', logo: brand.logo };
      }
    };
  }

  VIEW.BRAND_STORAGE_KEY = BRAND_STORAGE_KEY;
  VIEW.BRAND_COLORS = BRAND_COLORS;
  VIEW.BRAND_FONTS = BRAND_FONTS;
  VIEW.readBrand = readBrand;
  VIEW.writeBrand = writeBrand;
  VIEW.fitLogoSize = fitLogoSize;
  VIEW.isLogoFile = isLogoFile;
  VIEW.prepareLogoFile = prepareLogoFile;
  VIEW.loadLogoImage = loadLogoImage;
  VIEW.createBrandPanel = createBrandPanel;
})();
