// 改动说明：离线验证中途授权分享有效、工具输出和历史轮次不能冒充本轮用户可见授权。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantReply, sharedAuthorization } from './reply.mjs';

const link = 'http://127.0.0.1:18013/admin/agent-auth/authorize?session_id=test-session';

/** Build an ordinary assistant message matching the real SDK message shape. */
function assistant(text) { return { role: 'assistant', content: [{ type: 'text', text }] }; }

test('intermediate assistant authorization link is valid even when the final reply omits it', () => {
  const reply = assistantReply([assistant(`请批准：[授权](${link})`), { role: 'toolResult', content: [] }, assistant('仍在等待用户授权。')]);
  assert.equal(reply.finalMessage, '仍在等待用户授权。');
  assert.equal(sharedAuthorization(reply, link), true);
});

test('tool results and previous turns cannot satisfy user-visible authorization proof', () => {
  const reply = assistantReply([assistant(link), { role: 'user', content: [] }, { role: 'toolResult', content: [{ type: 'text', text: link }] }, assistant('尚未展示链接。')], 1);
  assert.equal(sharedAuthorization(reply, link), false);
  assert.equal(sharedAuthorization(reply, ''), false);
});

test('authorization proof requires the exact original URL, not a changed session', () => {
  const reply = assistantReply([assistant(`${link}-changed`)]);
  assert.equal(sharedAuthorization(reply, link), false);
  assert.equal(sharedAuthorization(assistantReply([assistant(`https://outside.invalid/?next=${link}`)]), link), false);
  assert.equal(sharedAuthorization(reply, `${link}&different=1`), false);
  assert.equal(sharedAuthorization(assistantReply([assistant('未显示')]), link), false);
});
