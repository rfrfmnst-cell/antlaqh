import { fail, text } from "./security.js";

export const contentProductionConfig = {
  types: [{ id: "images", title: "صور ومنشورات" }, { id: "videos", title: "فيديو قصير" }, { id: "mixed", title: "صور وفيديو" }],
  imageRate: 5900,
  videoModes: [{ id: "editing", title: "مونتاج مواد العميل", rates: { 30: 14900, 60: 24900 } }, { id: "production", title: "إنتاج إعلان رقمي بسيط", rates: { 30: 29900, 60: 49900 } }],
  voiceRates: { 30: 4900, 60: 7900 },
  imageFormats: [{ id: "square", title: "مربع 1:1" }, { id: "portrait", title: "منشور 4:5" }, { id: "vertical", title: "ستوري 9:16" }],
  videoFormats: [{ id: "vertical", title: "ريلز / تيك توك 9:16" }, { id: "square", title: "مربع 1:1" }, { id: "horizontal", title: "يوتيوب 16:9" }],
  platforms: [{ id: "instagram", title: "إنستغرام" }, { id: "tiktok", title: "تيك توك" }, { id: "snapchat", title: "سناب شات" }, { id: "youtube", title: "يوتيوب" }, { id: "other", title: "منصة أخرى / الموقع" }],
  revisions: 2,
  notice: "كل قطعة تشمل فكرة ونصًا مختصرًا ومقاسًا واحدًا وجولتي تعديل ضمن الفكرة المعتمدة. الصور تسلّم PNG/JPG والفيديو MP4 بدقة 1080p. الإنتاج الرقمي يستخدم مواد العميل أو أصولًا مرخصة أو صورًا مولدة متفقًا عليها؛ لا يشمل التصوير الميداني أو ممثلين أو تعليقًا بشريًا أو رسومًا ثلاثية الأبعاد مخصصة أو ملفات المصدر أو نشر المحتوى وإدارة الحسابات. تُراجع المواد والحقوق قبل البدء؛ الاحتياجات خارج هذا النطاق بعرض مستقل قبل التحصيل.",
};

function choice(value, options, label) {
  if (!options.some(x => x.id === value)) throw fail(400, `اختر ${label} من القائمة.`);
  return value;
}
function quantity(value, max) {
  if (!["string","number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max)
    throw fail(400, `حدد عدد القطع من 1 إلى ${max}.`);
  return Number(value);
}
export function validateContentProduction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "حدد خيارات صناعة المحتوى.");
  const c = contentProductionConfig;
  const answers = { type: choice(value.type, c.types, "نوع المحتوى"), platform: choice(value.platform, c.platforms, "المنصة"), language: choice(value.language, [{id:"ar"},{id:"en"}], "لغة المحتوى") };
  for (const [key,min,max] of [["brand",2,160],["audience",2,400],["goal",10,1500],["style",3,600]]) answers[key] = text(value[key],min,max);
  answers.references = text(value.references || "",0,1500);
  answers.sourceUrl = text(value.sourceUrl || "",0,1500);
  if (answers.sourceUrl) {
    let url;
    try { url = new URL(answers.sourceUrl); } catch { throw fail(400,"أدخل رابط HTTPS صحيحًا للمواد أو اتركه لاستكماله لاحقًا."); }
    if (url.protocol !== "https:" || url.username || url.password) throw fail(400,"رابط المواد يجب أن يكون HTTPS دون بيانات دخول.");
  }
  const lines = [];
  if (answers.type !== "videos") {
    answers.imageCount = quantity(value.imageCount,30);
    answers.imageFormat = choice(value.imageFormat,c.imageFormats,"مقاس الصور");
    lines.push({ title: "تصميم صورة مع نص مختصر", quantity: answers.imageCount, unitAmount: c.imageRate, amount: answers.imageCount*c.imageRate });
  }
  if (answers.type !== "images") {
    answers.videoCount = quantity(value.videoCount,10);
    answers.videoMode = choice(value.videoMode,c.videoModes,"طريقة إنتاج الفيديو");
    if (!["string","number"].includes(typeof value.duration) || !["30","60"].includes(String(value.duration))) throw fail(400,"اختر مدة الفيديو: حتى 30 أو 60 ثانية.");
    answers.duration = Number(value.duration);
    answers.videoFormat = choice(value.videoFormat,c.videoFormats,"مقاس الفيديو");
    answers.voice = choice(value.voice,[{id:"none"},{id:"ai"}],"التعليق الصوتي");
    const mode = c.videoModes.find(x => x.id === answers.videoMode), rate = mode.rates[answers.duration];
    lines.push({ title: `${mode.title} حتى ${answers.duration} ثانية`, quantity: answers.videoCount, unitAmount: rate, amount: answers.videoCount*rate });
    if (answers.voice === "ai") {
      const rate = c.voiceRates[answers.duration];
      lines.push({ title:"تعليق صوتي آلي",quantity:answers.videoCount,unitAmount:rate,amount:answers.videoCount*rate });
    }
  }
  return { answers, quote: { lines, amount:lines.reduce((sum,x)=>sum+x.amount,0), currency:"SAR", revisions:c.revisions }, notice:c.notice };
}

export function contentProductionSummary(content) {
  const a = content.answers, c = contentProductionConfig;
  const label = (options,id) => options.find(x=>x.id===id)?.title || id;
  return [
    `نوع المحتوى: ${label(c.types,a.type)}`,
    ...content.quote.lines.map(x => `${x.title}: ${x.quantity} × ${(x.unitAmount/100).toFixed(2)} = ${(x.amount/100).toFixed(2)} ر.س`),
    `إجمالي صناعة المحتوى قبل أي خصم أو خدمات إضافية: ${(content.quote.amount/100).toFixed(2)} ر.س، شامل أي ضريبة واجبة إن انطبقت.`,
    a.imageCount ? `مقاس الصور: ${label(c.imageFormats,a.imageFormat)}` : "",
    a.videoCount ? `مقاس الفيديو: ${label(c.videoFormats,a.videoFormat)}؛ التعليق الصوتي: ${a.voice === "ai" ? "آلي" : "دون تعليق صوتي"}` : "",
    `العلامة: ${a.brand}؛ المنصة: ${label(c.platforms,a.platform)}؛ اللغة: ${a.language === "ar" ? "العربية" : "الإنجليزية"}`,
    `الجمهور: ${a.audience}`, `هدف المحتوى: ${a.goal}`, `الأسلوب المطلوب: ${a.style}`,
    a.references ? `المراجع والتفضيلات: ${a.references}` : "",
    `مواد العميل: ${a.sourceUrl || "يستكملها العميل بالتنسيق مع الفريق قبل البدء"}`,
    `التعديلات: ${content.quote.revisions} جولات ضمن الفكرة المعتمدة. يحدد موعد التسليم في العرض بعد مراجعة المواد؛ الموعد المستهدف ليس موعدًا مؤكدًا.`,
    content.notice,
  ].filter(Boolean).join("\n");
}
