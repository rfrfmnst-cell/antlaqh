import { fail } from "./security.js";
import { validateCheckoutOrder } from "./edfapay-api-checkout.js";

export const tapWebhookPath = "/api/webhooks/tap";
const endpoint = "https://api.tap.company/v2/charges/";
const tapDomain = /(^|\.)tap\.company$/i;

export function createTapCheckout({env=process.env, origin, request=fetch} = {}) {
  const key = String(env.TAP_SECRET_KEY || "").trim();
  const merchantId = String(env.TAP_MERCHANT_ID || "").trim();
  const test = /^sk_test_[A-Za-z0-9_-]{10,}$/.test(key);
  const live = /^sk_live_[A-Za-z0-9_-]{10,}$/.test(key);
  const publicOrigin = new URL(origin || env.APP_URL || "http://localhost").origin;
  const ready = env.TAP_CHECKOUT_ENABLED === "true" &&
    (test || (live && env.TAP_ALLOW_LIVE === "true")) &&
    /^[A-Za-z0-9_-]{2,64}$/.test(merchantId) &&
    (publicOrigin.startsWith("https://") || env.NODE_ENV !== "production");
  const readiness = Object.freeze({
    configured: ready, provider:"tap", mode: live ? "production" : "sandbox",
    reason: ready ? null : !key ? "missing_key" :
      !merchantId ? "missing_merchant" : "disabled_or_invalid",
  });

  async function initiate({order,providerOrderId}) {
    if (!ready) throw fail(503,"ربط تاب غير مفعّل لحساب انطلاقة.");
    const {customer,customerPhone} = validateCheckoutOrder(order,providerOrderId);
    const digits = customerPhone.slice(1);
    // The first digits encode the country code; Antlaqh currently accepts Saudi mobile numbers.
    if (!/^9665\d{8}$/.test(digits)) throw fail(409,"الدفع عبر تاب يتطلب رقم جوال سعودي صالح.");
    const parts = customer.name.trim().split(/\s+/);
    const firstName = parts.shift();
    const lastName = parts.join(" ") || firstName;
    const payload = {
      amount:Number((order.amount/100).toFixed(2)), currency:"SAR",
      customer_initiated:true, threeDSecure:true, save_card:false,
      description:"Antlaqh order " + order.number,
      reference:{transaction:providerOrderId,order:providerOrderId},
      customer:{first_name:firstName,last_name:lastName,email:customer.email.trim().toLowerCase(),
        phone:{country_code:"966",number:digits.slice(3)}},
      merchant:{id:merchantId},
      source:{id:"src_all"},
      post:{url:publicOrigin+tapWebhookPath},
      redirect:{url:publicOrigin+"/#/payment/"+encodeURIComponent(order.id)+"?provider=tap"},
    };
    let response;
    try {
      response=await request(endpoint,{method:"POST",headers:{
        authorization:"Bearer "+key,accept:"application/json",
        "Content-Type":"application/json",lang_code:"ar",
      },body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    } catch {throw fail(502,"تعذر الاتصال ببوابة تاب.");}
    if (!response?.ok) {
      const code=Number(response?.status);
      throw fail(502,[401,403].includes(code) ? "رفضت تاب بيانات الاعتماد أو صلاحيات التاجر." :
        "تعذر إنشاء جلسة الدفع لدى تاب." + (Number.isInteger(code) ? " (HTTP "+code+")" : ""));
    }
    let data;
    try {data=await response.json();} catch {throw fail(502,"استجابة تاب غير صالحة.");}
    if (data?.status !== "INITIATED" || !/^chg_[A-Za-z0-9_-]{8,}$/.test(data?.id || ""))
      throw fail(502,"لم تُنشئ تاب عملية دفع معلّقة صالحة.");
    let target;
    try {
      target=new URL(data.transaction?.url);
      if (target.protocol!=="https:" || !tapDomain.test(target.hostname) || target.username || target.password) throw Error();
    } catch {throw fail(502,"رابط صفحة تاب غير صالح.");}
    return {redirectUrl:target.href,providerOrderId,chargeId:data.id};
  }
  return {readiness,initiate};
}
