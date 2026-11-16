import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { createPhoneLogin, hasServiceAccess, accessPolicyVersion } from '../lib/phone-login.js';
import { digest, id } from '../lib/security.js';
import { checkIntegrations } from '../lib/integration-checks.js';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'antlaqh-phone-'));
  const db = await createStore({ driver: 'sqlite', dir });
  let now = 1794760000000, approval = { verified: true }, failure, calls = [];
  const env = { AUTHENTICA_API_KEY: 'private-test-key-' + 'x'.repeat(25) };
  const auth = createPhoneLogin({ db, env, clock: () => now, request: async (url, options) => {
    calls.push({ url, options });
    if (failure) return { status: failure, ok: false, json: async () => ({ error: env.AUTHENTICA_API_KEY }) };
    return { status: 200, ok: true, json: async () => url.endsWith('/verify-otp') ? approval : { success: true } };
  } });
  const input = { name: 'عميل اختبار', phone: '٠٥٣٦٠٠٠٠٠١', acceptTerms: true };
  try { await run({ db, auth, env, calls, input, advance: ms => { now += ms; }, approve: value => { approval = value; }, fail: status => { failure = status; } }); }
  finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
}
test('phone login requires a configured provider, name, Saudi phone and policy consent before sending', async () => {
  await fixture(async ({ auth, db, input, calls }) => {
    const disabled = createPhoneLogin({ db, env: {} });
    await assert.rejects(disabled.send(input), { status: 503 });
    for (const change of [{ name: '' }, { name: 'a\nname' }, { phone: 'bad' }, { phone: '+12025550123' }, { acceptTerms: false }])
      await assert.rejects(auth.send({ ...input, ...change }), { status: 400 });
    assert.equal(calls.length, 0);
    const sent = await auth.send(input);
    assert.match(sent.challengeId, /^[a-f0-9]{36}$/);
    assert.equal(calls[0].url, 'https://api.authentica.sa/api/v2/send-otp');
    assert.deepEqual(JSON.parse(calls[0].options.body), { method: 'sms', phone: '+966536000001' });
    assert.equal((await db.list('user')).length, 0);
    assert.doesNotMatch(JSON.stringify(sent), /private-test-key|536000001/);
  });
});
test('only explicit provider verification creates a phone account, ignores client privilege and binds the stored challenge', async () => {
  await fixture(async ({ auth, db, input, approve, calls }) => {
    const sent = await auth.send({ ...input, role: 'admin', phoneVerified: true });
    for (const result of [{ success: true }, { verified: 'true' }, {}, { verified: false }]) {
      approve(result);
      await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '123456' }), { status: 400 });
      assert.equal((await db.list('user')).length, 0);
    }
    approve({ verified: true });
    const user = await auth.check({ challengeId: sent.challengeId, code: '012345', phone: '+966599999999', role: 'admin', name: 'Injected' });
    assert.equal(user.phone, '+966536000001'); assert.equal(user.name, input.name); assert.equal(user.role, 'customer');
    assert.equal(user.phoneVerified, true); assert.equal(user.accessPolicyVersion, accessPolicyVersion); assert.equal(user.email, '');
    const last = JSON.parse(calls.at(-1).options.body);
    assert.deepEqual(last, { phone: user.phone, otp: '012345' });
    assert.doesNotMatch(JSON.stringify(await db.list('mobileChallenge')), /012345|123456/);
    assert.equal((await db.get('verifiedPhone', digest(user.phone))).userId, user.id);
    await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '012345' }), { status: 400 });
  });
});
test('resends, five failures, expiry, normalized phone throttling and concurrent verification fail closed', async () => {
  await fixture(async ({ auth, db, input, advance, approve, calls }) => {
    const old = await auth.send(input);
    await assert.rejects(auth.send({ ...input, phone: '+966536000001' }), { status: 429 });
    advance(61000); const fresh = await auth.send(input);
    await assert.rejects(auth.check({ challengeId: old.challengeId, code: '123456' }), { status: 400 });
    const results = await Promise.allSettled([auth.check({ challengeId: fresh.challengeId, code: '123456' }), auth.check({ challengeId: fresh.challengeId, code: '123456' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await db.list('user')).length, 1);
    advance(61000); const third = await auth.send(input);
    approve({ verified: false });
    for (let i = 0; i < 5; i++) await assert.rejects(auth.check({ challengeId: third.challengeId, code: '000000' }), { status: 400 });
    const count = calls.length; await assert.rejects(auth.check({ challengeId: third.challengeId, code: '123456' }), { status: 400 });
    assert.equal(calls.length, count);
    advance(61000); await assert.rejects(auth.send(input), { status: 429 });
    advance(15 * 60000); const expired = await auth.send(input); advance(5 * 60000);
    await assert.rejects(auth.check({ challengeId: expired.challengeId, code: '123456' }), { status: 400 });
  });
});
test('provider failures reveal no keys or upstream payload and create no verified users', async () => {
  for (const status of [401, 403, 429, 500]) await fixture(async ({ auth, db, input, fail, env }) => {
    fail(status);
    await assert.rejects(auth.send(input), e => !e.message.includes(env.AUTHENTICA_API_KEY) && e.status === (status === 429 ? 429 : 503));
    assert.equal((await db.list('user')).length, 0);
  });
});
test('documented Authentica v2 boolean status verifies the account while false, strings and contradictory flags fail closed', async () => {
  await fixture(async ({ auth, db, input, approve }) => {
    const sent = await auth.send(input);
    for (const result of [{ status: false }, { status: 'true' }, { success: true }, { status: true, verified: false }]) {
      approve(result);
      await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '123456' }), { status: 400 });
      assert.equal((await db.list('user')).length, 0);
    }
    approve({ status: true, message: 'OTP verified successfully' });
    const user = await auth.check({ challengeId: sent.challengeId, code: '123456' });
    assert.equal(user.phoneVerified, true);
    await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '123456' }), { status: 400 });
  });
});
test('phone proof cannot take an admin account or an unverified legacy reservation', async () => {
  await fixture(async ({ auth, db, input }) => {
    const sent = await auth.send(input), uid = id(), key = digest('+966536000001');
    await db.insert('loginPhone', { id: key, userId: uid });
    await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '123456' }), { status: 409 });
    assert.equal((await db.list('user')).length, 0);
  });
  await fixture(async ({ auth, db, input }) => {
    const sent = await auth.send(input), uid = id(), key = digest('+966536000001');
    await db.insert('user', { id: uid, role: 'admin', phone: '+966536000001', phoneVerified: true });
    await db.insert('verifiedPhone', { id: key, userId: uid });
    await assert.rejects(auth.check({ challengeId: sent.challengeId, code: '123456' }), { status: 409 });
    assert.equal((await db.get('user', uid)).role, 'admin');
  });
});
test('service permission rejects legacy sessions, missing identity, old policy and unverified numbers', () => {
  const u = { role: 'customer', name: 'عميل', phone: '+966536000001', phoneVerified: true, accessPolicyVersion };
  assert.equal(hasServiceAccess(null), false);
  for (const change of [{ phoneVerified: false }, { name: '' }, { phone: '' }, { accessPolicyVersion: 'old' }])
    assert.equal(hasServiceAccess({ u: { ...u, ...change }, s: { authentication: 'phone_otp' } }), false);
  assert.equal(hasServiceAccess({ u, s: {} }), false);
  assert.equal(hasServiceAccess({ u, s: { authentication: 'phone_otp' } }), true);
  assert.equal(hasServiceAccess({ u: { role: 'admin' }, s: {} }), true);
});
test('read-only integration probes scope Tap to the merchant and expose only sanitized status', async () => {
  const env = { AUTHENTICA_API_KEY: 'secret-auth', TAP_SECRET_KEY: 'sk_test_' + 'x'.repeat(25), TAP_MERCHANT_ID: '68096112' };
  const requests = [];
  const result = await checkIntegrations({ env, request: async (url, options) => {
    requests.push({ url, options }); return { status: 200, ok: true, json: async () => url.includes('authentica') ? { balance: 100 } :
      { object_type: 'list', live_mode: false, charges: [{ id: 'private-charge', customer: { email: 'private@example.test' } }] } };
  } });
  assert.equal(result.authentica.state, 'accepted'); assert.equal(result.tap.state, 'accepted');
  assert.deepEqual(JSON.parse(requests.find(r => r.url.includes('tap.company')).options.body).merchants, ['68096112']);
  assert.doesNotMatch(JSON.stringify(result), /secret-auth|sk_test_|private-charge|private@example/);
});
