import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { fail, phone } from './security.js';
import { createEdfapayCheckout as apiCheckout, validateCheckoutOrder } from './edfapay-api-checkout.js';
export function createEdfapayCheckout(options = {}) {
 const env = options.env || process.env;
 const request = options.request || fetch;
 const merchantId = String(env.EDFAPAY_MERCHANT_ID || '').trim();
 const password = String(env.EDFAPAY_MERCHANT_PASSWORD || '').trim();
 if (env.EDFAPAY_INTEGRATION === 'api_key' || (!merchantId && !password)) return apiCheckout(options);
 const origin = new URL(options.origin || env.APP_URL || 'http://localhost').origin;
 const ready = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(merchantId) && password.length > 0 && env.EDFAPAY_CHECKOUT_ENABLED !== 'false' && (origin.startsWith('https:') || env.NODE_ENV !== 'production');
 const readiness = Object.freeze({configured:ready, provider:'edfapay',mode:'production',integration:'merchant',requiresBillingAddress:true,reason:ready?null:'merchant_not_ready'});
 async function initiate({order,providerOrderId,billing,payerIp}) {
  if (!ready) throw fail(503,'إعداد بيانات التاجر غير مكتمل أو معطّل.');
  validateCheckoutOrder(order,providerOrderId);
  const limits={firstName:32,lastName:32,address:255,city:32,zip:10,country:2};
  const clean={};
  for (const [key,max] of Object.entries(limits)) { const value=billing?.[key]; if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x1f]/.test(value)) throw fail(400,'أكمل الاسم وعنوان الفوترة الصحيحين قبل الدفع.'); clean[key]=value.trim(); }
  clean.country=clean.country.toUpperCase();
  if(!/^[A-Z]{2}$/.test(clean.country)||!isIP(payerIp||'')) throw fail(400,'تعذر التحقق من بلد الفوترة أو عنوان الاتصال.');
  const amount=(order.amount/100).toFixed(2);
  const description='Antlaqh order '+order.number;
  const md5=createHash('md5').update((providerOrderId+amount+'SAR'+description+password).toUpperCase()).digest('hex');
  const hash=createHash('sha1').update(md5).digest('hex');
  const fields={action:'SALE',edfa_merchant_id:merchantId,order_id:providerOrderId,order_amount:amount,order_currency:'SAR',order_description:description,payer_first_name:clean.firstName,payer_last_name:clean.lastName,payer_address:clean.address,payer_country:clean.country,payer_city:clean.city,payer_zip:clean.zip,payer_email:order.customer.email.trim().toLowerCase(),payer_phone:phone(order.customer.phone),payer_ip:payerIp,term_url_3ds:origin+'/#/payment/'+encodeURIComponent(order.id)+'?provider=edfapay',req_token:'N',recurring_init:'N',auth:'N',hash};
  const body=new FormData(); for(const [key,value] of Object.entries(fields)) body.set(key,value);
  let response; try { response=await request('https://api.edfapay.com/payment/initiate',{method:'POST',headers:{accept:'application/json'},body,signal:AbortSignal.timeout(15000)}); } catch {throw fail(502,'تعذر الاتصال ببوابة الدفع.');}
  let result; try {result=await response.json();} catch {result=null;}
  if ([401,403].includes(response?.status)) throw fail(502,'رفضت بوابة الدفع معرف التاجر أو كلمة مرور التاجر.');
  if (result?.result === 'ERROR' || result?.result === 'DECLINED' || (!response?.ok && result?.error_code)) {
   const messages = {204002:'حساب التاجر لا يملك قناة دفع مفعّلة.',204003:'نوع الدفع غير مفعّل في حساب التاجر.',204004:'طريقة الدفع غير مفعّلة في حساب التاجر.',204006:'شبكة البطاقة غير مفعّلة في حساب التاجر.',204012:'عملة الطلب غير مفعّلة في حساب التاجر.'};
   const code = /^\d{3,6}$/.test(String(result.error_code)) ? String(result.error_code) : '';
   const allowedFields = new Set([...Object.keys(fields),'card_number','card_exp_month','card_exp_year','card_cvv2']);
   const rejectedFields = [...new Set((Array.isArray(result.errors) ? result.errors.slice(0,50) : []).map(error => typeof error?.error_message === 'string' ? error.error_message.match(/^([a-z_]+):/)?.[1] : '').filter(field => allowedFields.has(field)))];
   const detail = rejectedFields.length ? ' الحقول المرفوضة: '+rejectedFields.join(', ')+'.' : '';
   throw fail(502,(messages[Number(code)] || 'رفضت بوابة الدفع إنشاء الجلسة. تحقق من بيانات التاجر ومتطلبات حسابه.')+(code ? ' رمز البوابة: '+code+'.' : '')+detail);
  }
  if (!response?.ok) throw fail(502,'رفضت بوابة الدفع إنشاء جلسة الدفع. HTTP '+(Number.isInteger(response?.status) && response.status>=100 && response.status<=599 ? response.status : 'غير معروف')+'.');
  if (!result) throw fail(502,'استجابة بوابة الدفع غير صالحة.');
  let redirect; try {redirect=new URL(result.redirect_url);if(redirect.protocol!=='https:'||!/(^|\.)edfapay\.com$/i.test(redirect.hostname)||redirect.username||redirect.password)throw Error();} catch {throw fail(502,'لم تعد بوابة الدفع رابط دفع صالحًا.');}
  return {redirectUrl:redirect.href,providerOrderId};
 }
 return {readiness,initiate};
}
