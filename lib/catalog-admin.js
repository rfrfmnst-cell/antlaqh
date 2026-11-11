import { services as defaults } from './catalog.js';
import { fail, text } from './security.js';

const money = value => {
  if (!Number.isSafeInteger(value) || value < 100 || value > 100000000) throw fail(400, 'أدخل سعراً صحيحاً من ريال إلى مليون ريال.');
  return value;
};
export function validateService(value, existing) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'بيانات الخدمة غير صحيحة.');
  if (typeof value.enabled !== 'boolean') throw fail(400, 'حدد حالة الخدمة.');
  const item = {
    id: existing.id,
    title: text(value.title, 3, 140), category: text(value.category, 2, 60),
    description: text(value.description, 10, 5000), enabled: value.enabled,
    includes: text(value.includes, 3, 5000).split('\n').map(s => s.trim()).filter(Boolean),
    pricing: { ...existing.pricing, from: money(value.amount), scope: text(value.scope, 10, 5000) },
  };
  if (existing.study) {
    item.study = structuredClone(existing.study);
    for (const plan of item.study.plans) plan.amount = money(value.studyPrices?.[plan.id]);
    item.pricing.from = Math.min(...item.study.plans.map(p => p.amount));
  }
  if (existing.contentProduction) {
    item.contentProduction = structuredClone(existing.contentProduction);
    const c = item.contentProduction;
    c.imageRate = money(value.contentPrices?.imageRate);
    for (const mode of c.videoModes) for (const duration of [30, 60]) mode.rates[duration] = money(value.contentPrices?.[mode.id + duration]);
    for (const duration of [30, 60]) c.voiceRates[duration] = money(value.contentPrices?.['voice' + duration]);
    item.pricing.from = c.imageRate;
  }
  return item;
}

export async function readCatalog(db, includeHidden = false) {
  const overrides = new Map((await db.list('serviceConfig')).map(s => [s.id, s]));
  const items = defaults.map(s => ({ ...structuredClone(s), ...overrides.get(s.id) }));
  for (const added of overrides.values()) if (!defaults.some(s => s.id === added.id)) items.push({ icon: 'grid', ...added });
  const visible = items.filter(s => s.enabled !== false);
  for (const item of items) item.checkoutAddons = (item.checkoutAddons || []).map(addon => visible.find(s => s.id === addon.id)).filter(Boolean).map(s => ({ id: s.id, title: s.title, description: s.description, pricing: { ...s.pricing } }));
  return includeHidden ? items : visible;
}

export async function saveService(db, value, existing, actor) {
  const item = { ...validateService(value, existing), updatedAt: new Date().toISOString(), updatedBy: actor };
  const previous = await db.get('serviceConfig', item.id);
  if (previous) await db.update('serviceConfig', item.id, () => item);
  else await db.insert('serviceConfig', item);
  return item;
}
