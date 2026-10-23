const signup = document.getElementById("signup");
const verifyPanel = document.getElementById("verify-panel");
const verifyForm = document.getElementById("verify-form");
const signupStatus = document.getElementById("signup-status");
const verifyStatus = document.getElementById("verify-status");
let pendingPhone = "";

async function post(path, value) {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "تعذر الاتصال. حاول لاحقًا.");
  return body;
}

signup.addEventListener("submit", async event => {
  event.preventDefault();
  const button = signup.querySelector("button[type=submit]");
  const data = new FormData(signup);
  button.disabled = true;
  signupStatus.textContent = "جارٍ إرسال رمز التحقق…";
  try {
    const phone = String(data.get("phone") || "");
    const result = await post("/api/individual-optins", {
      phone, city: String(data.get("city") || ""), name: String(data.get("name") || ""),
      carrierClaim: String(data.get("carrierClaim") || "unknown"),
      interest: String(data.get("interest") || ""),
      whatsappUser: data.get("whatsappUser") === "on",
      marketingConsent: data.get("marketingConsent") === "on",
      website: String(data.get("website") || ""),
    });
    if (result.status === "already_subscribed") {
      signupStatus.textContent = "هذا الرقم مشترك بالفعل. شكرًا لك.";
    } else {
      pendingPhone = phone;
      verifyPanel.hidden = false;
      signupStatus.textContent = "تم إرسال رمز عبر SMS، أكمل التحقق أدناه.";
      document.getElementById("otp").focus();
    }
  } catch (error) { signupStatus.textContent = error.message || "تعذر التسجيل."; }
  finally { button.disabled = false; }
});

verifyForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = verifyForm.querySelector("button[type=submit]");
  button.disabled = true;
  verifyStatus.textContent = "جارٍ التحقق…";
  try {
    const result = await post("/api/individual-optins/verify", {
      phone: pendingPhone, code: String(new FormData(verifyForm).get("code") || ""),
    });
    if (result.status === "verified") {
      verifyStatus.textContent = "تم تأكيد ملكية رقمك واشتراكك بنجاح!";
      signup.hidden = true; button.hidden = true;
    }
  } catch (error) { verifyStatus.textContent = error.message || "رمز غير صالح."; }
  finally { button.disabled = false; }
});
