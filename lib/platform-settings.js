import { text, email, phone, fail } from './security.js';
export const settingFields = {
  BUSINESS_EMAIL: ['بريد التواصل', 'antlaqh2030@gmail.com'], BUSINESS_PHONE: ['رقم التواصل', '+966553575760'],
  BUSINESS_LEGAL_NAME: ['اسم مقدم الخدمة', 'إنطلاقة للتجارة الإلكترونية'], BUSINESS_ADDRESS: ['العنوان', 'المملكة العربية السعودية'],
  BUSINESS_REGISTRATION_NUMBER: ['رقم الوثيقة', ''], BUSINESS_REGISTRATION_TYPE: ['نوع الوثيقة', 'none'], BUSINESS_ACTIVITY: ['النشاط', 'خدمات التجارة الإلكترونية والحلول الرقمية'],
  BANK_NAME: ['البنك', 'البنك الأهلي السعودي'], BANK_IBAN: ['الآيبان', 'SA3610000044000001058010'],
};
export async function readSettings(db) {
  const saved = await db.get('platformConfig', 'settings');
  return Object.fromEntries(Object.entries(settingFields).map(([key, [, fallback]]) => [key, saved?.values?.[key] ?? process.env[key] ?? fallback]));
}
export function validateSettings(value) {
  const result = {};
  for (const key of Object.keys(settingFields)) result[key] = text(value?.[key] ?? '', 0, 300);
  result.BUSINESS_EMAIL = email(result.BUSINESS_EMAIL);
  result.BUSINESS_PHONE = phone(result.BUSINESS_PHONE);
  for (const key of ['BUSINESS_LEGAL_NAME','BUSINESS_ADDRESS','BUSINESS_ACTIVITY','BANK_NAME']) result[key] = text(result[key], 2, 300);
  if (!['none','commercial_registration','freelance_certificate'].includes(result.BUSINESS_REGISTRATION_TYPE)) throw fail(400, 'اختر نوع الوثيقة.');
  result.BANK_IBAN = result.BANK_IBAN.replace(/\s/g, '').toUpperCase();
  if (!/^SA\d{22}$/.test(result.BANK_IBAN)) throw fail(400, 'أدخل آيبان سعودي من 24 خانة.');
  const digits = (result.BANK_IBAN.slice(4) + result.BANK_IBAN.slice(0,4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  if (BigInt(digits) % 97n !== 1n) throw fail(400, 'رقم الآيبان غير صحيح.');
  return result;
}
