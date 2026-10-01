import { fail } from "./security.js";

const offer = Object.freeze({
  code: "ANTLAQH20",
  ratePercent: 20,
  startsAt: "2026-09-30T21:00:00.000Z",
  endsAt: "2026-10-31T21:00:00.000Z",
  timezone: "Asia/Riyadh",
  terms: Object.freeze([
    "خصم إطلاق 20% على خدمات انطلاقة ومنتجاتها الرقمية باستخدام ANTLAQH20.",
    "أدخل الكود عند إنشاء الطلب من 1 أكتوبر وحتى نهاية 31 أكتوبر 2026 بتوقيت الرياض.",
    "يحتفظ الطلب المؤهل بالخصم عند إصدار عرض الخدمة أو تعديله لاحقًا.",
    "يحسب الخادم الخصم من السعر قبل الخصم ويقرّبه إلى أقرب هللة.",
    "يطبّق على إجمالي عرض انطلاقة؛ رسوم المزوّد التي تدفعها لهم مباشرة لا يشملها الكود. لا يجمع مع كود آخر.",
  ]),
});
const start = Date.parse(offer.startsAt), end = Date.parse(offer.endsAt);

export function getLaunchOffer(at = Date.now()) {
  return { ...offer, terms: [...offer.terms], active: at >= start && at < end };
}

export function claimPromotion(value, at = Date.now()) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") throw fail(400, "أدخل كود الخصم الصحيح.");
  const code = value.trim().toUpperCase();
  if (!code) return null;
  if (code !== offer.code) throw fail(400, "كود الخصم غير صحيح.");
  if (at < start) throw fail(400, "عرض الإطلاق لم يبدأ بعد.");
  if (at >= end) throw fail(400, "انتهى عرض الإطلاق؛ لا يمكن استخدام الكود لطلب جديد.");
  return { ...offer, terms: [...offer.terms], claimedAt: new Date(at).toISOString() };
}

export function priceBreakdown(subtotal, promotion = null) {
  if (!Number.isSafeInteger(subtotal) || subtotal < 100 || subtotal > 100000000)
    throw fail(400, "أدخل مبلغًا صالحًا لا يقل عن ريال واحد.");
  // Eligibility is captured when the order is created, so later quotes retain it.
  const discount = promotion ? Math.round(subtotal * promotion.ratePercent / 100) : 0;
  return { subtotal, discount, amount: subtotal - discount };
}
