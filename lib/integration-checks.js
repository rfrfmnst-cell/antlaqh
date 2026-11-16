// Read-only provider checks. Raw provider responses, credentials and transactions are never returned.
export async function checkIntegrations({ env = process.env, request = fetch, clock = Date.now } = {}) {
  async function probe(provider, url, options, validate) {
    try {
      const response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if ([401, 403].includes(response.status)) return { state: 'rejected', httpStatus: response.status };
      let data;
      try { data = await response.json(); }
      catch { return { state: 'unavailable', httpStatus: response.status }; }
      const code = String(data?.errors?.[0]?.code || '');
      if (/^\d{3,6}$/.test(code)) return { state: 'rejected', httpStatus: response.status, providerCode: code };
      if (!response.ok) return { state: 'unavailable', httpStatus: response.status };
      const accepted = validate(data);
      return { state: accepted ? 'accepted' : 'unexpected_response', httpStatus: response.status,
        ...(!accepted && provider === 'tap' ? { format: {
          list: data?.object_type === 'list' || data?.object === 'list',
          charges: Array.isArray(data?.charges),
          liveMode: typeof data?.live_mode === 'boolean' ? data.live_mode : null,
        } } : {}) };
    } catch { return { state: 'unavailable' }; }
  }
  const result = { checkedAt: new Date(clock()).toISOString(), authentica: { state: 'not_configured' }, tap: { state: 'not_configured' } };
  await Promise.all([
    env.AUTHENTICA_API_KEY && probe('authentica', 'https://api.authentica.sa/api/v2/balance', {
      headers: { Accept: 'application/json', 'X-Authorization': env.AUTHENTICA_API_KEY },
    }, data => data && (Number.isFinite(Number(data.balance ?? data.data?.balance)))).then(value => { result.authentica = value; }),
    /^sk_test_[A-Za-z0-9_-]{10,}$/.test(env.TAP_SECRET_KEY || '') && env.TAP_MERCHANT_ID &&
      probe('tap', 'https://api.tap.company/v2/charges/list', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.TAP_SECRET_KEY },
        body: JSON.stringify({ limit: '1', merchants: [env.TAP_MERCHANT_ID] }),
      }, data => (data?.object_type === 'list' || data?.object === 'list') && data.live_mode === false && Array.isArray(data.charges)).then(value => { result.tap = value; }),
  ]);
  return result;
}
