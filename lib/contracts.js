import { fail, text } from "./security.js";

export const contractMetadata = Object.freeze({
  schemaVersion: 2,
  policyVersion: "2026-10-01",
  required: true,
});

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw fail(400, `تحقق من ${label} ضمن الحدود المسموحة.`);
  return value;
}
export function validateContractDetails(value) {
  if (!object(value) || !object(value.provider))
    throw fail(400, "أكمل تفاصيل العقد وبيانات مقدم الخدمة قبل إصدار العرض.");
  const provider = {
    legalName: text(value.provider.legalName, 2, 150),
    address: text(value.provider.address, 10, 500),
    registrationNumber: value.provider.registrationNumber === undefined
      ? "" : text(value.provider.registrationNumber, 0, 80),
    registrationType: value.provider.registrationType === undefined ? "none" : value.provider.registrationType,
    activity: value.provider.activity === undefined ? "" : text(value.provider.activity, 0, 200),
  };
  if (!["none", "commercial_registration", "freelance_certificate"].includes(provider.registrationType))
    throw fail(400, "اختر نوع إثبات النشاط الصحيح.");
  return {
    provider,
    deliverables: text(value.deliverables, 15, 5000),
    exclusions: text(value.exclusions, 10, 3000),
    clientRequirements: text(value.clientRequirements, 10, 3000),
    thirdPartyCosts: text(value.thirdPartyCosts, 10, 3000),
    revisions: integer(value.revisions, 0, 20, "عدد جولات التعديل"),
    reviewDays: integer(value.reviewDays, 1, 30, "مدة مراجعة التسليم"),
    supportDays: integer(value.supportDays, 0, 365, "مدة دعم عيوب التنفيذ"),
    ownership: text(value.ownership, 10, 3000),
    cancellation: text(value.cancellation, 10, 3000),
  };
}

export function createContractDocument(details, context) {
  const money = (value) => `${(value / 100).toFixed(2)} ر.س`;
  const section = (title, body) => ({ title, body });
  const provider = details.provider;
  const selectedSite = context.siteOptions;
  const registrationLabel = provider.registrationType === "freelance_certificate"
    ? "رقم شهادة العمل الحر" : provider.registrationType === "commercial_registration"
      ? "رقم السجل التجاري" : "رقم الإثبات المقدم";
  const sections = [
    section("أطراف الاتفاق وبيانات التواصل", [
      `مقدم الخدمة: ${provider.legalName}.`,
      `العنوان: ${provider.address}.`,
      provider.registrationNumber ? `${registrationLabel}: ${provider.registrationNumber}.` : "",
      provider.activity ? `النشاط: ${provider.activity}.` : "",
      `التواصل: ${context.contact.email} — ${context.contact.phone}.`,
      `العميل: ${context.customer.name} — ${context.customer.email}.`,
    ].filter(Boolean).join("\n")),
    section("نطاق العمل والمخرجات", `${context.agreement}\n\nالمخرجات المتفق عليها:\n${details.deliverables}`),\n    ...(context.serviceDetails ? [section("الخدمة ومدخلات الطلب", [`الخدمة: ${context.serviceDetails.title}.`, `النطاق المنشور عند الطلب: ${context.serviceDetails.pricing?.scope || "يحدد في العرض"}.`, context.requestDetails?.title ? `عنوان الطلب: ${context.requestDetails.title}.` : "", context.requestDetails?.description ? `وصف احتياج العميل: ${context.requestDetails.description}` : "", context.requestDetails?.budget ? `الميزانية التي ذكرها العميل: ${context.requestDetails.budget}.` : "", context.requestDetails?.targetDate ? `موعد الإطلاق المستهدف الذي ذكره العميل: ${context.requestDetails.targetDate}.` : "", Array.isArray(context.serviceDetails.includes) && context.serviceDetails.includes.length ? `العناصر الأساسية للخدمة: ${context.serviceDetails.includes.join("، ")}.` : ""].filter(Boolean).join("\\n"))] : []),
    ...(selectedSite ? [section("نموذج الموقع والإضافات المطلوبة", [
      `النموذج المختار: ${selectedSite.template.title}.`,
      ...selectedSite.addons.map((addon) => `${addon.title}: ${addon.scope || addon.description || "ضمن نطاق عرض السعر المكتوب"}`),
      "لا تشمل الإضافات رسوم الموردين أو التجديد إلا كما يبين بند تكاليف الطرف الثالث.",
    ].join("\n"))] : []),
    section("ما لا يشمله نطاق العمل", details.exclusions),
    section("متطلبات العميل وبدء التنفيذ", `${details.clientRequirements}\n\nيبدأ العمل بعد موافقة العميل على هذا الإصدار، وتأكيد الإدارة استلام الدفع، واستلام متطلبات العميل المحددة. توثق أي آثار لتأخر المتطلبات أو تغييرها كتابةً ويعتمد العميل أي تعديل في الموعد أو النطاق.`),
    section("السعر وطريقة الدفع", [
      `السعر قبل الخصم: ${money(context.subtotal)}.`,
      `الخصم: ${money(context.discount)}${context.promotion ? ` باستخدام ${context.promotion.code}` : ""}.`,
      `المبلغ المتفق عليه: ${money(context.amount)}.`,
      "الدفع بتحويل بنكي فقط إلى الحساب المعلن داخل الطلب. رفع إيصال التحويل لا يؤكد الدفع؛ تؤكد الإدارة الاستلام بعد التحقق الفعلي. لا ينفذ هذا الاتفاق عملية دفع أو استرداد بنكي تلقائي.",
    ].join("\n")),
    section("رسوم وخدمات الطرف الثالث", `${details.thirdPartyCosts}\n\nيجب بيان رسوم الموردين والدومين والاستضافة والتجديد والضرائب إن وجبت في عرض السعر، وتحديد ما يشمله المبلغ وما يدفع مستقلاً. لا تعتمد رسوم إضافية دون موافقة مكتوبة.`),
    section("التسليم والمراجعة", `تاريخ التسليم المتفق عليه: ${context.deliveryDate}.\nلعميل المشروع ${details.reviewDays} يومًا بعد التسليم لتقديم ملاحظات مكتوبة على مطابقة المخرجات للنطاق المتفق عليه. انقضاء فترة المراجعة أو عدم الرد لا يعد موافقة صامتة أو تنازلاً عن الحقوق. توثق الملاحظات ومعالجتها داخل الطلب.`),
    section("التعديلات وتغيير النطاق", `يشمل العرض ${details.revisions} جولة تعديل ضمن النطاق والمخرجات المتفق عليها. أي تغيير في النطاق أو السعر أو موعد التسليم يوثق كتابةً بإصدار مستقل، ويتطلب موافقة جديدة من العميل قبل تنفيذه. الطلبات خارج النطاق تعرض بسعر مستقل ولا تخصم من دعم عيوب التنفيذ.`),
    section("دعم عيوب التنفيذ", details.supportDays > 0
      ? `يتاح دعم عيوب التنفيذ المتعلقة بمطابقة النطاق لمدة ${details.supportDays} يومًا من التسليم. يشمل إصلاح العيوب المتعلقة بالمخرجات المتفق عليها؛ الميزات الجديدة أو تغييرات النطاق تتطلب عرضًا مستقلاً. لا يلغي هذا البند الحقوق النظامية للعميل.`
      : "لا يتضمن هذا العرض مدة دعم إضافية بعد التسليم. تبقى ملاحظات مطابقة النطاق والحقوق النظامية محفوظة؛ أي دعم إضافي أو نطاق جديد يتطلب اتفاقًا مستقلاً."),
    section("الملكية والتراخيص", `${details.ownership}\n\nتوضح حقوق استخدام المخرجات وموعد نقلها، وأي مواد أو قوالب أو تراخيص للطرف الثالث وما يخضع لشروط أصحابها. لا تنتقل حقوق لا يملك مقدم الخدمة حق نقلها، ولا تعد تراخيص الموردين ملكية حصرية للعميل إلا بنص واضح.`),
    section("الإلغاء وتسوية الأعمال", `${details.cancellation}\n\nيقدم طلب الإلغاء بتذكرة دعم مرتبطة بالطلب. توثق الأعمال المنفذة والرسوم الفعلية التي ترتبت، ويبين احتساب التسوية وإجراءاتها كتابةً. يحتفظ العميل بحق العدول خلال سبعة أيام من التعاقد على الخدمة عند عدم استخدامها أو الانتفاع بها، حيث ينطبق نظامًا، وبحقوقه عند العيب أو عدم مطابقة الوصف أو النطاق. إذا تأخر التسليم أو التنفيذ مدة تزيد على خمسة عشر يومًا من تاريخ إبرام العقد أو عن الموعد المتفق عليه، وفق أحكام النظام ومع مراعاة القوة القاهرة، يحق للعميل الفسخ واسترداد ما دفعه والتكاليف المترتبة على التأخير. لا يفترض أن تخصيص الموقع يلغي حق الإلغاء. لا ينتقص هذا البند من الحقوق النظامية ولا يجيز رسومًا غير موضحة أو غير مستحقة.`),
    section("الشروط الخاصة", context.terms),
    section("الخصوصية وأولوية القانون", "تستخدم بيانات العميل وملفاته لتنفيذ الطلب والتواصل والدعم، وفق سياسة الخصوصية المنشورة، وتقتصر مشاركتها مع الموردين على ما يلزم لتنفيذ الخدمات المتفق عليها. لا تشارك الملفات الخاصة دون مقتضى التنفيذ أو موافقة مناسبة. تخضع العلاقة للأنظمة النافذة في المملكة العربية السعودية، وتتقدم الأحكام النظامية الواجبة على أي نص يتعارض معها في هذا الاتفاق."),
    section("الإصدارات والموافقة", "يحتفظ كل إصدار بنطاقه وسعره وتفاصيله وموافقته المؤرخة. إصدار عرض جديد لا يغير نص الإصدار القديم أو سجل الموافقة عليه. اعتماد العميل مسجل داخل المنصة ولا تدعي المنصة أنه توقيع إلكتروني معتمد."),
  ];
  return {
    schemaVersion: contractMetadata.schemaVersion,
    policyVersion: contractMetadata.policyVersion,
    details: structuredClone(details),
    sections,
  };
}
