function decodeAsset(encoded, first = 0, last = encoded.length * 3 / 4) {
  const boundary = Math.floor(first / 3);
  const decoded = atob(encoded.slice(boundary * 4, Math.ceil(last / 3) * 4));
  const offset = first - boundary * 3;
  const bytes = new Uint8Array(Math.min(last - first, decoded.length - offset));
  for (let index = 0; index < bytes.length; index++) bytes[index] = decoded.charCodeAt(index + offset);
  return bytes;
}

function serveAudio(request, headers, encoded, etag) {
  const size = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  headers['Accept-Ranges'] = 'bytes';
  const ifRange = request.headers.get('If-Range');
  const range = !ifRange || ifRange === etag ? request.headers.get('Range') : null;
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else if (match?.[2]) start = Math.max(0, size - Number(match[2]));
    if (!match || (!match[1] && !match[2]) || start > end) {
      headers['Content-Range'] = `bytes */${size}`;
      return new Response(null, { status: 416, headers });
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end + 1 - start);
  const bytes = request.method === 'HEAD' ? null : decodeAsset(encoded, start, end + 1);
  return new Response(bytes, { status: range ? 206 : 200, headers });
}

function serveAsset(request, path) {
  const entry = siteAssets[path === '/' ? '/index.html' : path];
  if (!Array.isArray(entry)) return new Response('未找到页面', { status: 404 });
  const [type, hash, encoded] = entry;
  const etag = '"' + hash + '"';
  const headers = {
    'Content-Type': type, ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
  };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  if (type === 'audio/mpeg') return serveAudio(request, headers, encoded, etag);
  const body = request.method === 'HEAD' ? null : decodeAsset(encoded);
  return new Response(body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback') {
      try { return await feedbackRequest(request, env.DB); }
      catch (error) {
        console.error('Feedback operation failed:', error.name);
        return accountResponse({ message: '暂时无法保存问卷，请稍后重试。' }, 503);
      }
    }
    if (url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')) {
      try { return await accountRequest(request, env.DB, url.pathname); }
      catch (error) {
        console.error('Account operation failed:', error.name);
        return accountResponse({ message: '账号服务暂时不可用，请稍后重试。' }, 503);
      }
    }
    if (url.pathname === '/api/discussions') {
      try { return await discussionRequest(request, env.DB); }
      catch (error) {
        console.error('Discussion storage error:', error.message);
        return discussionReply({ message: '交流站暂不可用，请稍后重试。' }, 503);
      }
    }
    if (url.pathname === '/api/rooms') {
      try { return await roomRequest(request, env.DB); }
      catch (error) {
        console.error('Room storage error:', error.message);
        return roomError('联机服务暂不可用，请稍后重试。', 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    return serveAsset(request, url.pathname);
  },
};
