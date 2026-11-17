// Google Analytics (GA4) and lead tracking for every DebtMedx page.
(function () {
  var ID = "G-MEF4RNB187";
  if (!/^G-[A-Z0-9]+$/.test(ID) || ID === "G-XXXXXXXXXX") { window.dmxTrack = function () {}; return; }
  var s = document.createElement("script");
  s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", ID);

  var page = location.pathname;
  window.dmxTrack = function (name, params) {
    try { gtag("event", name, Object.assign({ page_path: page }, params || {})); } catch (e) {}
  };

  // Phone taps
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href^='tel:']");
    if (a) window.dmxTrack("phone_call", { method: "phone" });
    var b = e.target.closest && e.target.closest("[data-lead]");
    if (b) window.dmxTrack("lead_form_open", { entry_point: b.getAttribute("data-lead") });
  }, true);

  // Tally consultation form submitted (popup or embed)
  var sent = false;
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch (x) { return; } }
    if (d && d.event === "Tally.FormSubmitted" && !sent) {
      sent = true;
      window.dmxTrack("generate_lead", { method: "consultation_form" });
      setTimeout(function () { sent = false; }, 3000);
    }
  });
})();
