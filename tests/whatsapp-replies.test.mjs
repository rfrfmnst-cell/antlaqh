import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createWhatsappReplies } from '../lib/whatsapp-replies.js';
import { createMetaWebhook } from '../lib/meta-webhook.js';
import { services, customerJourney } from '../lib/catalog.js';

const now = Date.parse('2026-10-21T12:00:00Z');
const env = { APP_URL: 'https://antlaqh.com', META_AUTOREPLY_ENABLED: 'true',
  META_WEBHOOK_ENABLED: 'true', META_APP_SECRET: 'a'.repeat(32),
  META_WEBHOOK_VERIFY_TOKEN: 'b'.repeat(40), META_WHATSAPP_ACCOUNT_ID: '123456789',
  META_WHATSAPP_PHONE_NUMBER_ID: '987654321', META_WHATSAPP_ACCESS_TOKEN: 'secret'.repeat(10), META_GRAPH_API_VERSION: 'v25.0' };
const message = (id = 'wamid.incoming', body = 'كم سعر تصميم متجر؟') => ({ id, from: '966500000001',
  type: 'text', text: { body }, timestamp: String(now / 1000) });
function setup(overrides = {}) {
  const records = new Map(), calls = [];
  const db = {
    get: async (kind, id) => records.get(kind + id)?.item,
    list: async (kind, owner) => [...records.values()].filter(r => r.kind === kind && (owner === undefined || r.owner === owner)).map(r => r.item),
    insert: async (kind, item, owner) => { const key = kind + item.id; if (records.has(key)) throw Error('duplicate'); records.set(key, { kind, item, owner }); },
    update: async (kind, id, fn) => { const r = records.get(kind + id); r.item = fn(r.item); },
    remove: async (kind, id) => records.delete(kind + id),
  };
  const options = { db, env, clock: () => now, getCatalog: () => ({ services, customerJourney }),
    fetchImpl: async (url, options) => { calls.push({ url, ...options }); return { ok: true }; }, ...overrides };
  return { db, records, calls, options, replies: createWhatsappReplies(options) };
}
test('disabled or incomplete settings never send', async () => {
  for (const missing of ['META_AUTOREPLY_ENABLED', 'META_WHATSAPP_ACCESS_TOKEN', 'META_GRAPH_API_VERSION', 'APP_URL']) {
    const f = setup({ env: { ...env, [missing]: '' } });
    assert.equal(f.replies.readiness.configured, false);
    await f.replies.receive(message()); assert.equal(f.calls.length, 0);
  }
});
test('catalog price and safe links are sent only through the configured Meta number', async () => {
  const f = setup(); await f.replies.receive(message());
  assert.equal(f.calls.length, 1);
  const call = f.calls[0], body = JSON.parse(call.body);
  assert.equal(call.url, 'https://graph.facebook.com/v25.0/987654321/messages');
  assert.equal(body.to, '966500000001');
  assert.equal(body.context.message_id, 'wamid.incoming');
  assert.match(body.text.body, /590 ر\.س/);
  assert.match(body.text.body, /https:\/\/antlaqh.com\/#\//);
  assert.doesNotMatch(JSON.stringify([...f.records.values()]), /966500000001|كم سعر|secret/);
});
test('concurrent deliveries and a process restart do not resend a message', async () => {
  const f = setup(); await Promise.all([f.replies.receive(message()), f.replies.receive(message())]);
  await createWhatsappReplies(f.options).receive(message());
  assert.equal(f.calls.length, 1);
});
test('old, future, malformed and non-text messages never trigger replies', async () => {
  const f = setup();
  for (const patch of [{ timestamp: String(now / 1000 - 301) }, { timestamp: String(now / 1000 + 61) },
    { from: 'invalid' }, { id: '' }, { type: 'image' }, { text: { body: 'a'.repeat(3001) } }])
    await f.replies.receive({ ...message(), ...patch });
  assert.equal(f.calls.length, 0);
});
test('timeouts are recorded without sensitive data and never retried automatically', async () => {
  let attempts = 0;
  const f = setup({ fetchImpl: async () => { attempts++; throw Error('private provider error'); } });
  await f.replies.receive(message()); await f.replies.receive(message());
  assert.equal(attempts, 1);
  assert.equal([...f.records.values()][0].item.state, 'unknown');
  assert.doesNotMatch(JSON.stringify([...f.records.values()]), /private provider error/);
});
test('sender rate limit bounds replies and handoff does not claim a ticket was created', async () => {
  const f = setup();
  for (let i = 0; i < 7; i++) await f.replies.receive(message('wamid.' + i, 'موظف'));
  assert.equal(f.calls.length, 5);
  assert.match(JSON.parse(f.calls[0].body).text.body, /لم يُنشأ طلب دعم/);
});
test('only a signed webhook for the configured account can invoke outbound replies', async () => {
  const f = setup(), hook = createMetaWebhook({ db: f.db, env, clock: () => now, replies: f.replies });
  const payload = { object: 'whatsapp_business_account', entry: [{ id: env.META_WHATSAPP_ACCOUNT_ID,
    changes: [{ field: 'messages', value: { metadata: { phone_number_id: env.META_WHATSAPP_PHONE_NUMBER_ID }, messages: [message()] } }] }] };
  function req(signature, data = payload) {
    const raw = Buffer.from(JSON.stringify(data)), r = Readable.from([raw]);
    r.headers = { 'content-type': 'application/json', 'x-hub-signature-256': signature || 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex') }; return r;
  }
  assert.equal(hook.readiness.outbound, true);
  await assert.rejects(hook.receive(req('sha256=' + '0'.repeat(64))), { status: 403 });
  payload.entry[0].id = '333333333'; await hook.receive(req());
  assert.equal(f.calls.length, 0);
  payload.entry[0].id = env.META_WHATSAPP_ACCOUNT_ID; await hook.receive(req());
  assert.equal(f.calls.length, 1);
});

test('reply claims and result updates work with the persistent application store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'antlaqh-whatsapp-'));
  const db = await createStore({ driver: 'sqlite', dir });
  try {
    const f = setup({ db });
    await f.replies.receive(message());
    await createWhatsappReplies(f.options).receive(message());
    assert.equal(f.calls.length, 1);
    const records = await db.list('whatsappReply');
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'accepted');
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
