(function defineGame(root) {
  'use strict';

  const START_CHIPS = 720;
  const ROUNDS = 5;
  const DURATION = 6 * 60 * 1000;
  const SAVE_VERSION = 2;
  const PARTICIPATION_AWARDS = [40, 20];
  const PARTICIPATION = PARTICIPATION_AWARDS[0];
  const PARTICIPATION_BID_STEP = 10;
  const CHIPS_PER_PROFIT_COIN = 10;
  const PROFIT_COIN_CAP = 100;
  const CHECK_IN = 60;
  const AFK_INTERVAL = 10 * 60_000;
  const AFK_COINS = 1;
  const AFK_LIMIT = 8 * 60 * 60_000;
  const AFK_CAP = (AFK_LIMIT / AFK_INTERVAL) * AFK_COINS;
  const AFK_DAILY_CAP = 72;
  const AFK_RANKS = [
    { name: '基础补给站', threshold: 0, points: 0, cap: 0 },
    { name: '扩容补给站', threshold: 96, points: 1, cap: 6 },
    { name: '中转补给站', threshold: 240, points: 2, cap: 12 },
  ];
  const AFK_CARD_STEP = 96;
  const AFK_POINTS_PER_COIN = 8;
  const SCRATCH_REWARDS = [
    { coins: 3, weight: 60 },
    { coins: 6, weight: 30 },
    { coins: 12, weight: 9 },
    { coins: 30, weight: 1 },
  ];
  const SLOT_COST = 10;
  const SLOT_PAYOUTS = { twoCoins: 8, threeCoins: 32, allRaresOwned: 20 };
  const SLOT_SYMBOLS = [
    { id: 'coin', label: '币牌', chance: 0.5 },
    { id: 'rare', label: '藏品牌', chance: 0.25 },
    { id: 'permit', label: '道具牌', chance: 0.25 },
  ];
  const SHARE = 20;
  const PERMIT_COST = 100;
  const MIN_ELIGIBLE_ROUNDS = 3;
  const SHOP_ITEMS = [
    {
      id: 'escort-permit', name: '护运签', category: '对局道具',
      description: '继续搜仓时，保护本次通行。使用即消耗。',
      price: PERMIT_COST, inventory: 'permits', unit: '张',
      grant(state) { state.permits++; },
    },
    {
      id: 'scratch-card', name: '补给刮刮卡', category: '补给道具',
      description: '刮开兑换 3–30 光核币。离线补给成长也会送卡。',
      price: 12, inventory: 'scratchCards', unit: '张',
      grant(state) { state.scratchCards = (state.scratchCards ?? 0) + 1; },
    },
    {
      id: 'slot-lock', name: '币牌锁定器', category: '老虎机道具',
      description: '转动前可锁定首格币牌。该次只可能获得光核币。',
      price: 6, inventory: 'slotLocks', unit: '个',
      grant(state) { state.slotLocks = (state.slotLocks ?? 0) + 1; },
    },
    {
      id: 'game-resources', name: '游戏内资源', category: '光子联动',
      description: '预留给指定游戏的可兑换资源。可先测试前往光核官网。',
      externalUrl: 'https://guanghe.qq.com/', externalLabel: '测试跳转',
    },
    { id: 'limited-props', name: '限时道具', category: '光子联动', description: '预留给赛季或活动期间开放的游戏道具。' },
    { id: 'player-perks', name: '玩家权益', category: '光子联动', description: '预留给活动联动的玩家权益。' },
  ];
  const MILESTONES = Object.freeze([
    { level: 1, coins: 60, permits: 1 },
    { level: 3, coins: 100, permits: 1 },
    { level: 5, coins: 180, permits: 2 },
  ]);
  const RIVALS = [
    { name: '铁哨', style: '看重货值', mark: '哨' },
    { name: '纸鸢', style: '偏好低价', mark: '鸢' },
    { name: '白栈', style: '起伏较大', mark: '栈' },
  ];
  const CATALOG = [
    ['A-07', '退役航测箱', '海岸测绘站', '防震扣完整，底部有盐蚀', 80, 50, 430, ['老化定位模组', '便携水平仪', '航测镜组', '双轴航姿陀螺', '潮汐星历镜', '精密星位仪']],
    ['B-14', '冷藏转运箱', '北港保税区', '保温层厚重，温标失效', 90, 60, 460, ['空置保温仓', '双联冷阀', '复合温控芯片', '真空温标匣', '低温相变泵', '低温校准核心']],
    ['C-03', '封存样品箱', '材料实验室', '质检封签完整，重心偏左', 150, 100, 590, ['普通晶片样本', '抛光校准片', '光学晶片组', '梯度偏振晶坯', '双相导光晶棱', '无瑕折射晶柱']],
    ['D-21', '设备回收箱', '旧城维修厂', '柜体有划痕，减振槽完整', 70, 40, 390, ['报废电源板', '陶封继电片', '工控检修仪', '多路故障示波芯', '相干故障诊断台', '稀有信号矩阵']],
    ['E-09', '轨道勘探副箱', '丘陵观测台', '加厚合金箱盖，封条褪色', 140, 80, 620, ['磨损的轨迹板', '轨距检尺', '光栅定位台', '三轴基准盘', '干涉测距主镜', '轨道测距阵列']],
    ['F-12', '档案周转箱', '旧码头资料库', '内衬偏软，封装记录缺页', 50, 30, 360, ['空白存档片', '港口值班日志', '航线数据卷', '跨港航标底片', '航路母版底稿', '原始航路图谱']],
    ['G-05', '通讯封装箱', '西线中继站', '角落残留绝缘涂层', 110, 70, 540, ['淘汰信号板', '可调短波线圈', '全频中继器', '跳频校验模块', '多塔相位汇流器', '试制通讯阵列']],
    ['H-18', '陶芯工具箱', '地下设备室', '运输标签要求平放', 100, 60, 480, ['陶瓷边角料', '镶陶切削头', '整套陶芯工具', '微距研磨轴', '无振精磨主轴', '原型精磨机芯']],
  ];
  const MAIN_CATEGORIES = {
    A: ['航测器材', '精密光学件'],
    B: ['温控设备', '环境传感器'],
    C: ['材料样品', '光学样品'],
    D: ['检修仪器', '工业电路'],
    E: ['测距仪器', '定位组件'],
    F: ['航线资料', '数据载体'],
    G: ['通讯设备', '信号处理组件'],
    H: ['精密工具', '加工机芯'],
  };
  const ACCESSORIES = [
    { name: '隔振夹具', categories: ['运输夹具', '金属工具'], quality: 'green', silhouette: 'clamp' },
    { name: '屏蔽接头', categories: ['通讯配件', '供电转接件'], quality: 'blue', silhouette: 'signal' },
    { name: '编织导线', categories: ['线材', '传感配件'], quality: 'white', silhouette: 'wire' },
    { name: '陶瓷垫片', categories: ['绝缘零件', '封装材料'], quality: 'white', silhouette: 'plate' },
  ];
  const GRADES = ['white', 'green', 'blue', 'purple', 'orange', 'red'];
  const GRADE_SPLIT = 0.5;
  const FAMILY_SILHOUETTES = ['optic', 'capsule', 'crystal', 'module', 'optic', 'archive', 'signal', 'module'];
  const COLLECTION_ITEMS = [
    ...CATALOG.flatMap((entry, family) => entry[7].map((name, tier) => ({
      name, quality: GRADES[tier], silhouette: FAMILY_SILHOUETTES[family],
      artId: `${entry[0].toLowerCase()}-${GRADES[tier]}`, category: MAIN_CATEGORIES[entry[0][0]][0], source: entry[2],
    }))),
    ...ACCESSORIES.map(({ name, quality, silhouette, categories }, index) => ({
      name, quality, silhouette, artId: `part-${index + 1}`, category: categories[0], source: '通用货箱配件',
    })),
  ];
  const COLLECTIBLE_NAMES = new Set(COLLECTION_ITEMS.map(item => item.name));
  const BOX_SHAPES = {
    notch: { width: 3, height: 3, label: '凹形', tiles: 7 },
    elbow: { width: 2, height: 3, label: 'L 形', tiles: 4 },
    rectangle: { width: 2, height: 2, label: '方形', tiles: 4 },
    bar: { width: 3, height: 1, label: '长条形', tiles: 3 },
  };
  const PACKINGS = [
    [['notch', 1, 1], ['elbow', 5, 1], ['bar', 2, 4]],
    [['notch', 4, 2], ['rectangle', 1, 1], ['bar', 1, 4]],
    [['notch', 2, 1], ['rectangle', 5, 2], ['bar', 3, 4]],
  ];
  const RISK = [12, 22, 22, 28];
  const LEGACY_RISK = [12, 22, 36, 50];
  const SCENARIOS = [
    { id: 'receiving', name: '卸货站', fee: 0, chips: START_CHIPS, valueScale: 1, redBoost: 0, risk: RISK },
    { id: 'freight', name: '转运库', fee: 10, chips: 820, valueScale: 1.13, redBoost: 0.06, risk: [14, 22, 24, 30] },
    { id: 'sealed', name: '封存仓', fee: 20, chips: 940, valueScale: 1.28, redBoost: 0.12, risk: [16, 24, 28, 34] },
    { id: 'blacksite', name: '黑标库', fee: 35, chips: 1080, valueScale: 1.45, redBoost: 0.20, risk: [18, 28, 32, 40] },
  ];
  const LATE_LOTS = [
    { multiplier: 1.20, green: 0.14, blue: 0.42 },
    { multiplier: 1.30, green: 0.10, blue: 0.42 },
  ];
  const LATE_RECOVERY = 0.70;
  const HISTORY_LIMIT = 20;
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
  });

  function dayKey(now) {
    const fields = Object.fromEntries(dateFormatter.formatToParts(now).map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  function createState() {
    return {
      version: SAVE_VERSION, wallet: 0, permits: 0, checkinDay: '', shareDay: '',
      afkSince: null, afkEarned: 0, afkCoins: 0, afkClaimDay: '', afkClaimedToday: 0,
      afkBonusPoints: 0, afkBonusToday: 0, afkBonusEarned: 0, scratchCards: 0, lastScratch: null, slotLocks: 0,
      participationDay: '', participationToday: 0, milestoneRuns: 0,
      claimed: [], started: 0, finished: 0, eligibleRuns: 0, reportsShared: 0,
      communityVisits: 0, communityOfficialClicks: 0, bestNet: null, history: [], collection: [], run: null, notes: {}, lastSpin: null,
    };
  }

  function displayTag(number) {
    return `AC-${String(number).padStart(4, '0')}`;
  }

  function turnToken(run) {
    return run ? `${run.id}/${run.index}/${run.phase}` : '';
  }

  const roundTen = value => Math.round(value / 10) * 10;
  const findScenario = (id = SCENARIOS[0].id) => SCENARIOS.find(scenario => scenario.id === id);
  const redThreshold = (scenario, index) => {
    const late = LATE_LOTS[index - 3];
    return (late ? late.green + late.blue : 0.8) - scenario.redBoost;
  };
  const redChance = (scenario, index) => Math.round((1 - redThreshold(scenario, index)) * (1 - GRADE_SPLIT) * 1000) / 10;
  const chipsLeft = run => findScenario(run.scenarioId).chips - run.spent;
  const cargoValue = run => run.cargo.reduce((total, item) => total + item.value, 0);
  const runNet = run => cargoValue(run) + run.recovered - run.spent;
  const nextRisk = run => run.cargo.length ? (run.legacyEconomy ? LEGACY_RISK : findScenario(run.scenarioId).risk)[run.index] || 0 : 0;
  const nextRecoveryRate = run => run.index >= 2 && !run.legacyEconomy ? LATE_RECOVERY : 0;
  const participationBidFloor = (lot, legacyEconomy) => lot.reserve + (legacyEconomy ? 0 : PARTICIPATION_BID_STEP);
  const isRedeemable = item => Number.isInteger(item?.price) && item.price > 0 && typeof item.grant === 'function';

  function afkStatus(state, now) {
    const elapsed = Number.isFinite(state.afkSince) ? Math.max(0, now - state.afkSince) : 0;
    const banked = state.afkCoins ?? 0;
    const room = Math.max(0, AFK_CAP - banked);
    const intervals = Math.min(Math.floor(elapsed / AFK_INTERVAL), Math.floor(room / AFK_COINS));
    const coins = banked + intervals * AFK_COINS;
    const full = coins >= AFK_CAP;
    const day = dayKey(now);
    const sameDay = state.afkClaimDay === day;
    const claimedToday = sameDay ? state.afkClaimedToday : 0;
    const claimable = Math.min(coins, Math.max(0, AFK_DAILY_CAP - claimedToday));
    const earned = state.afkEarned ?? 0;
    const after = earned + claimable;
    const bonusToday = sameDay ? state.afkBonusToday ?? 0 : 0;
    let bonusPoints = sameDay ? state.afkBonusPoints ?? 0 : 0;
    let rankIndex = 0;
    let payoutCap = 0;
    // Award points at each base coin's own rank, even if a claim crosses a threshold.
    for (const [index, band] of AFK_RANKS.entries()) {
      if (earned >= band.threshold) rankIndex = index;
      if (after >= band.threshold) payoutCap = band.cap;
      const end = Math.min(after, AFK_RANKS[index + 1]?.threshold ?? after);
      bonusPoints += Math.max(0, end - Math.max(earned, band.threshold)) * band.points;
    }
    const bonus = Math.min(payoutCap, Math.floor(bonusPoints / AFK_POINTS_PER_COIN)) - bonusToday;
    const cards = Math.floor(after / AFK_CARD_STEP) - Math.floor(earned / AFK_CARD_STEP);
    const cardProgress = earned % AFK_CARD_STEP;
    return {
      coins, intervals, full, day, claimedToday, claimable, earned, rankIndex,
      rank: AFK_RANKS[rankIndex], nextRank: AFK_RANKS[rankIndex + 1],
      bonus, bonusToday, bonusPoints, cards, cardProgress,
      nextIn: full ? 0 : AFK_INTERVAL - elapsed % AFK_INTERVAL,
    };
  }

  function rollSymbol(random) {
    let sample = random();
    for (const { id, chance } of SLOT_SYMBOLS) {
      if (sample < chance) return id;
      sample -= chance;
    }
    return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1].id;
  }

  function spinSlots(state, random, lockCoin) {
    const reels = Array.from({ length: 3 }, (_, index) => lockCoin && index === 0 ? 'coin' : rollSymbol(random));
    const result = { reels, coins: 0, permits: 0, collectible: null };
    if (lockCoin) {
      state.slotLocks--;
      result.lockCoin = true;
    }
    const coinsShown = reels.filter(id => id === 'coin').length;
    if (coinsShown === 3) result.coins = SLOT_PAYOUTS.threeCoins;
    else if (coinsShown === 2) result.coins = SLOT_PAYOUTS.twoCoins;
    else if (reels.every(id => id === 'permit')) {
      state.permits++;
      result.permits = 1;
    } else if (reels.every(id => id === 'rare')) {
      const remaining = COLLECTION_ITEMS.filter(item => item.quality === 'red' && !state.collection.includes(item.name));
      if (remaining.length) {
        const drop = remaining[Math.floor(random() * remaining.length)];
        state.collection.push(drop.name);
        result.collectible = drop.name;
      } else result.coins = SLOT_PAYOUTS.allRaresOwned;
    }
    state.wallet += result.coins - SLOT_COST;
    state.lastSpin = result;
  }

  function splitValue(total, accessoryShare) {
    const primary = Math.floor(total * 0.66);
    const accessory = Math.floor(total * accessoryShare);
    return [primary, accessory, total - primary - accessory];
  }

  function boxItems(lot) {
    const family = lot.id[0];
    const template = CATALOG.find(entry => entry[0] === lot.id);
    const tier = template[7].indexOf(lot.contents);
    const seed = family.charCodeAt(0) + lot.value / 10 + lot.scanLow / 10;
    const expanded = lot.expandedGrades === true;
    const hasBlueAccessory = seed % 2 !== 0;
    const accessoryShare = !expanded ? 0.21 : hasBlueAccessory ? 0.13 : 0.17;
    const values = splitValue(lot.value, accessoryShare);
    const minus = splitValue(lot.value - lot.scanLow, accessoryShare);
    const plus = splitValue(lot.scanHigh - lot.value, accessoryShare);
    const accessories = hasBlueAccessory ? ACCESSORIES.slice(0, 2) : ACCESSORIES.slice(2);
    const grade = quality => !expanded && quality === 'white' ? 'green' : quality;
    const contents = [{ name: lot.contents, categories: MAIN_CATEGORIES[family], quality: GRADES[tier] }, ...accessories];
    // A lot's stored identity and value are enough to reconstruct its original scan after refresh.
    return PACKINGS[seed % PACKINGS.length].map(([shape, column, row], index) => ({
      ...contents[index], quality: grade(contents[index].quality), ...BOX_SHAPES[shape], shape, column, row,
      value: values[index], low: values[index] - minus[index], high: values[index] + plus[index],
    }));
  }

  function makeLot(template, random, index, scenario) {
    const [id, name, source, seal, baseReserve, baseLow, baseHigh, contents] = template;
    const late = LATE_LOTS[index - 3];
    const estimateScale = scenario.valueScale * (late?.multiplier ?? 1);
    const reserve = roundTen(baseReserve * scenario.valueScale);
    const low = roundTen(baseLow * estimateScale);
    const high = roundTen(baseHigh * estimateScale);
    const tierRoll = random();
    const tier = tierRoll < (late?.green ?? 0.34) ? 0 : tierRoll < redThreshold(scenario, index) ? 1 : 2;
    const minFraction = [0, 0.34, 0.73][tier];
    const maxFraction = [0.32, 0.72, 1][tier];
    const spread = high - low;
    // Divide each old estimate band using its existing value roll. Total, bids and RNG order stay aligned.
    const valueRoll = random();
    const value = roundTen(low + spread * (minFraction + valueRoll * (maxFraction - minFraction)));
    const appraisal = low + spread * 0.40;
    const bids = [
      roundTen(appraisal * (0.75 + random() * 0.55)),
      roundTen(reserve + (appraisal - reserve) * (0.20 + random() * 0.65)),
      roundTen(appraisal * (0.40 + random() * 1.03)),
    ].map(bid => Math.max(reserve, bid));
    return {
      id, name, source, seal, reserve, low, high, value, bids, scanned: false,
      scanLow: Math.max(low, value - 20 - roundTen(random() * 50)),
      scanHigh: Math.min(high, value + 20 + roundTen(random() * 50)),
      contents: contents[tier * 2 + Number(valueRoll >= GRADE_SPLIT)], expandedGrades: true,
    };
  }

  function startRun(state, now, random, scenario) {
    const shuffled = CATALOG.slice();
    for (let position = shuffled.length - 1; position > 0; position--) {
      const other = Math.floor(random() * (position + 1));
      [shuffled[position], shuffled[other]] = [shuffled[other], shuffled[position]];
    }
    state.started++;
    state.run = {
      id: displayTag(state.started), startedAt: now, expiresAt: now + DURATION,
      scenarioId: scenario.id, entryFee: scenario.fee,
      index: 0, phase: 'auction', scans: 2, spent: 0, cargo: [], seized: [],
      lots: shuffled.slice(0, ROUNDS).map((template, index) => makeLot(template, random, index, scenario)),
      outcomes: [], checkpoint: null, recovered: 0,
    };
  }

  function unlockFromReport(state, report) {
    const seen = new Set(state.collection);
    const added = [];
    for (const box of report.cargo) {
      const outcome = report.outcomes.find(auction => auction.lotId === box.id && auction.won);
      if (!outcome) continue;
      for (const { name } of outcome.items ?? [{ name: outcome.contents }]) {
        if (seen.has(name) || !COLLECTIBLE_NAMES.has(name)) continue;
        added.push(name);
        seen.add(name);
      }
    }
    state.collection.push(...added);
    return added;
  }

  function restoreCollection(state) {
    if (Array.isArray(state.collection)) return state;
    const restored = { ...state, collection: [] };
    for (const report of restored.history) unlockFromReport(restored, report);
    return restored;
  }

  function restoreState(previous, now) {
    const saved = restoreCollection(previous);
    if (saved.version !== 1) return saved;

    // Settle whole legacy intervals at the previous rate, then start accruing at the new rate.
    const elapsed = Number.isFinite(saved.afkSince) ? Math.max(0, now - saved.afkSince) : 0;
    const legacyElapsed = Math.min(elapsed, AFK_LIMIT);
    return {
      ...saved,
      version: SAVE_VERSION,
      milestoneRuns: saved.eligibleRuns,
      participationDay: '', participationToday: 0,
      afkCoins: Math.floor(legacyElapsed / AFK_INTERVAL) * 2,
      afkSince: Number.isFinite(saved.afkSince) ? now - legacyElapsed % AFK_INTERVAL : null,
      afkClaimDay: '', afkClaimedToday: 0,
      run: saved.run ? { ...saved.run, legacyEconomy: true, recovered: 0 } : null,
    };
  }

  function participationProgress(outcomes, legacyEconomy = false) {
    const roundsLeft = Math.max(0, MIN_ELIGIBLE_ROUNDS - outcomes.length);
    const hasBid = outcomes.some(({ bid }) => Number.isInteger(bid) && bid > 0);
    const hasQualifyingBid = legacyEconomy ? hasBid : outcomes.some(outcome =>
      Number.isInteger(outcome.bid) && outcome.bid >= participationBidFloor(outcome, false),
    );
    return { roundsLeft, hasBid, hasQualifyingBid, eligible: roundsLeft === 0 && hasQualifyingBid };
  }

  function participationStatus(state, now) {
    const day = dayKey(now);
    const used = state.participationDay === day ? state.participationToday : 0;
    const remaining = Math.max(0, PARTICIPATION_AWARDS.length - used);
    return { day, used, remaining, nextCoins: PARTICIPATION_AWARDS[used] ?? 0 };
  }

  function settle(state, reason, now) {
    const { run } = state;
    const rounds = run.outcomes.length;
    const gross = cargoValue(run);
    const recovered = run.recovered;
    const net = runNet(run);
    const eligible = participationProgress(run.outcomes, run.legacyEconomy).eligible;
    const reward = participationStatus(state, now);
    const milestoneCredited = eligible && reward.remaining > 0;
    const participation = milestoneCredited ? reward.nextCoins : 0;
    const bonus = Math.min(PROFIT_COIN_CAP, Math.max(0, Math.floor(net / CHIPS_PER_PROFIT_COIN)));
    const report = {
      id: run.id, reason, finishedAt: now, duration: Math.min(DURATION, Math.max(0, now - run.startedAt)),
      rounds, gross, net, recovered, spent: run.spent, participation, bonus, eligible, milestoneCredited,
      scenarioId: run.scenarioId ?? SCENARIOS[0].id, entryFee: run.entryFee ?? 0,
      legacyEconomy: Boolean(run.legacyEconomy),
      cargo: run.cargo, seized: run.seized, outcomes: run.outcomes,
    };
    report.newUnlocks = unlockFromReport(state, report);
    state.wallet += participation + bonus;
    state.finished++;
    if (eligible) state.eligibleRuns++;
    if (milestoneCredited) {
      state.participationDay = reward.day;
      state.participationToday = reward.used + 1;
      state.milestoneRuns++;
    }
    if (rounds > 0) state.bestNet = state.bestNet === null ? net : Math.max(state.bestNet, net);
    state.history.unshift(report);
    state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
    state.run = null;
    return report;
  }

  function reveal(run, bid) {
    const lot = run.lots[run.index];
    const highest = Math.max(...lot.bids);
    const won = bid !== null && bid > highest;
    if (won) {
      run.spent += bid;
      run.cargo.push({ id: lot.id, name: lot.name, value: lot.value, cost: bid });
    }
    run.outcomes.push({
      lotId: lot.id, name: lot.name, contents: lot.contents, value: lot.value, reserve: lot.reserve,
      items: boxItems(lot).map(({ name, value, quality }) => ({ name, value, quality })),
      bid, bids: lot.bids, winner: won ? '你' : RIVALS[lot.bids.indexOf(highest)].name, won,
    });
    run.phase = 'decision';
  }

  function checkpoint(state, usePermit, random) {
    const { run } = state;
    const risk = nextRisk(run);
    const hit = risk > 0 && random() < risk / 100;
    run.checkpoint = risk ? { status: hit ? 'hit' : 'clear', risk } : null;
    if (usePermit) {
      state.permits--;
      run.checkpoint.status = hit ? 'protected' : 'clear-with-permit';
    } else if (hit) {
      const seized = run.cargo.reduce((best, item) => item.value > best.value ? item : best);
      run.cargo = run.cargo.filter(item => item.id !== seized.id);
      run.seized.push(seized);
      run.checkpoint.item = seized;
      const recovered = roundTen(seized.value * nextRecoveryRate(run));
      run.recovered += recovered;
      run.checkpoint.recovered = recovered;
    }
    run.index++;
    run.phase = 'auction';
  }

  function reduce(previous, action, { now = Date.now(), random = Math.random } = {}) {
    const state = restoreState(JSON.parse(JSON.stringify(previous)), now);
    const accepted = (effect, report = null) => ({ state, changed: true, effect, report });
    const refused = message => ({ state: previous, changed: false, message });
    const run = state.run;

    if (run && now >= run.expiresAt) {
      return accepted('settled', settle(state, 'clock', now));
    }

    switch (action.type) {
      case 'start': {
        if (run) return refused('已有一局正在进行。');
        const scenario = findScenario(action.scenarioId);
        if (!scenario) return refused('此竞拍场景暂不可用。');
        if (state.wallet < scenario.fee) return refused(`光核币不足，进入${scenario.name}需要 ${scenario.fee} 光核币。`);
        state.wallet -= scenario.fee;
        startRun(state, now, random, scenario);
        return accepted('started');
      }
      case 'afk-start':
        if (Number.isFinite(state.afkSince)) return refused();
        state.afkSince = now;
        return accepted('afk-started');
      case 'claim-afk': {
        const bank = afkStatus(state, now);
        if (!bank.claimable) return refused(bank.coins ? '今日离线补给已领满，库存可跨日领取。' : '还没有可领取的离线补给。');
        state.afkSince = bank.full ? now : state.afkSince + bank.intervals * AFK_INTERVAL;
        state.afkCoins = bank.coins - bank.claimable;
        state.afkClaimDay = bank.day;
        state.afkClaimedToday = bank.claimedToday + bank.claimable;
        state.afkEarned = bank.earned + bank.claimable;
        state.afkBonusPoints = bank.bonusPoints;
        state.afkBonusToday = bank.bonusToday + bank.bonus;
        state.afkBonusEarned = (state.afkBonusEarned ?? 0) + bank.bonus;
        state.scratchCards = (state.scratchCards ?? 0) + bank.cards;
        const coins = bank.claimable + bank.bonus;
        state.wallet += coins;
        return { ...accepted('afk-claimed'), coins, bonus: bank.bonus, cards: bank.cards };
      }
      case 'scratch-card': {
        if (!state.scratchCards) return refused('当前没有补给刮刮卡。');
        let roll = random() * 100;
        const reward = SCRATCH_REWARDS.find(({ weight }) => (roll -= weight) < 0) ?? SCRATCH_REWARDS[SCRATCH_REWARDS.length - 1];
        state.scratchCards--;
        state.lastScratch = reward.coins;
        state.wallet += reward.coins;
        return { ...accepted('scratch-revealed'), coins: reward.coins };
      }
      case 'spin-slots':
        if (state.wallet < SLOT_COST) return refused('光核币不足，无法转动。');
        if (action.lockCoin && !state.slotLocks) return refused('当前没有币牌锁定器。');
        spinSlots(state, random, action.lockCoin);
        return accepted('slots-spun');
      case 'checkin': {
        const today = dayKey(now);
        if (state.checkinDay === today) return refused('今天已经签到。');
        state.checkinDay = today;
        state.wallet += CHECK_IN;
        return accepted('checked-in');
      }
      case 'report-shared': {
        if (!state.history.some(report => report.id === action.reportId && report.rounds > 0)) {
          return refused('完成至少一轮竞拍即可生成有效战报。');
        }
        const today = dayKey(now);
        state.reportsShared++;
        if (state.shareDay === today) return accepted('shared');
        state.shareDay = today;
        state.wallet += SHARE;
        return accepted('share-reward');
      }
      case 'milestone': {
        const target = MILESTONES.find(item => item.level === action.level);
        if (!target || state.milestoneRuns < target.level) return refused('里程碑尚未达成。');
        if (state.claimed.includes(target.level)) return refused('这档奖励已经领取。');
        state.claimed.push(target.level);
        state.wallet += target.coins;
        state.permits += target.permits;
        return accepted('milestone');
      }
      case 'exchange': {
        const item = SHOP_ITEMS.find(product => product.id === (action.itemId ?? 'escort-permit'));
        if (!isRedeemable(item)) return refused('该商品兑换待开放。');
        if (state.wallet < item.price) return refused('光核币不足。');
        state.wallet -= item.price;
        item.grant(state);
        return { ...accepted('exchanged'), item };
      }
      case 'note': {
        if (!['stop', 'clue', 'loss'].includes(action.topic)) return refused('话题暂不可用。');
        const value = String(action.note ?? '').trim().slice(0, 280);
        if (!value) return refused('写下一点想法再保存。');
        state.notes[action.topic] = { text: value, updatedAt: now };
        return accepted('saved');
      }
      case 'community':
        state.communityVisits++;
        return accepted('visited');
      case 'community-official':
        state.communityOfficialClicks = (state.communityOfficialClicks ?? 0) + 1;
        return accepted('official-clicked');
      case 'tick':
        return refused();
    }

    if (!run || action.token !== turnToken(run)) return refused('对局已更新，请查看当前进度。');
    const lot = run.lots[run.index];
    switch (action.type) {
      case 'scan':
        if (run.phase !== 'auction' || lot.scanned || run.scans < 1) return refused('本轮无法使用勘察。');
        lot.scanned = true;
        run.scans--;
        return accepted('scanned');
      case 'bid':
      case 'pass': {
        if (run.phase !== 'auction') return refused('本轮已揭标。');
        const bid = action.type === 'pass' ? null : action.bid;
        if (action.type === 'bid' && (!Number.isInteger(bid) || bid < lot.reserve || bid % 10 || bid > chipsLeft(run))) {
          return refused('请输入符合起拍价和余额的出价，每次以 10 筹码递增。');
        }
        reveal(run, bid);
        if (run.index + 1 === ROUNDS) return accepted('settled', settle(state, 'limit', now));
        return accepted('revealed');
      }
      case 'continue':
        if (run.phase !== 'decision') return refused('请先完成这一轮。');
        if (action.permit && (!nextRisk(run) || !state.permits)) return refused('当前无法使用护运签。');
        checkpoint(state, Boolean(action.permit), random);
        return accepted('continued');
      case 'extract':
        if (run.phase !== 'decision') return refused('请在一轮竞拍揭标后撤离。');
        return accepted('settled', settle(state, 'extract', now));
      default:
        return refused();
    }
  }

  const api = {
    ROUNDS, START_CHIPS, PARTICIPATION, CHECK_IN, SHARE, PERMIT_COST, MIN_ELIGIBLE_ROUNDS,
    AFK_INTERVAL, AFK_COINS, AFK_LIMIT, AFK_CAP, AFK_DAILY_CAP, AFK_RANKS, AFK_CARD_STEP, afkStatus,
    SCRATCH_REWARDS, SLOT_COST, SLOT_PAYOUTS, SLOT_SYMBOLS,
    SAVE_VERSION, PARTICIPATION_AWARDS, PARTICIPATION_BID_STEP, CHIPS_PER_PROFIT_COIN, PROFIT_COIN_CAP, RISK, LATE_RECOVERY,
    RIVALS, MILESTONES, SHOP_ITEMS, GRADES, COLLECTION_ITEMS, createState, dayKey, turnToken, chipsLeft, cargoValue, nextRisk,
    boxItems, restoreCollection, restoreState, participationBidFloor, participationProgress, participationStatus,
    nextRecoveryRate, runNet, SCENARIOS, findScenario, redChance, isRedeemable, reduce,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DarkVaultGame = api;
})(globalThis);
