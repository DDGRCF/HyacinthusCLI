// 改动说明：保留本轮全部用户可见 assistant 文本，防止只看最后回复而漏判中途已展示的授权链接。

/** Collect only assistant text emitted in this turn, never accepting tool output or prior-turn text as user-visible proof. */
export function assistantReply(messages, startIndex = 0) {
  const assistantMessages = messages.slice(startIndex).filter(message => message.role === 'assistant')
    .map(message => (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n'))
    .filter(Boolean);
  return { finalMessage: assistantMessages.at(-1) || '', assistantMessages };
}

/** Bind an exact original URL to a real assistant message rather than a final summary or tool transcript. */
export function sharedAuthorization(reply, originalUrl) {
  return typeof originalUrl === 'string' && originalUrl.length > 0
    && reply.assistantMessages.some(text => (text.match(/https?:\/\/[^\s<>"'`()\[\]，。；！？]+/g) || []).includes(originalUrl));
}
