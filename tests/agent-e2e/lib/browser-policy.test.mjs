// 改动说明：离线验证授权 UI 不使用业务 API/外部站点，转发真实响应与关闭 WS；不连接浏览器或数据库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizationTarget, protectAuthorizationContext } from './browser-policy.mjs';

const config = { api: 'http://127.0.0.1:8001', admin: 'http://127.0.0.1:5667' };

test('authorization API paths always target the isolated API, not a business proxy', () => {
  assert.equal(authorizationTarget('http://127.0.0.1:8000/api/v1/admin/auth?x=1', config), 'http://127.0.0.1:8001/api/v1/admin/auth?x=1');
  assert.equal(authorizationTarget('http://127.0.0.1:5667/assets/app.js', config), 'ui');
  assert.equal(authorizationTarget('https://outside.example/assets/app.js', config), null);
  assert.equal(authorizationTarget('ws://127.0.0.1:8000/api/ws', config), null);
});

test('same-origin admin API stays on the isolated stack so Sec-Fetch headers survive', () => {
  assert.equal(authorizationTarget('http://127.0.0.1:5667/api/v1/admin/auth/sessions/refresh', config), 'ui');
  assert.equal(authorizationTarget('http://127.0.0.1:8001/api/v1/admin/auth/sessions/refresh', config), 'http://127.0.0.1:8001/api/v1/admin/auth/sessions/refresh');
});

test('authorization routing keeps upstream responses and disables WebSocket bypasses', async () => {
  let handler, websocketHandler;
  const context = {
    async route(pattern, callback) { assert.equal(pattern, '**/*'); handler = callback; },
    async routeWebSocket(pattern, callback) { assert.equal(pattern, '**'); websocketHandler = callback; },
  };
  await protectAuthorizationContext(context, config);
  const response = { fromActualUpstream: true };
  let fulfilled;
  await handler({
    request: () => ({ url: () => 'http://127.0.0.1:8000/api/v1/admin/auth/sessions/password' }),
    async fetch(options) { assert.equal(options.url, `${config.api}/api/v1/admin/auth/sessions/password`); assert.equal(options.maxRedirects, 0); return response; },
    async fulfill(value) { fulfilled = value.response; },
  });
  assert.equal(fulfilled, response);
  let closed = false;
  await websocketHandler({ async close() { closed = true; } });
  assert.equal(closed, true);
});
