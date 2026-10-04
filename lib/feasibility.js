import { fail, text } from "./security.js";

const basic = ["ملخص المشروع والفرصة والفئة المستهدفة", "تقدير الاستثمار والتكاليف والإيرادات ونقطة التعادل", "توصيات القرار والافتراضات ومصادر البيانات", "تسليم PDF وWord وجولة تعديل واحدة"];
const detailed = ["تحليل السوق والمنافسين وخطة التسويق", "الدراسة الفنية والتشغيلية والموارد البشرية", "نموذج مالي Excel لخمس سنوات: الدخل والتدفقات النقدية ونقطة التعادل وفترة الاسترداد", "تحليل الحساسية والمخاطر والسيناريوهات", "تسليم PDF وWord وExcel وجولتي تعديل"];
export const studyPlans = [
  { id: "brief-personal", depth: "brief", purpose: "personal", title: "دراسة مختصرة للاستخدام الشخصي", amount: 29900, days: 3, revisions: 1, includes: basic },
  { id: "detailed-personal", depth: "detailed", purpose: "personal", title: "دراسة تفصيلية للاستخدام الشخصي", amount: 69900, days: 7, revisions: 2, includes: [...basic.slice(0, 3), ...detailed] },
  { id: "brief-financing", depth: "brief", purpose: "financing", title: "دراسة مختصرة لعرض المشروع على جهة تمويل", amount: 49900, days: 5, revisions: 1, includes: [...basic, "ملخص تمويلي وخطة استخدام التمويل وتوقعات مالية أولية لثلاث سنوات", "مواءمة العرض مع المتطلبات المرفقة لجهة تمويل واحدة؛ لا تحل محل دراسة تفصيلية إذا طلبتها الجهة"] },
  { id: "detailed-financing", depth: "detailed", purpose: "financing", title: "دراسة تفصيلية لطلب التمويل", amount: 119900, days: 10, revisions: 2, includes: [...basic.slice(0, 3), ...detailed, "خطة استخدام التمويل ومساهمة المالك والقدرة المتوقعة على السداد", "مواءمة الدراسة مع النموذج المرفق لجهة تمويل واحدة"] },
];
export const studyDocuments = [
  { id: "project", title: "تفاصيل المشروع", description: "وصف النشاط والمنتجات والعملاء والموقع والمساحة والطاقة الإنتاجية وخطة التشغيل." },
  { id: "quotations", title: "عروض الأسعار والتكاليف", description: "تسعير المعدات والتجهيزات والمواد والمخزون والإيجار والرواتب والتراخيص؛ اسم المورد وتاريخ العرض إن توفر." },
  { id: "financial", title: "الأسعار والمبيعات والميزانية", description: "أسعار البيع وتكلفة الوحدة والمبيعات المتوقعة ورأس المال والتكاليف الشهرية وأي نموذج مالي سابق." },
  { id: "history", title: "نتائج المشروع القائم", description: "للمشروع القائم: المبيعات والمصروفات والقوائم المالية المتاحة لآخر سنة؛ وللمشروع الجديد اختر لا ينطبق." },
  { id: "funding", title: "متطلبات جهة التمويل", description: "اسم الجهة ونموذج الدراسة وقائمة المستندات وشروط التمويل المنشورة أو المرسلة لك؛ دون كلمات مرور أو بيانات بنكية حساسة." },
];
export const studyNotice = "تشمل الباقة مشروعًا واحدًا في موقع واحد وجهة تمويل واحدة عند اختيار التمويل. تبدأ مدة التنفيذ بأيام العمل بعد تأكيد الدفع واستكمال البيانات. توثق الافتراضات والبيانات الناقصة؛ لا يُضمن ربح المشروع أو قبول التمويل. المسح الميداني والاعتماد المهني ورسوم الجهات الخارجية غير مشمولة؛ أي توسع في النطاق بعرض جديد وموافقة قبل تحصيله.";
export function validateStudy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "أجب عن أسئلة دراسة الجدوى.");
  const plan = studyPlans.find(p => p.depth === value.depth && p.purpose === value.purpose);
  if (!plan || !["new", "existing"].includes(value.stage)) throw fail(400, "اختر مستوى الدراسة والغرض منها ومرحلة المشروع.");
  const answers = { depth: plan.depth, purpose: plan.purpose, stage: value.stage };
  for (const [name, min, max] of [["activity", 3, 300], ["city", 2, 160], ["customers", 10, 1500], ["operations", 10, 2000], ["costs", 10, 2000], ["sales", 10, 2000], ["capital", 2, 300]]) answers[name] = text(value[name], min, max);
  if (plan.purpose === "financing") {
    answers.fundingEntity = text(value.fundingEntity, 2, 300);
    answers.fundingAmount = text(value.fundingAmount, 2, 300);
    answers.fundingRequirements = text(value.fundingRequirements, 10, 2000);
  }
  return { answers, plan: structuredClone(plan), notice: studyNotice };
}
export function requiredStudyDocuments(study) {
  return studyDocuments.filter(d => (d.id !== "funding" || study.answers.purpose === "financing") && (d.id !== "history" || study.answers.stage === "existing"));
}
export function validateStudyDocuments(study, value, files) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "حدد حالة مستندات الدراسة.");
  return requiredStudyDocuments(study).map(d => {
    const item = value[d.id];
    if (!item || !["attached", "pending", "in_answers"].includes(item.status)) throw fail(400, `حدد حالة ${d.title}.`);
    if (item.status === "attached" && !files.some(f => f.studyCategory === d.id)) throw fail(400, `ارفع ملف ${d.title} أولًا أو اختر سأستكمله لاحقًا.`);
    const note = text(item.note || "", item.status === "attached" ? 0 : 10, 1000);
    return { id: d.id, title: d.title, status: item.status, note, fileIds: files.filter(f => f.studyCategory === d.id).map(f => f.id) };
  });
}
export function studySummary(study) {
  const a = study.answers;
  return [study.plan.title, `مرحلة المشروع: ${a.stage === "existing" ? "قائم" : "جديد"}`, `النشاط: ${a.activity}`, `المدينة والموقع: ${a.city}`, `العملاء والمنتجات: ${a.customers}`, `التشغيل والموارد: ${a.operations}`, `التكاليف: ${a.costs}`, `الأسعار والمبيعات: ${a.sales}`, `رأس المال: ${a.capital}`, ...(a.purpose === "financing" ? [`جهة التمويل: ${a.fundingEntity}`, `مبلغ التمويل: ${a.fundingAmount}`, `متطلبات الجهة: ${a.fundingRequirements}`] : []), `مدة التنفيذ: ${study.plan.days} أيام عمل بعد تأكيد الدفع واستكمال البيانات`, ...(study.documents || []).map(d => `${d.title}: ${d.status === "attached" ? "مرفق" : d.status === "pending" ? "سيستكمل لاحقًا" : "ورد في الإجابات"}${d.note ? " — " + d.note : ""}`)].join("\n");
}
