(function setupGuide(root) {
  'use strict';
  const game = root.DarkVaultGame;
  const topics = {
    home: ['活动首页', '第一次玩可以先点「新手教程」，跟着练习一次扫描、出价和撤离。', '练习完成后，从免费的卸货站开始。也可以打开「登录」，注册账号后跨浏览器续玩。'],
    scenarios: ['竞拍场景', '选一档开始。卸货站免费，另外三档的入场费从钱包扣除。', '不同场景的开局筹码、红色主件概率和盘查风险不同。四档共用每日参与奖与里程碑名额。'],
    rules: ['参加规则', '按查勘、暗拍、撤离的顺序看一遍，再进竞拍台。', '单人最多五轮，限时六分钟。第 5 轮揭标后或到时会自动结算。'],
    arena: ['竞拍台', '选一档开局。进入竞拍后，先点「扫描」查线索，再输入暗标或放弃本箱。', `每局可扫描两次。同价时电脑优先，竞得才扣局内筹码。每净赚 ${game.CHIPS_PER_PROFIT_COIN} 筹码得 1 光核币，单局盈利奖上限 ${game.PROFIT_COIN_CAP} 币。`],
    online: ['线上组队', '加入房间后先看估价。碰到拿不准的货箱，可以先用一次扫描，再提交暗标。', '邀请房支持 2–4 人。每人 720 筹码，共拍 3 箱，有 2 次私有扫描。每轮有 30 秒，全员提交或超时后统一揭标，同价并列最高时货箱流拍。顶部「开启声音」可播放竞拍音乐与音效。'],
    scan: ['箱内扫描图', '点一个带颜色的轮廓，查看它的品质、占格、可能品类和估价。', '颜色和品质名称对应。总估价是扫描后的全箱区间，揭标后会显示真实估值。'],
    bid: ['暗标', '看起拍价和扫描估值，再用加减键或输入框出价。', '每箱只提交一次暗标，以 10 筹码为步长，最高价竞得。同价时电脑优先，竞得才扣款。'],
    risk: ['撤离与盘查', '看当前净收益和下一轮盘查概率，决定现在撤离还是继续搜仓。', `持货继续有概率触发盘查，并扣留估值最高的一箱。进入第 4、5 轮时，结算会返还扣留货箱约 ${Math.round(game.LATE_RECOVERY * 100)}% 的估值。护运签保护本次通行，使用即消耗。`],
    receipt: ['本局结算', '先看「本局钱包增减」，再用明细对照盈利奖、参与奖和入场费。', `筹码净收益等于带出货值加盘查返还，再减竞拍成本。每满 ${game.CHIPS_PER_PROFIT_COIN} 筹码盈利折算 1 币，单局最多 ${game.PROFIT_COIN_CAP} 币。钱包增减为盈利奖加参与奖，再减开局已扣的入场费。`],
    collection: ['收藏室', '点「未解锁」看看还缺哪些品质的藏品。', '成功带出的货物会登记到图鉴。仓库老虎机也可掉落未解锁的红色藏品。'],
    supply: ['活动补给', '先签到领光核币，再选择离线补给或仓库老虎机。', '顶部「补给」有红点时直达离线领取。任务和里程碑也能在首页活动中心操作。'],
    afk: ['离线补给', '点「领取补给」，累计领过的基础币会升级补给站。', `关掉页面也会累积。每 ${game.AFK_INTERVAL / 60_000} 分钟存 ${game.AFK_COINS} 基础币，最多存 ${game.AFK_CAP} 币，每天最多领 ${game.AFK_DAILY_CAP} 基础币，库存可跨日。基础币累计达到 96 和 240 时升级。升级后每 8 或 4 枚新领的基础币额外发 1 枚，每日加成上限分别为 6 和 12 枚。每累计领取 ${game.AFK_CARD_STEP} 基础币发一张刮刮卡。`],
    slots: ['仓库老虎机', `余额足够时点「转一次」。花 ${game.SLOT_COST} 光核币，等三格停下后看本次结果。`, `普通模式三格独立抽取。勾选锁定会消耗一个锁定器，让第一格固定为币牌。红色藏品集齐后，三张藏品牌改发 ${game.SLOT_PAYOUTS.allRaresOwned} 光核币。`],
    shop: ['光核币商店', '挑选道具后点「兑换」。持有刮刮卡时，可到同页刮卡台开奖。', '护运签用于竞拍盘查，币牌锁定器在老虎机开转前勾选使用。显示「待开放兑换」的商品是联动占位。'],
    community: ['光核交流站', '打开一条战报讨论，给出你的出价或撤离判断。也可以从结算页发起讨论。', '公开帖子与回复会展示给其他访客。「策略话题」里保存的个人草稿仍保存在当前浏览器。'],
    activity: ['活动与进度', '先点「签到」，再看今天还能领多少参与奖。', `签到、分享和参与奖在北京时间 00:00 刷新。完成至少 ${game.MIN_ELIGIBLE_ROUNDS} 轮、有一笔报价达到该箱起拍价加 ${game.PARTICIPATION_BID_STEP} 筹码并结算，即为有效对局。每天前两场有效局计入里程碑，空手和亏损也适用。`],
    discussion: ['网页讨论', '点一个话题写几句策略，保存草稿后可以复制。', '草稿保存在当前浏览器。要与其他玩家交流，可以进入光核玩家社区官网。'],
    ranking: ['个人排行', '打一场有效对局，回到这里看成绩或打开战报。', '按当前账号或游客档的有效战报和筹码净收益排序。试玩数据可从此处导出。'],
    milestones: ['参与里程碑', '进度达到一档后，点「领取」把奖励存入钱包。', '北京时间每天前两场有效对局会计入进度。累积进度和已经领取的奖励会保存在当前浏览器。'],
  };

  const storage = 'guanghe-guides-v1';
  const getSeen = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storage) || '[]');
      return Array.isArray(saved) ? saved : [];
    }
    catch { return []; }
  };
  const seen = new Set(getSeen());
  const panel = document.createElement('aside');
  panel.id = 'context-help';
  panel.className = 'context-help';
  panel.hidden = true;
  panel.innerHTML = '<h3></h3><p></p><p class="context-detail"></p><div class="context-extra"></div><button type="button" class="text-button context-replay">重看引导</button>';
  document.body.append(panel);
  let anchor;
  let pinned = false;
  let restoring = false;
  let hideTimer;
  let guide;

  function decorate(scope) {
    if (anchor && !anchor.isConnected) close();
    scope.querySelectorAll('[data-help-topic]').forEach(heading => {
      const key = heading.dataset.helpTopic;
      if (!topics[key] || heading.parentElement.classList.contains('help-heading')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'help-heading';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'help-button';
      button.dataset.help = key;
      button.setAttribute('aria-label', `${topics[key][0]}说明`);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', panel.id);
      button.textContent = '?';
      heading.before(wrapper);
      wrapper.append(heading, button);
    });
  }

  function position() {
    if (!anchor?.isConnected || !anchor.getClientRects().length) return close();
    const trigger = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const top = trigger.bottom + height + 8 <= innerHeight ? trigger.bottom + 5 : trigger.top - height - 5;
    const left = buttonIsAtPageEdge() ? trigger.right - width : trigger.left;
    panel.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }

  function buttonIsAtPageEdge() {
    return Boolean(anchor?.closest('.section-head, .hero-copy'));
  }

  function open(button) {
    clearTimeout(hideTimer);
    if (anchor === button) return;
    close();
    anchor = button;
    const [title, , text] = topics[button.dataset.help];
    const host = button.closest('dialog[open]') ?? document.body;
    if (panel.parentNode !== host) host.append(panel);
    panel.querySelector('h3').textContent = title;
    panel.querySelector('p').textContent = text;
    const extra = panel.querySelector('.context-detail');
    extra.textContent = button.previousElementSibling.dataset.helpDetail ?? '';
    extra.hidden = !extra.textContent;
    const template = document.querySelector(`template[data-help-extra="${button.dataset.help}"]`);
    panel.querySelector('.context-extra').replaceChildren(...(template ? [template.content.cloneNode(true)] : []));
    button.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-label', `${title}说明`);
    panel.hidden = false;
    position();
  }

  function close(returnFocus = false) {
    clearTimeout(hideTimer);
    if (!anchor) return;
    const button = anchor;
    anchor = null;
    pinned = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      restoring = true;
      button.focus({ preventScroll: true });
      restoring = false;
    }
  }

  function dismiss() {
    guide?.remove();
    guide = null;
  }

  function teach(button, force = false) {
    const key = button.dataset.help;
    if (!force && seen.has(key)) return;
    dismiss();
    const [, instruction] = topics[key];
    guide = document.createElement('aside');
    guide.className = 'first-guide';
    guide.dataset.guide = key;
    guide.setAttribute('aria-label', '首次引导');
    guide.innerHTML = '<p><strong>上手提示</strong><span></span></p><button class="button subtle small" type="button">知道了</button>';
    guide.querySelector('span').textContent = instruction;
    guide.querySelector('button').addEventListener('click', () => {
      dismiss();
      restoring = true;
      button.focus({ preventScroll: true });
      restoring = false;
    });
    const row = button.closest('.section-head, .dialog-head, .scan-heading, .reveal-result') ?? button.closest('.help-heading');
    row.after(guide);
    if (force) guide.querySelector('button').focus({ preventScroll: true });
    seen.add(key);
    try { localStorage.setItem(storage, JSON.stringify([...new Set([...getSeen(), ...seen])])); } catch { /* Session-only guide progress. */ }
  }

  function visit(key, scope) {
    const button = scope.querySelector(`[data-help="${key}"]`);
    if (button && button.getClientRects().length) teach(button);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const button = event.target.closest('[data-help]');
    if (panel.contains(event.target)) clearTimeout(hideTimer);
    if (button && !pinned) open(button);
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType !== 'mouse' || pinned || !anchor) return;
    const related = event.relatedTarget;
    if ((anchor.contains(event.target) || panel.contains(event.target)) &&
        !(related instanceof Node && (anchor.contains(related) || panel.contains(related)))) {
      hideTimer = setTimeout(() => close(), 180);
    }
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest('[data-help]');
    if (button && !restoring) open(button);
    else if (!panel.contains(event.target)) close();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-help]');
    if (button) {
      if (pinned && button === anchor) close();
      else {
        open(button);
        pinned = true;
        if (event.detail === 0) panel.querySelector('.context-replay').focus({ preventScroll: true });
      }
    } else if (!panel.contains(event.target)) close();
  });
  panel.querySelector('.context-replay').addEventListener('click', () => {
    const button = anchor;
    close();
    if (button?.isConnected) teach(button, true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && anchor) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(panel.contains(document.activeElement));
    }
  }, true);
  root.addEventListener('resize', () => { if (anchor) position(); });
  document.addEventListener('scroll', event => { if (anchor && !panel.contains(event.target)) position(); }, true);

  root.DarkVaultGuide = { decorate, visit, close, dismiss };
})(window);
