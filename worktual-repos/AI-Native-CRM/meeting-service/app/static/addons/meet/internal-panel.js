/**
 * Internal meeting panel: an answer for the employee, or a fact check for a
 * manager. Recommendation and Next Best action are not part of this view.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorktualInternalPanel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function factLabel(verdict) {
    if (verdict === "matches") return "That checks out.";
    if (verdict === "differs") return "That doesn’t line up with the CRM.";
    return "I couldn’t verify that from the CRM.";
  }

  function view(result) {
    if (!result || result.internal !== true) return null;
    var manager = result.audience === "manager";
    var detail = result.factDetail ? String(result.factDetail).trim() : "";
    var answer = result.answer ? String(result.answer).trim() : "";
    var body = manager
      ? [factLabel(result.factVerdict), detail].filter(Boolean).join(" ")
      : answer;
    return {
      hideRecommendation: true,
      hideNextBest: true,
      title: manager ? "Quick check" : "Here’s a way to answer",
      body: body,
      heard: result.heardLine ? String(result.heardLine).trim() : "",
    };
  }

  return { view: view, factLabel: factLabel };
});
