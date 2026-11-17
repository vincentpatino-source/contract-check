// Lead form for state pages (same Tally form as the main page).
(function () {
  var FORM = "M1N2EX";
  function open(entry) {
    var fields = { source: "mcadebtcalculator", entry_point: entry };
    if (window.Tally && typeof window.Tally.openPopup === "function") {
      window.Tally.openPopup(FORM, { layout: "modal", width: 560, hiddenFields: fields });
    } else {
      var q = Object.keys(fields).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]); }).join("&");
      window.open("https://tally.so/r/" + FORM + "?" + q, "_blank", "noopener");
    }
  }
  document.querySelectorAll("[data-lead]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.preventDefault(); open(b.getAttribute("data-lead")); });
  });
})();
