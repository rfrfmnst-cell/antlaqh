import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/antlaqh-whatsapp-webhook/index.ts', import.meta.url), 'utf8');
function handler(env = {}) {
  let callback;
  vm.runInNewContext(source, { Deno: { env: { get: key => env[key] }, serve: fn => { callback = fn; } },
    Response, URL, TextEncoder, TextDecoder, AbortSignal,
    fetch() { throw Error('Health must never call a provider'); } });
  return callback;
}
test('Supabase health names missing Meta settings without exposing secret values or sending messages', async () => {
  const health = await handler()(new Request('https://example.test/health'));
  const result = await health.json();
  assert.equal(health.status, 200);
  assert.equal(result.meta_secrets_configured, false);
  assert.equal(result.inbound_and_outbound_ready, false);
  assert.deepEqual(result.missing_meta_settings.sort(), ['META_WEBHOOK_VERIFY_TOKEN', 'META_APP_SECRET',
    'META_WHATSAPP_ACCOUNT_ID', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_ACCESS_TOKEN'].sort());
});
test('valid Meta values clear the missing list but never enable automation without its separate settings', async () => {
  const values = { META_WEBHOOK_VERIFY_TOKEN: 'verify-private'.repeat(4), META_APP_SECRET: 'app-private'.repeat(4),
    META_WHATSAPP_ACCOUNT_ID: '123456789', META_WHATSAPP_PHONE_NUMBER_ID: '987654321',
    META_WHATSAPP_ACCESS_TOKEN: 'access-private'.repeat(4) };
  const result = await (await handler(values)(new Request('https://example.test/health'))).json();
  assert.deepEqual(result.missing_meta_settings, []);
  assert.equal(result.meta_secrets_configured, true);
  assert.equal(result.ai_automation_enabled, false);
  assert.equal(result.inbound_and_outbound_ready, false);
  for (const secret of Object.values(values)) assert.ok(!JSON.stringify(result).includes(secret));
});
