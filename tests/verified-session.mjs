import { digest } from '../lib/security.js';
import { accessPolicyVersion } from '../lib/phone-login.js';
// Regression suites seed a previously completed OTP session. Phone-login tests exercise the real HTTP flow.
export async function verifiedSession(db, cookie) {
  const token = cookie.match(/antlaqh_session=([a-f0-9]{36})/)[1];
  const sessionId = digest(token), session = await db.get('session', sessionId);
  await db.update('user', session.userId, u => {
    u.phone ||= '+9665' + String(parseInt(u.id.slice(0, 7), 16)).padStart(8, '0').slice(-8);
    u.phoneVerified = true; u.accessPolicyVersion = accessPolicyVersion; return u;
  });
  await db.update('session', sessionId, s => { s.authentication = 'phone_otp'; return s; });
}
