(function runApp() {
  'use strict';
  const game = window.DarkVaultGame;
  const view = window.DarkVaultViews;
  const guidance = window.DarkVaultGuide;
  const fx = window.DarkVaultFx;
  const legacyStorageKey = 'guanghe-dark-vault-v1';
  const storageKey = `guanghe-dark-vault-v${game.SAVE_VERSION}`;
  const $ = selector => document.querySelector(selector);
  const dialog = $('#dialog');
  const dialogContent = $('#dialog-content');
  const gameArea = $('#arena-screen');
  const supplyNav = $('#supply-nav');
  const supplyDot = $('#supply-dot');
  const pages = new Map(Array.from(document.querySelectorAll('#main > section'), page => [page.id, page]));
  const outsidePlay = new Set(['afk-start', 'claim-afk', 'scratch-card', 'spin-slots', 'checkin', 'report-shared', 'milestone', 'exchange', 'note', 'community', 'community-official']);
  let state = game.createState();
  let canPersist = true;
  let screen = 'home';
  let collectionFilter = 'all';
  let collectionGrade = 'all';
  let busy = false;
  let spinning = false;
  let previousFocus = null;
  let noticeTimer;
  let day;
  let renderedTurn = '';
  let accountName = null;
  let clockSkew = 0;
  let accountPending = false;
  const accountMarker = 'guanghe-account-active';
  let sessionExpected = false;
  try { sessionExpected = localStorage.getItem(accountMarker) === '1'; } catch {}
  const gameNow = () => Date.now() + (accountName ? clockSkew : 0);

  async function accountRequest(path = '', data) {
    let response, result;
    try {
      response = await fetch('/api/account' + path, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(7000),
        ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
      });
      result = await response.json();
    } catch { throw new Error('暂时连不上账号存档，请重试。'); }
    if (!response.ok) throw new Error(result.message ?? '账号操作未完成。');
    return result;
  }

  function applySession(snapshot) {
    accountName = snapshot.username;
    clockSkew = snapshot.now - Date.now();
    sessionExpected = Boolean(accountName);
    try {
      if (sessionExpected) localStorage.setItem(accountMarker, '1');
      else localStorage.removeItem(accountMarker);
    } catch {}
    state = accountName ? snapshot.state : readState();
    $('#account-link').textContent = accountName ? '账号' : '登录';
    $('#account-guest').hidden = Boolean(accountName);
    $('#account-signed-in').hidden = !accountName;
    $('#account-username').textContent = accountName ?? '';
    $('#save-scope').textContent = accountName ? '账号存档' : '游客存档';
    renderHome();
    renderCollection();
    if (screen === 'arena') renderArena(false);
  }

  function setAccountPending(pending) {
    accountPending = pending;
    document.querySelectorAll('#account-form button, #account-logout').forEach(button => { button.disabled = pending; });
  }

  async function syncAccount() {
    if (accountPending || busy) return;
    setAccountPending(true);
    try {
      const snapshot = await accountRequest();
      if (snapshot.username || accountName || sessionExpected) applySession(snapshot);
    } catch (error) {
      if (sessionExpected) $('#account-status').textContent = error.message;
    } finally { setAccountPending(false); }
  }

  function readState(now = Date.now()) {
    if (!canPersist) return state;
    try {
      const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
      if (!raw) return game.createState();
      const stored = JSON.parse(raw);
      if ((stored?.version === 1 || stored?.version === game.SAVE_VERSION) &&
        Array.isArray(stored.history) && Array.isArray(stored.claimed) && stored.notes) return game.restoreState(stored, now);
      return game.createState();
    } catch (error) {
      if (error instanceof SyntaxError) return game.createState();
      canPersist = false;
      return state;
    }
  }

  function persist(next) {
    if (canPersist) {
      try { localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { canPersist = false; }
    }
    state = next;
  }

  function underLock(operation) {
    if (!canPersist || !navigator.locks?.request) return operation();
    let ran = false;
    return navigator.locks.request(storageKey, () => {
      ran = true;
      return operation();
    }).catch(error => {
      if (!ran && (error.name === 'SecurityError' || error.name === 'NotSupportedError')) return operation();
      throw error;
    });
  }

  function turnChanged(before, after) {
    return game.turnToken(before.run) !== game.turnToken(after.run) || before.history[0]?.id !== after.history[0]?.id;
  }

  async function update(action) {
    if (busy) return null;
    if (accountPending || (!accountName && sessionExpected)) {
      if (action.type !== 'afk-start') announce('正在确认账号存档。请稍等，或到账号页重新登录。', 'error');
      return null;
    }
    busy = true;
    const oldState = state;
    try {
      const result = accountName ? await accountRequest('/action', action) : await underLock(() => {
        const now = Date.now();
        const latest = readState(now);
        let result = game.reduce(latest, action, { now });
        // A supply action can arrive exactly as a run expires. Keep both transactions.
        if (result.effect === 'settled' && outsidePlay.has(action.type)) {
          const afterExpiry = game.reduce(result.state, action, { now });
          result = { ...afterExpiry, changed: true };
        }
        persist(result.state);
        return result;
      });
      if (accountName) {
        if (result.username !== accountName) throw new Error('登录状态已变化，请刷新页面。');
        state = result.state;
        clockSkew = result.now - Date.now();
      }
      const changedTurn = turnChanged(oldState, state);
      const newReceipt = oldState.history[0]?.id !== state.history[0]?.id ? state.history[0] : null;
      if (!(spinning && result.effect === 'slots-spun') && (result.changed || changedTurn || oldState.wallet !== state.wallet || !canPersist)) renderHome();
      if (oldState.collection.length !== state.collection.length) renderCollection();
      if (screen === 'arena' && (changedTurn || result.effect === 'scanned' || (state.run && oldState.permits !== state.permits))) {
        const focusedInsideArena = gameArea.contains(document.activeElement);
        const scan = result.effect === 'scanned';
        const scanning = scan && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
        renderArena(!changedTurn, scanning);
        if (scan) presentScan(focusedInsideArena);
        const cue = window.DarkVaultSound.cue;
        if (scan) {
          cue('scan');
          fx.confirm($('#scan-layout'), 'scan');
        }
        if (result.effect === 'continued') {
          const hit = state.run?.checkpoint?.status === 'hit';
          cue(hit ? 'loss' : 'round');
          if (hit) fx.confirm(gameArea.querySelector('.checkpoint.hit'), 'risk');
        }
        if (result.effect === 'revealed' || (result.effect === 'settled' && result.report?.reason === 'limit')) {
          gameArea.querySelector('.reveal-result')?.classList.add('is-revealing');
          const outcome = state.run?.outcomes.at(-1) ?? result.report?.outcomes.at(-1);
          cue(outcome?.won ? 'win' : outcome?.bid == null ? 'reveal' : 'loss');
          fx.confirm(gameArea.querySelector('.reveal-result'), outcome?.won ? 'win' : 'miss', outcome?.won && !newReceipt?.newUnlocks?.length);
        }
        if (changedTurn && (action.token || (action.type === 'tick' && focusedInsideArena))) focusStage();
        if (newReceipt?.newUnlocks?.length) {
          cue('collect');
          fx.confirm(gameArea.querySelector('.unlock-display'), 'collect', true);
        } else if (newReceipt?.rounds) fx.confirm(gameArea.querySelector('.settle-head'), 'settled');
        if (newReceipt?.rounds) window.DarkVaultSurvey.remind(gameArea.querySelector('.settlement'));
      }
      if (result.changed && result.effect !== 'slots-spun' && state.wallet > oldState.wallet) {
        fx.confirm($('#wallet-count'), 'wallet');
      }
      return result;
    } catch (error) {
      announce(accountName ? error.message : '这次操作暂未完成，请重试。', 'error');
      return null;
    } finally {
      busy = false;
    }
  }

  function announce(message, tone = 'success') {
    const target = dialog.hasAttribute('open') ? $('#dialog-status') : $('#notice');
    if (!message || !target) return;
    window.clearTimeout(noticeTimer);
    target.dataset.tone = tone;
    target.textContent = message;
    noticeTimer = window.setTimeout(() => { target.textContent = ''; }, 4000);
  }

  function renderHome() {
    const now = gameNow();
    const focused = document.activeElement;
    const recover = focused?.matches('#main button[data-action]') && focused;
    day = game.dayKey(now);
    $('#wallet-count').textContent = view.amount(state.wallet);
    $('.wallet').setAttribute('aria-label', `光核币余额 ${state.wallet}，进入商店`);
    $('#scenario-grid').innerHTML = view.scenarios(state);
    $('#activity-progress').innerHTML = view.activityProgress(state, now);
    $('#activity-save-warning').hidden = canPersist;
    $('#eligible-label').textContent = `${state.milestoneRuns} 场计入里程碑 · ${state.eligibleRuns} 场有效对局`;
    $('#task-list').innerHTML = view.tasks(state, now);
    $('#milestone-list').innerHTML = view.milestones(state);
    $('#shop-balance').textContent = `余额 ${view.amount(state.wallet)} 光核币`;
    $('#shop-items').innerHTML = view.shop(state);
    $('#shop-scratch').innerHTML = view.scratch(state);
    $('#topics').innerHTML = view.topicList(state);
    $('#my-reports').innerHTML = view.reports(state);
    refreshActivityDialog(now);
    if (screen === 'slots' && !spinning) $('#slots-machine').innerHTML = view.slots(state);
    refreshAfk(now);
    if (recover && !focused.isConnected) restoreFocus(focused);
  }

  function refreshAfk(now) {
    const bank = game.afkStatus(state, now);
    const total = bank.claimable + bank.bonus;
    const claimable = bank.claimable > 0;
    const destination = claimable ? '#afk' : '#supply';
    if (supplyNav.hash !== destination) {
      supplyDot.hidden = !claimable;
      supplyNav.setAttribute('href', destination);
      if (claimable) supplyNav.setAttribute('aria-label', '补给，离线补给可领取');
      else supplyNav.removeAttribute('aria-label');
    }
    if (screen !== 'afk' && screen !== 'supply') return;
    if (screen === 'supply') {
      $('#afk-preview').textContent = claimable ? `${view.amount(total)} 币可领` : '查看进度';
      return;
    }
    $('#afk-amount').textContent = view.amount(total);
    $('#afk-extra').hidden = !bank.bonus && !bank.cards;
    $('#afk-extra').textContent = [
      bank.bonus ? `含成长加成 +${bank.bonus} 币` : '',
      bank.cards ? `另领刮刮卡 ×${bank.cards}` : '',
    ].filter(Boolean).join(' · ');
    $('#afk-stock').textContent = `已存 ${view.amount(bank.coins)} 光核币${bank.coins > game.AFK_CAP ? '（含旧版结转）' : ''}`;
    $('#afk-meter').max = Math.max(game.AFK_CAP, bank.coins);
    $('#afk-meter').value = bank.coins;
    $('#afk-claim').disabled = !claimable;
    $('#afk-daily').textContent = `${bank.claimedToday} / ${game.AFK_DAILY_CAP} 光核币`;
    $('#afk-earned').textContent = `${view.amount(bank.earned)} 光核币`;
    $('#afk-level').textContent = `Lv.${bank.rankIndex + 1}`;
    $('#afk-rank').textContent = bank.rank.name;
    $('#afk-level-label').textContent = bank.nextRank
      ? `累计基础领取 ${view.amount(bank.earned)} / ${bank.nextRank.threshold} 币升级` : '已升至最高级';
    $('#afk-level-meter').hidden = !bank.nextRank;
    if (bank.nextRank) {
      $('#afk-level-meter').max = bank.nextRank.threshold - bank.rank.threshold;
      $('#afk-level-meter').value = bank.earned - bank.rank.threshold;
    }
    $('#afk-bonus-today').textContent = bank.rank.cap
      ? `今日成长加成 ${bank.bonusToday} / ${bank.rank.cap} 币` : 'Lv.2 解锁额外光核币';
    $('#afk-card-label').textContent = `下张卡进度 ${bank.cardProgress} / ${game.AFK_CARD_STEP} 基础币`;
    $('#afk-card-meter').max = game.AFK_CARD_STEP;
    $('#afk-card-meter').value = bank.cardProgress;
    const cards = state.scratchCards ?? 0;
    $('#afk-open-cards').hidden = !cards;
    $('#afk-open-cards').textContent = `已持有 ${view.amount(cards)} 张 · 去刮卡 →`;
    const seconds = Math.ceil(bank.nextIn / 1000);
    const minutes = Math.floor(seconds / 60);
    const stamp = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const accrual = bank.full ? '已存满。' : `距离下次累积 ${stamp}。`;
    $('#afk-status').textContent = bank.claimedToday >= game.AFK_DAILY_CAP
      ? `今日已领满，库存明天可领。${accrual}` : accrual;
    $('#afk-storage-note').hidden = canPersist;
  }

  function renderCollection() {
    $('#collection-count').textContent = `${state.collection.length} / ${game.COLLECTION_ITEMS.length} 已解锁`;
    $('#collection-shelf').innerHTML = view.collection(state, collectionFilter, collectionGrade);
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === collectionFilter));
    });
  }

  function restoreFocus(original) {
    if (!original) return;
    if (original.isConnected) {
      original.focus({ preventScroll: true });
      return;
    }
    const candidates = pages.get(screen).querySelectorAll('button[data-action]:enabled');
    const replacement = Array.from(candidates).find(button =>
      button.dataset.action === original.dataset.action && button.dataset.id === original.dataset.id &&
      button.dataset.level === original.dataset.level && button.dataset.scenarioId === original.dataset.scenarioId &&
      button.dataset.hub === original.dataset.hub && button.dataset.target === original.dataset.target,
    );
    (replacement || $(`#${screen === 'home' ? 'main' : screen}`))?.focus({ preventScroll: true });
  }

  function remainingSeconds() {
    return state.run ? Math.max(0, Math.ceil((state.run.expiresAt - gameNow()) / 1000)) : 0;
  }

  function clock() {
    const clockNode = $('#run-clock');
    if (!clockNode || !state.run) return;
    const remaining = remainingSeconds();
    const stamp = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    if (clockNode.textContent !== stamp) clockNode.textContent = stamp;
    clockNode.classList.toggle('urgent', remaining <= 30);
  }

  function renderArena(keepBid, scanning = false) {
    const turn = game.turnToken(state.run);
    const keepTurn = keepBid && turn && turn === renderedTurn;
    const draft = keepTurn ? $('#bid-value')?.value : undefined;
    const permit = keepTurn && $('#use-permit')?.checked;
    const selection = keepTurn ? Number($('.scan-piece[aria-pressed="true"]')?.dataset.index) : 0;
    renderedTurn = turn;
    $('#arena-lobby').hidden = Boolean(state.run || state.history[0]);
    const scene = state.run ?? state.history[0];
    if (scene) gameArea.dataset.scenario = game.findScenario(scene.scenarioId).id;
    else delete gameArea.dataset.scenario;
    const now = gameNow();
    gameArea.innerHTML = state.run ? view.board(state, draft, selection, now, scanning)
      : state.history[0] ? view.settlement(state.history[0], state, now) : '';
    guidance.decorate(gameArea);
    if (state.run?.phase === 'decision') guidance.visit('risk', gameArea);
    if (!state.run && state.history[0]) guidance.visit('receipt', gameArea);
    if (permit && $('#use-permit')) $('#use-permit').checked = true;
    updateStepper();
    clock();
  }

  function focusStage() {
    if (dialog.hasAttribute('open')) return;
    (gameArea.querySelector('[data-stage-title]') || $('#arena'))?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function presentScan(focusFromArena) {
    const layout = $('#scan-layout');
    if (!layout) return;
    if (!dialog.hasAttribute('open')) {
      if (focusFromArena) layout.focus({ preventScroll: true });
      layout.scrollIntoView({ block: 'nearest' });
    }
    const beam = layout.querySelector('.scan-beam');
    if (!beam) {
      if (document.activeElement === layout) layout.querySelector('.scan-piece[aria-pressed="true"]')?.focus({ preventScroll: true });
      guidance.visit('scan', layout);
      return;
    }
    const lot = state.run.lots[state.run.index];
    function finish() {
      if (!layout.isConnected || !layout.hasAttribute('data-scanning')) return;
      layout.removeAttribute('data-scanning');
      beam.remove();
      $('#lot-estimate-label').textContent = '全箱扫描估值';
      $('#lot-estimate').textContent = `${lot.scanLow}–${lot.scanHigh}`;
      $('.scan-button').textContent = '已扫描';
      layout.querySelector('.scan-feedback').textContent = `6 × 4 格 · ${layout.querySelectorAll('.scan-piece').length} 件货物`;
      if (document.activeElement === layout) layout.querySelector('.scan-piece[aria-pressed="true"]')?.focus({ preventScroll: true });
      guidance.visit('scan', layout);
    }
    beam.addEventListener('animationend', finish, { once: true });
    beam.addEventListener('animationcancel', finish, { once: true });
    window.setTimeout(finish, 450);
  }

  function showScreen(name, { push = true, focus = true } = {}) {
    const target = pages.has(name) ? name : 'home';
    const changed = target !== screen;
    if (changed) { guidance.close(); guidance.dismiss(); }
    screen = target;
    for (const page of pages.values()) page.hidden = page.id !== target;
    const navTarget = { rules: 'home', afk: 'supply', online: 'arena' }[target] ?? target;
    document.querySelectorAll('.top-nav [data-nav]').forEach(link => {
      if (link.dataset.nav === navTarget) link.setAttribute('aria-current', target === navTarget ? 'page' : 'location');
      else link.removeAttribute('aria-current');
    });
    if (push && location.hash !== `#${target}`) window.history.pushState(null, '', `#${target}`);
    refreshAfk(gameNow());
    if (target === 'slots' && changed && !spinning) $('#slots-machine').innerHTML = view.slots(state);
    if (target === 'arena') {
      if (changed) renderArena(true);
      if (focus) focusStage();
    } else if (focus) {
      pages.get(target).focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    if (target !== 'arena' || (state.run?.phase !== 'decision' && (state.run || !state.history[0]))) guidance.visit(target, pages.get(target));
    document.dispatchEvent(new Event('vault-screen'));
  }

  function fromLocation() {
    const next = location.hash.slice(1);
    if (next === 'main') return;
    const screen = next.split('/')[0];
    showScreen(screen, { push: false, focus: Boolean(screen) });
  }

  function chooseScenario() {
    if (dialog.hasAttribute('open')) {
      previousFocus = null;
      closeDialog();
    }
    showScreen('home', { focus: false });
    $('#scenario-heading').focus({ preventScroll: true });
    $('#scenario-section').scrollIntoView();
  }

  async function start(scenarioId) {
    const result = await update({ type: 'start', scenarioId });
    if (result && (state.run || result.effect === 'settled')) showScreen('arena');
    else if (result?.message) announce(result.message, 'error');
    if (result?.effect === 'started') gameArea.querySelector('.scene-entry')?.classList.add('is-entering');
  }

  function currentBounds() {
    return [state.run.lots[state.run.index].reserve, game.chipsLeft(state.run)];
  }

  function updateStepper() {
    const input = $('#bid-value');
    if (!input || input.disabled || !state.run) return;
    const [min, max] = currentBounds();
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    const margin = $('#bid-margin');
    if (margin) {
      const [low, high] = margin.dataset.range.split(',').map(Number);
      const valid = Number.isInteger(value) && value % 10 === 0 && value >= min && value <= max;
      margin.textContent = valid ? `若拍到，按估价差额 ${view.signed(low - value)} 至 ${view.signed(high - value)} 筹码` : '输入有效暗标后查看估价差额';
    }
    $('[data-step="-10"]').disabled = Number.isFinite(value) && value <= min;
    $('[data-step="10"]').disabled = Number.isFinite(value) && value >= max;
  }

  function stepBid(increment) {
    const input = $('#bid-value');
    const [min, max] = currentBounds();
    const numeric = Number(input.value);
    const rounded = Number.isFinite(numeric) && numeric >= min ? Math.round(numeric / 10) * 10 : min;
    input.value = String(Math.max(min, Math.min(max, rounded + increment)));
    clearBidError();
    updateStepper();
  }

  function clearBidError() {
    $('#bid-value')?.removeAttribute('aria-invalid');
    const error = $('#bid-error');
    if (error) error.textContent = '';
  }

  function bidError(message) {
    $('#bid-error').textContent = message;
    const input = $('#bid-value');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  function actOnTurn(type, data = {}) {
    return update({ type, token: game.turnToken(state.run), ...data });
  }

  function openDialog(title, html) {
    guidance.close();
    guidance.dismiss();
    if (!dialog.hasAttribute('open')) previousFocus = document.activeElement;
    $('#dialog-title').textContent = title;
    dialogContent.innerHTML = `${html}<p class="dialog-status" id="dialog-status" role="status"></p>`;
    guidance.decorate(dialogContent);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
      document.body.classList.add('dialog-fallback');
    }
    dialog.scrollTop = 0;
    dialog.querySelector('[data-action="close-dialog"]').focus();
  }

  function closeDialog() {
    guidance.close();
    guidance.dismiss();
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      document.body.classList.remove('dialog-fallback');
      restoreFocus(previousFocus);
    }
  }

  function openHub(tab, target) {
    const switching = dialog.hasAttribute('open');
    openDialog('光核活动中心', view.hub(state, gameNow(), tab));
    guidance.visit(target === 'hub-milestones' ? 'milestones' : tab, dialogContent);
    if (target) {
      const heading = document.getElementById(target);
      heading?.focus();
    } else if (switching) dialogContent.querySelector('[aria-pressed="true"]')?.focus();
  }

  function refreshActivityDialog(now) {
    const activity = dialog.hasAttribute('open') && $('#hub-content[data-tab="activity"]');
    if (!activity) return;
    const focused = document.activeElement;
    const section = focused.closest('.hub-block');
    const heading = activity.contains(section) ? section.querySelector('h3').id : null;
    activity.innerHTML = view.activityHub(state, now);
    guidance.decorate(activity);
    if (!heading) return;
    const restored = document.getElementById(heading);
    const replacement = Array.from(restored.closest('.hub-block').querySelectorAll('button')).find(button =>
      button.dataset.action === focused.dataset.action && button.dataset.id === focused.dataset.id && button.dataset.level === focused.dataset.level);
    (replacement ?? restored).focus({ preventScroll: true });
  }

  function hubBack() {
    const tab = $('#hub-content')?.dataset.tab;
    return tab ? `<button type="button" class="button subtle" data-action="hub" data-hub="${tab}">返回活动中心</button>` : '';
  }

  function topicDialog(id) {
    const topic = view.TOPICS[id];
    if (!topic) return;
    openDialog('策略话题', `<h3>${topic.title}</h3><p>${topic.prompt}</p>
      <form id="note-form" data-topic="${id}" novalidate>
        <label for="topic-note">我的讨论草稿（最多 280 字）</label>
        <textarea id="topic-note" maxlength="280" placeholder="写下你的选择和理由…">${view.safe(state.notes[id]?.text ?? '')}</textarea>
        <div class="dialog-actions"><button type="submit" class="button primary">保存草稿</button><button type="button" class="button subtle" data-action="copy-note">复制话题与草稿</button>${hubBack()}</div>
      </form>`);
  }

  function activeReport() {
    const id = dialogContent.querySelector('[data-report]')?.dataset.report;
    return state.history.find(report => report.id === id && report.rounds > 0);
  }

  function shareDialog(id) {
    const report = state.history.find(item => item.id === id && item.rounds > 0);
    if (!report) return;
    openDialog('撤离战报', `<div class="share-brief" data-report="${view.safe(report.id)}"><small class="mono">${view.safe(report.id)} · ${report.rounds} 轮</small><h3>${view.verdict(report)}</h3>
      ${view.balance(report.net)} <small>筹码净收益</small></div>
      <p>每日首次复制或分享有效战报可领 ${game.SHARE} 光核币。</p>
      <label for="share-text">战报文字</label><textarea id="share-text" readonly>${view.safe(reportText(report))}</textarea>
      <div class="dialog-actions"><button type="button" class="button primary" data-action="copy-report">复制战报</button>
        <button type="button" class="button subtle" data-action="download-report">下载战报图</button>
        <button type="button" class="button subtle" data-action="discuss-report" data-id="${view.safe(report.id)}">带这局去讨论</button>
        ${typeof navigator.share === 'function' ? '<button type="button" class="button subtle" data-action="native-share">分享…</button>' : ''}${hubBack()}</div>`);
  }

  function reportText(report) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = 'home';
    const networkUrl = /^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const bait = report.cargo.length ? `带出 ${report.cargo.map(item => item.name).join('、')}。` : '这一局空手撤出。';
    const recovery = report.recovered ? `盘查返还 ${view.amount(report.recovered)} 筹码。` : '';
    return `《暗仓竞拍》｜光核实践活动\n${report.id} ${view.verdict(report)} · 完成 ${report.rounds} 轮 · 净收益 ${view.signed(report.net)} 筹码。\n${bait}${recovery} 你会在哪一轮撤？${networkUrl ? `\n${url.href}` : ''}`;
  }

  async function copyText(value, field) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      if (field.value !== value) {
        const scratch = document.createElement('textarea');
        scratch.value = value;
        scratch.className = 'copy-scratch';
        dialogContent.append(scratch);
        scratch.focus();
        scratch.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch { /* Leave a selectable field below. */ }
        if (copied) scratch.remove();
        else scratch.className = '';
        return copied;
      }
      field.focus();
      field.select();
      try { return document.execCommand('copy'); } catch { return false; }
    }
  }

  async function shareReport(method) {
    const report = activeReport();
    if (!report) return;
    if (method === 'copy') {
      if (!await copyText(reportText(report), $('#share-text'))) {
        announce('已选中文字，请手动复制。', 'error');
        return;
      }
    } else {
      try { await navigator.share({ title: '暗仓竞拍 · 撤离战报', text: reportText(report) }); }
      catch (error) {
        if (error.name !== 'AbortError') announce('系统分享暂不可用，可复制战报文字。', 'error');
        return;
      }
    }
    const result = await update({ type: 'report-shared', reportId: report.id });
    if (!result) return;
    const message = method === 'copy' ? '战报已复制。' : '战报已交给系统分享。';
    announce(message + (result.effect === 'share-reward' ? ` +${game.SHARE} 光核币` : ''));
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    (dialog.hasAttribute('open') ? dialog : document.body).append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function makePoster(report) {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 880;
    const ctx = canvas.getContext('2d');
    if (!ctx) return announce('此浏览器暂无法生成战报图，可复制战报文字。', 'error');
    const gradient = ctx.createLinearGradient(0, 0, 720, 880);
    gradient.addColorStop(0, '#262026');
    gradient.addColorStop(0.48, '#131d2a');
    gradient.addColorStop(1, '#0c1016');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 720, 880);
    ctx.strokeStyle = '#667180';
    ctx.strokeRect(32, 32, 656, 816);
    ctx.fillStyle = '#ffae59';
    ctx.fillRect(64, 71, 48, 5);
    const text = (string, y, size, color, x = 64, weight = 600) => {
      ctx.font = `${weight} ${size}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(string, x, y, x === 64 ? 592 : 277);
    };
    text('光核实践活动 · 撤离战报', 121, 25, '#ffcc97');
    text('暗仓竞拍', 210, 67, '#f4f3ee', 64, 800);
    text(`${report.id}  /  ${report.rounds} 轮  /  ${view.verdict(report)}`, 267, 26, '#b2c0ce');
    ctx.fillStyle = '#3d4656';
    ctx.fillRect(64, 311, 592, 1);
    text('局内筹码净收益', 370, 23, '#b2c0ce');
    const netColor = report.net > 0 ? '#91d7ae' : report.net < 0 ? '#ff9b87' : '#f4f3ee';
    text(view.signed(report.net), 482, 99, netColor, 64, 820);
    if (report.recovered) text(`盘查返还 ${view.amount(report.recovered)} 筹码`, 524, 21, '#b2c0ce');
    text(`带出货值 ${view.amount(report.gross)}`, 564, 26, '#f4f3ee');
    text(`竞拍成本 ${view.amount(report.spent)}`, 564, 26, '#f4f3ee', 369);
    text(`参与奖 +${report.participation} 光核币`, 617, 23, '#ffcc97');
    text(`盈利奖 +${report.bonus} 光核币`, 617, 23, '#ffcc97', 369);
    ctx.fillStyle = '#3d4656';
    ctx.fillRect(64, 660, 592, 1);
    text(`带出 ${report.cargo.length} 箱  ·  盘查扣留 ${report.seized.length} 箱`, 724, 24, '#b2c0ce');
    text('你会在哪一轮撤？', 795, 27, '#f4f3ee');
    canvas.toBlob(blob => {
      if (!blob) return announce('战报图生成失败，可以复制战报文字。', 'error');
      download(blob, `暗仓竞拍-${report.id}.jpg`);
      announce('战报图已生成。');
    }, 'image/jpeg', 0.88);
  }

  function stats() {
    return {
      started: state.started, finished: state.finished, eligible: state.eligibleRuns, milestoneRuns: state.milestoneRuns,
      highestNet: state.bestNet, shareActions: state.reportsShared, communityOpens: state.communityVisits,
      officialCommunityClicks: state.communityOfficialClicks ?? 0,
      offlineCoinsClaimed: (state.afkEarned ?? 0) + (state.afkBonusEarned ?? 0),
    };
  }

  function statsDialog() {
    const data = stats();
    openDialog('个人试玩数据', `<p>记录范围为${accountName ? '当前账号' : '当前浏览器游客档'}。</p>
      <ul class="settle-metrics local-metrics">
        <li><span>开启对局</span><strong>${data.started}</strong></li><li><span>完成结算</span><strong>${data.finished}</strong></li>
        <li><span>有效对局</span><strong>${data.eligible}</strong></li><li><span>最高净收益</span><strong>${data.highestNet === null ? '—' : view.signed(data.highestNet)}</strong></li>
        <li><span>计入里程碑的对局</span><strong>${data.milestoneRuns}</strong></li>
        <li><span>战报复制与分享操作</span><strong>${data.shareActions}</strong></li><li><span>交流站入口点击</span><strong>${data.communityOpens}</strong></li>
        <li><span>社区官网链接点击</span><strong>${data.officialCommunityClicks}</strong></li>
        <li><span>已领取离线光核币</span><strong>${data.offlineCoinsClaimed}</strong></li>
      </ul><div class="dialog-actions"><button type="button" class="button subtle" data-action="export-stats">导出统计 JSON</button>${hubBack()}</div>`);
  }

  function selectScanItem(button) {
    const lot = state.run?.lots[state.run.index];
    if (!lot?.scanned) return;
    const index = Number(button.dataset.index);
    const item = game.boxItems(lot)[index];
    if (!item) return;
    $('.scan-piece[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    $('#scan-detail').innerHTML = view.scanDetails(item, index);
  }

  async function spinSlots(button) {
    if (spinning) return;
    spinning = true;
    const wasFocused = document.activeElement === button;
    button.disabled = true;
    const result = await update({ type: 'spin-slots', lockCoin: Boolean($('#slot-lock-coin')?.checked) });
    const payout = result?.effect === 'slots-spun' ? result.state.lastSpin : null;
    if (payout && screen === 'slots' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      $('#slots-machine').innerHTML = view.slots({ ...state, wallet: state.wallet - payout.coins }, true);
      await new Promise(resolve => {
        const lastTrack = $('.slot-window:last-child .slot-track');
        const timeout = window.setTimeout(resolve, 810);
        lastTrack.addEventListener('animationend', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      });
    }
    spinning = false;
    renderHome();
    if (screen === 'slots') {
      if (wasFocused && document.activeElement === document.body) $('[data-action="spin-slots"]:enabled')?.focus({ preventScroll: true });
      if (payout) {
        const collectible = payout.collectible;
        const won = payout.coins > 0 || payout.permits > 0;
        fx.confirm($(collectible ? '#slots .unlock-display' : '#slots .slot-result'), collectible ? 'collect' : won ? 'win' : 'miss', Boolean(collectible || won));
        window.DarkVaultSound.cue(collectible ? 'collect' : won ? 'win' : 'loss');
        if (payout.coins) fx.confirm($('#wallet-count'), 'wallet');
        announce(view.slotResult(payout));
      }
      else if (result?.message) announce(result.message, 'error');
    }
  }

  async function handleButton(button) {
    const action = button.dataset.action;
    if (action === 'filter-collection') {
      collectionFilter = button.dataset.filter;
      renderCollection();
      return;
    }
    if (action === 'inspect-collectible') {
      const item = game.COLLECTION_ITEMS.find(collectible => collectible.artId === button.dataset.id);
      if (item && state.collection.includes(item.name)) openDialog(item.name, view.collectibleDetail(item));
      return;
    }
    if (action === 'choose-scenario') return chooseScenario();
    if (action === 'hub') return openHub(button.dataset.hub, button.dataset.target);
    if (action === 'start') return start(button.dataset.scenarioId);
    if (action === 'rules') return openDialog('玩法说明', view.rules);
    if (action === 'scan-item') return selectScanItem(button);
    if (action === 'close-dialog') return closeDialog();
    if (action === 'topic') return topicDialog(button.dataset.id);
    if (action === 'share-dialog') return shareDialog(button.dataset.id);
    if (action === 'discussion-board') {
      closeDialog();
      showScreen('community');
      return;
    }
    if (action === 'discuss-report') {
      const report = state.history.find(item => item.id === button.dataset.id);
      if (report?.rounds) {
        if (dialog.open) closeDialog();
        window.DarkVaultDiscussions.compose(view.soloDiscussion(report));
      }
      return;
    }
    if (action === 'copy-report') return shareReport('copy');
    if (action === 'native-share') return shareReport('native');
    if (action === 'download-report') {
      const report = activeReport();
      if (report) makePoster(report);
      return;
    }
    if (action === 'copy-note') {
      const note = $('#topic-note');
      if (!note.value.trim()) return announce('写下你的想法后再复制。', 'error');
      const title = view.TOPICS[$('#note-form').dataset.topic].title;
      const value = `《暗仓竞拍》策略话题\n${title}\n${note.value.trim()}`;
      const copied = await copyText(value, note);
      announce(copied ? '已复制话题与草稿。' : '已选中文字，请手动复制。', copied ? 'success' : 'error');
      return;
    }
    if (action === 'stats') return statsDialog();
    if (action === 'export-stats') {
      const recentRuns = state.history.map(({ rounds, duration, reason, participation, outcomes, eligible, milestoneCredited, recovered, scenarioId, entryFee }) => ({
        rounds, durationSeconds: Math.round(duration / 1000), reason,
        scenarioId: game.findScenario(scenarioId).id, entryFee: entryFee ?? 0,
        submittedBid: game.participationProgress(outcomes).hasBid, countsAsEligible: eligible ?? (participation > 0),
        milestoneCredited: milestoneCredited ?? (participation > 0), checkpointsRecovered: recovered ?? 0,
      }));
      const data = { scope: 'local-browser', ...stats(), recentRuns };
      return download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), '暗仓竞拍-试玩统计.json');
    }
    if (action === 'bid-step') return stepBid(Number(button.dataset.step));
    if (action === 'spin-slots') return spinSlots(button);

    let result;
    switch (action) {
      case 'checkin':
      case 'claim-afk':
      case 'scratch-card':
        result = await update({ type: action });
        break;
      case 'exchange':
        result = await update({ type: action, itemId: button.dataset.id });
        break;
      case 'milestone':
        result = await update({ type: action, level: Number(button.dataset.level) });
        break;
      case 'scan':
      case 'pass':
      case 'extract':
      case 'continue':
        result = await actOnTurn(action, { permit: Boolean($('#use-permit')?.checked) });
        break;
    }
    if (!result) return;
    if (result.message) return announce(result.message, 'error');
    if (result.effect === 'scratch-revealed') {
      const card = $('#shop-scratch .scratch-window');
      card.classList.add('scratch-revealed');
      fx.confirm(card, 'win', true);
    }
    if (result.effect === 'afk-claimed') fx.confirm($('#afk-amount'), 'wallet');
    const messages = {
      'checked-in': `签到完成 · +${game.CHECK_IN} 光核币`,
      exchanged: result.item ? `已兑换 1 ${result.item.unit}${result.item.name}。` : '',
      milestone: '里程碑奖励已到账。',
      'afk-claimed': `离线补给已到账 · +${result.coins} 光核币${result.cards ? ` · 刮刮卡 ×${result.cards}` : ''}`,
      'scratch-revealed': `刮出 +${result.coins} 光核币`,
    };
    if (messages[result.effect]) announce(messages[result.effect]);
  }

  document.addEventListener('click', event => {
    const officialLink = event.target.closest('a[data-community-official]');
    if (officialLink) {
      void update({ type: 'community-official' });
      return;
    }
    const link = event.target.closest('a[data-nav]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (link === supplyNav) refreshAfk(gameNow());
      const next = link === supplyNav ? link.hash.slice(1) : link.dataset.nav;
      if (next === 'community' && screen !== 'community') void update({ type: 'community' });
      showScreen(next);
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (button && !button.disabled) void handleButton(button);
  });

  document.addEventListener('submit', async event => {
    if (event.target.id === 'bid-form') {
      event.preventDefault();
      const input = $('#bid-value');
      if (input.disabled) return;
      const [min, max] = currentBounds();
      const raw = input.value.trim();
      const bid = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(bid) || bid < min || bid > max || bid % 10) {
        return bidError(`出价须为 ${min} 到 ${max} 之间的 10 的倍数。`);
      }
      const result = await actOnTurn('bid', { bid });
      if (result?.message && $('#bid-value')) bidError(result.message);
    }
    if (event.target.id === 'note-form') {
      event.preventDefault();
      const input = $('#topic-note');
      const result = await update({ type: 'note', topic: event.target.dataset.topic, note: input.value });
      if (result) announce(result.effect === 'saved' ? '草稿已保存在当前浏览器。' : result.message, result.effect === 'saved' ? 'success' : 'error');
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'bid-value' && !event.isComposing) {
      clearBidError();
      updateStepper();
    }
  });
  $('#collection-grade').addEventListener('change', event => {
    collectionGrade = event.target.value;
    renderCollection();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing || !document.body.classList.contains('dialog-fallback')) return;
    if (event.key === 'Escape') return closeDialog();
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button:enabled, textarea'));
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      focusable[0].focus();
    }
  });
  dialog.addEventListener('close', () => {
    guidance.close();
    guidance.dismiss();
    restoreFocus(previousFocus);
  });
  window.addEventListener('popstate', fromLocation);
  window.addEventListener('hashchange', fromLocation);
  window.addEventListener('storage', event => {
    if (event.key === accountMarker) {
      void syncAccount();
      return;
    }
    if (accountName) return;
    if (event.key !== storageKey && event.key !== null) return;
    const next = readState();
    const changed = turnChanged(state, next);
    state = next;
    renderHome();
    renderCollection();
    if (screen === 'arena') renderArena(!changed);
  });

  async function tick() {
    if (!Number.isFinite(state.afkSince)) await update({ type: 'afk-start' });
    if (document.hidden) return;
    if (screen === 'arena') clock();
    const now = gameNow();
    if (game.dayKey(now) !== day) {
      renderHome();
      if (screen === 'arena') renderArena(true);
    }
    else refreshAfk(now);
    if (!state.run || remainingSeconds() > 0) return;
    const result = await update({ type: 'tick' });
    if (result?.effect === 'settled') announce('本局已到时限，自动撤离结算。');
  }

  async function submitAccount(operation, payload) {
    const status = $('#account-status');
    if (accountPending || busy) {
      status.textContent = '上一项操作正在完成，请稍后再试。';
      return;
    }
    setAccountPending(true);
    status.textContent = '正在连接账号存档…';
    try {
      const result = await accountRequest('/' + operation, payload);
      applySession(result);
      $('#account-form').reset();
      status.textContent = operation === 'logout' ? '已退出，当前显示游客档。'
        : operation === 'register' ? '注册成功，已进入新账号存档。' : '登录成功，账号进度已加载。';
    } catch (error) {
      status.textContent = error.message;
    } finally { setAccountPending(false); }
  }

  $('#account-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void submitAccount(event.submitter?.value ?? 'login', data);
  });
  $('#account-logout').addEventListener('click', () => void submitAccount('logout', {}));

  state = readState();
  $('#afk-rate').textContent = `每 ${game.AFK_INTERVAL / 60_000} 分钟 +${game.AFK_COINS} 光核币`;
  $('#afk-cap').textContent = `${game.AFK_LIMIT / 3_600_000} 小时 · 最多 ${game.AFK_CAP} 光核币`;
  $('#slot-entry-cost').textContent = `每次 ${game.SLOT_COST} 光核币`;
  guidance.decorate(document);
  renderHome();
  renderCollection();
  fromLocation();
  void tick();
  window.setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionExpected) void syncAccount().then(tick);
    else void tick();
  });
})();
