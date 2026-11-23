(function battleDiscussions() {
  'use strict';
  const page = document.querySelector('#community');
  const root = document.querySelector('#battle-discussions');
  const { safe } = window.DarkVaultViews;
  const api = '/api/discussions';
  const draftKey = 'guanghe-discussion-draft-v1';
  const authorKey = 'guanghe-discussion-author';
  const makeId = () => window.crypto.randomUUID().replaceAll('-', '');
  let audienceToken = '';
  let draft = null;
  let loadedThread = null;
  let loadCount = 0;
  let publishing = false;
  try {
    audienceToken = localStorage.getItem(authorKey) ?? '';
    draft = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
  } catch {}

  root.innerHTML = `<article class="panel discussion-desk">
    <div class="discussion-head"><h2>战报讨论</h2><div>
      <button type="button" class="button subtle small" data-forum="refresh">刷新</button>
      <button type="button" class="button primary small" data-forum="compose">发起讨论</button>
    </div></div>
    <div id="forum-composer" hidden></div>
    <p id="forum-status" role="status"></p>
    <div id="forum-content"></div>
  </article>`;
  const composer = root.querySelector('#forum-composer');
  const status = root.querySelector('#forum-status');
  const content = root.querySelector('#forum-content');
  const threadId = () => location.hash.match(/^#community\/([a-f0-9]{32})$/)?.[1] ?? '';
  const author = id => `玩家 ${safe(id.slice(0, 6).toUpperCase())}`;
  const heading = () => content.querySelector('[data-forum-title]');

  function stash() {
    try {
      if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
    } catch {}
  }

  function compose(seed = {}) {
    if (!draft?.body.trim()) {
      draft = { id: makeId(), title: seed.title ?? '', body: '', attachment: seed.attachment ?? '' };
      stash();
    }
    if (location.hash !== '#community') location.hash = 'community';
    drawComposer();
    requestAnimationFrame(() => composer.querySelector(draft?.title ? 'textarea' : 'input')?.focus());
  }

  function drawComposer() {
    composer.hidden = !draft;
    if (!draft) {
      composer.replaceChildren();
      return;
    }
    composer.innerHTML = `<form class="discussion-form" data-forum-form="thread">
      <label for="discussion-title">讨论标题</label><input id="discussion-title" name="title" maxlength="60" value="${safe(draft.title)}" required>
      ${draft.attachment ? `<p class="battle-attachment">${safe(draft.attachment)}</p>` : ''}
      <label for="discussion-body">你的判断</label><textarea id="discussion-body" name="body" maxlength="500" rows="3" required placeholder="你当时为什么这样出价？">${safe(draft.body)}</textarea>
      <div class="discussion-actions"><button type="submit" class="button primary">公开发布</button>
        <button type="button" class="button subtle" data-forum="discard">取消</button></div>
    </form>`;
  }

  async function request(route, options) {
    let response, data;
    try {
      response = await fetch(api + route, { ...options, signal: AbortSignal.timeout(9000) });
      data = await response.json();
    } catch { throw new Error('交流站连接暂不可用，请稍后重试。'); }
    if (!response.ok) throw new Error(data.message ?? '交流站暂不可用。');
    return data;
  }

  function drawFeed({ threads }) {
    content.innerHTML = threads.length ? `<ul class="thread-feed">${threads.map(thread => `<li>
      <a href="#community/${safe(thread.id)}"><strong>${safe(thread.title)}</strong><span>${thread.replies} 条回复</span></a>
      <p>${safe(thread.body)}</p><small>${author(thread.author)}</small></li>`).join('')}</ul>`
      : '<p class="discussion-empty">这里还没有公开讨论。可以打完一局，带着最难判断的那一箱来问问大家。</p>';
  }

  function drawThread({ thread, replies }, draftReply = '') {
    content.innerHTML = `<a class="text-button" href="#community">返回全部讨论</a>
      <h3 data-forum-title tabindex="-1">${safe(thread.title)}</h3><small>${author(thread.author)}</small>
      ${thread.attachment ? `<p class="battle-attachment">${safe(thread.attachment)}</p>` : ''}
      <p class="discussion-post">${safe(thread.body)}</p>
      <h4>玩家回复</h4>
      ${replies.length ? `<ol class="thread-replies">${replies.map(reply => `<li><strong>${author(reply.author)}</strong><p>${safe(reply.body)}</p></li>`).join('')}</ol>`
        : '<p class="discussion-empty">还没有回复。说说你会出多少。</p>'}
      <form class="discussion-form" data-forum-form="reply" data-thread="${safe(thread.id)}">
        <label for="discussion-reply">你的回复</label><textarea id="discussion-reply" name="body" rows="2" maxlength="500" required>${safe(draftReply)}</textarea>
        <div><button type="submit" class="button primary">发布回复</button></div>
      </form>`;
  }

  async function load(force = false) {
    if (page.hidden) return;
    const id = threadId();
    if (!force && loadedThread === id) return;
    loadedThread = id;
    const generation = ++loadCount;
    const previousInput = content.querySelector('textarea');
    const previousReply = previousInput?.form.dataset.thread === id ? previousInput.value : '';
    if (!force) content.replaceChildren();
    status.textContent = '正在加载讨论…';
    try {
      const data = await request(id ? '?id=' + id : '');
      if (generation !== loadCount) return;
      if (id) {
        drawThread(data, previousReply);
        if (!force) heading()?.focus({ preventScroll: true });
      } else drawFeed(data);
      status.textContent = '';
    } catch (error) {
      if (generation === loadCount) status.textContent = error.message;
    }
  }

  root.addEventListener('input', event => {
    if (event.target.closest('[data-forum-form="thread"]') && draft) {
      draft[event.target.name] = event.target.value;
      stash();
    }
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-forum]');
    if (!button || publishing) return;
    if (button.dataset.forum === 'compose') {
      if (!draft) compose();
      else composer.querySelector('input')?.focus();
    }
    if (button.dataset.forum === 'discard') {
      draft = null;
      stash();
      drawComposer();
    }
    if (button.dataset.forum === 'refresh') void load(true);
  });
  root.addEventListener('submit', async event => {
    const form = event.target.closest('[data-forum-form]');
    if (!form) return;
    event.preventDefault();
    if (publishing) return;
    publishing = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const isThread = form.dataset.forumForm === 'thread';
    try {
      if (!audienceToken) {
        audienceToken = makeId();
        try { localStorage.setItem(authorKey, audienceToken); } catch {}
      }
      const values = Object.fromEntries(new FormData(form));
      const data = await request('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values, id: isThread ? draft.id : (form.dataset.replyId ||= makeId()), token: audienceToken,
          ...(isThread ? { attachment: draft.attachment } : { threadId: form.dataset.thread }),
        }),
      });
      if (isThread) {
        draft = null;
        stash();
        drawComposer();
        location.hash = 'community/' + data.thread.id;
      } else if (threadId() === data.thread.id) {
        drawThread(data);
        content.querySelector('textarea')?.focus({ preventScroll: true });
        status.textContent = '回复已发布。';
      }
    } catch (error) {
      status.textContent = error.message || '发布暂未完成，请重试。';
    } finally {
      button.disabled = false;
      publishing = false;
    }
  });

  document.addEventListener('vault-screen', () => {
    if (page.hidden) loadedThread = null;
    else void load();
  });
  drawComposer();
  void load();
  window.DarkVaultDiscussions = { compose };
})();
