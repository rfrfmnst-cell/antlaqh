import { fail, phone, text } from "./security.js";

export const CONSENT_VERSION = "2026-10-21-01";
const carriers = new Set(["unknown", "stc", "mobily", "zain", "other"]);
const interests = new Set(["online-shopping", "digital-services", "offers", "other"]);

export function parseSignup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.website)
    throw fail(400, "طلب التسجيل غير صالح.");
  if (body.marketingConsent !== true || body.whatsappUser !== true)
    throw fail(400, "يجب أن تؤكد اختيارك الاشتراك في عروض واتساب.");
  const normalizedPhone = phone(body.phone);
  if (!/^\+9665\d{8}$/.test(normalizedPhone)) throw fail(400, "أدخل رقم جوال سعودي صحيح.");
  const carrierClaim = text(body.carrierClaim || "unknown", 2, 20);
  const interest = text(body.interest, 2, 40);
  if (!carriers.has(carrierClaim) || !interests.has(interest))
    throw fail(400, "اختر نوع العروض وشركة الاتصال من الخيارات المتاحة.");
  return { phone: normalizedPhone, name: body.name ? text(body.name, 2, 80) : "",
    city: text(body.city, 2, 80), carrierClaim, interest };
}

export function parseVerification(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "التحقق غير صالح.");
  const normalizedPhone = phone(body.phone);
  if (!/^\+9665\d{8}$/.test(normalizedPhone)) throw fail(400, "رقم الجوال غير صالح.");
  const code = text(body.code, 4, 10);
  if (!/^\d{4,10}$/.test(code)) throw fail(400, "رمز التحقق غير صحيح.");
  return { phone: normalizedPhone, code };
}
