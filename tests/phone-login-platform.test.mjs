import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

test('HTTP journey requires OTP for services and reuses the verified account without a password or guest bypass', async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  const dir = await mkdtemp(join(tmpdir(), 'antlaqh-mobile-api-')); let app;
  try {
    Object.assign(process.env, { NODE_ENV: 'test', PORT: '0', APP_URL: 'http://localhost:39989', DATA_DIR: dir, DB_DRIVER: 'sqlite',
      AUTHENTICA_API_KEY: 'mock-authentica-' + 'x'.repeat(30), BOOTSTRAP_ADMIN_EMAIL: '', BOOTSTRAP_ADMIN_PASSWORD: '', OPENAI_API_KEY: '' });
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.authentica.sa/')) throw Error('unexpected external request');
      const b = JSON.parse(options.body);
      return new Response(JSON.stringify(String(url).endsWith('/verify-otp')
        ? { status: b.otp === '012345', message: b.otp === '012345' ? 'OTP verified successfully' : 'Invalid OTP' }
        : { success: true, data: null, message: 'OTP send successfully' }), { status: 200 });
    };
    app = await import('../server.js?mobile=' + randomBytes(6).toString('hex'));
    if (!app.server.listening) await new Promise(done => app.server.once('listening', done));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    async function req(path, body, as) {
      const r = await originalFetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { ...(body ? { Origin: 'http://localhost:39989', 'Content-Type': 'application/json' } : {}),
          ...(as ? { Cookie: as.cookie, 'X-CSRF-Token': as.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
    }
    const order = { type: 'service', service: 'website', title: 'اختبار دخول بالجوال', description: 'طلب محلي للتحقق من حماية رحلة الخدمات.' };
    assert.equal((await req('/api/orders', order)).status, 401);
    assert.equal((await req('/api/auth/guest', { name: 'Bypass' })).status, 410);
    assert.equal((await req('/api/assistant', { messages: [{ role: 'user', content: 'مرحبا' }] })).status, 401);
    const legacy = await req('/api/auth/register', { name: 'حساب قديم', email: 'legacy@example.test', password: 'Only-test-Long-password-123', acceptTerms: true });
    const old = { cookie: legacy.cookie, csrf: legacy.data.csrf };
    assert.equal(legacy.data.user.serviceAccess, false);
    assert.equal((await req('/api/orders', order, old)).status, 401);
    const sent = await req('/api/auth/mobile/send', { name: 'اسم العميل', phone: '0536000002', acceptTerms: true });
    assert.equal(sent.status, 200);
    assert.equal((await req('/api/auth/mobile/check', { challengeId: sent.data.challengeId, code: '000000' })).status, 400);
    const checked = await req('/api/auth/mobile/check', { challengeId: sent.data.challengeId, code: '012345', role: 'admin' });
    assert.equal(checked.status, 200); assert.equal(checked.data.user.serviceAccess, true); assert.equal(checked.data.user.role, 'customer');
    assert.equal(checked.data.user.email, '');
    const actor = { cookie: checked.cookie, csrf: checked.data.csrf };
    assert.equal((await req('/api/session', undefined, actor)).data.user.serviceAccess, true);
    const created = await req('/api/orders', order, actor);
    assert.equal(created.status, 201); assert.equal(created.data.customer.phone, '+966536000002');
    assert.equal((await req('/api/orders/' + created.data.id, undefined, old)).status, 401);
    assert.equal((await req('/api/auth/mobile/check', { challengeId: sent.data.challengeId, code: '012345' })).status, 400);
    assert.doesNotMatch(JSON.stringify(checked.data), /mock-authentica|password|012345/);
  } finally {
    globalThis.fetch = originalFetch;
    if (app) { app.server.closeAllConnections(); await new Promise(done => app.server.close(done)); await app.db.close(); }
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env); await rm(dir, { recursive: true, force: true });
  }
});
