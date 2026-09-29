# أصول هوية إنطلاقة

استخدمت أداة image_gen المدمجة لإنشاء الصور وعزل الرمز من الشعار المرفق. لم يُستخدم مسار API/CLI لتوليد الصور.

- الشعار: public/assets/brand-logo-transparent.png — خلفية شفافة؛ الاسم الكامل يُكتب بنص HTML بجواره.
- الصور: public/assets/catalog-{id}.webp — 14 صورة مختلفة، بعرض 1200 بكسل، محسّنة للويب مع الحفاظ على المحتوى. جميعها صور توضيحية للخدمات، لا أعمال عملاء أو منتجات فعلية للبيع.

## وصف توليد الشعار

Use case: background-extraction. Edit target: the attached original INTLAKAH / إنطلاقة brand image. Create a clean transparent PNG cutout of ONLY the original central metallic dark teal and mint monogram at the top (the interwoven i/A-shaped symbol), with its original geometry, bevels, colors, gradients and proportions exactly preserved. Remove the grey/white background, ALL wireframe decorations and cast background shadows, and remove ALL Arabic and English lettering below the symbol; the website will typeset the business name itself separately. The symbol must be isolated on TRUE TRANSPARENT alpha, not a checkerboard or opaque white background. Tight square composition with even small padding, sharp crisp edges, high fidelity to original brand, do not redesign or invent the mark. No new text, objects, shadows or border.

## مجموعة أوصاف الصور

النوع: product-mockup. صور أفقية 3:2. الاتجاه المشترك: هوية تجارة رقمية راقية؛ بترولي داكن #143f3c، نعناعي #a7d2c5، فضي وأبيض دافئ #f3f6f2. تصوير استوديو ثلاثي الأبعاد واقعي بضوء نهار ناعم وظلال خفيفة، ألمنيوم ساتان وزجاج مصنفر وخامات طبيعية. تكوين مركزي يشغل 70%، خلفية رمادية مخضرة هادئة، خطوط هندسية رفيعة جدًا، دون نصوص أو علامات مائية أو شعارات مخترعة. استُخدم وصف مستقل لكل أصل:

| الملف                     | الموضوع المصمم                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| catalog-website.webp      | شاشة مكتبية وحاسوب محمول فضيان يعرضان واجهات مواقع أنيقة ببترولي ونعناعي، مع شبكة تخطيط واضحة. |
| catalog-apps.webp         | هاتفان فاخران بزوايا متكاملة يعرضان واجهة متجر ولوحة متابعة، دون شعارات المنصات.               |
| catalog-payments.webp     | بطاقة بترولية بلا أرقام، لوحة دفع زجاجية بعلامة نجاح، وجهاز دفع فضي مع أقواس اتصال.            |
| catalog-store.webp        | متجر على حاسوب محمول، حقيبة تسوق نعناعية وعبوات عاجية على قاعدة هادئة.                         |
| catalog-identity.webp     | بطاقات وأوراق ودليل هوية ولوحة عينات ألوان من البترولي والنعناعي، بورق فاخر.                   |
| catalog-marketing.webp    | حاسوب يعرض تحليلات مجردة، مكبر صوت زجاجي وسهم نمو فضي وبطاقات حملة.                            |
| catalog-dropshipping.webp | كرة أرضية زجاجية، طرود ومسارات توصيل متصلة بكتالوج متجر.                                       |
| catalog-noon.webp         | لوحة كتالوج على جهاز لوحي، طرود وحقيبة صفراء كلمسة لونية، ماسح باركود نعناعي؛ بلا شعارات.      |
| catalog-amazon.webp       | جهاز لوحي بلوحة البائع، طرود كرافت وشريط برتقالي وماسح فضي؛ بلا شعار أمازون.                   |
| catalog-ai.webp           | شبكة عصبية زجاجية مضيئة باعتدال، متصلة بواجهات بترولية لمسارات أتمتة؛ دون روبوتات.             |
| catalog-consulting.webp   | مقعدان نعناعي وبترولي، طاولة عاجية وحاسوب ودفتر تخطيط؛ جلسة استشارة دون أشخاص.                 |
| catalog-platforms.webp    | ثلاث لوحات برمجية متصلة تعرض وحدات تحكم ومستخدمين وجداول فوق قاعدة عاجية.                      |
| catalog-content.webp      | كاميرا فضية ودفتر تحريري وهاتف بمحتوى اجتماعي، رمز تشغيل زجاجي وبطاقات تصوير.                  |
| catalog-academy.webp      | حاسوب بواجهة تعلم، كتب عاجية ونعناعية وقلم وقبعة تخرج زجاجية.                                  |

يختار المسؤول غلاف المنتج من هذه المكتبة في نموذج إضافة المنتج أو تعديله. تظهر الصور أيضًا في الخدمات وصفحاتها والكتالوج.
