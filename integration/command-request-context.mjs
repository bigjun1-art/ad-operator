/** Per-command accounting only. Callers own the context lifetime (for example via AsyncLocalStorage). */
export function createCommandRequestContext({maxRequests = 1000, now = Date.now} = {}) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0) throw new TypeError('maxRequests must be a non-negative safe integer');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const startedAt = now(), attempts = [];
  const elapsed = start => Math.max(0, now() - start);
  const endpointPath = value => {
    // Store the API route, never a URL query, fragment, user info or request payload.
    const path = String(value ?? '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/, 1)[0];
    return path.startsWith('/') ? path.replace(/\/\d{6,}(?=\/|$)/g, '/:id') : '[invalid endpoint]';
  };
  function reserveAttempt({method, endpoint} = {}) {
    if (attempts.length >= maxRequests) throw Object.assign(new Error(`本次命令已达到 ${maxRequests} 次请求上限，未继续向平台发起请求`), {
      code:'COMMAND_REQUEST_LIMIT', requestDispatched:false, responseCodeValid:false, platformRejectionConfirmed:false,
      maxRequests, requestCount:attempts.length
    });
    const attempt = attempts.length + 1;
    attempts.push({attempt, method:['GET','POST'].includes(method) ? method : 'OTHER', endpoint:endpointPath(endpoint), startedAt:now(), outcome:'pending'});
    return attempt;
  }
  function record(attempt, {responseCode, httpStatus, requestId, outcome} = {}) {
    const entry = attempts[attempt - 1];
    if (!entry || entry.attempt !== attempt) throw new RangeError('Unknown command request attempt');
    entry.elapsedMs = elapsed(entry.startedAt);
    if (typeof responseCode === 'number' && Number.isSafeInteger(responseCode)) entry.responseCode = responseCode;
    if (typeof httpStatus === 'number' && Number.isSafeInteger(httpStatus)) entry.httpStatus = httpStatus;
    if (typeof requestId === 'string' || typeof requestId === 'number') entry.requestId = String(requestId);
    entry.outcome = ['success','error','pending'].includes(outcome) ? outcome : 'error';
  }
  function snapshot() {
    return {maxRequests, requestCount:attempts.length, remainingRequests:maxRequests-attempts.length, startedAt, elapsedMs:elapsed(startedAt),
      attempts:attempts.map(entry => ({...entry, elapsedMs:entry.elapsedMs ?? elapsed(entry.startedAt)}))};
  }
  return {reserveAttempt, record, snapshot};
}
