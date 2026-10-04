const patterns = {
  feasibility: [/جدوي|دراسه.*(?:مشروع|تمويل)/, 9],
  "ready-website": [/موقع.*جاهز|مواقع.*جاهز|(?:قالب|نموذج|قوالب|نماذج).*موق|مطعم|مقهي|مقهى|استوديو|تصوير|مقاولات|هندسه/, 7],
  website: [/موقع|مواقع|website|web site|ووردبريس|وردبريس|\bwordpress\b|\bcms\b|نظام.*اداره.*محتوي/, 2],
  store: [/متجر|متاجر|سله|سلة|زد|بيع منتجات|ecommerce|e-commerce/, 5],
  apps: [/تطبيق|اندرويد|ايفون|\bios\b|\bapp\b/, 5],
  payments: [/بوابه.*دفع|بوابات.*دفع|ربط.*(?:دفع|ابل باي|apple pay|مدي|بطاقه)|دفع الكتروني|payment gateway/, 5],
  identity: [/هويه|شعار|لوقو|\blogo\b|branding/, 5],
  marketing: [/تسويق|حمله|حملات|اعلان|اداره.*حساب|اداره.*قناه/, 4],
  content: [/محتوي|محتوى|كتابه|منشورات|بوست|مقالات|نصوص/, 5],
  dropshipping: [/دروب.*شيب|بدون مخزون|بلا مخزون|دروبشيب/, 8],
  noon: [/نون|\bnoon\b/, 7],
  amazon: [/امازون|\bamazon\b/, 7],
  ai: [/ذكاء.*اصطناعي|اتمته|شات بوت|chatbot|automation/, 5],
  consulting: [/استشار|استشر|مختص/, 5],
  platforms: [/منصه|منصات|لوحه.*اداره|نظام مخصص/, 5],
  academy: [/تعلم|تعل.?م|ورشه|دوره|تدريب/, 5],
};
const publicPages = new Set(["#/services", "#/ready-websites", "#/launch-offer", "#/start", "#/support", "#/terms"]);
const intro = "هذا مساعد إرشادي مجاني يعتمد على كتالوج انطلاقة وسياساتها المنشورة، ولا يولّد إجابات مفتوحة.";
export function normalizeArabic(value) {
  return String(value || "").normalize("NFKC")
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .toLowerCase().replace(/\s+/g, " ").trim();
}
const money = (amount) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: false }).format(amount / 100) + " ر.س";
const clean = (value, max = 1200) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
const safeId = (value) => typeof value === "string" && /^[a-z]+(?:-[a-z]+)*$/.test(value) && value.length <= 40;
function denied(text, index) {
  const before = text.slice(Math.max(0, index - 55), index).split(/[،؛.!?؟]|لكن|بل/).at(-1);
  return /(?:^|\s)(?:لا|ما|مو|مش|ليس|لست)\s+(?:(?:اريد|ابي|ابغي|احتاج|نحتاج|نبغي|ابحث|محتاج|بحاجه|في حاجه)\s+)?(?:(?:الي اي|الي|اي)\s+)?$/.test(before) ||
    /(?:^|\s)(?:بدون|غير)\s*$/.test(before) || /(?:^|\s)(?:ماابي|ماابغي|مابي|مااحتاج)\s*$/.test(before);
}
function positiveMatch(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, "g"))].some((match) => !denied(text, match.index));
}
function matches(text, services) {
  return services.map((service) => {
    const definition = patterns[service.id];
    const title = normalizeArabic(service.title);
    let score = definition && positiveMatch(text, definition[0]) ? definition[1] : 0;
    if (service.id === "website" && positiveMatch(text, /ووردبريس|وردبريس|\bwordpress\b|\bcms\b|نظام.*اداره.*محتوي/)) score += 6;
    const index = title ? text.indexOf(title) : -1;
    if (index >= 0 && !denied(text, index)) score += 10;
    return { service, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
}
function selectService(text, services, previous) {
  const current = matches(text, services);
  const selected = current[0]?.service;
  const followup = /^(?:و?كم(?: السعر| سعره| سعرها| يكلف| تكلف)?|بكم|وش السعر|ايش السعر|ما السعر)[؟?! .]*$/.test(text) ||
    /المشمول|يشمل|تشمل|شامل|ضمن السعر|اشتراك|تجديد|استضافه|دومين|عدد.*(?:منتج|صفحات|شاشات)|جولات.*تعديل|موعد|تسليم|كيف.*(?:اطلب|ابدا)|حجز|خصم.*(?:عليه|عليها)/.test(text);
  const inclusion = text.search(/تشمل|يشمل|تتضمن|يتضمن|مشمول|شامل|ضمن السعر/);
  const subject = inclusion >= 0 && matches(text.slice(0, inclusion), services)[0]?.service;
  const reference = /(?:هذا|هذه|نفس|ذلك|المذكور|السابق)\s+(?:الموقع|موقع|الخدمه|الخدمة|النموذج)|(?:^|\s)(?:عليه|عليها)(?:\s|[؟?!.]|$)/.test(text);
  const newRequest = /(?:^|\s)(?:اريد|احتاج|ابي|ابغي|ابحث عن|بدلا من|انتقل الي)\s/.test(text);
  if (previous && !newRequest && (
    inclusion >= 0 && !subject ||
    reference && (!selected || selected.id === "website" && current[0].score <= 2) ||
    !selected && followup
  )) return previous;
  return selected;
}
function price(service) {
  const p = service.pricing;
  return p && Number.isSafeInteger(p.from) && p.from > 0 && p.currency === "SAR" ? p : null;
}
function serviceText(service) {
  const p = price(service);
  return `${clean(service.title, 180)}: ${clean(service.description)}\n` + (p
    ? `سعر البداية ${money(p.from)} ${clean(p.unit, 60)}. النطاق المنشور: ${clean(p.scope, 1800)}\n${clean(p.note)}`
    : "يحدد النطاق والإجمالي في عرض سعر مكتوب.");
}
function endLabel(offer) {
  const end = Date.parse(offer?.endsAt);
  return Number.isFinite(end) ? new Date(end - 1).toLocaleDateString("ar-SA", {
    calendar: "gregory", timeZone: "Asia/Riyadh", day: "numeric", month: "long", year: "numeric",
  }) : "نهاية الفترة الموضحة في صفحة العرض";
}
function budget(text) {
  const raw = text.match(/(?:ميزاني(?:تي|ه)?|budget|حدودي)\D{0,20}(\d+(?:[.,٬٫]\d+)*)/)?.[1];
  if (!raw) return null;
  const normalized = raw.replace(/٬/g, ",").replace(/٫/g, ".");
  if (normalized.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(result) && result >= 0 && result <= 10000000 ? result : null;
}
export function createGuidedAssistant({ getCatalog, timeoutMs = 25000 } = {}) {
  return {
    async reply(messages) {
      let catalog, timer;
      try {
        const deadline = new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("catalog deadline")), timeoutMs);
        });
        catalog = await Promise.race([
          typeof getCatalog === "function" ? Promise.resolve().then(getCatalog) : {},
          deadline,
        ]);
      }
      catch { return { reply: `${intro}\nتعذر قراءة الكتالوج الآن. استعرض صفحة الخدمات أو تواصل مع الفريق لتحديد احتياجك.`, mode: "guided", links: [
        { label: "الخدمات", href: "#/services" }, { label: "الدعم", href: "#/support" },
      ] }; }
      finally { clearTimeout(timer); }
      const services = (Array.isArray(catalog?.services) ? catalog.services : []).filter((s) => safeId(s?.id)).slice(0, 40);
      const text = normalizeArabic(messages.at(-1).content);
      let previous;
      for (const item of messages.filter((m) => m.role === "user").slice(0, -1).slice(-5)) {
        previous = selectService(normalizeArabic(item.content), services, previous) || previous;
      }
      const selected = selectService(text, services, previous);
      const links = [];
      const add = (label, href) => {
        const serviceRoute = href.match(/^#\/(?:service\/|start\?service=)([a-z]+(?:-[a-z]+)*)$/);
        const preview = /^\/demos\/(?:business|portfolio|restaurant)\/$/.test(href);
        if (!(publicPages.has(href) || preview || serviceRoute && services.some((s) => s.id === serviceRoute[1]))) return;
        if (!links.some((l) => l.href === href) && links.length < 7) links.push({ label: clean(label, 100), href });
      };
      const finish = (reply) => ({ reply: reply.slice(0, 6500), mode: "guided", links });
      const serviceLinks = (service) => {
        add("تفاصيل " + clean(service.title, 70), "#/service/" + service.id);
        add("طلب عرض سعر", "#/start?service=" + service.id);
      };
      if (/تجاهل|ignore.*instructions|system prompt|اكشف.*(?:مفتاح|كلمه|رمز)|api.?key|كلمه.*مرور|بيانات.*(?:عميل|عملاء)|تعليمات.*داخليه|(?:وافق|اكد|انشي|انشئ|احذف|احجز|غير)\s+.*(?:طلب|عقد|دفع|تحويل|سعر)/.test(text)) {
        add("الخدمات", "#/services"); add("ابدأ طلبك بنفسك", "#/start"); add("الدعم", "#/support");
        return finish(`${intro}\nأعرض المعلومات العامة فقط؛ لا أرى بيانات العملاء أو الطلبات الخاصة، ولا أنشئ طلبًا أو أقبل عقدًا أو أؤكد دفعًا أو أغيّر سعرًا. لا ترسل كلمات المرور أو رموز التحقق أو مفاتيح الخدمات هنا.`);
      }
      if (/حاله.*طلب|طلبي|طلباتي|عقدي|ملفاتي|دفعت|حوالتي|اين.*طلب|وين.*طلب|تاخر.*طلب|فاتورتي/.test(text)) {
        add("الدعم ومتابعة الطلب", "#/support");
        return finish("لا أستطيع رؤية حالة طلبك أو عقدك أو ملفاتك أو تأكيد وصول دفعتك. افتح مساحة العميل بعد تسجيل الدخول لمتابعة الطلب والرسائل والمرفقات، أو افتح تذكرة دعم من حسابك. تؤكد الإدارة التحويل البنكي بعد مراجعة وصوله.");
      }
      if (/antlaqh20|خصم|كود|عرض الاطلاق|انتهاء.*اكتوبر|بعد.*اكتوبر/.test(text)) {
        const offer = catalog?.launchOffer;
        add("شروط عرض الإطلاق", "#/launch-offer");
        if (selected) serviceLinks(selected); else add("ابدأ مشروعك", "#/start");
        if (!offer || !/^[A-Z0-9_-]{1,40}$/.test(offer.code || "") || !Number.isInteger(offer.ratePercent) || offer.ratePercent <= 0 || offer.ratePercent > 100)
          return finish("راجع صفحة عرض الإطلاق لمعرفة الشروط الحالية. يثبت الخادم صلاحية الكود عند إنشاء الطلب؛ لا أستطيع تقرير أهلية طلب خاص.");
        const explanation = offer.active
          ? `عرض الإطلاق الحالي خصم ${offer.ratePercent}% بالكود ${offer.code} للطلبات المقدمة حتى ${endLabel(offer)} بتوقيت الرياض. أضف الكود عند إنشاء الطلب؛ يحفظ الخادم أهلية الطلب، ويظهر المبلغ قبل الخصم والخصم والإجمالي في العرض.`
          : `الكود ${offer.code} غير متاح الآن للطلبات الجديدة. الطلب الذي حفظ الخادم له العرض خلال فترة الصلاحية يحتفظ بالخصم عند إصدار عرض لاحق وفق شروطه؛ لا أستطيع تأكيد أهلية طلب خاص.`;
        const p = selected && price(selected);
        return finish(explanation + (offer.active && p
          ? `\nمثال لسعر البداية المنشور للنطاق نفسه: ${money(p.from)} قبل الخصم، خصم ${money(Math.round(p.from * offer.ratePercent / 100))}، والمبلغ ${money(p.from - Math.round(p.from * offer.ratePercent / 100))}. الإجمالي النهائي والرسوم الخارجية يوضحان في العرض المكتوب.` : ""));
      }
      if (/الغاء|استرداد|استرجاع|سياسه|خصوصيه|حقوق|ترخيص|ملكيه/.test(text)) {
        add("الشروط والسياسات", "#/terms"); add("الدعم", "#/support");
        return finish("تفاصيل النطاق والتعديلات والدعم والملكية والتراخيص والإلغاء والاسترداد تُكتب في نسخة العقد التي يوافق عليها العميل صراحة، مع حفظ الحقوق النظامية. أي تغيير في النطاق يحتاج اتفاقًا مكتوبًا وعرضًا جديدًا. للإلغاء أو مشكلة مطابقة النطاق افتح تذكرة دعم لتوثيق الطلب والأعمال والرسوم الفعلية؛ لا أستطيع إلغاء العقد أو الفصل في حالة خاصة.");
      }
      if (/كيف.*(?:اطلب|ابدا|اشتري)|خطوات|مراحل|رحله|عرض سعر|عقد|تحويل بنكي|كيف.*(?:ادفع|الدفع)/.test(text) ||
          selected?.id !== "payments" && /(?:طريقه|طرق|وسيله|وسايل).*دفع|بطاقه|ابل باي|apple pay|مدي/.test(text)) {
        if (selected) serviceLinks(selected); else add("ابدأ مشروعك", "#/start");
        add("الشروط", "#/terms");
        const journey = (Array.isArray(catalog?.customerJourney) ? catalog.customerJourney : []).slice(0, 4).map((s) => clean(s.title, 100)).filter(Boolean);
        return finish((journey.length ? `رحلة الخدمات: ${journey.join(" ← ")}.\n` : "") + "اختر الخدمة وأرسل طلبك بنفسك؛ يراجع الفريق الاحتياج ويصدر نطاقًا ومخرجات وسعرًا وموعدًا مكتوبًا مع تفاصيل العقد. تقرأ الإصدار وتوافق عليه صراحة، ثم تحوّل بنكيًا وترفق الإيصال، وتؤكد الإدارة وصول المبلغ يدويًا. يبدأ العمل بعد الموافقة والدفع وتوفير متطلبات العميل. الدفع داخل انطلاقة حاليًا بتحويل بنكي فقط؛ خدمة ربط بوابة دفع لمشروع العميل نطاق آخر.");
      }
      if (/موعد|مده.*(?:تنفيذ|تسليم)|متي.*(?:جاهز|ينتهي)|ضمان|تضمن|ارباح|قبول/.test(text)) {
        if (selected) serviceLinks(selected); else add("طلب عرض سعر", "#/start");
        return finish("مدة التنفيذ والموعد النهائي يحددهما الفريق في عرض سعر وعقد مكتوب حسب النطاق ومتطلباتك. لا أضمن الأرباح أو قبول حسابات الأسواق أو التطبيقات؛ القرار النهائي بيد الجهة الخارجية ورسومها وشروطها مستقلة." + (selected ? "\n" + serviceText(selected) : ""));
      }
      if (/تواصل|واتساب|whatsapp|رقمكم|بريدكم|الدعم|الفريق/.test(text)) {
        const contact = catalog?.contact || {};
        add("الدعم", "#/support");
        return finish(`يمكنك استخدام زر WhatsApp المباشر في الموقع للاستفسار، أو فتح تذكرة من حسابك لمتابعة الطلب. ${contact.phone ? "رقم التواصل المنشور: " + clean(contact.phone, 40) + ". " : ""}${contact.email ? "البريد المنشور: " + clean(contact.email, 180) + "." : ""} لا ترسل كلمات المرور أو رموز التحقق في المحادثة.`);
      }
      const limit = budget(text);
      if (selected) {
        serviceLinks(selected);
        let reply = serviceText(selected);
        const p = price(selected);
        if (limit !== null && p && p.from > Math.round(limit * 100)) {
          reply += "\nميزانيتك المذكورة أقل من سعر البداية المنشور لهذا النطاق. يمكن للفريق مناقشة نطاق أصغر في عرض مستقل؛ لا أؤكد تنفيذه بهذه الميزانية.";
          const consultation = services.find((s) => s.id === "consulting" && price(s)?.from <= limit * 100);
          if (consultation) { reply += "\nخطوة لتحديد الأولويات: " + serviceText(consultation); serviceLinks(consultation); }
        }
        if (selected.id === "feasibility" && selected.study) {
          reply += "\n" + selected.study.plans.map(p => `${clean(p.title, 120)}: ${money(p.amount)}، ${p.days} أيام عمل بعد تأكيد الدفع واستكمال البيانات.`).join("\n");
          reply += "\nحدد هل تريد دراسة مختصرة أو تفصيلية، وهل هي للاستخدام الشخصي أو لجهة تمويل. في طلب الدراسة ستجيب عن أسئلة المشروع وترفع تفاصيله وعروض الأسعار ومتطلبات الجهة، ثم تراجع العقد والسعر قبل الدفع. قبول التمويل بيد الجهة ولا نضمن الربح أو التمويل.";
        } else if (selected.id === "ready-website") {
          const custom = positiveMatch(text, /حجز|دفع الكتروني|لوحه.*اداره|نظام مخصص|متجر/);
          reply += "\nالأساس موقع تعريفي ثابت؛ لوحة الإدارة والمتجر والحجز والدفع الإلكتروني وظائف إضافية تحتاج نطاقًا وعرضًا مستقلين.";
          if (custom) reply += " طلبك يتضمن وظيفة تتجاوز النموذج التعريفي؛ اشرحها للفريق قبل الموافقة، ولا أؤكد شمولها بسعر النموذج.";
          add("المواقع الجاهزة وخياراتها", "#/ready-websites");
          const templates = Array.isArray(selected.templates) ? selected.templates : [];
          const requested = /مطعم|مقهي|مقهى/.test(text) ? "restaurant" : /تصوير|استوديو|بورتفوليو/.test(text) ? "portfolio" : /هندس|مقاولات|شركه/.test(text) ? "business" : null;
          const choices = templates.filter((t) => !requested || t.id === requested).slice(0, 3);
          if (choices.length) reply += "\nالمعاينات المتاحة: " + choices.map((t) => clean(t.title, 100)).join("، ") + ".";
          for (const t of choices) if (t.preview === `/demos/${t.id}/`) add("معاينة " + clean(t.title, 60), t.preview);
          const addons = Array.isArray(selected.addons) ? selected.addons : [];
          if (addons.length) reply += "\nإضافات اختيارية: " + addons.map((a) => `${clean(a.title, 80)}: ${clean(a.description, 400)}`).join("؛ ") + " لا أضع سعرًا افتراضيًا للموردين أو للتجديد؛ تُفصّل الرسوم في العرض.";
        } else if (/استضافه|دومين|اشتراك|مورد|تجديد|رسوم/.test(text)) {
          reply += "\nرسوم الجهات الخارجية والاشتراكات والتجديد منفصلة ما لم يذكر العرض المكتوب خلاف ذلك. لا أقدّر رسوم مورد بلا عرض.";
        }
        if (selected.id !== "payments" && /تشمل|يشمل|تتضمن|يتضمن|مشمول|شامل|ضمن السعر/.test(text) && positiveMatch(text, /بوابه.*دفع|بوابات.*دفع|ربط.*دفع|دفع الكتروني/)) {
          reply += "\nلا أفترض شمول ربط بوابة الدفع في هذا السعر؛ لدى انطلاقة خدمة ربط مستقلة، ويحدد العرض المكتوب ما يشمله مشروعك ورسوم الجهة الخارجية قبل الموافقة.";
        }
        return finish(reply);
      }
      if (limit !== null || /فكره|ابدا|محتار|مو عارف|غير واضحه|ما اعرف/.test(text)) {
        const first = services.filter((s) => ["consulting", "academy"].includes(s.id) && (limit === null || price(s)?.from <= limit * 100));
        if (first.length) {
          first.forEach(serviceLinks);
          return finish("ابدأ بتحديد فكرتك وأولوياتك قبل التنفيذ. هذه أسعار بداية للخيارات المنشورة، وليست تعهدًا بإجمالي مشروعك ضمن الميزانية:\n" + first.map(serviceText).join("\n\n") + "\nهل تحتاج جلسة لتقييم فكرتك أم ورشة لتتعلم تأسيس متجر؟");
        }
      }
      add("الخدمات والأسعار المنشورة", "#/services"); add("المواقع الجاهزة", "#/ready-websites"); add("طلب عرض سعر", "#/start");
      return finish(`${intro}\nلم أحدد خدمة من سؤالك. اختر نوع احتياجك: موقع أو متجر أو تطبيق أو هوية أو تسويق أو استشارة، أو استعرض الخدمات وأسعار البداية. لا أجيب عن موضوع خارج هذه المراجع، ولا أستطيع رؤية بيانات حسابك.`);
    },
  };
}
