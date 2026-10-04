const endpoint = process.env.EDFAPAY_SANDBOX_INITIATE_URL || "https://demo-api.edfapay.com/api/v1/payment-gateway/initiate";
const apiKey = String(process.env.EDFAPAY_SANDBOX_API_KEY || "").trim();
if (!apiKey) {
  console.log("EDFAPAY_SANDBOX: SKIPPED (missing GitHub secret EDFAPAY_SANDBOX_API_KEY)");
  process.exit(0);
}
const url = new URL(endpoint);
if (url.protocol !== "https:" || !/(^|\.)edfapay\.com$/i.test(url.hostname)) {
  console.error("EDFAPAY_SANDBOX: FAIL (invalid sandbox endpoint)");
  process.exit(1);
}
const marker = "ANT-SMOKE-" + Date.now();
const payload = {
  orderId: marker,
  currency: "SAR",
  amount: 1,
  customerDetails: { name: "Antlaqh Sandbox", email: "sandbox@example.test", phone: "+966500000000" },
  recurringInit: "N",
  auth: "N",
  successUrl: "https://antlaqh.com/#/payment/sandbox?provider=edfapay&result=success",
  failureUrl: "https://antlaqh.com/#/payment/sandbox?provider=edfapay&result=failure"
};
let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { accept:"application/json", "Content-Type":"application/json", "X-API-KEY":apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
} catch (error) {
  console.error("EDFAPAY_SANDBOX: FAIL (network)", error.name);
  process.exit(1);
}
let data = null;
try { data = await response.json(); } catch {}
if (!response.ok) {
  console.error("EDFAPAY_SANDBOX: FAIL (HTTP " + response.status + ")");
  process.exit(1);
}
let redirect;
try {
  redirect = new URL(data?.data?.redirectUrl);
  if (redirect.protocol !== "https:" || !/(^|\.)edfapay\.com$/i.test(redirect.hostname)) throw Error();
} catch {
  console.error("EDFAPAY_SANDBOX: FAIL (no trusted redirectUrl)");
  process.exit(1);
}
console.log("EDFAPAY_SANDBOX: PASS (hosted checkout session created; no payment submitted)");
console.log("EDFAPAY_SANDBOX_REDIRECT_HOST=" + redirect.hostname);
