const $ = (s) => document.querySelector(s);
const main = $("#main");
const state = {
  user: null,
  csrf: "",
  config: null,
  sequence: 0,
  challenge: null,
  loginChallenge: null,
  ready: false,
  loading: null,
  recoveryChallenge: null,
  recoveryChannel: null,
  recoveryMessage: "",
  resetToken: "",
  resetExpiresAt: 0,
  recoveryOperation: 0,
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const E = escape;
const money = (value) =>
  new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 2,
  }).format((value || 0) / 100);
const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("ar-SA", {
        calendar: "gregory",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const time = (value) =>
  value
    ? new Date(value).toLocaleString("ar-SA", {
        calendar: "gregory",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
const paths = {
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18",
  bag: "M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20",
  chart: "M4 4v16h17M8 15l4-5 4 3 5-7",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  check: "m5 12 4 4L19 6",
  grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  file: "M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8m-8 4h6",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
  message: "M21 4H3v13h5l4 4 4-4h5V4Z",
  bell: "M5 17V9a7 7 0 0 1 14 0v8l2 2H3l2-2Zm5 5h4",
  logout: "M10 3H4v18h6m4-14 5 5-5 5m-5-5h10",
  menu: "M3 6h18M3 12h18M3 18h18",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2",
  lock: "M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4",
  plus: "M12 4v16M4 12h16",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6",
  arrow: "M19 12H5m6-6-6 6 6 6",
  diamond: "m12 2 10 10-10 10L2 12 12 2Zm0 0v20M2 12h20",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const statuses = {
  received: "تم الاستلام",
  reviewing: "قيد المراجعة",
  quoted: "بانتظار موافقتك",
  awaiting_payment: "بانتظار الدفع",
  paid: "تم تأكيد الدفع",
  in_progress: "قيد التنفيذ",
  final_review: "المراجعة النهائية",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const badge = (o) =>
  `<span class="badge ${E(o.status)}">${E(statuses[o.status] || o.status)}</span>`;
const link = (href, label, kind = "") =>
  `<a class="btn ${kind}" href="#${href}">${label}</a>`;
let fieldCounter = 0;
const field = (name, label, type = "text", opts = "") => {
  const inputId = `${name}-${++fieldCounter}`;
  return `<div class="field"><label for="${inputId}">${label}</label><input id="${inputId}" name="${name}" type="${type}" ${opts}></div>`;
};
const textarea = (name, label, opts = "") => {
  const inputId = `${name}-${++fieldCounter}`;
  return `<div class="field"><label for="${inputId}">${label}</label><textarea id="${inputId}" name="${name}" ${opts}></textarea></div>`;
};
const errors = () => '<div class="error" role="alert"></div>';
function whatsappLink(label = "راسل انطلاقة على WhatsApp", className = "btn secondary") {
  const phone = state.config?.channels?.whatsapp?.phone || "966553575760";
  if (!/^\d{8,15}$/.test(phone)) return "";
  const greeting = encodeURIComponent("مرحبًا انطلاقة، أود الاستفسار عن خدماتكم ومتابعة مشروعي.");
  return `<a class="${E(className)}" href="https://wa.me/${phone}?text=${greeting}" target="_blank" rel="noopener noreferrer">${icon("message")}${E(label)}</a>`;
}
function contractField(name, label, value = "", attributes = "", multiline = false) {
  const inputId = `contract-${name}-${++fieldCounter}`;
  return `<div class="field"><label for="${inputId}">${E(label)}</label>${multiline
    ? `<textarea id="${inputId}" name="${name}" ${attributes}>${E(value)}</textarea>`
    : `<input id="${inputId}" name="${name}" value="${E(value)}" ${attributes}>`}</div>`;
}
function quoteForm(o, q) {
  const d = q?.document?.details || {}, p = d.provider || o.contractProvider || {};
  const textField = (name,label,value="",min=10,max=3000) => contractField(name,label,value,`required minlength="${min}" maxlength="${max}"`,true);
  return `<section class="panel"><h2>${q ? "إصدار عقد جديد" : "إعداد عرض السعر والعقد"}</h2><p class="muted">راجع كل بند؛ ما ترسله هنا يحفظ في نسخة مستقلة يوافق عليها العميل صراحة.</p><form data-form="quote" data-id="${E(o.id)}">${errors()}
    <fieldset class="site-options"><legend>هوية مقدم الخدمة</legend>
      ${contractField("providerLegalName","اسم مقدم الخدمة القانوني",p.legalName || "",'required minlength="2" maxlength="150" autocomplete="organization"')}
      ${textField("providerAddress","عنوان مقدم الخدمة",p.address || "",10,500)}
      <div class="field"><label for="provider-registration-type">نوع وثيقة النشاط</label><select id="provider-registration-type" name="providerRegistrationType">${[["none","لا توجد وثيقة مضافة"],["commercial_registration","سجل تجاري"],["freelance_certificate","شهادة عمل حر"]].map(([id,label])=>`<option value="${id}" ${id===(p.registrationType||"none")?"selected":""}>${label}</option>`).join("")}</select></div>
      ${contractField("providerRegistrationNumber","رقم السجل أو شهادة العمل الحر (إن وجدت)",p.registrationNumber || "",'maxlength="80"')}
      ${contractField("providerActivity","وصف النشاط",p.activity || "",'maxlength="200"')}
    </fieldset>
    ${textField("agreement","الاتفاق ونطاق المشروع",q?.agreement || o.description || "",10,10000)}
    ${textField("deliverables","المخرجات التي سيتسلمها العميل",d.deliverables || "",15,5000)}
    ${textField("exclusions","ما لا يشمله هذا العقد",d.exclusions || "")}
    ${textField("clientRequirements","المحتوى والصلاحيات والمتطلبات التي يوفرها العميل",d.clientRequirements || "")}
    <div class="form-grid">${contractField("revisions","عدد جولات التعديل",d.revisions ?? 1,'type="number" required min="0" max="20" step="1"')}${contractField("reviewDays","مهلة تقديم ملاحظات التسليم (أيام)",d.reviewDays ?? 7,'type="number" required min="1" max="30" step="1"')}${contractField("supportDays","دعم تصحيح عيوب مطابقة النطاق (أيام)",d.supportDays ?? 30,'type="number" required min="0" max="365" step="1"')}</div>
    ${textField("thirdPartyCosts","رسوم الاستضافة والدومين والجهات الخارجية وتجديدها",d.thirdPartyCosts || "")}
    ${textField("ownership","حقوق الملفات والتراخيص والملكية بعد السداد",d.ownership || "")}
    ${textField("cancellation","آلية الإلغاء والاسترداد والأعمال المنفذة",d.cancellation || "")}
    <div class="form-grid">${contractField("amount","الإجمالي شامل الرسوم والضرائب الواجبة قبل خصم الإطلاق (ر.س)",q?.subtotal ? q.subtotal/100 : "",'type="number" required min="1" max="1000000" step="0.01"')}${contractField("deliveryDate","تاريخ التسليم المتفق عليه",q?.deliveryDate || "",'type="date" required')}</div>
    ${textField("terms","شروط خاصة إضافية لهذا الإصدار",q?.terms || "تسري بنود هذا الإصدار مع تفاصيله المكتوبة، دون انتقاص الحقوق النظامية للطرفين.",10,10000)}
    <div class="notice">بيّن المخرجات وحدودها ورسوم الإضافات وتجديدها بدقة. لا تضف بيانات منشأة أو ضمانات غير مؤكدة. يحسب الخادم خصم الطلب، ويحفظ البنود والسعر والهوية والموافقة بإصدار مستقل. أي تغيير يحتاج موافقة جديدة؛ لا تُعد مهلة المراجعة موافقة تلقائية.</div><button class="btn" type="submit">إرسال العرض والعقد للعميل</button></form></section>`;
}
const empty = (title, message, action = "") =>
  `<div class="empty"><div class="service-icon">${icon("file")}</div><h2>${title}</h2><p>${message}</p>${action}</div>`;
const formData = (form) => Object.fromEntries(new FormData(form));
const go = (path) => {
  if (location.hash === "#" + path) return render();
  location.hash = path;
};
function clearSession() {
  state.user = null;
  state.csrf = "";
  state.challenge = null;
  state.loginChallenge = null;
}
function clearRecovery() {
  state.recoveryOperation++;
  state.recoveryChallenge = null;
  state.recoveryChannel = null;
  state.recoveryMessage = "";
  state.resetToken = "";
  state.resetExpiresAt = 0;
}
function notify(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => (el.hidden = true), 5000);
}
async function api(path, options = {}) {
  const requestUser = state.user;
  const requestCsrf = state.csrf;
  const headers = { ...options.headers };
  if (
    options.body &&
    typeof options.body !== "string" &&
    !(options.body instanceof File)
  ) {
    options.body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  if (options.method && options.method !== "GET")
    headers["X-CSRF-Token"] = state.csrf;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new Error("تعذر قراءة استجابة الخادم. حاول مجددًا.");
    data = { error: "تعذر قراءة استجابة الخادم." };
  }
  if (!response.ok) {
    const error = new Error(data?.error || "تعذر إتمام العملية.");
    error.status = response.status;
    if (
      response.status === 401 &&
      requestUser &&
      state.user === requestUser &&
      state.csrf === requestCsrf &&
      !/^\/api\/auth\/(?:login|register|otp\/(?:send|check)|recovery\/(?:request|verify|reset))$/.test(path)
    ) {
      clearSession();
      error.sessionExpired = true;
    }
    throw error;
  }
  return data;
}
async function initialize() {
  if (state.ready) return;
  if (!state.loading) {
    state.loading = Promise.all([api("/api/config"), api("/api/session")])
      .then(([config, session]) => {
        state.config = config;
        state.user = session.user || null;
        state.csrf = session.csrf || "";
        state.ready = true;
      })
      .finally(() => {
        state.loading = null;
      });
  }
  await state.loading;
}
const artwork = {
  website: {
    label: "برمجة المواقع",
    note: "تطوير وبرمجة",
    image: "/assets/catalog-website.webp",
  },
  apps: {
    label: "تطبيقات iOS وأندرويد",
    note: "تطوير وبرمجة",
    image: "/assets/catalog-apps.webp",
  },
  payments: {
    label: "ربط قنوات الدفع",
    note: "تجارة إلكترونية",
    image: "/assets/catalog-payments.webp",
  },
  store: {
    label: "تصميم المتاجر الإلكترونية",
    note: "تجارة إلكترونية",
    image: "/assets/catalog-store.webp",
  },
  identity: {
    label: "الهوية البصرية",
    note: "تصميم ومحتوى",
    image: "/assets/catalog-identity.webp",
  },
  marketing: {
    label: "التسويق الإلكتروني",
    note: "تسويق ونمو",
    image: "/assets/catalog-marketing.webp",
  },
  dropshipping: {
    label: "متاجر الدروبشيبينغ",
    note: "تجارة إلكترونية",
    image: "/assets/catalog-dropshipping.webp",
  },
  noon: {
    label: "كن بائعًا على نون",
    note: "أسواق إلكترونية",
    image: "/assets/catalog-noon.webp",
  },
  amazon: {
    label: "كن بائعًا على أمازون",
    note: "أسواق إلكترونية",
    image: "/assets/catalog-amazon.webp",
  },
  ai: {
    label: "ربط وتوظيف الذكاء الاصطناعي",
    note: "تطوير وبرمجة",
    image: "/assets/catalog-ai.webp",
  },
  consulting: {
    label: "استشر مختصًا",
    note: "استشارات وتعلّم",
    image: "/assets/catalog-consulting.webp",
  },
  platforms: {
    label: "بناء المنصات الإلكترونية",
    note: "تطوير وبرمجة",
    image: "/assets/catalog-platforms.webp",
  },
  content: {
    label: "التسويق بالمحتوى",
    note: "تصميم ومحتوى",
    image: "/assets/catalog-content.webp",
  },
  academy: {
    label: "تعلّم التجارة الإلكترونية",
    note: "استشارات وتعلّم",
    image: "/assets/catalog-academy.webp",
  },
};
function coverKey(p) {
  if (Object.hasOwn(artwork, p.cover)) return p.cover;
  const context = String(
    (p.category || "") + " " + (p.title || ""),
  ).toLowerCase();
  if (/تسويق|حمل|marketing|social|ads/.test(context)) return "marketing";
  if (/متجر|تجار|store|commerce/.test(context)) return "store";
  if (/تطبيق|نظام|برمج|app|software/.test(context)) return "apps";
  if (/محتوى|تصميم|قالب|دليل|كتاب|content|brand|book|template/.test(context))
    return "content";
  return "website";
}
function productImage(p, extra = "") {
  return `<div class="product-cover ${extra}"><img src="${artwork[coverKey(p)].image}" alt="صورة توضيحية لـ${E(p.title)}" loading="lazy" width="1024" height="1024"><span class="cover-label">${E(p.category)}</span></div>`;
}
function coverPicker(p = {}) {
  const selected = coverKey(p);
  return `<fieldset class="cover-picker"><legend>الصورة المناسبة للمنتج</legend><p class="hint">اختر الصورة الأقرب إلى محتوى المنتج.</p><div class="cover-options">${Object.entries(
    artwork,
  )
    .map(
      ([key, a]) =>
        `<label class="cover-option"><input type="radio" name="cover" value="${key}" ${key === selected ? "checked" : ""}><img src="${a.image}" alt="" loading="lazy"><span>${a.label}</span></label>`,
    )
    .join("")}</div></fieldset>`;
}
function logo(compact = false) {
  return `<a class="brand ${compact ? "brand-footer" : ""}" href="#/" aria-label="إنطلاقة للتجارة الإلكترونية، الصفحة الرئيسية"><img class="brand-logo" src="/assets/brand-logo-transparent.png" alt="شعار إنطلاقة" width="112" height="96"><span class="brand-name">إنطلاقة<span>للتجارة الإلكترونية</span></span></a>`;
}
function header(path) {
  const authed = !!state.user,
    admin = state.user?.role === "admin";
  const businessPhone = state.config?.businessPhone || "+966553575760";
  const businessEmail = state.config?.businessEmail || "antlaqh2030@gmail.com";
  const phoneLabel = businessPhone === "+966553575760" ? "0553575760" : businessPhone;
  $("#header").innerHTML =
    `<div class="header-accent"></div><div class="wrap header-inner">${logo()}<nav class="main-nav" id="main-nav" aria-label="التنقل الرئيسي">${[
      ["/", "الرئيسية"],
      ["/services", "حلولنا"],
      ["/store", "المتجر"],
      ["/about", "عن إنطلاقة"],
    ]
      .map(
        ([p, l]) =>
          `<a href="#${p}" class="${path === p ? "active" : ""}" ${path === p ? 'aria-current="page"' : ""}>${l}</a>`,
      )
      .join(
        "",
      )}</nav><div class="header-actions">${authed ? `<a class="user-chip" href="#${admin ? "/admin" : "/dashboard"}"><span class="avatar">${E(state.user.name.slice(0, 1))}</span><span class="user-name">${E(state.user.name.split(" ")[0])}</span></a>` : link("/login", "حسابي", "ghost login-link")}${link("/start", "ابدأ مشروعك " + icon("arrow"), "header-start")}<button class="btn ghost menu-button" data-action="menu" aria-label="فتح القائمة" aria-expanded="false" aria-controls="main-nav">${icon("menu")}</button></div></div>`;
  $("#footer").innerHTML =
    `<div class="wrap footer-cta"><div><span class="footer-eyebrow">خطوتك القادمة تبدأ هنا</span><h2>فكرتك تستحق انطلاقة.</h2><p>لنحوّل ما تتخيّله إلى حضور رقمي يعبّر عن مشروعك.</p></div><a class="btn footer-start" href="#/start">ابدأ مشروعك ${icon("arrow")}</a></div><div class="wrap footer-top"><div class="footer-brand">${logo(true)}<p>نصنع لمشروعك بداية مدروسة، وحضورًا رقميًا يعبّر عنه. من أول فكرة إلى تجربة تستحق أن تُشارك.</p><span class="footer-signature">بدايات مدروسة. أثر مستمر.</span></div><div class="footer-column"><h3>اكتشف انطلاقة</h3><nav aria-label="اكتشف انطلاقة"><a href="#/services">حلولنا الرقمية</a><a href="#/store">المتجر الرقمي</a><a href="#/ready-websites">المواقع الجاهزة</a><a href="#/launch-offer">عرض الإطلاق</a><a href="#/about">قصتنا وطريقتنا</a></nav></div><div class="footer-column"><h3>المساعدة والمتابعة</h3><nav aria-label="المساعدة والمتابعة"><a href="#/dashboard">مساحة العميل</a><a href="#/support">الدعم والمساعدة</a><button type="button" data-assistant-open>مساعد انطلاقة ${icon("spark")}</button><a href="#/terms">الشروط والأحكام</a><a href="#/privacy">سياسة الخصوصية</a>${state.config?.integrations?.ga4MeasurementId ? `<button type="button" data-analytics-settings>خيارات قياس الزيارات</button>` : ""}</nav></div><div class="footer-column footer-reach"><h3>لنتحدث عن مشروعك</h3><p>نحن بالقرب منك، من أول سؤال إلى الخطوة التالية.</p><div class="footer-contact"><a href="tel:${E(businessPhone)}"><span>اتصل بنا</span><b dir="ltr">${E(phoneLabel)}</b></a><a href="mailto:${E(businessEmail)}"><span>البريد الإلكتروني</span><b dir="ltr">${E(businessEmail)}</b></a>${whatsappLink("تواصل عبر WhatsApp","text-link")}</div></div></div><div class="wrap footer-utility"><div class="footer-payment"><span class="footer-eyebrow">الدفع بعد الاتفاق</span><div>${icon("globe")}<strong>تحويل بنكي</strong></div><p>التحويل البنكي هو وسيلة الدفع الوحيدة حاليًا.</p></div>${shareLinks()}</div><div class="wrap footer-bottom"><span>© ${new Date().getFullYear()} إنطلاقة للتجارة الإلكترونية. جميع الحقوق محفوظة.</span><a href="#/">العودة للرئيسية ${icon("arrow")}</a></div><a class="floating-contact" href="https://wa.me/966553575760?text=${encodeURIComponent("مرحبًا انطلاقة، أود الاستفسار عن خدماتكم.")}" target="_blank" rel="noopener noreferrer" aria-label="راسل انطلاقة عبر WhatsApp على ${E(phoneLabel)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 3h4l2 5-3 2c2 3 3 4 6 6l2-3 5 2v4c0 1-1 2-2 2C10 21 3 14 3 5c0-1 1-2 2-2Z"/></svg><span>راسلنا على WhatsApp</span></a>`;
}

function activeOffer() {
  const o = state.config?.launchOffer;
  return o?.active && Date.now() >= Date.parse(o.startsAt) && Date.now() < Date.parse(o.endsAt) ? o : null;
}
function offerEnd(o) {
  return new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "long", calendar: "gregory" }).format(new Date(Date.parse(o.endsAt) - 1));
}
function launchBanner() {
  const o = activeOffer();
  if (!o) return "";
  return `<section class="launch-offer" aria-label="عرض الإطلاق"><div><span class="eyebrow">احتفالًا بتدشين انطلاقة</span><h2>ابدأ خطوتك بخصم ${E(o.ratePercent)}%</h2><p>للطلـبات المقدمة حتى ${E(offerEnd(o))} بتوقيت الرياض.</p></div><div class="launch-actions"><button class="promo-code" type="button" data-copy-promo="${E(o.code)}" aria-label="نسخ كود الخصم ${E(o.code)}"><span dir="ltr">${E(o.code)}</span>${icon("file")}</button>${link("/start?promo="+encodeURIComponent(o.code), "ابدأ بالخصم", "lime")}<a href="#/launch-offer">تفاصيل وشروط العرض</a></div></section>`;
}
function offerPage() {
  const o = state.config?.launchOffer;
  if (!o) return empty("عرض الإطلاق", "لا يوجد عرض حاليًا.");
  return `<div class="wrap">${pageHead("عرض تدشين انطلاقة", activeOffer() ? "خصم 20% على الطلبات المؤهلة خلال أكتوبر 2026." : "انتهت فترة استخدام كود الإطلاق للطلبات الجديدة.")}<section class="panel"><h2 dir="ltr">${E(o.code)}</h2><p>آخر يوم للعرض: ${E(offerEnd(o))}، بتوقيت الرياض.</p><ul class="feature-list">${o.terms.map(t=>`<li>${icon("check")}${E(t)}</li>`).join("")}</ul><p>المواقع الجاهزة تُخصّص وتُسلّم بحسب النطاق المكتوب. لا يلزم شراء أي خدمة لاحقة. الدفع بالتحويل البنكي فقط.</p>${activeOffer() ? link("/start?promo="+encodeURIComponent(o.code), "استخدم الكود") : link("/services", "الخدمات المتاحة")}</section></div>`;
}
function promoField() {
  const o = activeOffer();
  return `<div class="field"><label for="promoCode">كود الخصم (اختياري)</label><input id="promoCode" name="promoCode" dir="ltr" maxlength="40" autocomplete="off" placeholder="${o ? E(o.code) : "كود الخصم"}" value="${o && new URLSearchParams(location.hash.split('?')[1]||'').get('promo') === o.code ? E(o.code) : ''}"><p class="hint">${o ? `خصم ${E(o.ratePercent)}% حتى ${E(offerEnd(o))}. <a href="#/launch-offer" target="_blank" rel="noopener">شروط العرض</a>` : "يفحص الخادم صلاحية الكود قبل إنشاء الطلب."}</p></div>`;
}
function priceSummary(value) {
  if (!value.amount) return value.promotion ? `<p class="notice">حُفظ كود ${E(value.promotion.code)} لهذا الطلب؛ سيظهر الخصم في عرض السعر.</p>` : "";
  return `<div class="price-summary">${value.discount ? `<div><span>السعر قبل الخصم</span><strong>${money(value.subtotal)}</strong></div><div class="discount-line"><span>خصم ${E(value.promotion?.ratePercent || 20)}% · <b dir="ltr">${E(value.promotion?.code || "ANTLAQH20")}</b></span><strong>− ${money(value.discount)}</strong></div>` : ""}<div class="invoice-total"><span>الإجمالي النهائي</span><strong>${money(value.amount)}</strong></div></div>`;
}
function journey() {
  const stages = state.config?.customerJourney || [];
  if (!stages.length) return "";
  return `<section class="section growth-journey" aria-labelledby="journey-title"><div class="section-head"><div><span class="eyebrow">ابدأ بما تحتاجه، وتوسّع حين يناسبك</span><h2 id="journey-title">خطوة واضحة اليوم. مساحة أكبر غدًا.</h2></div><p>كل مرحلة اختيارية. يمكنك طلب أي خدمة مباشرة.</p></div><div class="journey-grid">${stages.map((j,i)=>{const list=j.serviceIds.map(id=>state.config.services.find(s=>s.id===id)).filter(Boolean).sort((a,b)=>a.pricing.from-b.pricing.from);return `<article class="journey-card"><span class="journey-number">0${i+1}</span><h3>${E(j.title)}</h3><p>${E(j.description)}</p>${list[0] ? `<p class="journey-from">تبدأ من <strong>${money(list[0].pricing.from)}</strong></p>` : ""}<details><summary>اختر الخدمة المناسبة</summary><ul>${list.map(x=>`<li><a href="#/service/${E(x.id)}">${E(x.title)} <span>${money(x.pricing.from)}</span></a></li>`).join("")}</ul></details>${list[0] ? link("/service/"+list[0].id, "اكتشف نقطة البداية", "secondary small") : ""}</article>`;}).join("")}</div></section>`;
}
function nextStep(serviceId) {
  const stages=state.config?.customerJourney || [];
  const stage=stages.find(s=>s.serviceIds.includes(serviceId));
  const next=stages.find(s=>s.id===stage?.next);
  if (!next) return "";
  const service=next.serviceIds.map(id=>state.config.services.find(s=>s.id===id)).find(Boolean);
  return service ? `<section class="panel next-step"><span class="eyebrow">عندما تحتاج الخطوة التالية</span><h3>${E(next.title)}</h3><p>${E(next.description)} لا يلزم شراؤها مع طلبك الحالي.</p>${link("/service/"+service.id, "استكشف الخيار التالي", "secondary")}</section>` : "";
}
function readySiteOptions(query, selected) {
  const service=state.config.services.find(s=>s.id==="ready-website");
  if (!service) return "";
  return `<fieldset id="ready-site-options" class="site-options" ${selected !== service.id ? 'hidden' : ''}><legend>اختيارات الموقع الجاهز</legend><div class="field"><label for="template">نموذج الموقع</label><select id="template" name="template">${service.templates.map(t=>`<option value="${E(t.id)}" ${query.get('template')===t.id ? 'selected' : ''}>${E(t.title)}</option>`).join("")}</select></div>${service.addons.map(a=>`<label class="check addon-option"><input type="checkbox" name="addon_${E(a.id)}"><span><strong>${E(a.title)}</strong><small>${E(a.description)}</small></span></label>`).join("")}<p class="hint">الإضافات اختيارية؛ تحدَّد رسومها ورسوم تجديد المزوّد في العرض قبل الاتفاق. لا تُحجز استضافة أو دومين بمجرد إرسال الطلب.</p></fieldset>`;
}
function readyWebsites() {
  const s=state.config.services.find(s=>s.id==="ready-website");
  if (!s) return empty("مواقع جاهزة", "المنتج غير متاح حاليًا.");
  return `<div class="wrap">${pageHead("موقع جاهز. بداية على مقاسك.", "عاين النموذج، واختر إضافاتك. نخصّصه بمحتواك قبل التسليم.")}${launchBanner()}<section class="panel"><h2>${E(s.title)}</h2>${servicePrice(s,true)}<p>الموقع الأساسي ملفات ثابتة متجاوبة. لوحة الإدارة والمتجر والحجز والدفع الإلكتروني تحتاج نطاقًا مستقلًا.</p><ul class="feature-list">${s.includes.map(x=>`<li>${icon("check")}${E(x)}</li>`).join("")}</ul></section><section class="section"><div class="three-col">${s.templates.map(t=>`<article class="panel template-card"><div class="template-visual template-${E(t.id)}">${icon(t.id==='restaurant'?'bag':t.id==='portfolio'?'spark':'globe')}<span>تصميم عربي متجاوب</span></div><h2>${E(t.title)}</h2><p>${E(t.description)}</p><div class="actions"><a class="btn secondary" href="${E(t.preview)}" target="_blank" rel="noopener">معاينة فعلية</a>${link("/start?service=ready-website&template="+t.id+(activeOffer()?"&promo="+encodeURIComponent(activeOffer().code):""),"اختر هذا النموذج")}</div></article>`).join("")}</div></section><section class="panel"><h2>أضف ما تحتاجه فقط</h2><div class="three-col">${s.addons.map(a=>`<div><h3>${E(a.title)}</h3><p>${E(a.description)}</p></div>`).join("")}</div><p>يمكنك استخدام استضافتك ودومينك الحاليين أو طلب الملفات فقط. الدفع بالتحويل البنكي بعد الموافقة على النطاق والإجمالي.</p></section>${nextStep(s.id)}</div>`;
}
function paymentIcons() {
  return `<div class="wrap payment-methods" aria-label="وسائل الدفع"><div class="payment-enabled">${icon("globe")}<strong>تحويل بنكي</strong><span>متاح الآن</span></div><div class="payment-future" aria-label="وسائل غير متاحة حاليًا"><span class="pay-brand visa" dir="ltr">VISA</span><span class="pay-brand mastercard" dir="ltr"><i></i><i></i><b>Mastercard</b></span><span class="pay-brand mada">مدى <b dir="ltr">mada</b></span><span class="pay-brand applepay" dir="ltr">Apple Pay</span></div><p>الأيقونات الأخرى للتعريف بالخيارات المستقبلية؛ غير مفعّلة. التحويل البنكي هو وسيلة الدفع الوحيدة حاليًا.</p></div>`;
}
function shareLinks() {
  const url="https://antlaqh.com/";
  return `<section class="share-platform"><span>شارك انطلاقة مع من يحتاجها</span><button type="button" data-share-platform>مشاركة الرابط</button><a href="https://wa.me/?text=${encodeURIComponent('انطلاقة: خدمات ومواقع جاهزة تساعد مشروعك على البدء والنمو. '+url)}" target="_blank" rel="noopener noreferrer">WhatsApp</a><a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">LinkedIn</a><a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('ابدأ مشروعك الرقمي مع انطلاقة')}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">X</a></section>`;
}

function servicePrice(s, detailed = false) {
  if (!s.pricing) return "";
  const offer = activeOffer();
  return `<div class="service-price"><span>تبدأ من</span><strong>${money(s.pricing.from)}</strong>${offer ? `<small class="launch-price">${money(s.pricing.from - Math.round(s.pricing.from * offer.ratePercent / 100))} بالكود <b dir="ltr">${E(offer.code)}</b> للنطاق نفسه</small>` : ""}<span>${E(s.pricing.unit)}</span>${detailed ? `<p>${E(s.pricing.scope)}</p><small>${E(s.pricing.note)}</small>` : ""}</div>`;
}
function homepageAssistant() {
  return `<section class="homepage-assistant wrap" aria-labelledby="home-ai-title"><div class="home-ai-heading"><span class="home-ai-avatar">${icon("spark")}</span><div><span class="eyebrow">مساعد انطلاقة</span><h2 id="home-ai-title">أخبرنا عن فكرتك، ولنرتّب بدايتك.</h2><p>إرشاد من معلومات خدمات انطلاقة وأسعارها وخطوات الطلب.</p></div></div><div class="home-ai-entry"><label class="sr-only" for="home-ai-draft">سؤالك لمساعد انطلاقة</label><textarea id="home-ai-draft" rows="2" maxlength="3000" placeholder="أريد متجرًا إلكترونيًا… ما الباقة المناسبة؟"></textarea><button type="button" class="btn" data-assistant-open data-assistant-draft>اسأل المساعد ${icon("arrow")}</button></div><div class="home-ai-shortcuts"><button type="button" data-assistant-open data-assistant-prompt="ما أسعار باقات المتاجر ونطاقها؟">أسعار المتاجر</button><button type="button" data-assistant-open data-assistant-prompt="كيف تبدأ رحلة عرض السعر والعقد؟">كيف نبدأ المشروع؟</button><a href="#/services">استعرض الخدمات مباشرة</a></div><p class="small muted">${state.config.assistantReady === true ? state.config.assistantMode === "guided" ? "المساعد الإرشادي المجاني متاح الآن من معلومات انطلاقة المعلنة." : "المساعد متاح الآن لاكتشاف الخدمات والخطوة التالية." : "المساعد غير متاح حاليًا؛ استعرض الخدمات والأسعار مباشرة."}</p></section>`;
}
function serviceCards({ compact = false } = {}) {
  return (
    (compact
      ? state.config.services.filter((s) =>
          ["website", "store", "apps", "identity", "ai", "marketing"].includes(
            s.id,
          ),
        )
      : state.config.services
    )
      .map((s, index) => {
        const art = artwork[s.id] || artwork.website;
        return `<article class="service-card ${compact ? "compact" : ""}" data-service-text="${E((s.title + " " + s.description).toLowerCase())}" data-service-category="${E(s.category)}"><a class="service-art" href="#/service/${E(s.id)}" tabindex="-1" aria-hidden="true"><img src="${art.image}" alt="" width="1024" height="1024" loading="lazy"><span class="art-index" dir="ltr">${String(index + 1).padStart(2, "0")} /</span><span class="art-icon">${icon(s.icon)}</span></a><div class="service-body"><span class="category">${E(s.category)}</span><h3><a href="#/service/${E(s.id)}">${E(s.title)}</a></h3><p>${E(s.description)}</p>${servicePrice(s)}<a class="service-link" href="#/service/${E(s.id)}"><span>اكتشف الحل المناسب</span>${icon("arrow")}</a></div></article>`;
      })
      .join("") +
    `<article class="service-card cta-card" data-service-extra><span class="eyebrow">مساحة للأفكار الجديدة</span><div class="cta-orbit" aria-hidden="true">${icon("spark")}</div><h3>فكرتك مختلفة؟<br>لنصنع لها طريقًا.</h3><p>لا تحتاج إلى معرفة كل التفاصيل. شاركنا هدفك، ونساعدك على تحديد البداية.</p>${link("/start", "لنتحدث عن مشروعك " + icon("arrow"), "secondary")}</article>`
  );
}
function processSteps() {
  return `<div class="steps">${[
    ["نفهم فكرتك", "نتعرّف إلى مشروعك وجمهورك وما تريد تحقيقه."],
    ["نرسم الطريق", "نطاق واضح، وعرض سعر، واتفاق تراجعه قبل البدء."],
    ["نبني معك", "تنفيذ ومراجعات وتحديثات في مساحة مشروعك."],
    ["ننطلق بثقة", "نراجع التفاصيل معك، ونسلّم المخرجات المتفق عليها."],
  ]
    .map(
      ([title, text], i) =>
        `<article class="step"><span class="step-num" dir="ltr">0${i + 1}</span><h3>${title}</h3><p>${text}</p></article>`,
    )
    .join("")}</div>`;
}
function home() {
  return `<div class="wrap">${launchBanner()}</div>${homepageAssistant()}<div class="home-intro"><div class="wrap"><section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="status-dot"></span>إنطلاقة للتجارة الإلكترونية</span><h1>نخطط، ننفذ،<br><em>وننجح معك.</em></h1><p>نحوّل فكرتك إلى تجربة رقمية متكاملة؛ متجر يعبّر عنك، موقع يترك أثرًا، وحلول تنمو مع مشروعك.</p><div class="actions">${link("/start", "لنبدأ مشروعك " + icon("arrow"))}${link("/store", "تصفّح حلولنا", "secondary")}</div><div class="hero-note"><span>${icon("check")} تصميم يعكس هويتك</span><span>${icon("check")} رحلة واضحة من البداية</span></div></div><div class="hero-composition"><div class="geometry geometry-one" aria-hidden="true"></div><div class="hero-image"><img src="/assets/catalog-store.webp" alt="تصور إبداعي لمتجر إلكتروني بألوان إنطلاقة" width="1024" height="1024" fetchpriority="high"><div class="image-topline"><span><i></i> مصمّم لطموحك</span><span dir="ltr">INTLAKAH / DIGITAL</span></div><div class="image-caption"><div><small>من الفكرة إلى التجربة</small><strong>تفاصيل تصنع الفرق.</strong></div><span class="circle-arrow">${icon("arrow")}</span></div></div><div class="floating-note"><span class="floating-icon">${icon("bag")}</span><div><small>تجارتك، بأسلوبك.</small><strong>تجربة واحدة. احتمالات أوسع.</strong></div></div><div class="floating-mini"><img src="/assets/catalog-apps.webp" alt="تصور واجهة تطبيق" width="1024" height="1024"><span>حلول مترابطة <i>↗</i></span></div></div></section></div></div><div class="expertise-strip"><div class="wrap">${[
    ["bag", "تجارة إلكترونية"],
    ["globe", "مواقع ومنصات"],
    ["code", "تطبيقات وأنظمة"],
    ["chart", "تسويق رقمي"],
    ["spark", "محتوى إبداعي"],
  ]
    .map(([i, t]) => `<span>${icon(i)}${t}</span>`)
    .join(
      "",
    )}</div></div><div class="wrap">${journey()}<section class="section" aria-labelledby="services-title"><div class="section-head"><div><div class="eyebrow">حلول تتكامل حول مشروعك</div><h2 id="services-title">ما تحتاجه للخطوة القادمة.</h2></div><div><p>من بناء الأساس إلى صناعة الأثر.<br>اختر بداية تناسبك، ودع الباقي علينا.</p></div></div><div class="service-grid">${serviceCards({ compact: true })}</div><div class="section-more">${link("/services", "اكتشف جميع خدماتنا " + icon("arrow"), "secondary")}</div></section><section class="platform-section"><div class="platform-copy"><div class="eyebrow">تفاصيل أكثر. تشتّت أقل.</div><h2>مشروعك واضح.<br>في كل خطوة.</h2><p>مساحة خاصة تجمع الاتفاق، والطلبات، والملفات، والتحديثات. لتبقى على اطلاع، وتتفرّغ لما يهمك.</p><ul class="feature-list"><li>${icon("check")}عرض سعر وعقد تراجعهما قبل التنفيذ</li><li>${icon("check")}مراحل ومرفقات مرتبطة بمشروعك</li><li>${icon("check")}تواصل مع الفريق في مكان واحد</li></ul>${link(state.user ? "/dashboard" : "/register", "اكتشف مساحة العميل", "secondary")}</div><div class="workspace-preview" aria-label="تصور توضيحي لمساحة متابعة المشروع"><div class="preview-title"><span class="preview-brand">${icon("diamond")} مساحة مشروعك</span><span class="preview-label">تصوّر توضيحي</span></div><div class="preview-project"><span class="preview-project-icon">${icon("bag")}</span><div><small>الفصل القادم لمشروعك</small><h3>متجرك الإلكتروني</h3></div><span class="badge">رحلة متكاملة</span></div><div class="preview-progress"><span></span><span></span><span></span><span></span></div><div class="preview-milestones"><div>${icon("file")}<span>الاتفاق<small>النطاق والتفاصيل</small></span>${icon("check")}</div><div>${icon("grid")}<span>التنفيذ<small>مراحل واضحة ومراجعات</small></span>${icon("clock")}</div><div>${icon("message")}<span>التواصل<small>الملفات والملاحظات</small></span>${icon("arrow")}</div></div><div class="preview-bottom"><span class="mini-avatars"><i>إ</i><i>أنت</i></span><span>أنت وفريق إنطلاقة، في مساحة واحدة.</span></div></div></section><section class="section process-section"><div class="section-head"><div><div class="eyebrow">من أين نبدأ؟</div><h2>رحلة مدروسة، خطوة بخطوة.</h2></div><p>نعرف أن البداية تحمل الكثير من الأسئلة.<br>لهذا، نجعل الطريق واضحًا أمامك.</p></div>${processSteps()}</section><section class="assistant-callout"><div class="assistant-orb" aria-hidden="true">${icon("spark")}</div><div><div class="eyebrow">مساعد انطلاقة</div><h2>فكرتك في بالك، ولا تعرف من أين تبدأ؟</h2><p>اكتشف الحلول، ورتّب متطلبات مشروعك، واسأل عن خطوتك القادمة.</p></div><button class="btn secondary" type="button" data-assistant-open>ابدأ المحادثة ${icon("message")}</button></section><section class="banner"><span class="banner-lines" aria-hidden="true"></span><div><div class="eyebrow">فصلك القادم يبدأ هنا</div><h2>لنصنع شيئًا يليق بطموحك.</h2><p>شاركنا فكرتك. والبداية، علينا معًا.</p></div>${link("/start", "ابدأ مع إنطلاقة " + icon("arrow"), "lime")}</section></div>`;
}

function pageHead(title, subtitle = "", action = "") {
  return `<div class="page-head"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${action}</div>`;
}
function sidebar(path, admin = false) {
  const items = admin
    ? [
        ["/admin", "نظرة عامة", "grid"],
        ["/admin/orders", "الطلبات", "bag"],
        ["/admin/products", "المنتجات الرقمية", "file"],
        ["/admin/customers", "العملاء", "user"],
        ["/support", "تذاكر الدعم", "message"],
        ["/profile", "حسابي", "user"],
      ]
    : [
        ["/dashboard", "نظرة عامة", "grid"],
        ["/orders", "طلباتي", "bag"],
        ["/contracts", "عقودي", "file"],
        ["/invoices", "المدفوعات", "file"],
        ["/notifications", "التحديثات", "bell"],
        ["/support", "الدعم والمساعدة", "message"],
        ["/profile", "إعدادات الحساب", "user"],
      ];
  return `<aside class="sidebar" aria-label="قائمة الحساب"><div class="sidebar-label">${admin ? "إدارة المنصة" : "مساحتك في انطلاقة"}</div>${items.map(([p, l, i]) => `<a href="#${p}" class="${path === p ? "active" : ""}" ${path === p ? 'aria-current="page"' : ""}>${icon(i)}${l}</a>`).join("")}<div class="divider"></div><button data-action="logout">${icon("logout")}تسجيل الخروج</button></aside>`;
}
function workspace(path, content) {
  return `<div class="wrap workspace">${sidebar(path, state.user.role === "admin")}<div class="workspace-content">${content}</div></div>`;
}
function authPage(register, query) {
  const emailLogin = query.get("method") === "email" || (query.get("next") || "").startsWith("/admin");
  const next = query.get("next") || "/dashboard";
  return `<div class="wrap"><div class="auth-layout"><div class="auth-story"><div class="eyebrow">مساحتك في انطلاقة</div><h2>كل ما يخص مشروعك،<br>أقرب إليك.</h2><p>حساب واحد يجمع طلباتك وعقودك وملفاتك وتواصلك مع الفريق.</p><div class="auth-points"><div class="auth-point">${icon("bag")} متابعة الطلبات والمشاريع</div><div class="auth-point">${icon("file")} عروض أسعار وعقود واضحة</div><div class="auth-point">${icon("message")} تواصل وملاحظات في مكان واحد</div></div></div><div class="auth-form"><h1>${register ? "أنشئ حسابك" : "أهلًا بعودتك"}</h1><p class="muted">${register ? "خطوتك الأولى نحو مشروعك القادم." : "سجّل الدخول لمتابعة مشروعك."}</p><form data-form="${register ? "register" : "login"}" data-next="${E(next)}">${errors()}${register ? field("name", "الاسم الكامل", "text", 'required minlength="2" maxlength="100" autocomplete="name"') : ""}${register || !emailLogin ? field("phone", "رقم الجوال", "tel", 'required autocomplete="tel" inputmode="tel" placeholder="05XXXXXXXX" maxlength="30"') : ""}${register || emailLogin ? field("email", register ? "البريد الإلكتروني للمراسلات" : "بريد حساب الإدارة أو الحساب القديم", "email", 'required autocomplete="email" maxlength="180"') : ""}${field("password", "كلمة المرور", "password", `required ${register ? 'minlength="12"' : ""} maxlength="128" autocomplete="${register ? "new-password" : "current-password"}"`)}${register ? `<p class="small muted">12 حرفًا على الأقل؛ يُفضّل استخدام عبارة طويلة يسهل عليك تذكرها.</p><label class="check"><input type="checkbox" name="acceptTerms" required><span>قرأت <a href="#/terms" target="_blank" rel="noopener">الشروط والأحكام</a> و<a href="#/privacy" target="_blank" rel="noopener">سياسة الخصوصية</a> وأوافق عليهما.</span></label>` : ""}<button class="btn" type="submit">${register ? "إنشاء الحساب" : "تسجيل الدخول"}</button></form>${!register && !emailLogin ? `<details class="spaced"><summary>حساب قديم أو حساب إدارة؟</summary><p>ادخل بالبريد مرة واحدة، ثم اربط رقم الدخول من إعدادات الحساب.</p><a class="text-link" href="#/login?method=email&next=${encodeURIComponent(next)}">الدخول للحساب القديم أو الإدارة</a></details>` : ""}<p class="auth-switch">${register ? "لديك حساب؟" : "جديد على انطلاقة؟"} <a href="#/${register ? "login" : "register"}?next=${encodeURIComponent(next)}">${register ? "سجّل الدخول" : "أنشئ حسابًا"}</a></p></div></div></div>`;
}
function recoveryLayout(title, description, content) {
  return `<div class="wrap"><div class="checkout">${pageHead(title, description)}${content}<p class="small spaced"><a class="text-link" href="#/login">العودة إلى تسجيل الدخول</a></p></div></div>`;
}
function forgotPassword() {
  const ready = state.config?.recovery || {};
  const channelCard = (channel, title, available, label, type, attributes) =>
    `<section class="panel"><h2>${title}</h2><p class="small ${available ? "" : "muted"}">${available ? "متاحة الآن للحسابات المرتبطة بهذه القناة." : "غير مفعّلة حاليًا؛ لا يمكن إرسال رسالة استعادة عبر هذه القناة."}</p><form data-form="recovery-request" data-channel="${channel}">${errors()}${field("identifier", label, type, `${attributes} ${available ? "" : "disabled"}`)}<button class="btn ${channel === "whatsapp" ? "secondary" : ""}" type="submit" ${available ? "" : "disabled"}>${channel === "email" ? "طلب رابط الاستعادة" : "طلب رمز على WhatsApp"}</button></form></section>`;
  return recoveryLayout("نسيت كلمة المرور؟", "اختر البريد أو رقم WhatsApp المرتبط بحسابك. نستخدم ردًا عامًا لحماية خصوصية الحسابات.", `${state.recoveryMessage ? `<div class="notice" role="status">${E(state.recoveryMessage)}</div>` : ""}<div class="two-col">${channelCard("email", "البريد الإلكتروني", ready.emailReady === true, "البريد المرتبط بالحساب", "email", 'required maxlength="180" autocomplete="email"')}${channelCard("whatsapp", "WhatsApp", ready.whatsappReady === true, "رقم WhatsApp المرتبط بالحساب", "tel", 'required minlength="9" maxlength="30" inputmode="tel" autocomplete="tel" placeholder="05XXXXXXXX أو +9665XXXXXXXX"')}</div><p class="small muted">هذه الاستعادة آلية عند تفعيل مزود الإرسال. زر التواصل مع فريق انطلاقة لا يرسل رمز استعادة ولا يكشف بيانات حسابك.</p>`);
}
function verifyRecovery() {
  if (!state.recoveryChallenge || state.recoveryChannel !== "whatsapp")
    return recoveryLayout("تأكيد رمز الاستعادة", "ابدأ بطلب رمز جديد على WhatsApp.", `<section class="panel">${empty("لا يوجد طلب استعادة في هذه الصفحة", "قد تكون الصفحة أُعيد تحميلها. اطلب رمزًا جديدًا لمتابعة الاستعادة.", link("/forgot-password", "طلب استعادة جديد"))}</section>`);
  return recoveryLayout("تأكيد رمز الاستعادة", "أدخل الرمز من رسالة WhatsApp. لا تشاركه مع أي شخص.", `<section class="panel">${state.recoveryMessage ? `<div class="notice" role="status">${E(state.recoveryMessage)}</div>` : ""}<form data-form="recovery-verify">${errors()}${field("code", "رمز الاستعادة", "text", 'required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" minlength="4" maxlength="10" dir="ltr"')}<p class="hint">من 4 إلى 10 أرقام، مع الاحتفاظ بالأصفار في بداية الرمز.</p><button class="btn" type="submit">تأكيد الرمز</button></form><p class="small spaced"><a class="text-link" href="#/forgot-password">طلب رمز جديد أو اختيار البريد</a></p></section>`);
}
function resetPassword() {
  const expired = state.resetExpiresAt && Date.now() >= state.resetExpiresAt;
  if (!state.resetToken || expired) {
    state.resetToken = "";
    state.resetExpiresAt = 0;
    return recoveryLayout("تعيين كلمة مرور جديدة", "رابط الاستعادة مؤقت ويستخدم مرة واحدة.", `<section class="panel">${empty("الرابط غير متاح أو انتهت صلاحيته", "افتح رابط البريد الأصلي، أو اطلب استعادة جديدة. إعادة تحميل هذه الصفحة بعد إزالة الرابط تتطلب طلبًا جديدًا.", link("/forgot-password", "طلب استعادة جديد"))}</section>`);
  }
  return recoveryLayout("تعيين كلمة مرور جديدة", "اختر كلمة مرور بين 12 و128 حرفًا. سيُطلب منك تسجيل الدخول بعد تغييرها.", `<section class="panel"><form data-form="recovery-reset">${errors()}${field("password", "كلمة المرور الجديدة", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}${field("passwordConfirm", "أعد كتابة كلمة المرور الجديدة", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}<p class="small muted">يُستخدم رابط الاستعادة مرة واحدة، ويتحقق الخادم من صلاحيته. تغيير كلمة المرور ينهي جلسات الحساب المفتوحة.</p><button class="btn" type="submit">حفظ كلمة المرور الجديدة</button></form></section>`);
}
function authRequired(next) {
  return `<div class="wrap">${pageHead("لنبدأ من حسابك", "احفظ تفاصيل مشروعك وتابع الردود والتحديثات.")}<div class="checkout">${empty("مساحتك الخاصة بالمشروع", "سجّل الدخول أو أنشئ حسابًا لتقديم الطلب ومتابعته بأمان.", `<div class="actions">${link("/login?next=" + encodeURIComponent(next), "تسجيل الدخول")}${link("/register?next=" + encodeURIComponent(next), "إنشاء حساب", "secondary")}</div>`)}</div></div>`;
}
function start(query) {
  const selected = query.get("service") || "";
  const contact = state.user ? "" : `<div class="form-grid">${field("customerName", "الاسم", "text", 'required minlength="2" maxlength="100" autocomplete="name"')}${field("customerPhone", "رقم الجوال", "tel", 'required minlength="9" maxlength="16" autocomplete="tel" placeholder="05XXXXXXXX"')}</div>${field("customerEmail", "البريد الإلكتروني", "email", 'required maxlength="254" autocomplete="email"')}`;
  return `<div class="wrap">${pageHead("ابدأ مشروعك الإلكتروني", "بدون تسجيل دخول. أدخل بيانات التواصل واحتياجك وسننقلك مباشرة إلى متابعة الطلب والعقد والدفع.")}<div class="two-col"><section class="panel"><form data-form="start">${errors()}${contact}<div class="field"><label for="service">ما الخدمة التي تحتاجها؟</label><select id="service" name="service" required><option value="">اختر الخدمة</option>${state.config.services.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.title}</option>`).join("")}</select></div>${readySiteOptions(query,selected)}${field("title", "اسم المشروع أو عنوان الطلب", "text", 'required minlength="3" maxlength="160" placeholder="مثل: متجر لمنتجات العناية"')}${textarea("description", "حدّثنا عن فكرتك", 'required minlength="15" maxlength="8000" placeholder="ما الذي تريد بناءه؟ من سيستخدمه؟ وما أهم ما تتوقعه؟"')}<div class="form-grid">${field("budget", "الميزانية المتوقعة (اختياري)", "text", 'maxlength="100" placeholder="مثل: من 5,000 إلى 10,000 ر.س"')}${field("targetDate", "موعد الإطلاق المستهدف (اختياري)", "date")}</div>${promoField()}<button class="btn" type="submit">متابعة الطلب</button></form></section><aside><section class="panel"><div class="service-icon">${icon("spark")}</div><h2>المسار المباشر</h2><ol class="feature-list"><li><strong>01</strong> ترسل احتياجك دون إنشاء حساب.</li><li><strong>02</strong> نراجع التفاصيل ونجهز العرض.</li><li><strong>03</strong> تراجع العقد وتوافق عليه.</li><li><strong>04</strong> تنتقل للدفع ثم تتابع التنفيذ.</li></ol></section><div class="notice">لن نطلب منك كلمة مرور لبدء الطلب.</div></aside></div></div>`;
}
function ordersTable(orders, admin = false) {
  if (!orders.length)
    return empty(
      "لا توجد طلبات بعد",
      "ستظهر هنا طلبات المشاريع ومشتريات المنتجات الرقمية.",
      link("/start", "ابدأ أول مشروع"),
    );
  return `<div class="table-wrap"><table><thead><tr><th>الطلب</th>${admin ? "<th>العميل</th>" : ""}<th>الحالة</th><th>القيمة</th><th>التاريخ</th><th><span class="sr-only">التفاصيل</span></th></tr></thead><tbody>${orders.map((o) => `<tr><td><a href="#/order/${o.id}">${E(o.title)}</a><div class="muted" dir="ltr">${E(o.number)}</div></td>${admin ? `<td>${E(o.customer.name)}</td>` : ""}<td>${badge(o)}</td><td class="money">${o.amount ? money(o.amount) : "لم يُحدّد بعد"}</td><td>${date(o.createdAt)}</td><td><a class="text-link" href="#/order/${o.id}">عرض</a></td></tr>`).join("")}</tbody></table></div>`;
}
async function dashboard(path) {
  const admin = state.user.role === "admin";
  const orders = await api("/api/orders" + (admin ? "?all=1" : ""));
  let summary = admin
    ? await api("/api/admin/summary")
    : {
        orders: orders.length,
        active: orders.filter(
          (o) => !["completed", "cancelled"].includes(o.status),
        ).length,
        completed: orders.filter((o) => o.status === "completed").length,
        contracts: orders.filter((o) => o.currentContract).length,
      };
  const tiles = admin
    ? [
        [summary.active, "طلبات نشطة"],
        [summary.customers, "عميل مسجّل"],
        [money(summary.revenue), "مبالغ مؤكدة"],
        [summary.openTickets, "تذاكر مفتوحة"],
      ]
    : [
        [summary.active, "مشاريع وطلبات نشطة"],
        [summary.completed, "طلبات مكتملة"],
        [summary.contracts, "عقود وعروض"],
        [summary.orders, "إجمالي الطلبات"],
      ];
  return workspace(
    path,
    `${pageHead(admin ? "لوحة إدارة انطلاقة" : `أهلًا، ${E(state.user.name.split(" ")[0])}`, "متابعة واضحة لكل ما يحتاج انتباهك.", link(admin ? "/admin/products" : "/start", admin ? "إدارة المنتجات" : "مشروع جديد"))}<div class="stats">${tiles.map(([v, l], i) => `<div class="stat ${i === 0 ? "featured" : ""}"><span class="value">${v}</span><span class="label">${l}</span></div>`).join("")}</div><div class="section-head"><h2>أحدث الطلبات</h2><a class="text-link" href="#${admin ? "/admin/orders" : "/orders"}">عرض جميع الطلبات</a></div>${ordersTable(orders.slice(0, 6), admin)}${!admin ? journey() : ""}${!admin ? `<div class="banner"><div><h2>للفكرة التالية مساحة.</h2><p>اكتشف الخدمات التي تدعم خطوتك القادمة.</p></div>${link("/services", "تصفّح الخدمات", "lime")}</div>` : ""}`,
  );
}
async function orderList(path) {
  const admin = path.startsWith("/admin");
  const orders = await api("/api/orders" + (admin ? "?all=1" : ""));
  return workspace(
    path,
    `${pageHead(admin ? "إدارة الطلبات" : "طلباتي", "طلبات الخدمات ومشترياتك الرقمية.", !admin ? link("/start", "طلب جديد") : "")}<div class="filter-row"><label class="sr-only" for="order-search">ابحث في الطلبات</label><input class="filter-input" id="order-search" type="search" placeholder="ابحث بالعنوان أو رقم الطلب" data-filter="orders"></div><div id="orders-list">${ordersTable(orders, admin)}</div>`,
  );
}
function progress(o) {
  const keys = [
    "received",
    "quoted",
    "awaiting_payment",
    "in_progress",
    "final_review",
    "completed",
  ];
  const labels = [
    "استلام الطلب",
    "العرض والاتفاق",
    "الدفع",
    "التنفيذ",
    "المراجعة",
    "التسليم",
  ];
  let idx = keys.indexOf(o.status);
  if (o.status === "reviewing") idx = 0;
  if (o.status === "paid") idx = 2;
  return `<div class="progress-steps">${keys.map((k, i) => `<div class="progress-step ${i <= idx ? "done" : ""}">${labels[i]}</div>`).join("")}</div>`;
}
function contractCard(q, o, history = false) {
  const provider = q.providerDetails || {}, doc = q.document;
  const documentSections = doc?.sections?.map(section => `<section class="contract-section"><h3>${E(section.title)}</h3><p class="pre">${E(section.body)}</p></section>`).join("") || "";
  const registrationLabel = provider.registrationType === "freelance_certificate" ? "شهادة العمل الحر" : "وثيقة النشاط";
  return `<div class="quote"><div class="quote-head"><div><h3>عرض السعر والعقد · الإصدار ${q.version}</h3><span class="muted small">${date(q.createdAt)}${doc ? " · سياسة " + E(doc.policyVersion) : " · نسخة سابقة محفوظة"}</span></div><div class="quote-price">${money(q.amount)}</div></div>${priceSummary(q)}<div class="contract-parties"><p><strong>مقدم الخدمة:</strong> ${E(q.parties?.provider || "إنطلاقة للتجارة الإلكترونية")}</p>${provider.address ? `<p><strong>العنوان:</strong> ${E(provider.address)}</p>` : ""}${provider.registrationNumber ? `<p><strong>${registrationLabel}:</strong> <b dir="ltr">${E(provider.registrationNumber)}</b></p>` : ""}${provider.activity ? `<p><strong>النشاط:</strong> ${E(provider.activity)}</p>` : ""}${provider.email || provider.phone ? `<p><strong>التواصل:</strong> ${E(provider.email || "")} · ${E(provider.phone || "")}</p>` : ""}<p><strong>العميل:</strong> ${E(q.parties?.customer?.name || o.customer.name)} · ${E(q.parties?.customer?.email || o.customer.email)}</p><p><strong>رقم الطلب:</strong> ${E(o.number)}</p></div><h3>نطاق الاتفاق</h3><p class="pre">${E(q.agreement)}</p><div class="key-values"><div><span>تاريخ التسليم</span><strong>${date(q.deliveryDate)}</strong></div><div><span>الموافقة</span><strong>${q.acceptedAt ? "وافق العميل في " + date(q.acceptedAt) : "بانتظار موافقة العميل"}</strong></div></div>${documentSections}<section class="contract-section"><h3>${doc ? "شروط الإصدار الإضافية" : "الشروط المتفق عليها"}</h3><p class="pre">${E(q.terms)}</p></section><p class="small muted">الموافقة سجل إلكتروني مرتبط بهذا الإصدار. تغييرات السعر أو النطاق أو البنود تتطلب نسخة جديدة وموافقة جديدة.</p><div class="actions no-print">${link("/contract/"+o.id+"/"+q.id,"عرض العقد وحفظه أو طباعته","secondary")}</div>${!history && state.user?.id === o.owner && o.status === "quoted" && !q.acceptedAt ? `<form class="spaced no-print" data-form="accept" data-id="${o.id}" data-contract="${q.id}">${errors()}<label class="check"><input name="accept" type="checkbox" required><span>قرأت بيانات الطرفين والنطاق والمخرجات والسعر والتسليم والتعديلات والدعم والملكية والإلغاء وجميع بنود هذا الإصدار وأوافق عليها.</span></label><button type="submit" class="btn">الموافقة على هذا الإصدار من العقد</button></form>` : ""}</div>`;
}
async function contractDocument(oid, cid) {
  const o = await api("/api/orders/" + oid);
  const q = o.contracts.find(q => q.id === cid);
  if (!q) throw Error("نسخة العقد غير موجودة.");
  return `<div class="wrap"><article class="panel printable-contract"><div class="eyebrow">انطلاقة · سجل تعاقد</div><h1>عقد ${E(o.title)}</h1>${contractCard(q,o,true)}<div class="button-row spaced no-print"><button class="btn" data-action="print">طباعة أو حفظ PDF</button>${link("/order/"+o.id,"العودة إلى الطلب","secondary")}</div></article></div>`;
}
function paymentCard(o) {
  if (!o.amount) return "";
  const bank = state.config?.bankTransfer?.bank || "البنك الأهلي السعودي";
  const iban = state.config?.bankTransfer?.iban || "SA3610000044000001058010";
  return `<section class="panel"><h2>ملخص الدفع</h2>${priceSummary(o)}${o.payment?.confirmed && !o.payment.revoked ? `<div class="notice">تم تأكيد استلام الدفع في ${date(o.payment.at)}.</div>${link("/invoice/" + o.id, "عرض إيصال الدفع", "secondary")}${o.type === "product" ? `<a class="btn spaced" href="/api/orders/${o.id}/download">${icon("download")} تنزيل المنتج</a>` : ""}` : o.status === "awaiting_payment" ? `<h3>تحويل بنكي — ${E(bank)}</h3><p class="small">حوّل المبلغ الموضح أعلاه، واذكر رقم الطلب في وصف التحويل.</p><div class="field"><label for="bank-iban">رقم الآيبان</label><input id="bank-iban" dir="ltr" readonly value="${E(iban)}" aria-label="رقم الآيبان لـ${E(bank)}"></div><p class="small muted">رقم الطلب: <strong dir="ltr">${E(o.number)}</strong></p>${o.files.filter(f => f.purpose === "payment_receipt").map(f => `<div class="file-row"><div><strong>إيصال تحويل مرفق</strong><small>${date(f.at)}</small></div><a class="btn secondary small" href="/api/orders/${o.id}/files/${f.id}">عرض الإيصال</a></div>`).join("")}${state.user.role !== "admin" ? `<form class="spaced" data-form="payment-receipt" data-id="${o.id}">${errors()}<div class="field"><label for="transfer-receipt">إرفاق إيصال التحويل</label><input id="transfer-receipt" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required><p class="hint">PDF أو PNG أو JPEG، حتى 10 ميجابايت. الإيصال متاح لك وللإدارة فقط.</p></div><button class="btn" type="submit">إرسال الإيصال للمراجعة</button></form>` : ""}<div class="notice warning">رفع الإيصال لا يؤكد الدفع تلقائيًا؛ تؤكد الإدارة الدفع بعد التحقق من وصول التحويل.</div>` : `<p class="small muted">${o.payment?.revoked ? "أُلغي استحقاق هذه الدفعة. راجع فريق الدعم." : "يأتي الدفع بعد اعتماد العرض والعقد."}</p>`}</section>`;
}
function adminOrderControls(o) {
  if (state.user.role !== "admin") return "";
  const transitions = {
    received: ["reviewing", "cancelled"],
    reviewing: ["cancelled"],
    quoted: ["cancelled"],
    awaiting_payment: ["cancelled"],
    paid: ["in_progress"],
    in_progress: ["final_review"],
    final_review: ["in_progress", "completed"],
  };
  const options = transitions[o.status] || [];
  return `<section class="panel"><h2>إجراءات الإدارة</h2>${options.length ? `<form data-form="status" data-id="${o.id}">${errors()}<div class="field"><label for="status">المرحلة التالية</label><select id="status" name="status">${options.map((s) => `<option value="${s}">${statuses[s]}</option>`).join("")}</select></div>${field("note", "تحديث يظهر للعميل", "text", 'maxlength="1000"')}<button class="btn secondary" type="submit">تحديث المرحلة</button></form>` : '<p class="small muted">لا يوجد انتقال متاح لهذه المرحلة.</p>'}${o.status === "awaiting_payment" ? `<form data-form="confirm-payment" data-id="${o.id}" class="spaced"><h3>تأكيد استلام ${money(o.amount)}</h3>${errors()}${field("reference", "مرجع التحويل أو التحصيل", "text", 'required minlength="3" maxlength="150"')}<label class="check"><input type="checkbox" required><span>تحققت فعليًا من استلام المبلغ.</span></label><button class="btn" type="submit">تسجيل الدفع المؤكد</button></form>` : ""}${o.payment?.confirmed && !o.payment.revoked ? `<details class="spaced"><summary>إلغاء استحقاق الدفع</summary><form data-form="revoke-payment" data-id="${o.id}" class="spaced">${errors()}${textarea("reason", "سبب الإلغاء", 'required minlength="5" maxlength="500"')}<p class="small muted">يسحب صلاحية تنزيل المنتج ويلغي الطلب. لا ينفّذ استردادًا ماليًا من البنك.</p><label class="check"><input type="checkbox" required><span>أؤكد إلغاء الاستحقاق لهذا الطلب.</span></label><button class="btn danger" type="submit">إلغاء الاستحقاق</button></form></details>` : ""}</section>`;
}
async function orderDetail(path, oid) {
  const o = await api("/api/orders/" + oid),
    q = o.contracts.find((q) => q.id === o.currentContract);
  if (state.user?.role === "admin") o.contractProvider = await api("/api/admin/contract-provider").catch(() => ({}));
  return workspace(
    path,
    `<div class="breadcrumb"><a href="#${state.user.role === "admin" ? "/admin/orders" : "/orders"}">الطلبات</a><span>/</span><span dir="ltr">${E(o.number)}</span></div>${pageHead(E(o.title), `${o.type === "product" ? "طلب منتج رقمي" : "طلب خدمة"} · ${date(o.createdAt)}`, badge(o))}${o.type === "service" ? progress(o) : ""}<div class="two-col"><div><section class="panel"><h2>تفاصيل الطلب</h2><p class="pre">${E(o.description)}</p>${o.siteOptions ? `<div class="notice"><strong>النموذج: ${E(o.siteOptions.template.title)}</strong><p>الإضافات المطلوبة: ${o.siteOptions.addons.map(a=>E(a.title)).join("، ") || "دون إضافات"}. يشملها العرض فقط بحسب الاتفاق المكتوب.</p></div>` : ""}${!o.amount ? priceSummary(o) : ""}<div class="key-values"><div><span>صاحب الطلب</span><strong>${E(o.customer.name)}</strong></div><div><span>الميزانية المذكورة</span><strong>${E(o.budget || "غير محددة")}</strong></div></div></section>${
      q
        ? `<section class="panel"><h2>العرض والعقد</h2>${contractCard(q, o)}${
            o.contracts.length > 1
              ? `<details class="spaced"><summary>الإصدارات السابقة (${o.contracts.length - 1})</summary>${o.contracts
                  .filter((x) => x.id !== o.currentContract)
                  .map(
                    (x) =>
                      `<div class="spaced">${contractCard(x, o, true)}</div>`,
                  )
                  .join("")}</details>`
              : ""
          }</section>`
        : ""
    }${state.user.role === "admin" && o.type === "service" && (!o.payment?.confirmed || o.payment.revoked) && ["received", "reviewing", "quoted", "awaiting_payment"].includes(o.status) ? quoteForm(o,q) : ""}<section class="panel"><h2>محادثة الطلب</h2>${o.messages.length ? o.messages.map((x) => `<div class="message ${x.role === "admin" ? "admin" : ""}"><div class="message-meta"><strong>${E(x.by)}${x.role === "admin" ? " · فريق انطلاقة" : ""}</strong><span>${time(x.at)}</span></div><p class="pre">${E(x.message)}</p></div>`).join("") : '<p class="muted small">أضف سؤالًا أو ملاحظة لفريق العمل.</p>'}<form data-form="message" data-id="${o.id}" class="spaced">${errors()}${textarea("message", "رسالتك", 'required maxlength="4000"')}<button class="btn" type="submit">إرسال الرسالة</button></form></section><section class="panel"><h2>المرفقات</h2>${o.files.map((f) => `<div class="file-row"><div class="file-info"><strong>${f.purpose === "payment_receipt" ? "إيصال تحويل بنكي · " : ""}${E(f.name)}</strong><small>${E(f.by)} · ${(f.size / 1024).toFixed(0)} KB</small></div><a class="btn secondary small" href="/api/orders/${o.id}/files/${f.id}">${icon("download")} تنزيل</a></div>`).join("") || '<p class="small muted">لا توجد مرفقات بعد.</p>'}<form class="spaced" data-form="order-file" data-id="${o.id}">${errors()}<div class="field"><label for="attachment">إضافة ملف أو إثبات دفع</label><input class="file-input" id="attachment" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required><p class="hint">PDF أو PNG أو JPEG، حتى 10 ميجابايت. الملفات متاحة لك وللإدارة فقط.</p></div><button class="btn secondary" type="submit">رفع المرفق</button></form></section></div><aside>${paymentCard(o)}${adminOrderControls(o)}<section class="panel"><h2>سجل المشروع</h2><ul class="timeline">${[
      ...o.events,
    ]
      .reverse()
      .map(
        (ev) =>
          `<li><strong>${E(ev.message)}</strong><small>${date(ev.at)} · ${E(ev.actor)}</small></li>`,
      )
      .join("")}</ul></section></aside></div>`,
  );
}
async function store() {
  const products = await api("/api/products");
  return `<div class="wrap"><section class="store-intro"><div><div class="eyebrow">متجر إنطلاقة</div><h1>اختيارات تصنع<br><em>بدايتك القادمة.</em></h1><p>حلول رقمية وموارد عملية، يجمعها هدف واحد: أن تمنح مشروعك ما يحتاجه لينمو.</p><a class="text-link" href="#/start">تحتاج حلًا مخصصًا؟ لنتحدث ${icon("arrow")}</a></div><div class="store-feature"><img src="/assets/catalog-content.webp" alt="تصور إبداعي لموارد رقمية بهوية إنطلاقة" width="1024" height="1024"><span>صُمّم لفكرتك. اختير لخطوتك.</span></div></section>${launchBanner()}<section class="panel ready-site-callout"><span class="eyebrow">منتج جديد</span><h2>مواقع جاهزة تُخصّص لمشروعك.</h2><p>ثلاثة نماذج فعلية؛ مع خيارات الاستضافة والدومين والرفع.</p>${link("/ready-websites", "اختر موقعك الجاهز")}</section><section class="collections-section"><div class="section-head"><div><div class="eyebrow">مسارات تبدأ من احتياجك</div><h2>اكتشف عالم إنطلاقة.</h2></div><span class="small muted">خدمات تُنفّذ حسب طلبك</span></div><div class="collection-grid">${state.config.services.map((s) => `<a class="collection-card" href="#/service/${E(s.id)}"><img src="${(artwork[s.id] || artwork.website).image}" alt="" loading="lazy" width="1024" height="1024"><div><span>${E(s.title)}</span>${icon("arrow")}</div></a>`).join("")}</div></section><section class="section" aria-labelledby="digital-products"><div class="section-head"><div><div class="eyebrow">موارد لمشروعك</div><h2 id="digital-products">المنتجات الرقمية</h2></div>${products.length ? `<label class="catalog-search">${icon("search")}<input type="search" data-product-search placeholder="ابحث عن منتج…" aria-label="البحث في المنتجات الرقمية"></label>` : ""}</div>${products.length ? `<div class="catalog-toolbar"><span>${products.length.toLocaleString("ar-SA")} منتج متاح</span><span>تجد ملفات مشترياتك داخل حسابك</span></div><div class="three-col product-grid">${products.map((p) => `<article class="product-card" data-product-text="${E((p.title + " " + p.category + " " + p.description).toLowerCase())}">${productImage(p)}<div class="product-body"><h3>${E(p.title)}</h3><p class="pre">${E(p.description)}</p><div class="product-bottom"><div class="price">${money(p.amount)}</div>${link("/checkout/" + p.id, "التفاصيل " + icon("arrow"), "secondary small")}</div></div></article>`).join("")}</div><div class="empty catalog-no-results" hidden><h3>لم نجد منتجًا بهذا الاسم</h3><p>جرّب كلمة أخرى أو تصفّح جميع المنتجات.</p></div>` : `<div class="catalog-empty"><div class="catalog-empty-visual">${icon("bag")}<span>CURATED FOR YOUR NEXT CHAPTER</span></div><div><span class="eyebrow">شيء يستحق الانتظار</span><h3>نجهّز رفوفنا الرقمية.</h3><p>لم تُنشر منتجات للبيع بعد. وحتى تكتمل المجموعة، يمكنك طلب حل مصمّم خصيصًا لمشروعك.</p>${link("/services", "اكتشف حلولنا " + icon("arrow"), "secondary")}</div></div>`}</section><section class="assistant-callout"><div class="assistant-orb">${icon("spark")}</div><div><h2>تبحث عن الاختيار المناسب؟</h2><p>تحدث مع مساعد انطلاقة عن احتياجك وخطوتك القادمة.</p></div><button class="btn secondary" type="button" data-assistant-open>ساعدني في الاختيار ${icon("arrow")}</button></section></div>`;
}

async function checkout(pid) {
  const products = await api("/api/products"),
    p = products.find((p) => p.id === pid);
  if (!p) throw Error("المنتج غير متاح حاليًا.");
  return `<div class="wrap"><div class="checkout">${pageHead("مراجعة طلب المنتج", "راجع تفاصيل المنتج قبل إنشاء الطلب.")}<section class="panel">${productImage(p, "checkout-cover")}<h2>${E(p.title)}</h2><p class="pre">${E(p.description)}</p><div class="invoice-total"><span>الإجمالي</span><span>${money(p.amount)}</span></div><form class="spaced" data-form="checkout" data-id="${p.id}">${errors()}${promoField()}<div class="notice">ينشئ هذا الزر طلب شراء فقط. الدفع بتحويل بنكي لـ${E(state.config?.bankTransfer?.bank || "البنك الأهلي السعودي")} مع إرفاق الإيصال داخل الطلب. يُتاح التنزيل بعد تأكيد الإدارة استلام المبلغ.</div><label class="check"><input name="acceptTerms" type="checkbox" required><span>اطلعت على وصف المنتج والسعر و<a href="#/terms" target="_blank" rel="noopener">شروط الشراء</a> وأوافق عليها.</span></label><button class="btn" type="submit">إنشاء طلب الشراء</button></form></section></div></div>`;
}
async function contracts(path) {
  const orders = (await api("/api/orders")).filter((o) => o.contracts.length);
  return workspace(
    path,
    `${pageHead("العقود وعروض الأسعار", "راجع الاتفاقات المعروضة عليك والإصدارات المحفوظة.")}${
      orders.length
        ? orders
            .map(
              (o) =>
                `<section class="panel"><div class="section-head"><h2>${E(o.title)}</h2>${link("/order/" + o.id, "فتح الطلب", "secondary small")}</div>${contractCard(
                  o.contracts.find((q) => q.id === o.currentContract),
                  o,
                )}</section>`,
            )
            .join("")
        : empty(
            "لا توجد عقود بعد",
            "عندما يصدر الفريق عرض سعر، سيظهر هنا للاطلاع والموافقة.",
          )
    }`,
  );
}
async function invoices(path) {
  const orders = (await api("/api/orders")).filter((o) => o.amount);
  return workspace(
    path,
    `${pageHead("المدفوعات", "قيم طلباتك وإيصالات المبالغ المؤكدة.")}${orders.length ? `<div class="table-wrap"><table><thead><tr><th>الطلب</th><th>المبلغ</th><th>الحالة</th><th>المستند</th></tr></thead><tbody>${orders.map((o) => `<tr><td><a href="#/order/${o.id}">${E(o.title)}</a></td><td>${money(o.amount)}</td><td>${o.payment?.confirmed && !o.payment.revoked ? "تم التأكيد" : o.payment?.revoked ? "أُلغي الاستحقاق" : "غير مدفوع"}</td><td>${o.payment?.confirmed ? `<a class="text-link" href="#/invoice/${o.id}">إيصال الدفع</a>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : empty("لا توجد مدفوعات بعد", "ستظهر قيمة كل طلب هنا بعد إصدار العرض أو طلب منتج.")}`,
  );
}
async function invoice(oid) {
  const o = await api("/api/orders/" + oid);
  if (!o.payment?.confirmed) throw Error("لا يوجد إيصال دفع مؤكد لهذا الطلب.");
  return `<div class="wrap"><article class="invoice"><div class="invoice-head"><div class="brand">انطلاقة<small>INTLAKAH</small></div><div><h1>إيصال استلام دفع</h1><div class="small muted" dir="ltr">${E(o.payment.invoiceNumber)}</div></div></div>${o.payment.revoked ? '<div class="notice warning">هذا الاستحقاق ملغى؛ لا يُستخدم كإثبات لدفعة فعالة.</div>' : ""}<div class="key-values"><div><span>العميل</span><strong>${E(o.customer.name)}</strong><p class="small">${E(o.customer.email)}</p></div><div><span>تاريخ الاستلام</span><strong>${date(o.payment.at)}</strong></div><div><span>رقم الطلب</span><strong dir="ltr">${E(o.number)}</strong></div><div><span>مرجع الدفع</span><strong>${E(o.payment.reference)}</strong></div></div><div class="table-wrap spaced"><table><thead><tr><th>الوصف</th><th>القيمة</th></tr></thead><tbody><tr><td>${E(o.title)}</td><td>${money(o.payment.amount)}</td></tr></tbody></table></div><div class="invoice-total"><span>المبلغ المستلم</span><span>${money(o.payment.amount)}</span></div><p class="small muted spaced">يوثق هذا الإيصال المبلغ الذي أكدته الإدارة، ولا يُعد فاتورة ضريبية.</p><div class="button-row spaced no-print"><button class="btn" data-action="print">طباعة الإيصال</button>${link("/order/" + o.id, "العودة إلى الطلب", "secondary")}</div></article></div>`;
}
async function notifications(path) {
  const orders = await api("/api/orders");
  const events = orders
    .flatMap((o) =>
      o.events.map((ev) => ({ ...ev, orderId: o.id, title: o.title })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  return workspace(
    path,
    `${pageHead("تحديثات مشاريعك", "آخر المستجدات المسجلة على طلباتك.")}${
      events.length
        ? `<section class="panel"><ul class="timeline">${events
            .slice(0, 100)
            .map(
              (ev) =>
                `<li><strong>${E(ev.message)}</strong><a class="text-link small" href="#/order/${ev.orderId}">${E(ev.title)}</a><br><small>${time(ev.at)}</small></li>`,
            )
            .join("")}</ul></section>`
        : empty(
            "لا توجد تحديثات بعد",
            "ستظهر هنا مراحل مشاريعك ورسائل تحديث الطلبات.",
          )
    }`,
  );
}
async function support(path) {
  const tickets = await api("/api/tickets");
  return workspace(
    path,
    `${pageHead(state.user.role === "admin" ? "تذاكر الدعم" : "الدعم والمساعدة", "محادثة خاصة لمتابعة سؤالك مع الفريق.")}<section class="panel contact-channel"><h2>قناة WhatsApp</h2><p>راسل فريق انطلاقة على الرقم 0553575760. يفتح الزر محادثة مباشرة؛ لا يرسل بيانات حسابك أو طلباتك تلقائيًا. لحفظ الملاحظات ضمن مشروعك، استخدم محادثة الطلب أو تذكرة الدعم.</p>${whatsappLink()}</section><div class="two-col"><section class="panel"><h2>التذاكر</h2>${tickets.length ? tickets.map((t) => `<details class="ticket"><summary><span class="ticket-head"><strong>${E(t.subject)}</strong><span class="badge ${t.status === "closed" ? "completed" : "received"}">${t.status === "closed" ? "مغلقة" : "مفتوحة"}</span></span><span class="small muted">${E(t.name)} · ${date(t.createdAt)}</span></summary><div class="spaced">${t.messages.map((m) => `<div class="message ${m.role === "admin" ? "admin" : ""}"><div class="message-meta"><strong>${E(m.by)}</strong><span>${date(m.at)}</span></div><p class="pre">${E(m.message)}</p></div>`).join("")}<form data-form="ticket-reply" data-id="${t.id}">${errors()}${textarea("message", "إضافة رد", 'required maxlength="5000"')}${state.user.role === "admin" ? `<div class="field"><label for="ticket-status-${t.id}">حالة التذكرة</label><select id="ticket-status-${t.id}" name="status"><option value="open" ${t.status === "open" ? "selected" : ""}>مفتوحة</option><option value="closed" ${t.status === "closed" ? "selected" : ""}>مغلقة</option></select></div>` : ""}<button class="btn" type="submit">إرسال الرد</button></form></div></details>`).join("") : '<p class="muted">لا توجد تذاكر حتى الآن.</p>'}</section><section class="panel"><h2>تذكرة جديدة</h2><form data-form="ticket">${errors()}${field("subject", "عنوان السؤال", "text", 'required minlength="3" maxlength="180"')}${textarea("message", "كيف يمكننا مساعدتك؟", 'required minlength="10" maxlength="5000"')}<button class="btn" type="submit">إرسال التذكرة</button></form></section></div>`,
  );
}
function profile(path) {
  return workspace(
    path,
    `${pageHead("إعدادات الحساب", "بيانات حسابك ووسائل حمايته.")}<div class="two-col"><div><section class="panel"><h2>بياناتك</h2><div class="key-values"><div><span>الاسم</span><strong>${E(state.user.name)}</strong></div><div><span>البريد الإلكتروني</span><strong>${E(state.user.email)}</strong></div><div><span>تاريخ الانضمام</span><strong>${date(state.user.createdAt)}</strong></div><div><span>الجوال</span><strong>${state.user.phoneVerified ? E(state.user.phone) + " · موثّق" : "لم يتم توثيقه"}</strong></div></div></section><section class="panel"><h2>تغيير كلمة المرور</h2><form data-form="password">${errors()}${field("currentPassword", "كلمة المرور الحالية", "password", 'required autocomplete="current-password" maxlength="128"')}${field("password", "كلمة المرور الجديدة", "password", 'required minlength="12" maxlength="128" autocomplete="new-password"')}<p class="small muted">تغيير كلمة المرور ينهي الجلسات الأخرى المفتوحة لحسابك.</p><button class="btn" type="submit">حفظ كلمة المرور</button></form></section></div><section class="panel"><h2>رقم الجوال للدخول</h2>${state.user.loginPhone ? `<p dir="ltr">${E(state.user.loginPhone)}</p><p class="small muted">الدخول بهذا الرقم وكلمة المرور. توثيق ملكية الرقم عبر SMS منفصل.</p>` : `<p class="small muted">اربط رقمك لتستخدمه مع كلمة المرور بدل البريد.</p><form data-form="login-phone">${errors()}${field("phone", "رقم الجوال", "tel", 'required placeholder="05XXXXXXXX" autocomplete="tel"')}${field("currentPassword", "كلمة المرور الحالية", "password", 'required maxlength="128" autocomplete="current-password"')}<button class="btn" type="submit">ربط رقم الدخول</button></form>`}<h2 class="spaced">توثيق ملكية الجوال</h2>${state.config.smsReady ? `<p class="small muted">أضف رقمك بصيغته الدولية، ثم أدخل رمز الرسالة.</p><form data-form="phone-send">${errors()}${field("phone", "رقم الجوال", "tel", 'required placeholder="+9665XXXXXXXX" autocomplete="tel"')}<button class="btn secondary" type="submit">إرسال رمز التحقق</button></form>${state.challenge ? `<form class="spaced" data-form="phone-check">${errors()}${field("code", "رمز التحقق", "text", 'required inputmode="numeric" autocomplete="one-time-code" minlength="4" maxlength="10"')}<button class="btn" type="submit">تأكيد الرقم</button></form>` : ""}` : '<p class="muted">التحقق برسائل الجوال غير مفعّل حاليًا. الدخول برقم الجوال وكلمة المرور متاح؛ الرقم لا يُعتبر موثّقًا عبر SMS.</p>'}</section></div>`,
  );
}
async function adminProducts(path) {
  const products = await api("/api/admin/products");
  return workspace(
    path,
    `${pageHead("إدارة المنتجات الرقمية", "لا يظهر المنتج للبيع إلا بعد رفع ملفه ونشره.")}<div class="two-col"><section><div class="panel"><h2>المنتجات الحالية</h2>${products.length ? products.map((p) => `<article class="ticket admin-product"><div class="admin-product-image">${productImage(p)}</div><div class="ticket-head"><h3>${E(p.title)}</h3><span class="badge ${p.published ? "completed" : "reviewing"}">${p.published ? "منشور" : "مسودة"}</span></div><p class="small muted">${E(p.category)} · ${money(p.amount)}</p><p class="small pre">${E(p.description)}</p><p class="small">${p.file ? "الملف: " + E(p.file.name) : "لم يُرفع ملف المنتج بعد."}</p><form data-form="product-file" data-id="${p.id}">${errors()}<div class="field"><label for="file-${p.id}">ملف المنتج</label><input id="file-${p.id}" class="file-input" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required><p class="hint">PDF أو PNG أو JPEG، بحد أقصى 10 ميجابايت.</p></div><button class="btn secondary small" type="submit">${p.file ? "تحديث الملف" : "رفع الملف"}</button></form><button class="btn small spaced ${p.published ? "secondary" : ""}" data-action="publish-product" data-id="${p.id}" data-published="${!p.published}" ${!p.file ? "disabled" : ""}>${p.published ? "إخفاء من المتجر" : "نشر في المتجر"}</button><details class="spaced"><summary>تعديل بيانات المنتج</summary><form class="spaced" data-form="product-edit" data-id="${p.id}">${errors()}${field("title", "عنوان المنتج", "text", `required minlength="3" maxlength="140" value="${E(p.title)}"`)}${field("category", "التصنيف", "text", `required minlength="2" maxlength="60" value="${E(p.category)}"`)}<div class="field"><label>وصف المنتج<textarea name="description" required minlength="10" maxlength="5000">${E(p.description)}</textarea></label></div>${field("amount", "السعر (ر.س)", "number", `required min="1" step="0.01" value="${p.amount / 100}"`)}${coverPicker(p)}<button class="btn small" type="submit">حفظ التعديل</button></form></details></article>`).join("") : '<p class="muted">لا توجد منتجات. أضف المنتج الأول مع ملف حقيقي قابل للتسليم.</p>'}</div></section><section class="panel"><h2>إضافة منتج</h2><form data-form="product">${errors()}${field("title", "اسم المنتج", "text", 'required minlength="3" maxlength="140"')}${field("category", "التصنيف", "text", 'required minlength="2" maxlength="60" placeholder="مثل: دليل عمل"')}${textarea("description", "وصف المنتج ومحتواه", 'required minlength="10" maxlength="5000"')}${field("amount", "السعر النهائي (ر.س)", "number", 'required min="1" max="1000000" step="0.01"')}${coverPicker()}<button class="btn" type="submit">حفظ مسودة المنتج</button></form></section></div>`,
  );
}
async function customers(path) {
  const users = await api("/api/admin/customers");
  return workspace(
    path,
    `${pageHead("العملاء", "الحسابات المسجلة في المنصة.")}<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الجوال</th><th>تاريخ التسجيل</th></tr></thead><tbody>${
      users
        .filter((u) => u.role === "customer")
        .map(
          (u) =>
            `<tr><td>${E(u.name)}</td><td>${E(u.email)}</td><td>${u.phoneVerified ? E(u.phone) : "غير موثّق"}</td><td>${date(u.createdAt)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4">لا توجد حسابات عملاء حتى الآن.</td></tr>'
    }</tbody></table></div>`,
  );
}
function about() {
  return `<div class="wrap"><section class="about-intro"><div class="eyebrow">إنطلاقة للتجارة الإلكترونية</div><h1>نؤمن أن لكل فكرة<br><em>بداية تستحقها.</em></h1><p>نقرّب المسافة بين ما تتخيّله وما تبنيه.<br>بتصميم مدروس، وحلول عملية، وعلاقة تبدأ بالوضوح.</p></section><section class="brand-section"><div class="brand-copy"><div class="eyebrow">شريك في رحلتك الرقمية</div><h2>هوية واضحة.<br>وتفاصيل تصنع الأثر.</h2><p>تجمع إنطلاقة التجارة الإلكترونية والبرمجة والتسويق وصناعة المحتوى. ننطلق من احتياجك، ونصنع له حلًا مترابطًا يعبّر عن مشروعك ويساعدك على التقدّم.</p>${link("/start", "لنتعرّف إلى فكرتك " + icon("arrow"))}</div><div class="about-logo-stage"><div class="geometry" aria-hidden="true"></div><img src="/assets/brand-logo-transparent.png" alt="شعار إنطلاقة" width="640" height="550"><span>إنطلاقة للتجارة الإلكترونية</span></div></section><section class="section"><div class="section-head"><div><div class="eyebrow">طريقتنا في العمل</div><h2>وضوح من البداية إلى التسليم.</h2></div><p>كل خطوة لها هدف، وكل تفصيلة لها مكان.</p></div>${processSteps()}</section><section class="values-grid"><article><span>01 /</span><h3>نفهم قبل أن نبني</h3><p>نبدأ بالسؤال الصحيح لنقدّم الحل المناسب لمشروعك.</p></article><article><span>02 /</span><h3>التفاصيل مهمة</h3><p>تجربة مترابطة، من الانطباع الأول إلى سهولة الاستخدام.</p></article><article><span>03 /</span><h3>نبقى على تواصل</h3><p>متابعة واضحة واتفاقات وملاحظات في مساحة واحدة.</p></article></section><section class="banner"><div><div class="eyebrow">لنكتب الفصل القادم</div><h2>طموحك هو نقطة البداية.</h2><p>أخبرنا عنه، لنصنع الخطوة التالية معًا.</p></div>${link("/start", "ابدأ مشروعك " + icon("arrow"), "lime")}</section></div>`;
}

function catalogControls() {
  return `<div class="catalog-controls"><label class="catalog-search">${icon("search")}<input type="search" data-service-search aria-label="البحث في الخدمات" placeholder="عن ماذا تبحث لمشروعك؟"></label><div class="category-tabs" role="group" aria-label="تصنيف الخدمات">${["الكل", ...new Set(state.config.services.map((s) => s.category))].map((category, i) => `<button class="category-tab ${i === 0 ? "active" : ""}" type="button" data-service-filter="${E(category)}" aria-pressed="${i === 0}">${E(category)}</button>`).join("")}</div><p class="filter-summary" id="filter-summary" role="status">جميع الخدمات · ${state.config.services.length.toLocaleString("ar-SA")} خدمة</p></div>`;
}
function serviceDetail(sid) {
  const s = state.config.services.find((s) => s.id === sid);
  if (!s)
    return `<div class="wrap section">${empty("الخدمة غير موجودة", "اختر خدمة من الكتالوج.", link("/services", "جميع الخدمات"))}</div>`;
  const external = [
    "apps",
    "noon",
    "amazon",
    "payments",
    "dropshipping",
  ].includes(s.id);
  return `<div class="wrap"><nav class="breadcrumbs" aria-label="مسار الصفحة"><a href="#/services">خدماتنا</a><span>/</span><span>${E(s.title)}</span></nav><section class="service-detail"><div class="service-detail-copy"><span class="eyebrow">${E(s.category)}</span><h1>${E(s.title)}</h1><p>${E(s.description)}</p><div class="actions">${link("/start?service=" + s.id, "اطلب هذه الخدمة " + icon("arrow"))}<button class="btn secondary" type="button" data-assistant-open>استكشف مع المساعد ${icon("spark")}</button></div>${servicePrice(s, true)}<p class="service-assurance">عرض سعر ونطاق عمل واضح قبل البدء.</p></div><img class="detail-art" src="${(artwork[s.id] || artwork.website).image}" alt="${E(s.title)}" width="1536" height="1024"></section><section class="service-includes"><div><span class="eyebrow">تفاصيل تصنع بداية أفضل</span><h2>ما الذي نعمل عليه معك؟</h2><p>نحدّد المخرجات النهائية بحسب مشروعك في عرض الخدمة.</p></div><div class="includes-list">${(s.includes || []).map((item, i) => `<div><span>0${i + 1}</span><h3>${E(item)}</h3>${icon("check")}</div>`).join("")}</div></section>${external ? '<p class="service-fineprint">الرسوم والاشتراكات وحسابات الجهات الخارجية تُحدَّد حسب الاتفاق. تخضع الموافقات والنشر لشروط ومراجعة كل منصة.</p>' : ""}${s.id === "ready-website" ? link("/ready-websites", "معاينة النماذج والخيارات", "secondary") : ""}${nextStep(s.id)}<section class="section">${processSteps()}</section></div>`;
}
function assistantPrivacy() {
  return `<h2>مساعد انطلاقة</h2><p>${state.config?.assistantMode === "openai" ? "عند إرسال سؤال، تعالج خدمة مساعدة خارجية رسائلك وسياق المحادثة وفق سياسة المزود. لا تصل الخدمة إلى حسابك أو طلباتك أو ملفاتك." : "يعالج مساعد انطلاقة أسئلتك على خادم المنصة ليوجهك باستخدام معلومات الخدمات والأسعار والعروض المعلنة. لا يستخدم خدمة محادثة خارجية، ولا يصل إلى حسابك أو طلباتك أو ملفاتك."} لا نحفظ المحادثة في قاعدة بيانات المنصة أو تخزين المتصفح؛ تبقى في ذاكرة هذه الصفحة حتى تبدأ محادثة جديدة أو تحدّث الصفحة. لا ترسل كلمات المرور أو بيانات الدفع.</p>`;
}
function legal(privacy) {
  return `<div class="wrap"><article class="legal panel"><div class="eyebrow">انطلاقة</div><h1>${privacy ? "سياسة الخصوصية" : "الشروط والأحكام"}</h1>${privacy ? `<h2>قناة WhatsApp</h2><p>يفتح زر التواصل تطبيق أو موقع WhatsApp على رقم انطلاقة. تختار أنت إرسال الرسالة؛ لا تنقل المنصة تفاصيل حسابك أو ملفاتك تلقائيًا. تخضع المحادثة لسياسات WhatsApp. استخدم تذاكر الدعم لحفظ مراسلات المشروع داخل المنصة.</p><h2>قياس الزيارات الاختياري</h2><p>عند تفعيل Google Analytics، نطلب موافقتك قبل تحميله ونقيس صفحات الخدمات العامة فقط. لا نرسل بيانات الحسابات والطلبات والملفات أو رموز الدخول. يمكنك الرفض أو سحب الموافقة من خيارات قياس الزيارات أسفل الموقع. يعالج Google بيانات الزيارة وفق سياساته.</p>${assistantPrivacy()}<h2>ما الذي نحفظه؟</h2><p>نحفظ الاسم والبريد الإلكتروني وبيانات الحساب، وتفاصيل الطلبات والعقود والموافقات، والرسائل والمرفقات وبيانات الدفع التي تسجلها الإدارة. عند توثيق رقم الجوال نحفظ الرقم وحالة التوثيق.</p><h2>لماذا نستخدم هذه البيانات؟</h2><p>لإدارة حسابك وتنفيذ طلباتك والرد على استفساراتك وحماية الوصول إلى ملفاتك. لا تعرض المنصة طلباتك ومرفقاتك للزوار أو العملاء الآخرين.</p><h2>من يصل إليها؟</h2><p>صاحب الحساب وإدارة انطلاقة بحسب الحاجة إلى تنفيذ الخدمة. عند تفعيل التحقق بالجوال يُرسل رقمك إلى مزود الرسائل لإرسال رمز التحقق. تخزَّن البيانات لدى مزود الاستضافة.</p><h2>ملفات الارتباط</h2><p>نستخدم ملف ارتباط ضروريًا لتسجيل الدخول وحماية الجلسة. تنتهي الجلسة عند تسجيل الخروج أو بعد انتهاء مدتها.</p><h2>طلبات الخصوصية</h2><p>يمكنك طلب مراجعة بياناتك أو تصحيحها أو حذفها عبر تذكرة دعم داخل حسابك. تخضع بيانات الطلبات والعقود المكتملة للحاجة إلى حفظ سجل التعامل.</p>` : `<h2>الحساب واستخدام المنصة</h2><p>استخدم معلومات صحيحة وحافظ على سرية كلمة المرور. لا ترفع محتوى لا تملك حق استخدامه، أو ملفات ضارة أو بيانات شخصية لا تحتاجها الخدمة.</p><h2>طلبات الخدمات</h2><p>إرسال طلب مشروع لا ينشئ التزامًا بالدفع. يتحدد نطاق العمل والسعر وموعد التسليم في العرض والعقد الذي تراجعه وتوافق عليه داخل حسابك.</p><h2>الموافقات والتعديلات</h2><p>تُحفظ موافقتك مع وقتها وإصدار الاتفاق. تغيير نطاق العمل أو السعر يحتاج اتفاقًا جديدًا. تبقى الإصدارات السابقة محفوظة في الطلب.</p><h2>المنتجات الرقمية والدفع</h2><p>راجع وصف المنتج والسعر قبل إنشاء الطلب. تتاح الملفات في حسابك بعد تأكيد الإدارة استلام الدفع. رفع إثبات التحويل لا يُعد تأكيدًا تلقائيًا للدفع.</p><h2>النطاق والمراجعة والدعم</h2><p>يحدد كل عقد المخرجات والاستثناءات والمتطلبات وجولات التعديل ومهلة الملاحظات ودعم تصحيح العيوب. لا يعد صمت العميل موافقة تلقائية؛ يوثق اعتماد التسليم والملاحظات في الطلب. الأعمال الإضافية تحتاج عرضًا وموافقة مستقلة.</p><h2>الإلغاء والاسترداد والتأخير</h2><p>قدّم طلب الإلغاء أو عدم المطابقة عبر تذكرة دعم ليحفظ ضمن سجل الطلب. تراجع الرسوم والأعمال المنفذة وفق العقد والحقوق النظامية؛ لا تعني إضافة خدمة مخصصة إسقاط جميع حقوق الإلغاء. يبقى حق العدول خلال سبعة أيام عند عدم الانتفاع والاستثناءات المنطبقة، وحقوق عدم المطابقة والتأخر، وفق النظام. لا ينفذ النظام استردادًا بنكيًا تلقائيًا.</p><h2>هوية مقدم الخدمة والرسوم</h2><p>يتضمن العقد اسم مقدم الخدمة القانوني وعنوانه وبيانات وثيقة نشاطه إن وجدت، والإجمالي شامل الرسوم والضرائب الواجبة، مع فصل رسوم المزوّد الخارجي وتجديدها. لا تحجز استضافة أو دومين بمجرد إرسال الطلب.</p><h2>حقوق الاستخدام</h2><p>تُحدد حقوق استخدام مخرجات الخدمة في الاتفاق. لا يجوز إعادة بيع الملفات الرقمية أو توزيعها إلا إذا كان وصف المنتج أو اتفاق منفصل يجيز ذلك.</p>`}<h2>التواصل</h2><p>للاستفسار عن هذه السياسة أو طلب المساعدة، استخدم <a class="text-link" href="#/support">الدعم والمساعدة</a>${state.config.businessEmail ? " أو البريد " + E(state.config.businessEmail) : ""}.</p></article></div>`;
}

async function render() {
  const seq = ++state.sequence;
  const raw = location.hash.slice(1) || "/";
  const [path, search = ""] = raw.split("?");
  const query = new URLSearchParams(search);
  if (path === "/reset-password" && query.has("token")) {
    clearRecovery();
    const token = query.get("token") || "";
    if (/^[a-f0-9]{64}$/.test(token)) state.resetToken = token;
    window.history.replaceState(null, "", "#/reset-password");
    query.delete("token");
  } else if (!["/forgot-password", "/verify", "/reset-password"].includes(path)) {
    clearRecovery();
  }
  header(path);
  main.innerHTML =
    '<div class="page-loading" role="status">جارٍ التحميل…</div>';
  try {
    await initialize();
    if (seq !== state.sequence) return;
    header(path);
    const privateRoute =
      [
        "/dashboard",
        "/orders",
        "/contracts",
        "/invoices",
        "/notifications",
        "/support",
        "/profile",
      ].includes(path) || /^\/(order|contract|invoice|checkout|admin)(\/|$)/.test(path);
    let html;
    if (privateRoute && !state.user) html = authRequired(raw);
    else if (path.startsWith("/admin") && state.user?.role !== "admin")
      throw Error("هذه المساحة متاحة لإدارة المنصة فقط.");
    else if (path === "/") html = home();
    else if (path === "/services")
      html = `<div class="wrap"><section class="solutions-intro"><div class="eyebrow">من فكرة أولى إلى تجربة متكاملة</div><h1>خبرات تتكامل.<br><em>لأجل طموحك.</em></h1><p>حلول مصمّمة حول ما يحتاجه مشروعك،<br>في كل مرحلة من رحلته الرقمية.</p></section>${launchBanner()}${journey()}<section class="section solutions-catalog">${catalogControls()}<div class="service-grid" id="service-results">${serviceCards()}</div></section><section class="banner"><div><h2>لنحدد نقطة البداية معًا.</h2><p>صف فكرتك لمساعد انطلاقة، أو ابدأ طلب مشروعك مباشرة.</p></div><button class="btn lime" type="button" data-assistant-open>تحدث مع المساعد ${icon("spark")}</button></section></div>`;
    else if (path === "/ready-websites") html = readyWebsites();
    else if (path === "/launch-offer") html = offerPage();
    else if (path.startsWith("/service/"))
      html = serviceDetail(path.split("/")[2]);
    else if (path === "/about") html = about();
    else if (path === "/forgot-password") html = forgotPassword();
    else if (path === "/verify") html = verifyRecovery();
    else if (path === "/reset-password") html = resetPassword();
    else if (path === "/login" || path === "/register") {
      html = authPage(path === "/register", query);
      if (path === "/login")
        html = html.replace('</form>', '</form><p class="small spaced"><a class="text-link" href="#/forgot-password">نسيت كلمة المرور؟</a></p>');
      if (path === "/login" && state.config.smsReady)
        html = html.replace(
          '<p class="auth-switch">',
          `<p class="auth-switch"><a href="#/otp-login?next=${encodeURIComponent(query.get("next") || "/dashboard")}">الدخول برمز الجوال</a></p><p class="auth-switch">`,
        );
    } else if (path === "/otp-login")
      html = `<div class="wrap"><div class="checkout">${pageHead("الدخول برمز الجوال", "للأرقام الموثّقة مسبقًا في حساب انطلاقة.")}<section class="panel">${state.config.smsReady ? `<form data-form="otp-send">${errors()}${field("phone", "رقم الجوال", "tel", 'required placeholder="+9665XXXXXXXX" autocomplete="tel"')}<button class="btn" type="submit">إرسال رمز الدخول</button></form>${state.loginChallenge ? `<form data-form="otp-check" class="spaced" data-next="${E(query.get("next") || "/dashboard")}">${errors()}${field("code", "رمز التحقق", "text", 'required inputmode="numeric" autocomplete="one-time-code" minlength="4" maxlength="10"')}<button class="btn" type="submit">تسجيل الدخول</button></form>` : ""}` : "<p>الدخول برمز الجوال غير مفعّل حاليًا.</p>"}<p class="small spaced"><a class="text-link" href="#/login">الدخول بالجوال وكلمة المرور</a></p></section></div></div>`;
    else if (path === "/start") html = start(query);
    else if (path === "/dashboard" || path === "/admin")
      html = await dashboard(path);
    else if (path === "/orders" || path === "/admin/orders")
      html = await orderList(path);
    else if (path.startsWith("/order/"))
      html = await orderDetail(path, path.split("/")[2]);
    else if (path === "/store") html = await store();
    else if (path.startsWith("/checkout/"))
      html = await checkout(path.split("/")[2]);
    else if (path === "/contracts") html = await contracts(path);
    else if (path.startsWith("/contract/")) html = await contractDocument(path.split("/")[2],path.split("/")[3]);
    else if (path === "/invoices") html = await invoices(path);
    else if (path.startsWith("/invoice/"))
      html = await invoice(path.split("/")[2]);
    else if (path === "/notifications") html = await notifications(path);
    else if (path === "/support") html = await support(path);
    else if (path === "/profile") html = profile(path);
    else if (path === "/admin/products") html = await adminProducts(path);
    else if (path === "/admin/customers") html = await customers(path);
    else if (path === "/terms" || path === "/privacy")
      html = legal(path === "/privacy");
    else
      html = `<div class="wrap section">${empty("الصفحة غير موجودة", "تحقق من الرابط أو عد إلى الصفحة الرئيسية.", link("/", "العودة للرئيسية"))}</div>`;
    if (seq !== state.sequence) return;
    main.innerHTML = html;
    document.title = `${main.querySelector("h1")?.innerText?.replace(/\n/g, " ") || "خدمات رقمية لمشروعك"} | إنطلاقة للتجارة الإلكترونية`;
    window.scrollTo({ top: 0, behavior: "instant" });
    main.focus({ preventScroll: true });
  } catch (e) {
    if (seq !== state.sequence) return;
    if (e.sessionExpired) {
      header(path);
      main.innerHTML = authRequired(raw);
      notify("انتهت جلستك. سجّل الدخول لمتابعة طلبك.");
    } else {
      main.innerHTML = `<div class="wrap section">${empty("تعذر فتح الصفحة", E(e.message), `<button class="btn" data-action="retry">حاول مجددًا</button> ${link("/", "الرئيسية", "secondary")}`)}</div>`;
    }
    document.title = `${main.querySelector("h1, h2")?.innerText || "تعذر فتح الصفحة"} | إنطلاقة للتجارة الإلكترونية`;
    main.focus({ preventScroll: true });
  }
}
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const recoveryForm = form.dataset.form.startsWith("recovery-");
  if (recoveryForm && form.dataset.submitting === "true") return;
  if (recoveryForm) form.dataset.submitting = "true";
  const button = form.querySelector("button[type=submit]");
  const old = button.textContent;
  const initiallyDisabled = button.disabled;
  button.disabled = true;
  button.textContent = "جارٍ الحفظ…";
  const error = form.querySelector(".error");
  if (error) error.textContent = "";
  const b = formData(form),
    kind = form.dataset.form,
    oid = form.dataset.id;
  try {
    if (kind === "recovery-request") {
      const channel = form.dataset.channel;
      const available = channel === "email"
        ? state.config?.recovery?.emailReady
        : channel === "whatsapp" ? state.config?.recovery?.whatsappReady : false;
      if (available !== true) throw Error("قناة الاستعادة المختارة غير مفعّلة حاليًا. اختر قناة متاحة.");
      const sequence = state.sequence, requestHash = location.hash;
      clearRecovery();
      const operation = state.recoveryOperation;
      const result = await api("/api/auth/recovery/request", {
        method: "POST",
        body: { channel, identifier: String(b.identifier || "").trim() },
      });
      if (sequence !== state.sequence || location.hash !== requestHash || operation !== state.recoveryOperation) return;
      state.recoveryChallenge = result.challengeId;
      state.recoveryChannel = channel;
      state.recoveryMessage = result.message;
      if (channel === "whatsapp") go("/verify");
      await render();
    } else if (kind === "recovery-verify") {
      if (!state.recoveryChallenge || state.recoveryChannel !== "whatsapp")
        throw Error("اطلب رمز استعادة جديدًا أولًا.");
      if (!/^[0-9]{4,10}$/.test(String(b.code || "")))
        throw Error("أدخل رمز الاستعادة من 4 إلى 10 أرقام.");
      const sequence = state.sequence, requestHash = location.hash;
      const operation = state.recoveryOperation, challengeId = state.recoveryChallenge;
      const result = await api("/api/auth/recovery/verify", {
        method: "POST",
        body: { challengeId, code: b.code },
      });
      if (sequence !== state.sequence || location.hash !== requestHash || operation !== state.recoveryOperation || state.recoveryChallenge !== challengeId) return;
      if (!/^[a-f0-9]{64}$/.test(result.resetToken || ""))
        throw Error("تعذر إكمال الاستعادة. اطلب رمزًا جديدًا.");
      state.resetToken = result.resetToken;
      state.resetExpiresAt = Date.now() + Math.min(Number(result.expiresIn) || 1800, 1800) * 1000;
      state.recoveryChallenge = null;
      state.recoveryMessage = "";
      go("/reset-password");
      await render();
    } else if (kind === "recovery-reset") {
      if (!state.resetToken || (state.resetExpiresAt && Date.now() >= state.resetExpiresAt))
        throw Error("انتهت صلاحية الاستعادة. اطلب رابطًا أو رمزًا جديدًا.");
      if (typeof b.password !== "string" || b.password.length < 12 || b.password.length > 128)
        throw Error("استخدم كلمة مرور بين 12 و128 حرفًا.");
      if (b.password !== b.passwordConfirm) throw Error("كلمتا المرور غير متطابقتين.");
      const sequence = state.sequence, token = state.resetToken, requestHash = location.hash;
      const operation = state.recoveryOperation;
      const requestUser = state.user, requestCsrf = state.csrf;
      const result = await api("/api/auth/recovery/reset", {
        method: "POST",
        body: { token, password: b.password },
      });
      const sameSession = state.user === requestUser && state.csrf === requestCsrf;
      if (sameSession) clearSession();
      if (!sameSession || sequence !== state.sequence || location.hash !== requestHash || operation !== state.recoveryOperation || state.resetToken !== token) return;
      clearRecovery();
      go("/login");
      await render();
      notify(result.message || "تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة.");
    } else if (kind === "register" || kind === "login") {
      const result = await api("/api/auth/" + kind, {
        method: "POST",
        body: { ...b, acceptTerms: !!b.acceptTerms },
      });
      state.user = result.user;
      state.csrf = result.csrf;
      let next = form.dataset.next || "/dashboard";
      if (!next.startsWith("/") || next.startsWith("//")) next = "/dashboard";
      if (next === "/dashboard" && state.user.role === "admin") next = "/admin";
      go(next);
      notify(
        kind === "register"
          ? "تم إنشاء حسابك. أهلًا بك في انطلاقة."
          : "تم تسجيل الدخول.",
      );
    } else if (kind === "start") {
      if (!state.user) {
        const guest = await api("/api/auth/guest", {
          method: "POST",
          body: { name: b.customerName, email: b.customerEmail, phone: b.customerPhone },
        });
        state.user = guest.user;
        state.csrf = guest.csrf;
      }
      const o = await api("/api/orders", {
        method: "POST",
        body: { ...b, type: "service", template: b.service === "ready-website" ? b.template : undefined, addons: b.service === "ready-website" ? ["hosting","domain","deployment"].filter(id => b["addon_"+id]) : [] },
      });
      go("/order/" + o.id);
      notify("تم استلام طلبك. ستتابع العقد والدفع والتنفيذ من هذه الصفحة دون تسجيل دخول.");
    } else if (kind === "checkout") {
      const o = await api("/api/orders", {
        method: "POST",
        body: { type: "product", productId: oid, acceptTerms: !!b.acceptTerms, promoCode: b.promoCode },
      });
      go("/order/" + o.id);
      notify("تم إنشاء طلب الشراء.");
    } else if (
      kind === "message" ||
      kind === "accept" ||
      kind === "quote" ||
      kind === "status" ||
      kind === "confirm-payment" ||
      kind === "revoke-payment"
    ) {
      const action = kind === "message" ? "messages" : kind;
      const payload =
        kind === "accept"
          ? { accept: !!b.accept, contractId: form.dataset.contract }
          : kind === "quote"
            ? { agreement:b.agreement,terms:b.terms,deliveryDate:b.deliveryDate,amount:Math.round(Number(b.amount)*100),contractDetails:{provider:{legalName:b.providerLegalName,address:b.providerAddress,registrationNumber:b.providerRegistrationNumber,registrationType:b.providerRegistrationType,activity:b.providerActivity},deliverables:b.deliverables,exclusions:b.exclusions,clientRequirements:b.clientRequirements,thirdPartyCosts:b.thirdPartyCosts,revisions:Number(b.revisions),reviewDays:Number(b.reviewDays),supportDays:Number(b.supportDays),ownership:b.ownership,cancellation:b.cancellation} }
            : b;
      await api(`/api/orders/${oid}/${action}`, {
        method: "POST",
        body: payload,
      });
      await render();
      notify("تم حفظ التحديث.");
    } else if (kind === "order-file" || kind === "payment-receipt" || kind === "product-file") {
      const file = form.querySelector("input[type=file]").files[0];
      if (!file) throw Error("اختر ملفًا أولًا.");
      if (file.size > 10 * 1024 * 1024) throw Error("الحد الأقصى 10 ميجابايت.");
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type))
        throw Error("اختر PDF أو PNG أو JPEG.");
      await api(
        kind !== "product-file"
          ? `/api/orders/${oid}/files`
          : `/api/admin/products/${oid}/file`,
        {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name),
            ...(kind === "payment-receipt" ? {"X-File-Purpose": "payment_receipt"} : {}),
          },
          body: file,
        },
      );
      await render();
      notify(kind === "payment-receipt" ? "تم إرسال إيصال التحويل للمراجعة." : "تم رفع الملف.");
    } else if (kind === "product" || kind === "product-edit") {
      await api(
        "/api/admin/products" + (kind === "product-edit" ? "/" + oid : ""),
        {
          method: "POST",
          body: { ...b, amount: Math.round(Number(b.amount) * 100) },
        },
      );
      await render();
      notify(
        kind === "product"
          ? "حُفظت المسودة. ارفع ملف المنتج ثم انشره."
          : "تم تحديث المنتج.",
      );
    } else if (kind === "ticket" || kind === "ticket-reply") {
      await api("/api/tickets" + (kind === "ticket-reply" ? "/" + oid : ""), {
        method: "POST",
        body: b,
      });
      await render();
      notify("تم حفظ رسالتك.");
    } else if (kind === "password") {
      const result = await api("/api/auth/password", {
        method: "POST",
        body: b,
      });
      state.csrf = result.csrf;
      state.user = result.user;
      form.reset();
      notify("تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.");
    } else if (kind === "otp-send") {
      const result = await api("/api/auth/otp/send", {
        method: "POST",
        body: b,
      });
      state.loginChallenge = result.challengeId;
      await render();
      notify(result.message);
    } else if (kind === "otp-check") {
      const result = await api("/api/auth/otp/check", {
        method: "POST",
        body: { code: b.code, challengeId: state.loginChallenge },
      });
      state.user = result.user;
      state.csrf = result.csrf;
      state.loginChallenge = null;
      let next = form.dataset.next || "/dashboard";
      if (!next.startsWith("/") || next.startsWith("//")) next = "/dashboard";
      if (next === "/dashboard" && state.user.role === "admin") next = "/admin";
      go(next);
      notify("تم تسجيل الدخول.");
    } else if (kind === "login-phone") {
      const result = await api("/api/auth/login-phone", { method: "POST", body: b });
      state.user = result.user; state.csrf = result.csrf;
      await render(); notify("تم ربط رقم الدخول وإنهاء الجلسات السابقة.");
    } else if (kind === "phone-send") {
      const result = await api("/api/auth/phone/send", {
        method: "POST",
        body: b,
      });
      state.challenge = result.challengeId;
      await render();
      notify("أُرسل رمز التحقق إلى جوالك.");
    } else if (kind === "phone-check") {
      const result = await api("/api/auth/phone/check", {
        method: "POST",
        body: { code: b.code, challengeId: state.challenge },
      });
      state.user = result.user;
      state.challenge = null;
      await render();
      notify("تم توثيق رقم الجوال.");
    }
  } catch (e) {
    if (e.sessionExpired) {
      await render();
      notify("انتهت جلستك. سجّل الدخول ثم أعد إرسال الطلب.");
    } else {
      if (error && form.isConnected) {
        error.textContent = e.message;
        error.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else notify(e.message);
    }
  } finally {
    if (recoveryForm) delete form.dataset.submitting;
    button.disabled = initiallyDisabled;
    button.textContent = old;
  }
});
function closeMenu(restoreFocus = false) {
  const nav = $("#main-nav");
  if (!nav?.classList.contains("open")) return;
  nav.classList.remove("open");
  const button = $('[data-action="menu"]');
  button?.setAttribute("aria-expanded", "false");
  if (restoreFocus) button?.focus();
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu(true);
});
document.addEventListener("click", async (event) => {
  if (
    event.target.closest("#main-nav a") ||
    !event.target.closest('#main-nav, [data-action="menu"]')
  ) closeMenu();
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  try {
    if (action === "skip") {
      event.preventDefault();
      main.focus();
    } else if (action === "menu") {
      const open = $("#main-nav").classList.toggle("open");
      el.setAttribute("aria-expanded", String(open));
    } else if (action === "logout") {
      await api("/api/auth/logout", { method: "POST", body: {} });
      clearSession();
      go("/");
      await render();
      notify("تم تسجيل الخروج.");
    } else if (action === "retry") await render();
    else if (action === "print") window.print();
    else if (action === "publish-product") {
      el.disabled = true;
      await api("/api/admin/products/" + el.dataset.id, {
        method: "POST",
        body: { published: el.dataset.published === "true" },
      });
      await render();
      notify("تم تحديث ظهور المنتج.");
    }
  } catch (e) {
    el.disabled = false;
    if (e.sessionExpired) await render();
    notify(e.sessionExpired ? "انتهت جلستك. سجّل الدخول مجددًا." : e.message);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.dataset.filter === "orders") {
    const q = event.target.value.trim().toLowerCase();
    document
      .querySelectorAll("#orders-list tbody tr")
      .forEach(
        (row) => (row.hidden = !row.textContent.toLowerCase().includes(q)),
      );
  }
});
window.addEventListener("hashchange", render);
await render();

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-product-search]")) return;
  const term = event.target.value.trim().toLowerCase();
  let count = 0;
  document.querySelectorAll("[data-product-text]").forEach((card) => {
    card.hidden = !card.dataset.productText.includes(term);
    if (!card.hidden) count++;
  });
  const message = document.querySelector(".catalog-no-results");
  if (message) message.hidden = count > 0;
});

function filterServices() {
  const search = document.querySelector("[data-service-search]");
  const category =
    document.querySelector("[data-service-filter].active")?.dataset
      .serviceFilter || "الكل";
  const term = search?.value.trim().toLowerCase() || "";
  let count = 0;
  document.querySelectorAll("[data-service-text]").forEach((card) => {
    card.hidden = !(
      card.dataset.serviceText.includes(term) &&
      (category === "الكل" || card.dataset.serviceCategory === category)
    );
    if (!card.hidden) count++;
  });
  const extra = document.querySelector("[data-service-extra]");
  if (extra) extra.hidden = !!term || category !== "الكل";
  const summary = document.querySelector("#filter-summary");
  if (summary)
    summary.textContent = count
      ? count.toLocaleString("ar-SA") + " خدمة تناسب بحثك"
      : "لا توجد نتائج؛ جرّب كلمة أخرى أو تصنيفًا مختلفًا.";
}
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-service-search]")) filterServices();
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-service-filter]");
  if (!b) return;
  document.querySelectorAll("[data-service-filter]").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  });
  filterServices();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "service") {
    const options = document.querySelector("#ready-site-options");
    if (options) options.hidden = event.target.value !== "ready-website";
  }
});
document.addEventListener("click", async (event) => {
  const code = event.target.closest("[data-copy-promo]");
  const share = event.target.closest("[data-share-platform]");
  if (!code && !share) return;
  const value = code?.dataset.copyPromo || "https://antlaqh.com/";
  try {
    if (share && navigator.share) await navigator.share({ title: "انطلاقة", url: value });
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); notify(code ? "تم نسخ كود الخصم." : "تم نسخ رابط انطلاقة."); }
    else notify("الرابط: " + value);
  } catch (error) { if (error.name !== "AbortError") notify("يمكنك نسخ الرابط أو الكود المعروض مباشرة."); }
});
