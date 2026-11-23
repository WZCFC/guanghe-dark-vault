(function onlinePlay() {
  'use strict';
  const screen = document.querySelector('#online');
  const board = document.querySelector('#online-board');
  const status = document.querySelector('#online-status');
  const safe = window.DarkVaultViews.safe;
  const sound = window.DarkVaultSound;
  const fx = window.DarkVaultFx;
  const sessionKey = 'guanghe-online-seat-v1';
  let session = {};
  try { session = JSON.parse(sessionStorage.getItem(sessionKey) || '{}') ?? {}; } catch {}
  const token = session.token ?? (globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? '');
  let code = session.code ?? '';
  let room = null;
  let activeAction = '';
  let queuedAction = null;
  let signature = '';
  let clockOffset = 0;
  let stageKey = '';
  let urgentKey = '';

  const signed = value => (value > 0 ? '+' : '') + value;

  function scanView(snapshot) {
    if (!snapshot.scan) return '';
    const pieces = snapshot.scan.pieces.map((item, index) => `<button type="button" class="scan-piece quality-${item.quality}"
      style="grid-column:${item.column}/span ${item.width};grid-row:${item.row}/span ${item.height};--piece-width:${item.width};--piece-height:${item.height}"
      data-online="piece" data-index="${index}" data-shape="${item.shape}" aria-pressed="${index === 0}"
      aria-controls="online-scan-detail" aria-label="货物 ${index + 1}">${index + 1}</button>`).join('');
    return `<section class="online-scan scan-layout" aria-label="你的扫描结果">
      <div class="scan-heading"><h3>箱内扫描图</h3><span class="scan-feedback">本轮私有线索</span></div>
      <div class="scan-body">
        <div class="scan-grid">${pieces}<span class="online-scan-beam" aria-hidden="true"></span></div>
        <div class="scan-detail" id="online-scan-detail" aria-live="polite">${window.DarkVaultViews.scanDetails(snapshot.scan.pieces[0], 0)}</div>
      </div>
    </section>`;
  }

  function remember() {
    try { sessionStorage.setItem(sessionKey, JSON.stringify({ token, code })); } catch {}
  }

  function hall() {
    const invite = location.hash.match(/^#online\/([a-f0-9]{8})$/i)?.[1]?.toUpperCase() ?? '';
    return `<article class="panel online-card">
      <h2>真人暗标</h2>
      <p class="online-summary">同一批货箱 · 3 轮 · 独立筹码</p>
      <div class="online-actions">
        <button type="button" class="button primary" data-online="quick">快速匹配</button>
        <button type="button" class="button subtle" data-online="create">创建好友房</button>
      </div>
      <form data-online-form="join"><label for="online-code">房间码</label>
        <input id="online-code" name="code" value="${invite}" maxlength="8" autocomplete="off" autocapitalize="characters" required>
        <button type="submit" class="button subtle">加入房间</button>
      </form>
    </article>`;
  }

  function lobby(snapshot) {
    return `<h2>${snapshot.mode === 'quick' ? '正在寻找另一位玩家' : '好友房'} <span class="mono online-code">${safe(snapshot.code)}</span></h2>
      <p class="online-summary">${snapshot.players.length} / ${snapshot.capacity} 人${snapshot.mode === 'private' ? ' · 至少两人开局' : ' · 匹配后自动开局'}</p>
      <div class="online-actions">
        ${snapshot.mode === 'private' ? '<button class="button subtle" type="button" data-online="copy">复制邀请链接</button>' : ''}
        ${snapshot.mode === 'private' && snapshot.selfSeat === snapshot.hostSeat
          ? `<button class="button primary" type="button" data-online="start" ${snapshot.players.length < 2 ? 'disabled' : ''}>开始竞拍</button>` : ''}
      </div>`;
  }

  function progress(snapshot) {
    const { lot, phase, round, rounds, latest } = snapshot;
    const own = snapshot.players.find(player => player.seat === snapshot.selfSeat);
    const title = phase === 'done' ? '对局结算' : `第 ${round} / ${rounds} 轮`;
    const scored = phase === 'done';
    const topNet = Math.max(...snapshot.players.filter(player => !player.left).map(player => player.net));
    const winner = scored && snapshot.players.filter(player => !player.left && player.net === topNet)
      .map(player => player.seat + ' 号').join('、');
    let details = '';
    if (phase === 'bidding') {
      const range = snapshot.scan ?? lot;
      details = `<div class="online-scene"><div>
        <p>${own.submitted ? '暗标封存' : '查勘货箱'}</p><h3>${safe(lot.name)}</h3>
        <p>${snapshot.scan ? '扫描估价' : '公开估价'} ${range.low}–${range.high} · 起拍 ${lot.reserve}</p>
        </div></div>`;
      if (own.submitted) {
        const active = snapshot.players.filter(player => !player.left);
        details += `<p class="online-sealed" role="status">${snapshot.selfBid === null ? '已放弃本箱' : `已提交 ${snapshot.selfBid} 筹码`}
          <span>等待统一揭标 · ${active.filter(player => player.submitted).length} / ${active.length} 已提交</span></p>`;
      } else {
        details += `<form data-online-form="bid">
          ${own.remaining >= lot.reserve
            ? `<label for="online-bid">暗标</label><input id="online-bid" name="bid" type="number" inputmode="numeric" min="${lot.reserve}" max="${own.remaining}" step="10" value="${lot.reserve}" required>
              <button class="button primary" type="submit">提交暗标</button>`
            : '<p class="online-summary">剩余筹码低于起拍价。</p>'}
          <button class="button subtle" type="button" data-online="scan" ${snapshot.scan || !snapshot.scansLeft ? 'disabled' : ''}>扫描 · 剩 ${snapshot.scansLeft} 次</button>
          <button class="button subtle" type="button" data-online="pass">放弃本箱</button>
        </form>${own.remaining >= lot.reserve
          ? `<p class="bid-margin mono" id="online-margin" data-range="${range.low},${range.high}">若拍到，按估价差额 ${signed(range.low - lot.reserve)} 至 ${signed(range.high - lot.reserve)} 筹码</p>` : ''}${scanView(snapshot)}`;
      }
    } else if (latest) {
      const win = latest.winner === snapshot.selfSeat;
      const verdict = win ? '你拍到了' : latest.winner ? '货箱已被竞得' : '本箱流拍';
      const result = latest.winner ? `${latest.winner} 号竞得` : latest.tie ? '并列最高价，流拍' : '无人出价，流拍';
      const price = latest.bids.find(item => item.seat === latest.winner)?.bid;
      details = `<div class="online-receipt" data-outcome="${win ? 'won' : latest.winner ? 'lost' : 'pass'}">
        <div class="online-stamp" aria-hidden="true">${win ? '得' : latest.winner ? '失' : '流'}</div>
        <div><h3>${verdict}</h3><p>第 ${latest.round} 轮 · ${safe(latest.lot.name)} · ${result}</p>
        <p>实际货值 ${latest.lot.value} 筹码${price == null ? '' : ` · 成交价 ${price} · 竞得净收益 ${signed(latest.lot.value - price)}`}</p></div></div>
        <ul class="online-reveal-bids" aria-label="揭标明细">${latest.bids.map(bid => `<li><span>${bid.seat} 号</span><strong>${bid.bid ?? '放弃'}</strong></li>`).join('')}</ul>`;
    }
    const recap = scored ? `<ol class="online-recap" aria-label="你的三轮记录">${(snapshot.results ?? []).map(receipt => {
      const ownPrice = receipt.bids.find(entry => entry.seat === snapshot.selfSeat)?.bid;
      const won = receipt.winner === snapshot.selfSeat;
      return `<li><span>第 ${receipt.round} 轮 · ${safe(receipt.lot.name)}</span>
        <strong>${won ? signed(receipt.lot.value - ownPrice) + ' 筹码' : ownPrice == null ? '放弃' : '未拍到'}</strong></li>`;
    }).join('')}</ol>` : '';
    return `<h2>${title}${snapshot.deadline ? ' · <span class="mono" data-online-clock></span>' : ''}</h2>
      ${winner ? `<p>最高净收益 · ${winner} · ${topNet} 筹码</p>` : ''}
      ${details}${recap}${scored && latest ? `<div class="battle-hook"><div><h4>和其他玩家比比出价</h4><p>${safe(onlineDiscussion(snapshot).title)}</p></div>
        <button class="button subtle" type="button" data-online="discuss">带这局去讨论</button></div>` : ''}`;
  }

  function onlineDiscussion(snapshot) {
    const hook = (snapshot.results ?? [snapshot.latest]).reduce((best, result) => {
      const ownBid = result.bids.find(bid => bid.seat === snapshot.selfSeat)?.bid;
      const top = Math.max(result.lot.reserve, ...result.bids.map(bid => bid.bid ?? 0));
      const delta = Math.abs(result.lot.value - top);
      return delta > best.delta ? { result, ownBid, delta } : best;
    }, { delta: -1 });
    const me = snapshot.players.find(player => player.seat === snapshot.selfSeat);
    const { lot, winner } = hook.result;
    return window.DarkVaultViews.discussionSeed('真人竞拍', lot.name, lot.value, winner === snapshot.selfSeat ? hook.ownBid : null, hook.ownBid, me.net);
  }

  function previewBid(input) {
    const margin = board.querySelector('#online-margin');
    if (!margin) return;
    const [low, high] = margin.dataset.range.split(',').map(Number);
    const value = Number(input.value);
    margin.textContent = input.validity.valid ? `若拍到，按估价差额 ${signed(low - value)} 至 ${signed(high - value)} 筹码` : '输入有效暗标后查看估价差额';
  }

  function draw(force = false) {
    const nextSignature = room ? JSON.stringify({ ...room, now: 0 }) : location.hash;
    if (!force && signature === nextSignature) return;
    signature = nextSignature;
    const previousInput = board.querySelector('#online-bid');
    const restoreBid = previousInput?.dataset.round === String(room?.round) && previousInput.value;
    const inputFocused = previousInput && document.activeElement === previousInput;
    if (!room) {
      stageKey = '';
      board.innerHTML = hall();
      return;
    }
    const nextStage = `${room.code}/${room.round}/${room.phase}`;
    const animate = nextStage !== stageKey;
    stageKey = nextStage;
    const previousScan = board.querySelector('.online-scan');
    const scanned = room.scan && !previousScan;
    const selectedPiece = previousScan?.querySelector('[aria-pressed="true"]')?.dataset.index;
    const roster = room.phase === 'done' ? [...room.players].sort((a, b) => Number(a.left) - Number(b.left) || b.net - a.net) : room.players;
    const players = roster.map(player => `<li><strong>${player.seat} 号${player.seat === room.selfSeat ? ' · 你' : ''}</strong>
      <small>${player.left ? '已离开' : room.phase === 'lobby' ? (player.seat === room.hostSeat ? '房主' : '已加入') : `${player.remaining} 筹码 · 净收益 ${player.net}`}</small>
      ${room.phase === 'bidding' && !player.left ? `<small>${player.submitted ? '已提交' : '待提交'}</small>` : ''}</li>`).join('');
    board.innerHTML = `<article class="panel online-card" data-phase="${room.phase}" ${animate ? 'data-stage-enter' : ''}>
      ${room.phase === 'lobby' ? lobby(room) : progress(room)}
      <ul class="online-roster" aria-label="房间成员">${players}</ul>
      <div><button class="button subtle small" type="button" data-online="leave">${room.phase === 'done' ? '返回组队大厅' : '离开房间'}</button></div>
    </article>`;
    const input = board.querySelector('#online-bid');
    if (scanned) board.querySelector('.online-scan')?.classList.add('is-sweeping');
    if (selectedPiece) selectPiece(Number(selectedPiece));
    if (input) {
      input.dataset.round = room.round;
      if (restoreBid) input.value = restoreBid;
      previewBid(input);
      if (inputFocused) input.focus({ preventScroll: true });
    }
    tickClock();
  }

  function selectPiece(index) {
    const item = room?.scan?.pieces[index];
    if (!item) return;
    board.querySelector('.online-scan [aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    board.querySelector(`.online-scan [data-index="${index}"]`)?.setAttribute('aria-pressed', 'true');
    board.querySelector('#online-scan-detail').innerHTML = window.DarkVaultViews.scanDetails(item, index);
  }

  function tickClock() {
    const clock = board.querySelector('[data-online-clock]');
    if (!clock || !room?.deadline) return;
    const seconds = Math.max(0, Math.ceil((room.deadline - Date.now() - clockOffset) / 1000));
    clock.textContent = seconds + ' 秒';
    clock.classList.toggle('urgent', room.phase === 'bidding' && seconds <= 8);
    if (room.phase === 'bidding' && seconds > 0 && seconds <= 5 && urgentKey !== stageKey) {
      urgentKey = stageKey;
      sound.cue('urgent');
    }
  }

  async function call(action, options = {}) {
    if (activeAction) {
      if (activeAction === 'status' && action !== 'status') queuedAction ??= [action, options];
      return;
    }
    if (!token) { status.textContent = '线上组队需要通过 HTTPS 打开。'; return; }
    activeAction = action;
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, code, ...options }),
        signal: AbortSignal.timeout(9000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (action === 'status' && [403, 404].includes(response.status)) {
          code = '';
          room = null;
          remember();
          draw(true);
        }
        status.textContent = data.message ?? '房间暂不可用。';
        return;
      }
      let visual;
      if (data.left) {
        code = '';
        room = null;
        if (location.hash.startsWith('#online/')) history.replaceState(null, '', '#online');
      } else {
        const previous = room;
        room = data;
        code = data.code;
        clockOffset = data.now - Date.now();
        if (!screen.hidden && room.phase === 'done' && previous?.phase !== 'done') window.DarkVaultSurvey?.remind('online');
        if (!screen.hidden) {
          if (room.latest && previous && room.latest.round !== previous.latest?.round) {
            const won = room.latest.winner === room.selfSeat;
            sound.cue(won ? 'win' : room.latest.winner ? 'loss' : 'reveal');
            visual = ['.online-receipt', won ? 'win' : 'miss', won];
          } else if (action === 'scan' && !previous?.scan) {
            sound.cue('scan');
            visual = ['.online-scan', 'scan'];
          } else if (action === 'bid') {
            sound.cue('seal');
            visual = ['.online-sealed', 'sealed'];
          }
          else if (room.phase === 'bidding' && room.round !== previous?.round) sound.cue('round');
        }
      }
      remember();
      if (action !== 'status' || status.textContent.startsWith('房间连接')) status.textContent = '';
      draw();
      if (visual) fx.confirm(board.querySelector(visual[0]), ...visual.slice(1));
    } catch {
      status.textContent = '房间连接中断，请稍后重试。';
    } finally {
      activeAction = '';
      const next = queuedAction;
      queuedAction = null;
      if (next && !screen.hidden) void call(...next);
    }
  }

  board.addEventListener('click', async event => {
    const button = event.target.closest('[data-online]');
    if (!button) return;
    const { online } = button.dataset;
    if (online === 'piece') return selectPiece(Number(button.dataset.index));
    if (online === 'discuss') return window.DarkVaultDiscussions.compose(onlineDiscussion(room));
    if (online === 'copy') {
      const invite = new URL(location.href);
      invite.hash = '#online/' + code;
      try {
        await navigator.clipboard.writeText(invite.href);
        status.textContent = '邀请链接已复制。';
      } catch {
        status.textContent = '可将房间码 ' + code + ' 发给朋友。';
      }
      return;
    }
    if (online === 'pass') return call('bid', { round: room.round, bid: null });
    if (online === 'scan') return call('scan', { round: room.round });
    void call(online);
  });

  board.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.target);
    if (event.target.dataset.onlineForm === 'join') {
      void call('join', { code: String(values.get('code')).trim().toUpperCase() });
    } else {
      void call('bid', { round: room.round, bid: Number(values.get('bid')) });
    }
  });
  board.addEventListener('input', event => {
    if (event.target.id === 'online-bid') previewBid(event.target);
  });

  function visible() {
    if (screen.hidden) return;
    draw();
    if (code && room?.phase !== 'done' && !document.hidden) void call('status');
  }

  new MutationObserver(visible).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('hashchange', visible);
  document.addEventListener('visibilitychange', visible);
  window.setInterval(() => { if (!screen.hidden) tickClock(); }, 250);
  window.setInterval(visible, 2000);
  visible();
})();
