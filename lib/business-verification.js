// A work document number is distinct from a store's e-commerce certificate.
export function businessVerification(env = process.env) {
  const documentNumber = env.BUSINESS_WORK_DOCUMENT_NUMBER || "FL-716389163";
  const certificateNumber = String(env.BUSINESS_ECOMMERCE_CERTIFICATE_NUMBER || "").trim();
  let certificateUrl = "";
  try {
    const url = new URL(env.BUSINESS_ECOMMERCE_CERTIFICATE_URL || "");
    if (url.protocol === "https:" && ["eauthenticate.saudibusiness.gov.sa","business.sa","www.business.sa"].includes(url.hostname) && !url.username && !url.password && url.pathname !== "/" && url.pathname !== "/inquiry") certificateUrl = url.href;
  } catch { /* An unconfigured or invalid URL never activates the verified badge. */ }
  return { documentNumber: /^[A-Z0-9-]{3,60}$/.test(documentNumber) ? documentNumber : "", certificateNumber: /^\d{6,20}$/.test(certificateNumber) ? certificateNumber : "", certificateUrl, verified: !!certificateUrl && /^\d{6,20}$/.test(certificateNumber), inquiryUrl:"https://eauthenticate.saudibusiness.gov.sa/inquiry" };
}
