// ============================================================
// web/src/view_result.js — 鑑定結果の項目のまとまり（段階3a-2）
// 設計：docs/web-pdf-plan.md §4.5、docs/product-spec.md §4.1
//   1回の鑑定の結果を、画面に並べる順に項目の一覧にする。画面・PDF・画像・印刷・自分用の文章はこの一覧だけを読む
//   （同じ中身から作るため、形式によって中身が変わらない）
//   開閉の単位：命式詳細は見出しのまとまり、運勢表は表ごと、鑑定書は章ごと。鑑定情報は閉じられない
// 書き方の決まり：web/README.md
// ============================================================
(function () {
  'use strict';

  var VIEW = window.HZ_WEB_VIEW = window.HZ_WEB_VIEW || {};

  // 画面に並べる順（app.js の RESULT_GROUPS と同じ）。PDF・印刷・自分用の文章もこの順に並べる
  var RESULT_KINDS = ['meishiki', 'taiun', 'nenun', 'getsuun', 'nichiun', 'report'];

  /**
   * 鑑定結果の項目のまとまり。table は仮想の _data、name は送った時点の氏名、now はミニ年運の「今年」を決める時刻。
   * 返す値：{ info: 鑑定情報, groups: [{ kind, sections: [項目] }] }（鑑定情報の項目は groups に含めない）
   */
  function buildResultModel(table, name, now) {
    var groups = RESULT_KINDS.map(function (kind) {
      var sections;
      if (kind === 'meishiki') sections = VIEW.buildMeishikiSections(table, now);
      else if (kind === 'report') sections = VIEW.buildReportSections(table);
      else sections = [VIEW.buildFortuneSection(table, kind)];
      return { kind: kind, sections: sections };
    });
    return { info: VIEW.readCommonInfo(table, name), groups: groups };
  }

  /** 鑑定情報を container に書く（画面では結果の先頭に1回だけ出す）。 */
  function renderResultInfo(container, model) {
    VIEW.renderSections(container, [VIEW.buildInfoSection(model.info)]);
  }

  /** kind のまとまり（命式詳細・運勢表・鑑定書）の中身を container に書く（鑑定情報は renderResultInfo）。 */
  function renderResultGroup(container, model, kind) {
    var group = findGroup(model, kind);
    VIEW.renderSections(container, group ? group.sections : []);
  }

  function findGroup(model, kind) {
    for (var i = 0; i < model.groups.length; i++) if (model.groups[i].kind === kind) return model.groups[i];
    return null;
  }

  /** 開いている項目（閉じられない項目を含む）を、画面の順に1列に並べる。closedKeys は { key: true }。鑑定情報は含めない。 */
  function listOpenSections(model, closedKeys) {
    var out = [];
    model.groups.forEach(function (group) {
      group.sections.forEach(function (section) {
        if (!section.closable || !closedKeys[section.key]) out.push(section);
      });
    });
    return out;
  }

  /** すべての項目（閉じた項目を含む）を、画面の順に1列に並べる。鑑定情報は含めない（自分に送る文章は常に全体。2026-10-21）。 */
  function listAllSections(model) {
    var out = [];
    model.groups.forEach(function (group) { out = out.concat(group.sections); });
    return out;
  }

  VIEW.RESULT_KINDS = RESULT_KINDS;
  VIEW.listAllSections = listAllSections;
  VIEW.buildResultModel = buildResultModel;
  VIEW.renderResultInfo = renderResultInfo;
  VIEW.renderResultGroup = renderResultGroup;
  VIEW.listOpenSections = listOpenSections;
})();
