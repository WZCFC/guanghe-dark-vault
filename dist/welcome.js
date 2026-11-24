(function welcome() {
  'use strict';
  const game = window.DarkVaultGame;
  const { safe, signed, scanDetails } = window.DarkVaultViews;
  const root = document.querySelector('#practice-game');
  const fixedTime = Date.now();
  const practiceRandom = () => .42;
  let state;
  let selected = 0;
  const lessons = [
    ['入场与两种钱', '光核币在钱包里，可付入场费、换道具。筹码在这一局里，用它出价。卸货站免费，开局有 720 筹码。其余三档入场要扣 10／20／35 光核币。'],
    ['看线索、扫描与出价', '箱签和公开估价先给你一个大概。每局只有两次扫描，可看到箱内的位置、形状、品质、可能品类与估价。单件信息和全箱估价都是线索。每箱只能交一个暗标，以 10 筹码为步长，也可以放弃。'],
    ['揭标与撤离', '出价最高才拿货、扣筹码；单人与电脑同价时电脑优先。揭标后可以带货撤离，或继续搜仓。持货继续可能遭盘查，护运签保护一次。单人最多五轮，六分钟到时结算。'],
    ['结算与有效对局', '带出货值加盘查返还、再减竞拍成本，得到筹码净收益。每满 10 筹码的正收益可换 1 光核币，单局最多换 100 币。完成至少三轮，至少一次达到起拍价加 10 的出价，并完成结算，才算有效局。每天前两场有效局分别给 40／20 币，空手或亏损也能领。'],
    ['真人竞拍', '快速匹配是两人，好友房可邀请 2–4 人。每人 720 筹码、两次私有扫描，共三轮。每轮 30 秒，提交后等待统一揭标；并列最高则流拍。联机按净收益排名，使用独立筹码。'],
    ['补给、商店与收藏', '补给页可以签到和领取离线资源。基础补给每 10 分钟一枚，库存最多累积 8 小时。领得够多会升级，解锁加成和刮刮卡。商店换护运签、刮刮卡和币牌锁定器；老虎机转一次花 10 币。带出或抽到的藏品可以去收藏室看。'],
    ['账号、战报和问卷', '在「登录」注册账号后，同一账号可换浏览器继续。游客档仍留在原浏览器。结算页可以生成战报或带一箱去交流站，确认发布后其他玩家能看到并回复。打完会提示填写体验问卷，首页也可随时打开。'],
  ];
  document.querySelector('#play-handbook').innerHTML = `<h2>玩法手册</h2>${lessons.map(([title, body]) =>
    `<details><summary>${title}</summary><p>${body}</p></details>`).join('')}`;

  function apply(type, extras = {}) {
    const result = game.reduce(state, { type, token: game.turnToken(state.run), ...extras }, {
      now: fixedTime, random: type === 'continue' ? () => .08 : practiceRandom,
    });
    state = result.state;
    return result;
  }

  function scanGrid(lot) {
    const items = game.boxItems(lot);
    return `<div class="scan-body practice-scan">
      <div class="scan-grid" role="group" aria-label="扫描揭示的货物">${items.map((item, index) =>
        `<button class="scan-piece quality-${item.quality}" type="button" data-practice="piece" data-index="${index}" data-shape="${item.shape}"
           aria-pressed="${index === selected}" aria-label="查看第 ${index + 1} 件货物"
           style="grid-column:${item.column}/span ${item.width};grid-row:${item.row}/span ${item.height};--piece-width:${item.width};--piece-height:${item.height}">${index + 1}</button>`).join('')}</div>
      <div class="scan-detail">${scanDetails(items[selected], selected)}</div>
    </div>`;
  }

  function draw(focus = false) {
    const run = state?.run;
    const report = state?.history[0];
    let title, step, body;
    if (!state) {
      title = '先试一次免费练习';
      step = 0;
      body = '<p>跟着完成查勘、暗标和撤离。练习用的筹码、货物和结果独立于正式对局。</p><button type="button" class="button primary" data-practice="start">打开练习箱</button>';
    } else if (report) {
      title = '结算完成';
      step = 4;
      body = `<p>带出货值 ${report.gross} ＋盘查返还 ${report.recovered} −竞拍成本 ${report.spent} ＝ <strong>${signed(report.net)} 筹码</strong>。</p>
        <p>这是练习结果。正式单人对局中，正收益每满 10 筹码可换 1 光核币。</p>
        <div class="discussion-actions"><a class="button primary" href="#home" data-nav="home">去首页选免费卸货站</a>
        <button type="button" class="button subtle" data-practice="restart">重练一次</button></div>`;
    } else if (run.phase === 'decision') {
      const round = run.outcomes.at(-1);
      title = '揭标后决定去留';
      step = 3;
      body = `<p><strong>${round.won ? '你竞得货箱' : round.bid == null ? '你放弃了货箱' : '电脑竞得货箱'}</strong>。货箱实际值 ${round.value} 筹码，电脑最高价 ${Math.max(...round.bids)}。</p>
        <div class="decision-actions decision-fork">
          <div><span>现在撤离</span><p>净收益 ${signed(game.runNet(run))} 筹码</p><button class="button primary" type="button" data-practice="extract">撤离结算</button></div>
          <div><span>继续搜仓</span><p>${game.nextRisk(run) ? `下一轮盘查概率 ${game.nextRisk(run)}%` : '空手继续没有盘查'}。</p><button class="button subtle" type="button" data-practice="continue">继续搜仓</button></div>
        </div>`;
    } else {
      const lot = run.lots[run.index];
      title = lot.scanned ? '看线索，再决定出价' : '先查勘货箱';
      step = lot.scanned ? 2 : 1;
      body = `<p>第 ${run.index + 1} 轮 · ${safe(lot.name)} · 起拍 ${lot.reserve} 筹码 · 手里剩 ${game.chipsLeft(run)} 筹码</p>
        ${run.checkpoint?.status === 'hit' ? '<p class="checkpoint hit">练习示范触发了盘查，扣留的货箱原价不会退回。</p>' : ''}
        <p>${lot.scanned ? '扫描后估计' : '公开估价'} <strong>${lot.scanned ? lot.scanLow : lot.low}–${lot.scanned ? lot.scanHigh : lot.high}</strong> 筹码。${lot.scanned ? '点一件物件看看可能是什么。' : '扫描能把范围缩小。'}</p>
        ${lot.scanned ? scanGrid(lot) : ''}
        <div class="discussion-actions">${!lot.scanned && run.scans ? `<button class="button subtle" type="button" data-practice="scan">扫描（剩 ${run.scans} 次）</button>` : ''}</div>
        ${game.chipsLeft(run) >= lot.reserve ? `<form class="practice-bid"><label for="practice-price">练习暗标</label>
        <input id="practice-price" name="price" type="number" inputmode="numeric" min="${lot.reserve}" max="${game.chipsLeft(run)}" step="10"
         value="${Math.min(game.chipsLeft(run), lot.reserve + 10)}" required><button type="submit" class="button primary">提交暗标</button></form>` : ''}
        <button class="button subtle small" type="button" data-practice="pass">放弃这箱</button>`;
    }
    const steps = ['准备', '查勘', '出价', '揭标与撤离', '结算'];
    root.innerHTML = `<article class="panel practice-panel"><ol class="practice-progress" aria-label="练习进度">${steps.map((label, index) =>
      `<li${index === step ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol>
      <h2 tabindex="-1">${title}</h2>${body}<p id="practice-error" role="status"></p></article>`;
    if (focus) root.querySelector('h2').focus({ preventScroll: true });
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-practice]');
    if (!button) return;
    const type = button.dataset.practice;
    if (type === 'piece') {
      selected = Number(button.dataset.index);
      const runner = state.run;
      const item = game.boxItems(runner.lots[runner.index])[selected];
      root.querySelector('[aria-pressed="true"]').setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      root.querySelector('.scan-detail').innerHTML = scanDetails(item, selected);
      return;
    }
    selected = 0;
    if (type === 'start' || type === 'restart') {
      state = game.createState();
      apply('start');
    } else apply(type);
    draw(true);
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    const result = apply('bid', { bid: Number(new FormData(event.target).get('price')) });
    if (!result.changed) root.querySelector('#practice-error').textContent = result.message;
    else draw(true);
  });
  draw();
})();
