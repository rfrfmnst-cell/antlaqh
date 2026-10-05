# ربط رسائل SMS في انطلاقة

أضيف دعم الرسائل النصية التشغيلية للطلبات عبر Twilio Messaging API. الربط منفصل عن Twilio Verify المستخدم لرموز التحقق.

## الرسائل التي يرسلها النظام

- تأكيد استلام الطلب، مع رابط المتابعة عند إنشاء الطلب.
- إشعار عند تجهيز عرض السعر والعقد.
- إشعار بعد تأكيد استلام الدفع.
- إشعار عند انتقال الطلب بين مراحل التنفيذ.

هذه رسائل تشغيلية مرتبطة بطلب العميل، وليست حملات تسويقية.

## متغيرات البيئة في Hostinger

```env
SMS_NOTIFICATIONS_ENABLED=true
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=...
```

يفضل استخدام `TWILIO_MESSAGING_SERVICE_SID`. ويمكن بدلًا منه، إذا كان لديك مرسل معتمد:

```env
TWILIO_SMS_FROM=ANTLAQH
```

لا تحفظ أي مفاتيح حقيقية داخل GitHub.

## التفعيل

1. أنشئ أو اختر Messaging Service / Sender معتمد لدى مزود الرسائل.
2. أضف القيم السابقة إلى Environment Variables في Hostinger.
3. أعد تشغيل تطبيق Node.js.
4. افتح `/api/config` وتحقق من:
   - `smsNotificationsReady: true`
   - `channels.sms.transactional: true`
5. أنشئ طلبًا تجريبيًا برقم جوال تملكه وتأكد من وصول الرسالة.
6. اختبر تغيير الحالة وتأكيد الدفع.

إذا كانت القيم ناقصة أو `SMS_NOTIFICATIONS_ENABLED=false` فلن ترسل المنصة أي SMS، ولن تتأثر دورة الطلب.
