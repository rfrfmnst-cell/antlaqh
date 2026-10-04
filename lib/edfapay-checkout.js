import { fail, phone as normalizePhone } from "./security.js";

const defaultEndpoint = "https://app-api.edfapay.com/api/v1/payment-gateway/initiate";

function endpointFrom(value) {
  try {
    const url = new URL(value || defaultEndpoint);
    if (url.protocol !== "https:" || !/(^|\.)edfapay\.com$/i.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function validEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 180;
}

export function createEdfapayCheckout({ env = process.env, origin, request = fetch } = {}) {
  const productionApiKey = String(env.EDFAPAY_API_KEY || "").trim();
  const sandboxApiKey = String(env.EDFAPAY_SANDBOX_API_KEY || "").trim();
  const usingSandboxAlias = !productionApiKey && !!sandboxApiKey;
  const endpoint = endpointFrom(
    env.EDFAPAY_INITIATE_URL ||
    env.EDFAPAY_SANDBOX_INITIATE_URL ||
    (usingSandboxAlias ? "https://demo-api.edfapay.com/api/v1/payment-gateway/initiate" : undefined)
  );
  const apiKey = productionApiKey || sandboxApiKey;
  const enabled = env.EDFAPAY_CHECKOUT_ENABLED === "true" ||
    (env.EDFAPAY_CHECKOUT_ENABLED == null && (productionApiKey || usingSandboxAlias));
  const publicOrigin = new URL(origin || env.APP_URL || "http://localhost").origin;
  const secureOrigin = new URL(publicOrigin).protocol === "https:" || env.NODE_ENV !== "production";
  const keyReady = apiKey.length >= 20;
  const configured = !!endpoint && enabled && secureOrigin && keyReady;
  const reason = configured ? null :
    !endpoint ? "invalid_endpoint" :
    !enabled ? "disabled" :
    !secureOrigin ? "insecure_origin" :
    !keyReady ? "missing_api_key" :
    "not_ready";
  const readiness = Object.freeze({
    configured,
    provider: "edfapay",
    mode: endpoint && /(^|\.)demo-api\.edfapay\.com$/i.test(endpoint.hostname) ? "sandbox" : "production",
    reason,
  });

  async function initiate({ order, providerOrderId }) {
    if (!configured) throw fail(503, "الدفع الإلكتروني عبر مبسط غير مفعّل على الخادم.");
    if (!order || order.status !== "awaiting_payment" || !Number.isSafeInteger(order.amount) || order.amount < 100)
      throw fail(409, "الطلب غير جاهز للدفع الإلكتروني.");
    if (order.payment?.confirmed && !order.payment.revoked)
      throw fail(409, "تم تأكيد دفع هذا الطلب مسبقًا.");
    const contract = order.contracts?.find((item) => item.id === order.currentContract);
    if (!contract?.acceptedAt)
      throw fail(409, "يجب اعتماد العقد قبل إنشاء جلسة الدفع.");
    if (typeof providerOrderId !== "string" || providerOrderId.length > 255 || !/^[A-Za-z0-9._:-]{8,255}$/.test(providerOrderId))
      throw fail(500, "تعذر إنشاء مرجع آمن لعملية الدفع.");
    const customer = order.customer || {};
    if (typeof customer.name !== "string" || customer.name.trim().length < 2 || customer.name.length > 100 || !validEmail(customer.email))
      throw fail(409, "أكمل اسم العميل وبريده قبل الدفع الإلكتروني.");
    let customerPhone;
    try { customerPhone = normalizePhone(customer.phone || ""); }
    catch { throw fail(409, "أكمل رقم جوال صحيحًا قبل الدفع الإلكتروني."); }

    const payload = {
      orderId: providerOrderId,
      currency: "SAR",
      amount: Number((order.amount / 100).toFixed(2)),
      customerDetails: {
        name: customer.name.trim(),
        email: customer.email.trim().toLowerCase(),
        phone: customerPhone,
      },
      recurringInit: "N",
      auth: "N",
      successUrl: publicOrigin + "/#/payment/" + encodeURIComponent(order.id) + "?provider=edfapay&result=success",
      failureUrl: publicOrigin + "/#/payment/" + encodeURIComponent(order.id) + "?provider=edfapay&result=failure",
    };

    let response;
    try {
      response = await request(endpoint.href, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw fail(502, "تعذر الاتصال ببوابة الدفع. حاول مرة أخرى.");
    }
    if (!response?.ok) throw fail(502, "رفضت بوابة الدفع إنشاء جلسة جديدة.");
    let result;
    try { result = await response.json(); }
    catch { throw fail(502, "أعادت بوابة الدفع استجابة غير صالحة."); }
    const redirect = result?.data?.redirectUrl;
    let redirectUrl;
    try {
      const parsed = new URL(redirect);
      if (parsed.protocol !== "https:" || !/(^|\.)edfapay\.com$/i.test(parsed.hostname)) throw Error();
      redirectUrl = parsed.href;
    } catch {
      throw fail(502, "تعذر التحقق من رابط صفحة الدفع.");
    }
    return { redirectUrl, providerOrderId };
  }

  return { readiness, initiate };
}
