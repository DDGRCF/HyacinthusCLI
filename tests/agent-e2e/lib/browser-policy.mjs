// 改动说明：同源请求直接交给隔离栈 nginx（保留 sec-fetch-site），仅跨源 API 改写到隔离后端；阻断外部站点/WS。
import { POLICY, loopbackOrigin } from './policy.mjs';

/** Keep same-origin UI/API requests on the isolated stack so browser-mandated Sec-Fetch headers survive. */
export function authorizationTarget(raw, config) {
  const request = new URL(raw);
  const api = loopbackOrigin(config.api);
  const admin = loopbackOrigin(config.admin);
  if (request.protocol !== 'http:' && request.protocol !== 'https:') return null;
  if (request.origin === admin) return 'ui';
  if (request.pathname.startsWith('/api/')) return new URL(`${request.pathname}${request.search}`, api).href;
  return null;
}

/** Route to real API responses, not mocks; disable Service Worker and WebSocket bypasses before page creation. */
export async function protectAuthorizationContext(context, config) {
  await context.route('**/*', async route => {
    const target = authorizationTarget(route.request().url(), config);
    if (target === 'ui') { await route.continue(); return; }
    if (!target) { await route.abort('blockedbyclient'); return; }
    try {
      const response = await route.fetch({ url: target, maxRedirects: 0, timeout: POLICY.browserTimeoutMs });
      await route.fulfill({ response });
    } catch { await route.abort('failed'); }
  });
  await context.routeWebSocket('**', async socket => { await socket.close(); });
}
