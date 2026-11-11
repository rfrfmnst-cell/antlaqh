import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { id, digest } from '../lib/security.js';
import { readCatalog } from '../lib/catalog-admin.js';

test('admin catalog persists prices, filters hidden services, and rejects customer writes and invalid amounts', async () => {
  const env = { ...process.env }, dir = await mkdtemp(join(tmpdir(), 'antlaqh-catalog-'));
  let app;
  Object.assign(process.env, { NODE_ENV: 'test', PORT: '0', APP_URL: 'http://localhost:39991', DATA_DIR: dir, DB_DRIVER: 'sqlite', BOOTSTRAP_ADMIN_EMAIL: '', BOOTSTRAP_ADMIN_PASSWORD: '', OPENAI_API_KEY: '', TWILIO_ACCOUNT_SID: '' });
  try {
    app = await import('../server.js?catalog=' + randomBytes(6).toString('hex'));
    if (!app.server.listening) await new Promise(done => app.server.once('listening', done));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    async function actor(role) {
      const uid = id(), token = id(), csrf = id();
      await app.db.insert('user', { id: uid, role, name: role, email: role + '@example.test' }, uid);
      await app.db.insert('session', { id: digest(token), userId: uid, csrf, expires: Date.now() + 60000, passwordVersion: 0 }, uid);
      return { cookie: 'antlaqh_session=' + token, csrf };
    }
    const admin = await actor('admin'), customer = await actor('customer');
    async function request(path, method = 'GET', body, user = admin, csrf = true) {
      const response = await fetch(base + path, { method, headers: { Origin: process.env.APP_URL, Cookie: user.cookie, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': user.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json() };
    }
    const initial = (await request('/api/admin/services')).data;
    const website = initial.find(s => s.id === 'website');
    const value = { ...website, enabled: true, amount: 123400, includes: website.includes.join('\n'), scope: website.pricing.scope };
    assert.equal((await request('/api/admin/services/website', 'PUT', value, customer)).status, 403);
    assert.equal((await request('/api/admin/services/website', 'PUT', value, admin, false)).status, 403);
    assert.equal((await request('/api/admin/services/website', 'PUT', { ...value, amount: -1 })).status, 400);
    assert.equal((await request('/api/admin/services/website', 'PUT', value)).status, 200);
    assert.equal((await readCatalog(app.db)).find(s => s.id === 'website').pricing.from, 123400);
    let config = (await request('/api/config')).data;
    assert.equal(config.services.find(s => s.id === 'website').pricing.from, 123400);
    assert.equal(config.services.find(s => s.id === 'ai').checkoutAddons.find(s => s.id === 'website').pricing.from, 123400);
    assert.equal((await request('/api/admin/services/website', 'PUT', { ...value, enabled: false })).status, 200);
    config = (await request('/api/config')).data;
    assert.equal(config.services.some(s => s.id === 'website'), false);
    assert.equal(config.services.find(s => s.id === 'ai').checkoutAddons.some(s => s.id === 'website'), false);
    assert.equal((await request('/api/admin/services', 'POST', { ...value, title: 'خدمة جديدة تجريبية' })).status, 201);
    const settings = (await request('/api/admin/platform-settings')).data.values;
    assert.equal((await request('/api/admin/platform-settings', 'PUT', { ...settings, BANK_IBAN: 'invalid' })).status, 400);
    assert.equal((await request('/api/admin/platform-settings', 'PUT', { ...settings, BUSINESS_EMAIL: 'owner@example.test' }, customer)).status, 403);
    assert.equal((await request('/api/admin/platform-settings', 'PUT', { ...settings, BUSINESS_EMAIL: 'owner@example.test' })).status, 200);
    assert.equal((await request('/api/config')).data.businessEmail, 'owner@example.test');
  } finally {
    if (app) { app.server.closeAllConnections(); await new Promise(done => app.server.close(done)); await app.db.close(); }
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  }
});
