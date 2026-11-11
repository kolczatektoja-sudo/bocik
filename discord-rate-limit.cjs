function createDiscordRateLimitGate({ now = Date.now, fallbackMs = 60_000, initialState } = {}) {
  let globalUntil = 0;
  let ipUntil = 0;
  const routes = new Map();
  let lastLimitedAt = null;
  let lastLimit = null;
  const listeners = new Set();
  const responseBuckets = new Map();
  function recentHttp() {
    const oldest = Math.floor(now() / 60000) - 9;
    for (const minute of responseBuckets.keys()) if (minute < oldest) responseBuckets.delete(minute);
    const result = { window_minutes: 10, total: 0, invalid: 0, by_source: {}, by_status: {} };
    for (const bucket of responseBuckets.values()) {
      result.total += bucket.total;
      result.invalid += bucket.invalid;
      for (const [key, count] of Object.entries(bucket.by_source)) result.by_source[key] = (result.by_source[key] || 0) + count;
      for (const [key, count] of Object.entries(bucket.by_status)) result.by_status[key] = (result.by_status[key] || 0) + count;
    }
    return result;
  }
  function recordResponse(source, response) {
    // Only aggregate transport labels and status codes: never store webhook tokens or URLs.
    if (!['bot-rest', 'interaction-rest', 'monitoring-webhook', 'registration-rest'].includes(source)) source = 'other';
    const minute = Math.floor(now() / 60000);
    const bucket = responseBuckets.get(minute) || { total: 0, invalid: 0, by_source: {}, by_status: {} };
    const status = String(response.status);
    bucket.total++;
    if ([401, 403, 429].includes(response.status) &&
        !(response.status === 429 && response.headers?.get?.('x-ratelimit-scope') === 'shared')) bucket.invalid++;
    bucket.by_source[source] = (bucket.by_source[source] || 0) + 1;
    bucket.by_status[status] = (bucket.by_status[status] || 0) + 1;
    responseBuckets.set(minute, bucket);
    recentHttp();
  }
  function exportState() {
    return { version: 1, globalUntil, ipUntil, lastLimitedAt, lastLimit,
      routes: [...routes].filter(([, until]) => until > now()) };
  }
  function notify() {
    for (const listener of listeners) {
      try { Promise.resolve(listener()).catch(() => {}); } catch (_) { /* Persistence cannot break the gate. */ }
    }
  }
  function restoreState(state) {
    if (!state || state.version !== 1) return;
    const deadline = value => Number.isFinite(value) && value > now() ? value : 0;
    globalUntil = Math.max(globalUntil, deadline(state.globalUntil));
    ipUntil = Math.max(ipUntil, deadline(state.ipUntil));
    for (const entry of Array.isArray(state.routes) ? state.routes : []) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
      const until = deadline(entry[1]);
      if (until) routes.set(entry[0], Math.max(routes.get(entry[0]) || 0, until));
    }
    if (typeof state.lastLimitedAt === 'string') lastLimitedAt = state.lastLimitedAt;
    if (state.lastLimit && typeof state.lastLimit === 'object') lastLimit = state.lastLimit;
    notify();
  }
  restoreState(initialState);
  function snapshot() {
    return {
      global_retry_after_ms: Math.max(0, globalUntil - now(), ipUntil - now()),
      bot_retry_after_ms: Math.max(0, globalUntil - now()),
      ip_retry_after_ms: Math.max(0, ipUntil - now()),
      last_limited_at: lastLimitedAt,
      last_limit: lastLimit,
      recent_http: recentHttp(),
    };
  }
  function assertAllowed(key, { authenticated = true } = {}) {
    const remaining = Math.max(ipUntil, authenticated ? globalUntil : 0, routes.get(key) || 0) - now();
    if (remaining <= 0) return;
    const error = new Error('Discord API: trwa przerwa po HTTP 429.');
    Object.assign(error, { status: 429, code: 429, retryAfterMs: remaining, localCooldown: true });
    throw error;
  }
  function block(key, ms, global = false) {
    const delay = Number.isFinite(ms) && ms > 0 ? ms : fallbackMs;
    const until = now() + delay;
    if (global === 'ip') ipUntil = Math.max(ipUntil, until);
    else if (global) globalUntil = Math.max(globalUntil, until);
    else routes.set(key, Math.max(routes.get(key) || 0, until));
    lastLimitedAt = new Date(now()).toISOString();
    if (routes.size > 200) {
      for (const [route, expiry] of routes) if (expiry <= now()) routes.delete(route);
    }
    notify();
    return delay;
  }
  function observe(key, response, data, { globalOnly = false, authenticated = true } = {}) {
    if (response.status !== 429) return 0;
    const header = response.headers?.get?.('retry-after');
    const seconds = [data?.retry_after, header, response.headers?.get?.('x-ratelimit-reset-after')]
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(Number).filter(value => Number.isFinite(value) && value >= 0);
    const dateMs = header && !Number.isFinite(Number(header)) ? Date.parse(header) - now() : 0;
    const ms = Math.max(0, dateMs || 0, ...seconds.map(value => value * 1000));
    const ipBlocked = /blocked from accessing our API temporarily/i.test(
      typeof data === 'string' ? data : data?.message || '');
    const global = data?.global === true || response.headers?.get?.('x-ratelimit-global') === 'true' ||
      response.headers?.get?.('x-ratelimit-scope') === 'global';
    // discord.js already queues individual REST buckets. Never promote a
    // channel rename/category limit to a pause of unrelated bot operations.
    if (globalOnly && !global && !ipBlocked) return 0;
    // Tokenless interaction/webhook requests use the IP global limit, not the
    // bot token's global limit. A temporary API/IP ban stops both transports.
    const scope = ipBlocked || (global && !authenticated) ? 'ip' : global;
    // Keep the origin of the actual HTTP 429, not subsequent localCooldown errors.
    lastLimit = { key, authenticated, scope: response.headers?.get?.('x-ratelimit-scope') || null,
      reportedGlobal: global, temporaryApiBan: ipBlocked,
      blockedScope: scope === 'ip' ? 'ip' : scope ? 'bot' : 'route',
      observedAt: new Date(now()).toISOString() };
    return block(key, ms > 0 ? ms + 100 : fallbackMs, scope);
  }
  return { snapshot, assertAllowed, observe, block, exportState, restoreState, recordResponse,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
module.exports = { createDiscordRateLimitGate };
