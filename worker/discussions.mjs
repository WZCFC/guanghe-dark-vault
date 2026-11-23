const discussionId = /^[a-f0-9]{32}$/;
const discussionReply = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function readDiscussion(db, id) {
  if (id === null) {
    const { results } = await db.prepare(`SELECT id, author, title, body, attachment, created,
      (SELECT COUNT(*) FROM discussion_replies r WHERE r.thread_id = t.id) AS replies
      FROM discussion_threads t ORDER BY created DESC, id DESC LIMIT 24`).all();
    return discussionReply({ threads: results });
  }
  if (!discussionId.test(id)) return discussionReply({ message: '帖子地址格式不正确。' }, 400);
  const thread = await db.prepare('SELECT * FROM discussion_threads WHERE id = ?').bind(id).first();
  if (!thread) return discussionReply({ message: '这条讨论找不到了。' }, 404);
  const { results } = await db.prepare(
    'SELECT id, author, body, created FROM discussion_replies WHERE thread_id = ? ORDER BY created DESC, id DESC LIMIT 60',
  ).bind(id).all();
  return discussionReply({ thread, replies: results.reverse() });
}

async function discussionRequest(request, db) {
  const url = new URL(request.url);
  if (!db) return discussionReply({ message: '交流站暂不可用。' }, 503);
  if (request.method === 'GET') return readDiscussion(db, url.searchParams.get('id'));
  if (request.method !== 'POST') return discussionReply({ message: '操作不受支持。' }, 405);
  if (request.headers.get('Origin') !== url.origin) return discussionReply({ message: '请从交流站发布。' }, 403);
  let input;
  try {
    if (Number(request.headers.get('Content-Length')) > 6000) return discussionReply({ message: '内容太长。' }, 413);
    const text = await request.text();
    if (text.length > 3000) return discussionReply({ message: '内容太长。' }, 413);
    input = JSON.parse(text);
  } catch { return discussionReply({ message: '无法读取内容。' }, 400); }
  const { id, token, threadId } = input ?? {};
  const field = key => typeof input[key] === 'string' ? input[key].trim() : '';
  if (typeof id !== 'string' || typeof token !== 'string' || !discussionId.test(id) || !discussionId.test(token)) {
    return discussionReply({ message: '发布会话已失效，请刷新页面。' }, 400);
  }
  const body = field('body');
  if (!body.length || body.length > 500) return discussionReply({ message: '正文需要 1–500 个字符。' }, 400);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const author = Array.from(new Uint8Array(hash).slice(0, 4), byte => byte.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  if (threadId != null) {
    if (typeof threadId !== 'string' || !discussionId.test(threadId)) return discussionReply({ message: '请选择有效帖子。' }, 400);
    const result = await db.prepare(`INSERT OR IGNORE INTO discussion_replies (id, thread_id, author, body, created)
      SELECT ?, id, ?, ?, ? FROM discussion_threads WHERE id = ?`).bind(id, author, body, now, threadId).run();
    if (!result.meta.changes) {
      const existing = await db.prepare('SELECT author FROM discussion_replies WHERE id = ? AND thread_id = ?')
        .bind(id, threadId).first();
      if (existing?.author !== author) return discussionReply({ message: '未找到可回复的讨论。' }, 404);
    }
    return readDiscussion(db, threadId);
  }
  const title = field('title');
  const attachment = field('attachment');
  if (!title.length || title.length > 60 || attachment.length > 320) return discussionReply({ message: '请检查标题或战报长度。' }, 400);
  const result = await db.prepare('INSERT OR IGNORE INTO discussion_threads VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, author, title, body, attachment, now).run();
  if (!result.meta.changes) {
    const existing = await db.prepare('SELECT author FROM discussion_threads WHERE id = ?').bind(id).first();
    if (existing?.author !== author) return discussionReply({ message: '发布冲突，请刷新后重试。' }, 409);
  }
  return readDiscussion(db, id);
}
