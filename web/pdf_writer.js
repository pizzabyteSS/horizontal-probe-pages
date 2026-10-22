// ============================================================
// web/src/pdf_writer.js — ページの JPEG を貼った PDF を書き出す（段階3a-1）
// 設計：docs/web-pdf-plan.md §4.4
//   PDF の仕組みのうち、カタログ・ページ・JPEG の画像（DCTDecode）・ページの中身・相互参照表だけを使う
//   JPEG はそのまま埋め込む（作り直さない）。画像の幅・高さ・色の数は JPEG の中から読む
//   名前などの文字は PDF の情報（Info）に入れない（中身は絵だけ）
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // JPEG の SOF（フレームの始め）。幅・高さ・色の数が入っている
  var SOF_MARKERS = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];
  var COLOR_SPACE_BY_COMPONENTS = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' };

  /** JPEG の幅・高さ・色の数を読む。JPEG でなければ例外。 */
  function readJpegInfo(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw VIEW.createPdfError('encode', 'JPEG ではありません');
    var i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var marker = bytes[i + 1];
      if (marker === 0xFF) { i++; continue; }
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      var length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (SOF_MARKERS.indexOf(marker) >= 0) {
        var info = {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          components: bytes[i + 9]
        };
        if (!COLOR_SPACE_BY_COMPONENTS[info.components]) throw VIEW.createPdfError('encode', 'JPEG の色の数に対応していません');
        return info;
      }
      if (marker === 0xDA || marker === 0xD9) break;   // 画像のデータに入った・終わり（SOF がなかった）
      i += 2 + length;
    }
    throw VIEW.createPdfError('encode', 'JPEG の大きさが読めません');
  }

  /** ASCII の文字をバイト列にする（PDF の辞書と相互参照表は ASCII だけで書く）。 */
  function toAsciiBytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7F;
    return bytes;
  }

  function formatNumber(value) { return String(Math.round(value * 100) / 100); }

  function padOffset(offset) {
    var text = String(offset);
    while (text.length < 10) text = '0' + text;
    return text;
  }

  /**
   * ページの JPEG から PDF を作る。images は [{ bytes: Uint8Array }]（1枚が1ページ）。
   * 各ページの大きさは pageWidthPt×pageHeightPt（ポイント）で、絵をページ全体に広げる。返す値は Uint8Array。
   * 画像に widthPt・heightPt があればそのページはその大きさ（運勢表の横向きのページ。2026-10-21）
   */
  function buildPdfFromJpegs(images, pageWidthPt, pageHeightPt) {
    if (!images.length) throw VIEW.createPdfError('encode', 'ページがありません');
    var chunks = [];
    var size = 0;
    var offsets = [];
    var push = function (bytes) { chunks.push(bytes); size += bytes.length; };
    var pushText = function (text) { push(toAsciiBytes(text)); };
    var beginObject = function (number) { offsets[number] = size; pushText(number + ' 0 obj\n'); };

    // 1：カタログ　2：ページの一覧　ページごとに 3 から順に［ページ・中身・画像］
    var pageCount = images.length;
    var pageNumbers = [];
    for (var p = 0; p < pageCount; p++) pageNumbers.push(3 + p * 3);

    pushText('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // バイナリを含む印（PDF の慣習）
    beginObject(1);
    pushText('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    beginObject(2);
    pushText('<< /Type /Pages /Count ' + pageCount + ' /Kids [' + pageNumbers.map(function (n) { return n + ' 0 R'; }).join(' ') + '] >>\nendobj\n');

    images.forEach(function (image, index) {
      var info = readJpegInfo(image.bytes);
      var pageNo = pageNumbers[index];
      var contentNo = pageNo + 1;
      var imageNo = pageNo + 2;
      var width = formatNumber(image.widthPt || pageWidthPt);
      var height = formatNumber(image.heightPt || pageHeightPt);
      var content = 'q ' + width + ' 0 0 ' + height + ' 0 0 cm /Im0 Do Q\n';
      beginObject(pageNo);
      pushText('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height + '] /Resources << /XObject << /Im0 ' + imageNo + ' 0 R >> >> /Contents ' + contentNo + ' 0 R >>\nendobj\n');
      beginObject(contentNo);
      pushText('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
      beginObject(imageNo);
      pushText('<< /Type /XObject /Subtype /Image /Width ' + info.width + ' /Height ' + info.height +
        ' /ColorSpace ' + COLOR_SPACE_BY_COMPONENTS[info.components] + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.bytes.length + ' >>\nstream\n');
      push(image.bytes);
      pushText('\nendstream\nendobj\n');
    });

    var objectCount = 2 + pageCount * 3;
    var xrefOffset = size;
    var xref = 'xref\n0 ' + (objectCount + 1) + '\n0000000000 65535 f \n';
    for (var n = 1; n <= objectCount; n++) xref += padOffset(offsets[n]) + ' 00000 n \n';
    pushText(xref + 'trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    var out = new Uint8Array(size);
    var at = 0;
    chunks.forEach(function (chunk) { out.set(chunk, at); at += chunk.length; });
    return out;
  }

  VIEW.readJpegInfo = readJpegInfo;
  VIEW.buildPdfFromJpegs = buildPdfFromJpegs;
})();
