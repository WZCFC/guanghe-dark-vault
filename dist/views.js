(function defineViews(root) {
  'use strict';
  const game = root.DarkVaultGame;
  const number = new Intl.NumberFormat('zh-CN');
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
  });
  const amount = value => number.format(value);
  const signed = value => `${value > 0 ? '+' : ''}${amount(value)}`;
  const safe = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const balance = value => `<strong class="balance ${value > 0 ? 'positive' : value < 0 ? 'negative' : ''}">${signed(value)}</strong>`;
  const QUALITY = { white: '白色品质', green: '绿色品质', blue: '蓝色品质', purple: '紫色品质', orange: '橙色品质', red: '红色品质' };
  const itemsByName = new Map(game.COLLECTION_ITEMS.map(item => [item.name, item]));
  const artUrl = (item, size) => `assets/collectibles/${item.artId}-${size}.webp${size === 'detail' ? '?v=24' : ''}`;
  const profitCoinRule = `每净赚 ${game.CHIPS_PER_PROFIT_COIN} 筹码得 1 光核币，单局盈利奖最多 ${game.PROFIT_COIN_CAP} 光核币`;
  const outOfTime = '倒计时结束，已自动带出剩余货物。';
  const TOPICS = {
    stop: { title: '第一箱净赚 200，你会马上撤吗？', prompt: '12% 的盘查风险会改变你的决定吗？说说你会在什么价位收手。' },
    clue: { title: '哪类货箱值得用一次扫描？', prompt: '留给起拍价高的货箱，还是留到后几轮？可以带上货箱编号和你的出价。' },
    loss: { title: '亏得最多的一箱，你当时怎么估价？', prompt: '回想一下出价、扫描和撤离顺序。再遇到类似的箱签，你会改哪一步？' },
  };

  function scenarios(state) {
    const active = state.run && game.findScenario(state.run.scenarioId);
    const ongoing = active ? `<div class="scenario-resume panel"><p><strong>${safe(active.name)}</strong>的竞拍进行中。</p>
      <a class="button primary small" href="#arena" data-nav="arena">返回本局</a></div>` : '';
    return `${ongoing}<ul class="scenario-grid">${game.SCENARIOS.map(scenario => {
      const { id, name, fee, chips, risk } = scenario;
      const affordable = state.wallet >= fee;
      const action = active ? '本局结束后可进入' : affordable ? '进入竞拍' : '光核币不足';
      // The range covers rounds 1–3 through round 5.
      const redRange = `${game.redChance(scenario, 0)}–${game.redChance(scenario, game.ROUNDS - 1)}%`;
      return `<li class="panel scenario-card" data-scenario="${safe(id)}">
        <img class="scenario-preview" src="assets/scene-${safe(id)}-thumb.webp" alt="" width="320" height="130" loading="lazy" decoding="async">
        <div class="scenario-card-head"><h3>${safe(name)}</h3><strong class="scenario-fee">${fee ? `${fee} 光核币` : '免费入场'}</strong></div>
        <dl class="scenario-metrics"><div><dt>开局筹码</dt><dd class="mono">${amount(chips)}</dd></div>
          <div><dt>红色主件概率</dt><dd class="mono">${redRange}</dd></div>
          <div><dt>持货盘查</dt><dd class="mono">${risk[0]}–${risk[risk.length - 1]}%</dd></div></dl>
        <button type="button" class="button small ${fee ? 'subtle' : 'primary'}" data-action="start" data-scenario-id="${safe(id)}"
          aria-label="${safe(name)}，${action}${fee && affordable && !active ? `，消耗 ${fee} 光核币` : ''}" ${active || !affordable ? 'disabled' : ''}>${action}</button></li>`;
    }).join('')}</ul>`;
  }

  function task(name, detail, action) {
    return `<div class="task-row"><div><h4>${name}</h4><p>${detail}</p></div>${action}</div>`;
  }

  function tasks(state, now) {
    const today = game.dayKey(now);
    const latest = state.history.find(report => report.rounds > 0);
    const checkin = state.checkinDay === today
      ? '<span class="confirmed">已签到</span>'
      : '<button type="button" class="button primary small" data-action="checkin" aria-label="每日签到">签到</button>';
    const share = latest
      ? `<button type="button" class="button subtle small" data-action="share-dialog" data-id="${safe(latest.id)}">分享战报</button>`
      : '<button type="button" class="button subtle small" data-action="choose-scenario">去竞拍</button>';
    return task('每日签到', `+${game.CHECK_IN} 光核币`, checkin)
      + task('完成有效对局', rewardSummary(state, now), '<button type="button" class="button subtle small" data-action="choose-scenario">去竞拍</button>')
      + task('分享撤离战报', state.shareDay === today ? '今日分享奖励已领取' : `每日首次复制或分享有效战报 +${game.SHARE} 光核币`, share)
      + task('指定游戏任务', '待联动方确认游戏、任务及奖励', '<span class="pending">待接入</span>');
  }

  function milestones(state) {
    return game.MILESTONES.map(({ level, coins, permits }) => {
      const claimed = state.claimed.includes(level);
      const ready = state.milestoneRuns >= level;
      const reward = claimed ? '<span class="confirmed">已领取</span>' : ready
        ? `<button type="button" class="button primary small" data-action="milestone" data-level="${level}" aria-label="领取第 ${level} 场里程碑">领取</button>`
        : `<span class="pending mono" aria-label="已计入 ${state.milestoneRuns} 场，共需 ${level} 场">${state.milestoneRuns}/${level}</span>`;
      return `<div class="milestone-row"><div><h4>完成 <strong>${level}</strong> 场</h4><p>${coins} 光核币 · 护运签 ×${permits}</p></div>${reward}</div>`;
    }).join('');
  }

  function activityProgress(state, now) {
    const today = game.dayKey(now);
    const { used } = game.participationStatus(state, now);
    const dailyMax = game.PARTICIPATION_AWARDS.length;
    const milestoneMax = game.MILESTONES[game.MILESTONES.length - 1].level;
    const milestoneProgress = Math.min(state.milestoneRuns, milestoneMax);
    const unclaimed = game.MILESTONES.filter(({ level }) => !state.claimed.includes(level));
    const ready = unclaimed.filter(({ level }) => state.milestoneRuns >= level).length;
    const milestonesNote = ready ? `${ready} 档奖励可领取` : unclaimed.length ? `下一档需 ${unclaimed[0].level} 场` : '奖励已全部领取';
    return `<article class="panel activity-card"><h3>签到与分享</h3><ul class="activity-states">
      <li>每日签到 <strong>${state.checkinDay === today ? '已完成' : '待签到'}</strong></li>
      <li>分享战报 <strong>${state.shareDay === today ? '奖励已领取' : '待分享'}</strong></li></ul></article>
      <article class="panel activity-card"><h3>每日目标</h3><p>领取有效局参与奖 <strong class="mono">${used}/${dailyMax} 场</strong></p>
        <progress value="${used}" max="${dailyMax}" aria-label="当日参与奖进度"></progress></article>
      <article class="panel activity-card"><h3>参与里程碑</h3><p>累计计入 <strong class="mono">${milestoneProgress}/${milestoneMax} 场</strong></p>
        <progress value="${milestoneProgress}" max="${milestoneMax}" aria-label="累计里程碑进度"></progress>
        <button type="button" class="text-button" data-action="hub" data-hub="activity" data-target="hub-milestones">${milestonesNote}</button></article>`;
  }

  const HUB_TABS = { activity: '活动与进度', discussion: '策略草稿', ranking: '个人排行' };

  function activityHub(state, now) {
    return `<section aria-labelledby="hub-daily" class="hub-block">
        <h3 id="hub-daily" tabindex="-1" data-help-topic="activity">每日活动</h3>${tasks(state, now)}</section>
      <section aria-labelledby="hub-milestones" class="hub-block">
        <h3 id="hub-milestones" tabindex="-1" data-help-topic="milestones">参与里程碑</h3>${milestones(state)}</section>`;
  }

  function ranking(state) {
    const ranked = state.history.filter(report => report.eligible ?? report.participation > 0)
      .sort((a, b) => b.net - a.net || b.finishedAt - a.finishedAt).slice(0, 10);
    const scores = ranked.length ? `<ol class="rank-list">${ranked.map((report, index) =>
      `<li><span class="rank-number mono">${index + 1}</span><span><strong>${safe(game.findScenario(report.scenarioId).name)}</strong>
        <small>${safe(report.id)} · ${report.rounds} 轮</small></span>${balance(report.net)}
        <button type="button" class="button subtle small" data-action="share-dialog" data-id="${safe(report.id)}" aria-label="查看 ${safe(report.id)} 战报">战报</button></li>`).join('')}</ol>`
      : '<div class="empty"><p>完成一场有效对局后即可上榜。</p><button type="button" class="button subtle small" data-action="choose-scenario">去竞拍</button></div>';
    return `<h3 data-help-topic="ranking">个人排行</h3>${scores}
      <button type="button" class="text-button" data-action="stats">个人试玩数据与导出</button>`;
  }

  function hub(state, now, tab) {
    const tabs = Object.entries(HUB_TABS).map(([id, label]) => `<button type="button" class="button subtle small" data-action="hub" data-hub="${id}" aria-pressed="${id === tab}">${label}</button>`).join('');
    const content = tab === 'discussion'
      ? `<h3 data-help-topic="discussion">策略草稿</h3><div class="topic-list">${topicList(state)}</div>
        <button type="button" class="button subtle small" data-action="discussion-board">看公开战报讨论</button>
        <a class="button subtle small hub-community" href="https://guanghe.qq.com/" target="_blank" rel="noopener noreferrer" data-community-official>前往光核玩家社区官网</a>`
      : tab === 'ranking' ? ranking(state) : activityHub(state, now);
    return `<nav class="hub-nav" aria-label="活动中心栏目">${tabs}</nav><div id="hub-content" data-tab="${tab}">${content}</div>`;
  }

  function shop(state) {
    return `<ul class="shop-grid">${game.SHOP_ITEMS.map(item => {
      const onSale = game.isRedeemable(item);
      const affordable = onSale && state.wallet >= item.price;
      const control = onSale
        ? `<div class="shop-price"><strong class="mono">${item.price}</strong> 光核币</div>
          <button class="button primary small" type="button" data-action="exchange" data-id="${safe(item.id)}" ${affordable ? '' : 'disabled'}
            aria-label="消耗 ${item.price} 光核币兑换 1 ${item.unit}${safe(item.name)}">${affordable ? '兑换' : '光核币不足'}</button>`
        : item.externalUrl?.startsWith('https://')
          ? `<a class="button subtle small" href="${safe(item.externalUrl)}" target="_blank" rel="noopener noreferrer"
              aria-label="${safe(item.externalLabel)}，在新标签页打开光核官网">${safe(item.externalLabel)} <span aria-hidden="true">↗</span></a>`
          : '<span class="pending shop-pending">待开放兑换</span>';
      return `<li class="panel shop-card"><span class="shop-category">${safe(item.category)}</span><h3>${safe(item.name)}</h3>
        <p>${safe(item.description)}</p>${item.inventory ? `<span class="shop-stock">已持有 <strong class="mono">${amount(state[item.inventory] ?? 0)}</strong> ${item.unit}</span>` : ''}
        <div class="shop-card-foot">${control}</div></li>`;
    }).join('')}</ul>`;
  }

  function scratch(state) {
    const count = state.scratchCards ?? 0;
    const last = state.lastScratch;
    return `<article class="panel scratch-ticket" aria-labelledby="scratch-heading">
      <div class="scratch-copy"><h2 id="scratch-heading">刮卡台</h2>
        <p>持有 <strong class="mono">${amount(count)}</strong> 张补给刮刮卡</p>
        <details><summary>查看开奖概率</summary><ul>${game.SCRATCH_REWARDS.map(({ coins, weight }) =>
          `<li>${coins} 币 <strong class="mono">${weight}%</strong></li>`).join('')}</ul></details>
      </div>
      <div class="scratch-controls">
        <p class="scratch-window">${last != null ? `上张刮出 <strong class="mono">+${last}</strong> 光核币` : '银膜未揭开'}</p>
        <button type="button" class="button primary small" data-action="scratch-card" ${count ? '' : 'disabled'}>刮开一张</button>
      </div>
    </article>`;
  }

  function slotResult(result) {
    if (!result) return '等待开转';
    if (result.coins) return `获得 ${result.coins} 光核币`;
    if (result.collectible) return `解锁红色藏品「${result.collectible}」`;
    if (result.permits) return `获得护运签 ×${result.permits}`;
    return '本次未命中';
  }

  function slots(state, spinning = false) {
    const result = state.lastSpin;
    const reels = result?.reels ?? ['empty', 'empty', 'empty'];
    const symbols = Object.fromEntries(game.SLOT_SYMBOLS.map(({ id, label }) => [id, label]));
    const [coin, rare, permit] = game.SLOT_SYMBOLS.map(symbol => symbol.chance);
    const [tripleCoin, doubleCoin, tripleRare, triplePermit] = [coin ** 3, 3 * coin ** 2 * (1 - coin), rare ** 3, permit ** 3];
    const miss = 1 - tripleCoin - doubleCoin - tripleRare - triplePermit;
    const formatOdds = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 });
    const rules = [
      ['三张币牌', `${game.SLOT_PAYOUTS.threeCoins} 光核币`, tripleCoin],
      ['恰好两张币牌', `${game.SLOT_PAYOUTS.twoCoins} 光核币`, doubleCoin],
      ['三张藏品牌', '1 件未解锁红色藏品', tripleRare],
      ['三张道具牌', '护运签 ×1', triplePermit],
      ['其他组合', '本次无掉落', miss],
    ];
    const narrative = result ? `本次余额 ${signed(result.coins - game.SLOT_COST)} 光核币` : '';
    const canSpin = state.wallet >= game.SLOT_COST;
    const locks = state.slotLocks ?? 0;
    const face = id => `<div class="slot-reel" data-symbol="${safe(id)}"><span class="slot-icon" aria-hidden="true"></span><span>${safe(symbols[id] ?? '—')}</span></div>`;
    const tracks = reels.map((id, index) => {
      const sequence = Object.keys(symbols);
      const pinned = result?.lockCoin && index === 0;
      const strip = spinning && !pinned ? [...sequence.slice(index), ...sequence, ...sequence.slice(0, index), id] : [id];
      return `<div class="slot-window${pinned ? ' slot-pinned' : ''}"><div class="slot-track">${strip.map(face).join('')}</div>${pinned ? '<span class="slot-pin">已锁定</span>' : ''}</div>`;
    }).join('');
    return `<div class="slots-layout">
      <article class="panel slot-board" aria-label="老虎机操作台">
        <div class="slot-head"><h2>转动结果</h2><span class="collection-count">余额 ${amount(state.wallet)} 光核币</span></div>
        <div class="slot-reels${spinning ? ' spinning' : ''}" ${spinning ? 'aria-hidden="true"' : 'aria-label="当前三个图案"'}>${tracks}</div>
        <p class="slot-result" role="status">${spinning ? '转动中…' : safe(slotResult(result))}</p>
        <p class="slot-accounting">${spinning ? '' : `${narrative}${result?.lockCoin ? ' · 消耗锁定器 ×1' : ''}`}</p>
        ${!spinning && result?.collectible ? unlockDisplay([result.collectible]) : ''}
        <div class="slot-lock-control">
          <label><input id="slot-lock-coin" type="checkbox" ${locks && canSpin && !spinning ? '' : 'disabled'}>
            <span>锁定首格币牌 <strong class="mono">×${amount(locks)}</strong></span></label>
          ${locks ? '<span>锁定时仅可获得光核币</span>' : '<a href="#shop" data-nav="shop" class="text-button">去商店兑换</a>'}
        </div>
        <div class="slot-actions"><button type="button" data-action="spin-slots" class="button primary" ${canSpin && !spinning ? '' : 'disabled'}>转一次 · ${game.SLOT_COST} 光核币</button>
          ${canSpin || spinning ? '' : '<p>光核币不足</p>'}
        </div>
      </article>
      <template data-help-extra="slots">
        <table class="slot-odds">
          <caption>图案、掉落与概率</caption>
          <thead><tr><th scope="col">组合</th><th scope="col">产出</th><th scope="col">概率</th></tr></thead>
          <tbody>${rules.map(([name, reward, odds]) => `<tr><th scope="row">${name}</th><td>${reward}</td><td class="mono">${formatOdds.format(odds)}</td></tr>`).join('')}</tbody>
        </table>
        <p>锁定首格后，其余两格仍独立转动。25% 获得 ${game.SLOT_PAYOUTS.threeCoins} 币，50% 获得 ${game.SLOT_PAYOUTS.twoCoins} 币，25% 无掉落。</p>
      </template>
    </div>`;
  }

  function topicList(state) {
    return Object.entries(TOPICS).map(([id, topic]) => `<button type="button" class="topic-button" data-action="topic" data-id="${id}"><span>${topic.title}</span><span ${state.notes[id] ? '' : 'aria-hidden="true"'}>${state.notes[id] ? '有草稿 ↗' : '↗'}</span></button>`).join('');
  }

  function reports(state) {
    const recent = state.history.filter(report => report.rounds > 0).slice(0, 4);
    if (!recent.length) return '<div class="empty"><p>完成一局后，撤离战报会出现在这里。</p><button type="button" class="button subtle small" data-action="start">去竞拍</button></div>';
    return `<div class="report-list">${recent.map(report => `
      <div class="report-row"><div><h4 class="mono">${safe(report.id)}</h4><p>${date.format(report.finishedAt)} · 完成 ${report.rounds} 轮</p></div>
        ${balance(report.net)}<button type="button" class="button subtle small" data-action="share-dialog" data-id="${safe(report.id)}" aria-label="查看 ${safe(report.id)} 战报">战报</button></div>`).join('')}</div>`;
  }

  function collection(state, filter, grade = 'all') {
    const owned = new Set(state.collection);
    const shelves = game.GRADES.filter(quality => grade === 'all' || grade === quality).map(quality => {
      const tier = game.COLLECTION_ITEMS.filter(item => item.quality === quality);
      const cards = tier.filter(item => filter === 'all' || owned.has(item.name) === (filter === 'owned')).map(item => {
        const unlocked = owned.has(item.name);
        const art = unlocked
          ? `<button class="collectible-art collectible-inspect" type="button" data-action="inspect-collectible" data-id="${item.artId}" aria-label="细看${safe(item.name)}">
              <img src="${artUrl(item, 'thumb')}" width="160" height="160" alt="" loading="lazy" decoding="async"></button>`
          : `<div class="collectible-art" aria-hidden="true"><span class="silhouette shape-${item.silhouette}"></span></div>`;
        return `<li class="collectible quality-${quality} ${unlocked ? 'unlocked' : 'locked'}">
          ${art}
          <div class="collectible-label">${unlocked ? `<h3>${safe(item.name)}</h3>` : ''}<span class="collection-grade">${QUALITY[quality]}</span></div></li>`;
      });
      if (!cards.length) return '';
      const progress = tier.filter(item => owned.has(item.name)).length;
      return `<section class="collection-tier" aria-label="${QUALITY[quality]}"><div class="collection-tier-head quality-${quality}">
        <h2>${QUALITY[quality]}</h2><span class="mono">${progress} / ${tier.length} 已解锁</span></div><ul class="collection-shelf">${cards.join('')}</ul></section>`;
    }).join('');
    return shelves || `<p class="collection-empty">${filter === 'owned' ? '这个筛选范围内还没有解锁藏品。' : '这个筛选范围内的藏品已全部解锁。'}</p>`;
  }

  function collectibleDetail(item) {
    const size = item.artId.startsWith('part-') ? 624 : 506;
    return `<figure class="collectible-detail quality-${item.quality}">
      <img src="${artUrl(item, 'detail')}" width="${size}" height="${size}" alt="${safe(item.name)}藏品细节图" decoding="async">
      <figcaption><span class="quality-label quality-${item.quality}">${QUALITY[item.quality]}</span>
        <span>${safe(item.category)} · ${safe(item.source)}</span></figcaption></figure>`;
  }

  function unlockDisplay(names) {
    const grades = game.GRADES;
    const found = names.map(name => itemsByName.get(name)).filter(Boolean)
      .sort((a, b) => grades.indexOf(b.quality) - grades.indexOf(a.quality));
    const featured = found[0];
    if (!featured) return '';
    return `<section class="unlock-display quality-${featured.quality}" aria-label="新增收藏">
      <img class="unlock-art" src="${artUrl(featured, 'thumb')}" width="160" height="160" alt="" decoding="async">
      <div><p class="unlock-count">首次入藏 · 新增 ${found.length} 件</p>
        <h4>${safe(featured.name)}</h4><span class="quality-label quality-${featured.quality}">${QUALITY[featured.quality]}</span>
        ${found.length > 1 ? `<p class="unlock-other">${found.slice(1).map(item => safe(item.name)).join('、')}</p>` : ''}
        <button class="button subtle small" type="button" data-action="inspect-collectible" data-id="${safe(featured.artId)}">查看藏品细节</button>
      </div></section>`;
  }

  function lotBanner(lot, revealed) {
    const title = revealed ? `<p class="reveal-lot">${safe(lot.name)}</p>` : `<h3 data-stage-title tabindex="-1">${safe(lot.name)}</h3>`;
    return `<div class="lot-banner${revealed ? ' revealed' : ''}">
      <div class="lot-scene" aria-hidden="true"></div><div class="lot-shade" aria-hidden="true"></div><div class="scene-entry" aria-hidden="true"></div>
      <header class="lot-title"><span class="ticket">LOT ${safe(lot.id)}</span>${title}${revealed ? '' : `<p>来源 · ${safe(lot.source)}</p>`}</header></div>`;
  }

  function checkpointNotice(checkpoint) {
    if (!checkpoint) return '';
    const messages = {
      hit: `遇到盘查 · ${safe(checkpoint.item?.name ?? '')}已被扣留。${checkpoint.recovered ? `结算时返还 ${checkpoint.recovered} 筹码。` : '已付筹码计入成本。'}`,
      protected: '遇到盘查 · 护运签已生效，货物全部保留。',
      'clear-with-permit': '顺利通过 · 本次未触发盘查，启用的护运签已消耗。',
      clear: '顺利通过 · 本次未触发盘查，货物全部保留。',
    };
    return `<p class="checkpoint ${checkpoint.status}" role="status">${messages[checkpoint.status]}</p>`;
  }

  const itemNumber = index => String(index + 1).padStart(2, '0');

  function scanDetails(item, index) {
    return `<div class="scan-item-head"><h4>货物 <span class="mono">${itemNumber(index)}</span></h4><span class="quality-label quality-${item.quality}">${QUALITY[item.quality]}</span></div>
      <dl><dt>形状</dt><dd>${item.label} · 占 ${item.tiles} 格</dd>
      <dt>可能品类</dt><dd>${item.categories.map(safe).join(' / ')}</dd>
      <dt>单件估价</dt><dd><strong class="mono">${item.low}–${item.high}</strong> 筹码</dd></dl>`;
  }

  function scanLayout(lot, selected, scanning) {
    const items = game.boxItems(lot);
    const active = items[selected] ? selected : 0;
    const buttons = items.map((item, index) => `<button type="button" class="scan-piece quality-${item.quality}"
      style="grid-column:${item.column}/span ${item.width};grid-row:${item.row}/span ${item.height};--piece-width:${item.width};--piece-height:${item.height}"
      data-action="scan-item" data-index="${index}" data-shape="${item.shape}"
      aria-pressed="${index === active}" aria-controls="scan-detail" aria-label="货物 ${itemNumber(index)}，${QUALITY[item.quality]}，${item.label}">
      <span aria-hidden="true">${itemNumber(index)}</span></button>`).join('');
    return `<section id="scan-layout" class="scan-layout" tabindex="-1" aria-labelledby="scan-layout-title"${scanning ? ' data-scanning' : ''}>
      <div class="scan-heading"><h3 id="scan-layout-title" data-help-topic="scan">箱内扫描图</h3><span class="scan-feedback" role="status">${scanning ? '正在扫描…' : `6 × 4 格 · ${items.length} 件货物`}</span></div>
      <div class="scan-body">
        <div class="scan-grid" role="group" aria-label="箱内货物位置">${buttons}${scanning ? '<span class="scan-beam" aria-hidden="true"></span>' : ''}</div>
        <div class="scan-detail" id="scan-detail" aria-live="polite" aria-atomic="true">${scanDetails(items[active], active)}</div>
      </div>
    </section>`;
  }

  function auction(run, bidDraft, scanSelection, scanning) {
    const lot = run.lots[run.index];
    const inactive = game.chipsLeft(run) < lot.reserve;
    const bid = bidDraft ?? (inactive ? '' : lot.reserve);
    const scanned = lot.scanned && !scanning;
    const range = scanned ? [lot.scanLow, lot.scanHigh] : [lot.low, lot.high];
    const minParticipationBid = game.participationBidFloor(lot, run.legacyEconomy);
    const progress = game.participationProgress(run.outcomes, run.legacyEconomy);
    const bidNote = progress.hasQualifyingBid ? '已满足本局参与奖的出价条件。'
      : `本箱达到 ${minParticipationBid} 筹码，计作参与奖所需的有效出价。`;
    const margin = inactive ? '筹码不足，可放弃本箱。'
      : `若拍到，按估价差额 ${signed(range[0] - Number(bid))} 至 ${signed(range[1] - Number(bid))} 筹码`;
    return `<div class="lot-content">
      ${checkpointNotice(run.checkpoint)}
      <dl class="clues"><div><dt>箱签线索</dt><dd>${safe(lot.seal)}</dd></div><div><dt>起拍价</dt><dd><strong class="mono">${lot.reserve}</strong> 筹码</dd></div></dl>
      <div class="scan-row"><div class="scan-info"><span id="lot-estimate-label">${scanned ? '全箱扫描估值' : '全箱初步估值'}</span><strong class="mono" id="lot-estimate">${range.join('–')}</strong><small>筹码</small></div>
        <button class="button subtle small scan-button" type="button" data-action="scan" ${lot.scanned || run.scans === 0 ? 'disabled' : ''}>${scanning ? '扫描中…' : scanned ? '已扫描' : `扫描 (${run.scans})`}</button></div>
      ${lot.scanned ? scanLayout(lot, scanSelection, scanning) : ''}
      <form id="bid-form" class="bid-form" novalidate>
        <label for="bid-value" data-help-topic="bid" data-help-detail="${safe(`最高可出价 ${game.chipsLeft(run)} 筹码。${bidNote}`)}">你的暗标</label>
        <div class="bid-controls"><div class="bid-input-group">
          <button type="button" data-action="bid-step" data-step="-10" aria-label="减少 10 筹码" ${inactive ? 'disabled' : ''}>−</button>
          <input id="bid-value" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="${String(game.findScenario(run.scenarioId).chips).length}" autocomplete="off" value="${safe(bid)}" aria-describedby="bid-qualification bid-error" ${inactive ? 'disabled' : ''}>
          <button type="button" data-action="bid-step" data-step="10" aria-label="增加 10 筹码" ${inactive ? 'disabled' : ''}>+</button>
        </div><button type="submit" class="button primary" ${inactive ? 'disabled' : ''}>提交暗标</button></div>
        <p class="bid-margin mono" id="bid-margin" data-range="${range.join(',')}">${margin}</p>
        <p class="form-note" id="bid-qualification">${inactive ? '' : progress.hasQualifyingBid ? '已达参与奖出价条件' : `参与奖门槛 ${minParticipationBid} 筹码`}</p>
        <p id="bid-error" class="inline-error" aria-live="polite"></p>
      </form>
      <div class="auction-footer"><button class="button subtle small" type="button" data-action="pass">放弃本箱</button></div>
    </div>`;
  }

  function revealedItems(items) {
    if (!items?.length) return '';
    return `<details class="box-reveal"><summary>查看箱内物件与真实估值</summary>
      <ul>${items.map(item => {
        const known = itemsByName.get(item.name);
        const art = known ? `<img src="${artUrl(known, 'thumb')}" alt="" width="40" height="40" loading="lazy" decoding="async">` : '';
        return `<li><span class="revealed-item-name">${art}<span>${safe(item.name)}${QUALITY[item.quality] ? ` <span class="quality-label quality-${item.quality}">${QUALITY[item.quality]}</span>` : ''}</span></span><strong class="mono">${item.value} 筹码</strong></li>`;
      }).join('')}</ul></details>`;
  }

  function revealResult(outcome, lastRound = false) {
    const result = outcome.won ? 'won' : outcome.winner === null ? 'unsold' : outcome.bid === null ? 'passed' : 'lost';
    const [symbol, label, detail] = {
      won: ['✓', '竞得货箱', `已加入到手货箱 · 扣除 ${amount(outcome.bid)} 筹码`],
      lost: ['×', '未竞得', `${safe(outcome.winner)}以 ${amount(Math.max(...outcome.bids))} 筹码竞得 · 本轮未扣筹码`],
      passed: ['−', '已放弃', `${safe(outcome.winner)}竞得 · 本轮未扣筹码`],
      unsold: ['−', '货箱流拍', '本轮无人出价'],
    }[result];
    const heading = lastRound ? `<h4>第 ${game.ROUNDS} 轮 · ${label}</h4>` : `<h3 data-stage-title tabindex="-1">${label}</h3>`;
    return `<div class="reveal-result" data-result="${result}"><span class="reveal-mark" aria-hidden="true">${symbol}</span>
      <div>${heading}<p>${detail}</p></div>${outcome.won ? `<div class="reveal-gain mono">${balance(outcome.value - outcome.bid)}<small>本箱账面差额</small></div>` : ''}</div>`;
  }

  function decision(state, now) {
    const { run } = state;
    const outcome = run.outcomes[run.outcomes.length - 1];
    const risk = game.nextRisk(run);
    const recovery = game.nextRecoveryRate(run);
    const rivalPrice = Math.max(...outcome.bids);
    const riskText = risk
      ? `<p class="next-risk"><strong>${risk}% 盘查概率</strong> · 扣留最高估值货箱${recovery ? `，返还 ${Math.round(recovery * 100)}%` : ''}</p>`
      : '<p class="next-risk clear">空手继续无盘查</p>';
    const permit = risk && state.permits > 0
      ? `<label class="permit-choice"><input type="checkbox" id="use-permit"> 消耗 1 张护运签保护本次通行（持有 ${state.permits} 张）</label>` : '';
    const progress = game.participationProgress(run.outcomes, run.legacyEconomy);
    const { nextCoins } = game.participationStatus(state, now);
    const reward = progress.eligible
      ? (nextCoins ? `现在撤离可领 ${nextCoins} 光核币参与奖，并计入里程碑。` : '本局已达到有效对局条件。')
      : `还需${participationSteps(progress, run.legacyEconomy)}，结算后才算有效对局。`;
    return `<div class="reveal">
      ${revealResult(outcome)}
      <dl class="reveal-data"><div><dt>全箱真实估值</dt><dd class="mono">${outcome.value}</dd></div><div><dt>你的出价</dt><dd class="mono">${outcome.bid === null ? '放弃' : outcome.bid}</dd></div><div><dt>电脑最高价</dt><dd class="mono">${rivalPrice || '未出价'}</dd></div></dl>
      ${revealedItems(outcome.items)}
    </div><div class="decision"><h3 class="decision-title" data-help-topic="risk" data-help-detail="${safe(rewardSummary(state, now))}">撤离还是继续？</h3>
      <div class="decision-actions decision-fork">
        <div><span>现在撤离 · 净收益</span>${balance(game.runNet(run))}
          <button type="button" class="button primary" data-action="extract"><i data-icon="exit" aria-hidden="true"></i>撤离结算</button></div>
        <div><span>继续搜仓 · 下一轮</span>${riskText}<button type="button" class="button subtle" data-action="continue">继续搜仓</button></div>
      </div>${permit}<p class="form-note">${reward}</p>
    </div>`;
  }

  function participationSteps({ roundsLeft, hasQualifyingBid }, legacyEconomy) {
    const steps = [];
    if (roundsLeft) steps.push(`完成 ${roundsLeft} 轮`);
    if (!hasQualifyingBid) steps.push(legacyEconomy ? '提交 1 次有效出价' : `有 1 笔出价达到该箱起拍价 +${game.PARTICIPATION_BID_STEP} 筹码`);
    return steps.join('、');
  }

  function rewardSummary(state, now) {
    const { nextCoins } = game.participationStatus(state, now);
    const quota = nextCoins ? `今日下一场有效局 +${nextCoins} 光核币` : '今日参与奖及里程碑额度已用完';
    return `${quota} · 里程碑累计 ${state.milestoneRuns} 场`;
  }

  function sidebar(state) {
    const { run } = state;
    const total = game.cargoValue(run);
    const resolved = run.phase === 'decision' ? run.outcomes[run.outcomes.length - 1] : null;
    const budgets = run.rivalBudgeted ? game.rivalBalances(run) : null;
    return `<aside class="run-side" aria-label="货物与电脑竞价员">
      <section class="panel"><div class="panel-head"><h3>到手货箱</h3><span class="annot">${run.cargo.length} 箱 · 扣留 ${run.seized.length} 箱</span></div>
        <div class="stash-body"><dl class="stash-totals"><div><dt>当前货值</dt><dd>${amount(total)}</dd></div><div><dt>已付成本</dt><dd>${amount(run.spent)}</dd></div>
          ${run.recovered ? `<div><dt>盘查返还</dt><dd>${amount(run.recovered)}</dd></div>` : ''}
          <div class="stash-net"><dt>现在撤离净收益</dt><dd>${balance(game.runNet(run))}</dd></div></dl>
          <ul class="stash-list">${run.cargo.map(item => `<li><span>${safe(item.name)}</span><span class="mono">${item.value}</span></li>`).join('')}</ul>
          ${run.cargo.length ? '' : '<p class="stash-help">竞得的货物会显示在这里。</p>'}</div>
      </section>
      <section class="panel"><div class="panel-head"><h3>电脑竞价员</h3><span class="annot">${resolved ? '已揭标' : '报价封存'}</span></div>
        <ul class="rivals-list">${game.RIVALS.map((rival, index) => `<li><span class="avatar" aria-hidden="true">${rival.mark}</span><div><strong>${rival.name}</strong><small>${budgets ? rival.style + ' · 剩 ' + amount(budgets[index]) : '按开局规则出价'}</small></div><span class="mono">${resolved ? resolved.bids[index] || '观望' : '···'}</span></li>`).join('')}</ul>
      </section>
    </aside>`;
  }

  function board(state, bidDraft, scanSelection, now, scanning) {
    const { run } = state;
    const scenario = game.findScenario(run.scenarioId);
    const stages = Array.from({ length: game.ROUNDS }, (_, i) => `<li${i <= run.index ? ' class="filled"' : ''}></li>`).join('');
    const revealed = run.phase === 'decision';
    return `<div class="arena-hud"><div><h3>${safe(scenario.name)}</h3><div class="hud-stage"><span class="mono">第 ${run.index + 1} / ${game.ROUNDS} 轮</span><ol class="stages" aria-hidden="true">${stages}</ol></div></div>
      <div class="hud-stat"><span>余下时间</span><time id="run-clock" aria-label="余下时间">06:00</time></div>
      <div class="hud-stat"><span>局内筹码</span><strong class="mono">${game.chipsLeft(run)}</strong></div>
      <p class="hud-chip-tip">每净赚 ${game.CHIPS_PER_PROFIT_COIN} 筹码得 1 光核币</p></div>
      ${run.legacyEconomy ? '<p class="checkpoint">本局沿用开局时的拍品与参与条件，下次开局使用新版数值。</p>' : ''}
      <div class="board"><article class="panel arena-lot">${lotBanner(run.lots[run.index], revealed)}
        ${revealed ? decision(state, now) : auction(run, bidDraft, scanSelection, scanning)}</article>${sidebar(state)}</div>`;
  }

  function verdict(report) {
    if (report.net >= 250) return '满载撤离';
    if (report.net > 0) return '盈利撤离';
    if (report.net < 0) return '亏损撤离';
    return report.rounds === 0 ? '超时撤离' : '平账撤离';
  }

  function discussionSeed(mode, name, value, paid, submitted, net) {
    const title = paid != null && paid > value ? `这箱估值 ${value}，出了 ${paid}，你会压到多少？`
      : paid != null ? `这箱 ${paid} 拍下，值 ${value}。你会出多少？`
        : `错过这箱 ${value} 的货，你会怎么出价？`;
    const attachment = `${mode} · ${name} · 全箱真实估值 ${value} 筹码。我的暗标 ${submitted ?? '放弃'}，全局净收益 ${signed(net)} 筹码。`;
    return { title, attachment };
  }

  function soloDiscussion(report) {
    const hook = report.outcomes.reduce((best, round) => {
      const price = round.won ? round.bid : Math.max(...round.bids);
      const gap = Math.abs(round.value - price);
      return gap > best.gap ? { round, price, gap } : best;
    }, { gap: -1 });
    return discussionSeed('单人撤离', hook.round.name, hook.round.value, hook.round.won ? hook.price : null, hook.round.bid, report.net);
  }

  function settlement(report, state, now) {
    const scenario = game.findScenario(report.scenarioId);
    const note = report.reason === 'clock' ? outOfTime : report.reason === 'limit' ? '已完成全部 5 轮，仓库结算完成。' : '你选择带着现有货物撤离。';
    const share = report.rounds ? `<button type="button" class="button subtle" data-action="share-dialog" data-id="${safe(report.id)}">生成战报</button>` : '';
    const discuss = report.outcomes.length ? soloDiscussion(report) : null;
    const entryFee = report.entryFee ?? 0;
    const walletChange = report.bonus + report.participation - entryFee;
    const walletBreakdown = [
      ['筹码净收益', report.net, '筹码'],
      ['折算为盈利奖', report.bonus, '光核币'],
      ['参与奖', report.participation, '光核币'],
      [entryFee ? '入场费（开局已扣）' : '入场费（免费）', 0 - entryFee, '光核币'],
    ];
    const totals = [['带出货值', report.gross], ['盘查返还', report.recovered ?? 0], ['竞拍成本', report.spent]];
    const cargo = report.cargo.map(item => `<li><span>${safe(item.name)}</span><strong>${item.value}</strong></li>`);
    const seized = report.seized.map(item => `<li><span>${safe(item.name)}（盘查扣留）</span><strong class="negative">未带出</strong></li>`);
    const rounds = report.outcomes.length ? `<details class="history-detail"><summary>逐轮复盘</summary><ol class="round-history">${report.outcomes.map((round, index) => `<li><strong>第 ${index + 1} 轮 · ${safe(round.name)}</strong><br>全箱估值 ${round.value}，你的暗标 ${round.bid ?? '放弃'}，${round.winner === null ? '货箱流拍' : safe(round.winner) + '竞得'}。${revealedItems(round.items)}</li>`).join('')}</ol></details>` : '';
    const seconds = Math.floor(report.duration / 1000);
    const duration = `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    const unlocks = report.newUnlocks?.length ? unlockDisplay(report.newUnlocks) : '';
    const legacy = report.legacyEconomy || report.eligible === undefined;
    const progress = game.participationProgress(report.outcomes, legacy);
    const participationNote = report.participation
      ? '本局已计入有效对局和里程碑。'
      : report.eligible ? '本局计入有效对局，结算时的当日参与奖和里程碑额度已用完。'
        : progress.eligible ? '本局参与奖按当时的结算规则记录。'
          : `本局参与条件还差${participationSteps(progress, legacy)}。`;
    return `<article class="panel settlement">
      <header class="settle-head"><div><div class="code mono">${safe(scenario.name)} · ${safe(report.id)} · ${report.rounds}/${game.ROUNDS} 轮 · ${duration}</div><h3 data-stage-title tabindex="-1">${verdict(report)}</h3><p>${note}</p></div><div class="settle-net"><small>本局钱包增减</small>${balance(walletChange)} <small>光核币</small></div></header>
      <div class="settle-body">${unlocks}${report.reason === 'limit' ? revealResult(report.outcomes[report.outcomes.length - 1], true) : ''}
        <section class="wallet-receipt" aria-labelledby="wallet-receipt-title">
          <h4 id="wallet-receipt-title" data-help-topic="receipt" data-help-detail="${safe(`${participationNote}${rewardSummary(state, now)}`)}">本局结算明细</h4>
          <dl class="wallet-breakdown">${walletBreakdown.map(([label, value, unit]) => `<div><dt>${label}</dt><dd>${balance(value)} <span>${unit}</span></dd></div>`).join('')}</dl>
        </section>
        <ul class="settle-metrics" aria-label="筹码净收益明细">${totals.map(([label, value]) => `<li><span>${label}</span><strong>${amount(value)}</strong> 筹码</li>`).join('')}</ul>
        <p class="settle-note">${participationNote}</p>
        <ul class="settlement-list">${cargo.concat(seized).join('')}</ul>
        ${rounds}
        ${discuss ? `<section class="battle-hook"><div><h4>这局最值得聊的一箱</h4><p>${safe(discuss.title)}</p></div><button type="button" class="button subtle" data-action="discuss-report" data-id="${safe(report.id)}">带这局去讨论</button></section>` : ''}
        <div class="settle-actions"><button type="button" class="button primary" data-action="choose-scenario">选择场景再开一局 <span aria-hidden="true">→</span></button>${share}<a href="#collection" data-nav="collection" class="button subtle">查看收藏室</a><a href="#supply" data-nav="supply" class="button subtle">查看活动补给</a><a href="#community" data-nav="community" class="button subtle">去交流站复盘</a>${report.rounds ? '<a href="#feedback" data-nav="feedback" class="button subtle">体验问卷</a>' : ''}</div>
      </div></article>`;
  }

  const rules = `<ol>
    <li><strong>选场景。</strong>入场费从光核币钱包扣除，按场景发放局内筹码。每局最多拍卖 ${game.ROUNDS} 个箱子，可扫描 2 次，查看物件品质、占格、可能品类和估价。</li>
    <li><strong>交暗标。</strong>每箱出价一次。报价最高的人拿下货物并支付，同价时电脑竞价员优先。你也可以放弃本箱。</li>
    <li><strong>选撤离。</strong>揭标后可带走全部现有货箱。卸货站持货进入第 2 至 5 轮的盘查概率依次为 ${game.RISK.map(rate => `${rate}%`).join('、')}。各档第 4、5 轮货箱估值和出红概率更高。进入这两轮若被扣留，结算时返还该箱估值的 ${Math.round(game.LATE_RECOVERY * 100)}%。护运签可保护本次通行，使用即消耗。</li>
    <li><strong>结算。</strong>第 ${game.ROUNDS} 轮结束或 6 分钟倒计时结束时自动撤离。净收益等于带出货值加盘查返还，再减竞拍成本。${profitCoinRule}。</li>
  </ol><p>完成至少 ${game.MIN_ELIGIBLE_ROUNDS} 轮、至少一笔有效出价达到该箱起拍价 +${game.PARTICIPATION_BID_STEP} 筹码，并完成结算，计作有效对局。每天前两场有效局分别发 ${game.PARTICIPATION_AWARDS.join('、')} 光核币并计入里程碑。空手和亏损均按同一额度发放。</p>`;

  root.DarkVaultViews = { TOPICS, amount, signed, safe, balance, scenarios, tasks, milestones, activityProgress, activityHub, hub,
    shop, scratch, slots, slotResult, topicList, reports, collection, collectibleDetail, board, scanDetails, settlement, verdict, discussionSeed, soloDiscussion, rules };
})(globalThis);
