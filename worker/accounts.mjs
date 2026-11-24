const accountCookie = '__Host-vault_session';
const accountTtl = 30 * 86400;
const accountOutsidePlay = new Set([
  'afk-start', 'claim-afk', 'scratch-card', 'spin-slots', 'checkin', 'report-shared',
  'milestone', 'exchange', 'note', 'community', 'community-official',
]);
const accountActions = new Set([...accountOutsidePlay, 'start', 'scan', 'pass', 'bid', 'continue', 'extract', 'tick']);
const accountEncoder = new TextEncoder();
const toHex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const hashAccountToken = async token => toHex(await crypto.subtle.digest('SHA-256', accountEncoder.encode(token)));

function accountResponse(data, status = 200, cookie) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}

const accountCookieValue = (value, age) => `${accountCookie}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;

function accountSession(request) {
  const raw = request.headers.get('Cookie')?.split(';').map(entry => entry.trim())
    .find(entry => entry.startsWith(accountCookie + '='))?.slice(accountCookie.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? hashAccountToken(raw) : null;
}

async function deriveVerifier(password, salt) {
  const key = await crypto.subtle.importKey('raw', accountEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt.match(/../g), byte => parseInt(byte, 16)), iterations: 100_000,
  }, key, 256));
}

function sameVerifier(expected, actual) {
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= parseInt(expected.slice(i * 2, i * 2 + 2), 16) ^ actual[i];
  return difference === 0;
}

async function getAccount(db, session, now) {
  if (!session) return null;
  return db.prepare(`SELECT a.id, a.username, a.state, a.revision FROM vault_sessions s
    JOIN vault_accounts a ON s.account_id = a.id WHERE s.token_hash = ? AND s.expires > ?`)
    .bind(session, now).first();
}

async function startAccountSession(db, row, prior, now) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashAccountToken(token);
  const statements = [
    db.prepare('DELETE FROM vault_sessions WHERE expires <= ?').bind(now),
    db.prepare('INSERT INTO vault_sessions VALUES (?, ?, ?)').bind(tokenHash, row.id, now + accountTtl * 1000),
  ];
  if (prior) statements.unshift(db.prepare('DELETE FROM vault_sessions WHERE token_hash = ?').bind(prior));
  await db.batch(statements);
  return accountResponse({ username: row.username, state: JSON.parse(row.state), now }, 200, accountCookieValue(token, accountTtl));
}

async function authenticateAccount(db, input, operation, request, prior, now) {
  const username = typeof input.username === 'string' ? input.username.trim().normalize('NFKC').toLowerCase() : '';
  const password = input.password;
  if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 80) {
    return accountResponse({ message: '用户名需为 2–24 位文字、数字、下划线或连字符，密码需为 8–80 位。' }, 400);
  }
  const source = request.headers.get('CF-Connecting-IP') ?? 'local';
  const windowStart = Math.floor(now / 60_000);
  const bucket = await hashAccountToken(source + ':' + windowStart);
  await db.prepare('DELETE FROM vault_auth_attempts WHERE expires <= ?').bind(now).run();
  const attempt = await db.prepare(`INSERT INTO vault_auth_attempts VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count`)
    .bind(bucket, now + 120_000).first();
  if (attempt.count > 20) return accountResponse({ message: '尝试过于频繁，请稍后再试。' }, 429);

  if (operation === 'register') {
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const verifier = toHex(await deriveVerifier(password, salt));
    const state = globalThis.DarkVaultGame.createState();
    state.afkSince = now;
    const row = { id: crypto.randomUUID(), username, state: JSON.stringify(state) };
    const result = await db.prepare('INSERT OR IGNORE INTO vault_accounts (id, username, salt, verifier, state) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, username, salt, verifier, row.state).run();
    if (!result.meta.changes) return accountResponse({ message: '这个用户名已被使用。' }, 409);
    return startAccountSession(db, row, prior, now);
  }

  const row = await db.prepare('SELECT id, username, salt, verifier, state FROM vault_accounts WHERE username = ?').bind(username).first();
  const calculated = await deriveVerifier(password, row?.salt ?? '00'.repeat(16));
  if (!row || !sameVerifier(row.verifier, calculated)) return accountResponse({ message: '用户名或密码不正确。' }, 401);
  return startAccountSession(db, row, prior, now);
}

async function accountGameAction(db, session, action) {
  if (!action || !accountActions.has(action.type)) return accountResponse({ message: '不支持这项操作。' }, 400);
  const game = globalThis.DarkVaultGame;
  for (let attempt = 0; attempt < 6; attempt++) {
    const now = Date.now();
    const row = await getAccount(db, session, now);
    if (!row) return accountResponse({ message: '登录已过期，请重新登录。' }, 401);
    if (action.expectedUsername !== undefined && action.expectedUsername !== row.username) {
      return accountResponse({ message: '账号已在另一个页面切换，请刷新后重试。' }, 409);
    }
    let result = game.reduce(JSON.parse(row.state), action, { now });
    if (result.effect === 'settled' && accountOutsidePlay.has(action.type)) {
      result = { ...game.reduce(result.state, action, { now }), changed: true };
    }
    if (result.changed) {
      const update = await db.prepare('UPDATE vault_accounts SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
        .bind(JSON.stringify(result.state), row.id, row.revision).run();
      if (!update.meta.changes) continue;
    }
    return accountResponse({ ...result, username: row.username, now });
  }
  return accountResponse({ message: '另一个页面正在更新存档，请重试。' }, 409);
}

async function accountRequest(request, db, path) {
  if (!db) return accountResponse({ message: '账号服务暂时不可用。' }, 503);
  const now = Date.now();
  if (path === '/api/account' && request.method === 'GET') {
    const row = await getAccount(db, await accountSession(request), now);
    return accountResponse(row ? { username: row.username, state: JSON.parse(row.state), now } : { username: null, now });
  }
  if (request.method !== 'POST') return accountResponse({ message: '操作不受支持。' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return accountResponse({ message: '请从游戏页面操作。' }, 403);
  }
  let input;
  try {
    if (Number(request.headers.get('Content-Length')) > 4000) return accountResponse({ message: '内容太长。' }, 413);
    const body = await request.text();
    if (body.length > 1500) return accountResponse({ message: '内容太长。' }, 413);
    input = JSON.parse(body);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid input');
  } catch { return accountResponse({ message: '操作格式错误。' }, 400); }
  const session = await accountSession(request);
  if (path === '/api/account/register' || path === '/api/account/login') return authenticateAccount(db, input, path.split('/').pop(), request, session, now);
  if (path === '/api/account/action') return accountGameAction(db, session, input);
  if (path === '/api/account/logout') {
    if (session) await db.prepare('DELETE FROM vault_sessions WHERE token_hash = ?').bind(session).run();
    return accountResponse({ username: null, now }, 200, accountCookieValue('', 0));
  }
  return accountResponse({ message: '操作不受支持。' }, 404);
}

async function feedbackRequest(request, db) {
  if (request.method !== 'POST') return accountResponse({ message: '请在问卷页提交。' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return accountResponse({ message: '请从体验问卷提交。' }, 403);
  }
  let input;
  try {
    if (Number(request.headers.get('Content-Length')) > 6000) return accountResponse({ message: '反馈太长了。' }, 413);
    const text = await request.text();
    if (text.length > 2500) return accountResponse({ message: '反馈太长了。' }, 413);
    input = JSON.parse(text);
  } catch { return accountResponse({ message: '无法读取反馈。' }, 400); }
  const { id, rating, friction, note, mode } = input ?? {};
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || ![1, 2, 3, 4, 5].includes(rating) ||
      !['入场与币', '扫描与估价', '出价与揭标', '撤离与结算', '补给与其他功能', '没有卡住'].includes(friction) ||
      typeof note !== 'string' || note.length > 500 || !['solo', 'online', 'visit'].includes(mode)) {
    return accountResponse({ message: '请选择评分和体验环节，补充说明最多 500 字。' }, 400);
  }
  if (!db) return accountResponse({ message: '暂时无法保存问卷，请稍后重试。' }, 503);
  await db.prepare('INSERT OR IGNORE INTO vault_feedback VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, rating, friction, note.trim(), mode, Date.now()).run();
  return accountResponse({ saved: true });
}
