// Optional GA4 measures public pages only after the visitor opts in.
let measurementId = null, started = false, consent = null, lastPage = null;
const publicRoute = () => {
  const route = (location.hash.slice(1) || "/").split("?")[0];
  return /^\/(?:services|store|ready-websites|about|launch-offer)?$/.test(route) || /^\/service\/[a-z-]+$/.test(route) ? route : null;
};
try { consent = localStorage.getItem("antlaqh-analytics-consent"); } catch {}
function pageView() {
  const route = publicRoute();
  if (!started || consent !== "accepted" || !route || route === lastPage) return;
  lastPage = route;
  window.gtag("event", "page_view", {
    page_title: "انطلاقة · " + route,
    page_location: location.origin + "/#" + route,
    page_referrer: "",
  });
}
function start() {
  if (started || !measurementId || consent !== "accepted" || !publicRoute()) return;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: location.origin + "/", page_referrer: "" });
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.append(script);
  pageView();
}
function choices(force = false) {
  if (!measurementId || (!force && (consent || !publicRoute()))) return;
  document.querySelector("#analytics-choice")?.remove();
  const panel = document.createElement("section");
  panel.id = "analytics-choice";
  panel.className = "analytics-choice";
  panel.setAttribute("aria-label", "خيارات قياس الزيارات");
  panel.innerHTML = '<div><strong>نساعد انطلاقة على فهم الزيارات؟</strong><p>قياس اختياري لصفحات الخدمات العامة عبر Google Analytics. لا نرسل بيانات الحسابات أو الطلبات أو الملفات. يمكنك الرفض أو تغيير الاختيار من أسفل الموقع.</p><a href="#/privacy">سياسة الخصوصية</a></div><div class="actions"><button class="btn" data-analytics="accepted">أوافق على القياس</button><button class="btn secondary" data-analytics="rejected">رفض القياس</button></div>';
  document.body.append(panel);
}
document.addEventListener("click", event => {
  const button = event.target.closest("[data-analytics]");
  if (button) {
    consent = button.dataset.analytics;
    try { localStorage.setItem("antlaqh-analytics-consent", consent); } catch {}
    document.querySelector("#analytics-choice")?.remove();
    window["ga-disable-" + measurementId] = consent !== "accepted";
    if (started) window.gtag("consent", "update", { analytics_storage: consent === "accepted" ? "granted" : "denied" });
    if (consent === "accepted") { lastPage = null; start(); pageView(); }
    return;
  }
  if (event.target.closest("[data-analytics-settings]")) choices(true);
});
window.addEventListener("hashchange", () => {
  if (measurementId) window["ga-disable-" + measurementId] = consent !== "accepted" || !publicRoute();
  choices(); start(); pageView();
});
try {
  const response = await fetch("/api/config", { credentials: "omit" });
  if (response.ok) {
    const config = await response.json();
    measurementId = config.integrations?.ga4MeasurementId || null;
    if (measurementId) { choices(); start(); }
  }
} catch { /* Optional measurement must never prevent the site from loading. */ }
