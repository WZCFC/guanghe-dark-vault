const assert = require('node:assert/strict');
const { test } = require('node:test');
const game = require('./dist/game.js');

const noon = Date.parse('2026-11-19T12:00:00+08:00');
const act = (state, type, detail = {}, random = () => 0.49, now = noon) =>
  game.reduce(state, { type, token: game.turnToken(state.run), ...detail }, { now, random });

test('an outing deals five distinct lots and scans only once per lot', () => {
  let { state } = act(game.createState(), 'start');
  assert.equal(state.run.lots.length, game.ROUNDS);
  assert.equal(new Set(state.run.lots.map(lot => lot.id)).size, game.ROUNDS);
  assert.equal(state.run.expiresAt - state.run.startedAt, 360_000);
  const lot = state.run.lots[0];
  assert.ok(lot.scanLow <= lot.value && lot.scanHigh >= lot.value);
  assert.ok(lot.scanHigh - lot.scanLow < lot.high - lot.low);
  ({ state } = act(state, 'scan'));
  assert.equal(state.run.scans, 1);
  assert.equal(act(state, 'scan').changed, false);
});

test('sealed bids enforce the reserve, increments and budget and charge only the winner', () => {
  const { state } = act(game.createState(), 'start');
  const lot = state.run.lots[0];
  for (const bid of [NaN, lot.reserve - 10, lot.reserve + 1, game.START_CHIPS + 10]) {
    assert.equal(act(state, 'bid', { bid }).changed, false);
  }
  const competition = Math.max(...lot.bids);
  const tied = act(state, 'bid', { bid: competition }).state;
  assert.equal(tied.run.spent, 0);
  const won = act(state, 'bid', { bid: competition + 10 }).state;
  assert.equal(won.run.spent, competition + 10);
  assert.equal(won.run.cargo.length, 1);
  assert.equal(act(won, 'bid', { bid: competition + 10 }).changed, false);
});

test('scenarios expose four entries and charge a selected entry exactly once', () => {
  const fees = game.SCENARIOS.map(scenario => scenario.fee);
  assert.deepEqual(fees, [0, 10, 20, 35]);
  const [standard, , , advanced] = game.SCENARIOS;
  const initial = { ...game.createState(), wallet: advanced.fee - 1 };
  assert.equal(act(initial, 'start', { scenarioId: advanced.id }).changed, false);
  assert.equal(act(initial, 'start', { scenarioId: 'unknown' }).changed, false);
  const funds = { ...initial, wallet: advanced.fee };
  let { state } = act(funds, 'start', { scenarioId: advanced.id }, () => 0.65);
  assert.equal(state.wallet, 0);
  assert.equal(state.run.scenarioId, advanced.id);
  assert.equal(game.chipsLeft(state.run), advanced.chips);
  const normalRun = act(funds, 'start', { scenarioId: standard.id }, () => 0.65).state.run;
  assert.ok(state.run.lots[0].reserve > normalRun.lots[0].reserve);
  assert.equal(game.boxItems(state.run.lots[0])[0].quality, 'red');
  assert.equal(game.boxItems(normalRun.lots[0])[0].quality, 'purple');
  assert.equal(act(state, 'start', { scenarioId: advanced.id }).changed, false);
  const expired = act(state, 'start', { scenarioId: advanced.id }, () => 0.65, noon + 360_000);
  assert.equal(expired.effect, 'settled');
  assert.equal(expired.state.wallet, 0);
  assert.equal(expired.report.scenarioId, advanced.id);
  assert.equal(expired.report.entryFee, advanced.fee);
});

test('paid and free scenarios use one daily participation quota', () => {
  let state = { ...game.createState(), wallet: 100 };
  for (const [index, scenario] of game.SCENARIOS.slice(0, 3).entries()) {
    ({ state } = act(state, 'start', { scenarioId: scenario.id }));
    ({ state } = act(state, 'bid', { bid: state.run.lots[0].reserve + 10 }));
    for (let round = 1; round < 3; round++) {
      ({ state } = act(state, 'continue'));
      ({ state } = act(state, 'pass'));
    }
    ({ state } = act(state, 'extract'));
    assert.equal(state.history[0].participation, [40, 20, 0][index]);
  }
  assert.equal(state.eligibleRuns, 3);
  assert.equal(state.milestoneRuns, 2);
  assert.equal(state.wallet, 130);
});

test('box scans place distinct items and reconcile their ranges with the reveal', () => {
  for (const roll of [0.05, 0.49, 0.91]) {
    const { state } = act(game.createState(), 'start', {}, () => roll);
    for (const lot of state.run.lots) {
      const items = game.boxItems(lot);
      assert.deepEqual(game.boxItems(JSON.parse(JSON.stringify(lot))), items);
      assert.equal(items.length, 3);
      assert.ok(items.some(item => item.shape === 'notch'));
      assert.ok(items.every(item => game.GRADES.includes(item.quality)));
      if (roll > 0.8) assert.equal(items[0].quality, 'red');
      assert.equal(items.reduce((sum, item) => sum + item.value, 0), lot.value);
      assert.equal(items.reduce((sum, item) => sum + item.low, 0), lot.scanLow);
      assert.equal(items.reduce((sum, item) => sum + item.high, 0), lot.scanHigh);
      for (const item of items) {
        assert.ok(item.low >= 0);
        assert.ok(item.low <= item.value && item.value <= item.high);
        assert.ok(item.categories.length >= 2);
        assert.ok(item.column >= 1 && item.column + item.width <= 7);
        assert.ok(item.row >= 1 && item.row + item.height <= 5);
      }
      items.forEach((item, index) => {
        for (const other of items.slice(index + 1)) {
          assert.ok(item.column + item.width <= other.column || other.column + other.width <= item.column ||
            item.row + item.height <= other.row || other.row + other.height <= item.row);
        }
      });
    }
    const lot = state.run.lots[0];
    const { state: revealed } = act(state, 'pass');
    assert.deepEqual(revealed.run.outcomes[0].items, game.boxItems(lot).map(({ name, value, quality }) => ({ name, value, quality })));
  }
});

test('a permit absorbs a checkpoint hit, while an unprotected loss keeps the costs', () => {
  let state = game.createState();
  state.permits = 1;
  ({ state } = act(state, 'start'));
  ({ state } = act(state, 'bid', { bid: Math.max(...state.run.lots[0].bids) + 10 }));
  assert.equal(game.nextRisk(state.run), 12);
  const hit = act(state, 'continue', {}, () => 0).state;
  assert.equal(hit.run.cargo.length, 0);
  assert.equal(hit.run.seized.length, 1);
  assert.equal(hit.run.spent, state.run.spent);
  const protectedRun = act(state, 'continue', { permit: true }, () => 0).state;
  assert.equal(protectedRun.permits, 0);
  assert.equal(protectedRun.run.cargo.length, 1);
  assert.equal(protectedRun.run.seized.length, 0);
});

test('late seizures recover 70% of the highest box in settlement without funding new bids', () => {
  let initial = game.createState();
  initial.permits = 1;
  ({ state: initial } = act(initial, 'start'));
  const held = { id: initial.run.lots[0].id, name: '估值最高的箱', value: 355, cost: 300 };
  initial.run.cargo = [held, { id: initial.run.lots[1].id, name: '另一箱', value: 160, cost: 150 }];
  initial.run.spent = 450;
  initial.run.phase = 'decision';
  for (const [index, risk] of [[2, 22], [3, 28]]) {
    initial.run.index = index;
    assert.equal(game.nextRisk(initial.run), risk);
    const hit = act(initial, 'continue', {}, () => 0).state;
    assert.equal(hit.run.recovered, 250);
    assert.equal(hit.run.checkpoint.recovered, 250);
    assert.equal(game.chipsLeft(hit.run), 270);
    assert.equal(hit.run.seized[0].id, held.id);
    let end = act(hit, 'pass').state;
    if (end.run) end = act(end, 'extract').state;
    assert.equal(end.history[0].gross, 160);
    assert.equal(end.history[0].recovered, 250);
    assert.equal(end.history[0].net, -40);
    const safeRun = act(initial, 'continue', { permit: true }, () => 0).state;
    assert.equal(safeRun.run.recovered, 0);
    assert.equal(safeRun.run.cargo.length, 2);
  }
});

test('collection records the objects actually extracted, including from compatible receipts', () => {
  let { state } = act(game.createState(), 'start');
  const expected = game.boxItems(state.run.lots[0]).map(item => item.name);
  ({ state } = act(state, 'bid', { bid: Math.max(...state.run.lots[0].bids) + 10 }));
  assert.deepEqual(state.collection, []);
  const extracted = act(state, 'extract').state;
  assert.deepEqual(extracted.collection, expected);
  assert.deepEqual(extracted.history[0].newUnlocks, expected);
  const legacy = JSON.parse(JSON.stringify(extracted));
  delete legacy.collection;
  assert.deepEqual(game.restoreCollection(legacy).collection, expected);
  delete legacy.collection;
  delete legacy.history[0].outcomes[0].items;
  assert.deepEqual(game.restoreCollection(legacy).collection, expected.slice(0, 1));
  ({ state } = act(state, 'continue', {}, () => 0));
  ({ state } = act(state, 'pass'));
  ({ state } = act(state, 'extract'));
  assert.deepEqual(state.collection, []);
  let { state: replay } = act(extracted, 'start');
  ({ state: replay } = act(replay, 'bid', { bid: Math.max(...replay.run.lots[0].bids) + 10 }));
  ({ state: replay } = act(replay, 'extract'));
  assert.deepEqual(replay.collection, expected);
  assert.deepEqual(replay.history[0].newUnlocks, []);
  assert.equal(game.COLLECTION_ITEMS.length, 52);
});

test('six main grades follow the estimate bands and preserve locked legacy lots', () => {
  const [, , , top] = game.SCENARIOS;
  const [standard] = game.SCENARIOS;
  assert.deepEqual(game.GRADES.map(grade => game.COLLECTION_ITEMS.filter(item => item.quality === grade).length), [10, 9, 9, 8, 8, 8]);
  assert.deepEqual([game.redChance(standard, 0), game.redChance(standard, 4), game.redChance(top, 0), game.redChance(top, 4)], [10, 24, 20, 34]);
  const mainItems = [0.1, 0.6, 0.1, 0.6, 0.1, 0.6].map((value, index) => {
    const band = [0.1, 0.5, 0.9][Math.floor(index / 2)];
    let call = 0;
    const result = act(game.createState(), 'start', {}, () => (++call === 8 ? band : call === 9 ? value : 0.49));
    return game.boxItems(result.state.run.lots[0])[0];
  });
  assert.deepEqual(mainItems.map(item => item.quality), game.GRADES);
  assert.ok(mainItems.every((item, index) => index === 0 || item.value > mainItems[index - 1].value));
  const legacy = { id: 'C-03', contents: '普通晶片样本', value: 120, scanLow: 100, scanHigh: 160 };
  assert.equal(game.boxItems(legacy)[0].quality, 'green');
  assert.equal(game.boxItems({ ...legacy, expandedGrades: true })[0].quality, 'white');
});

test('participation requires three resolved rounds and a valid bid', () => {
  let { state } = act(game.createState(), 'start');
  const reserve = state.run.lots[0].reserve;
  const oneBid = act(state, 'bid', { bid: reserve + 10 }).state;
  const early = act(oneBid, 'extract').state;
  assert.equal(early.history[0].participation, 0);
  const finish = starting => {
    let next = starting;
    for (let i = 1; i < 3; i++) {
      next = act(next, 'continue').state;
      next = act(next, 'pass').state;
    }
    return act(next, 'extract').state;
  };
  const skipped = finish(act(state, 'pass').state);
  assert.equal(skipped.eligibleRuns, 0);
  assert.equal(skipped.history[0].participation, 0);
  assert.equal(skipped.wallet, 0);
  const reserveOnly = finish(act(state, 'bid', { bid: reserve }).state);
  assert.equal(reserveOnly.history[0].participation, 0);
  assert.equal(reserveOnly.eligibleRuns, 0);
  const outbid = finish(oneBid);
  assert.equal(outbid.eligibleRuns, 1);
  assert.equal(outbid.history[0].cargo.length, 0);
  assert.equal(outbid.history[0].participation, game.PARTICIPATION);
  assert.equal(outbid.history[0].net, 0);
  assert.equal(outbid.run, null);
  assert.equal(act(outbid, 'extract').changed, false);
  const loss = finish(act(state, 'bid', { bid: game.START_CHIPS }).state);
  assert.ok(loss.history[0].net < 0);
  assert.equal(loss.history[0].participation, game.PARTICIPATION);
  assert.equal(loss.wallet, game.PARTICIPATION);
});

test('two settlements award 40 then 20 coins, later settlements still count, and midnight restores the quota', () => {
  const finish = (previous, now) => {
    const step = (state, type, detail) => act(state, type, detail, undefined, now).state;
    let state = step(previous, 'start');
    state = step(state, 'bid', { bid: state.run.lots[0].reserve + 10 });
    for (let i = 1; i < 3; i++) {
      state = step(state, 'continue');
      state = step(state, 'pass');
    }
    return step(state, 'extract');
  };
  const late = Date.parse('2026-11-19T23:56:00+08:00');
  let state = game.createState();
  for (const expected of [40, 20, 0]) {
    state = finish(state, late);
    assert.equal(state.history[0].participation, expected);
    assert.equal(state.history[0].eligible, true);
    assert.equal(state.history[0].milestoneCredited, expected > 0);
  }
  assert.equal(state.wallet, 60);
  assert.equal(state.eligibleRuns, 3);
  assert.equal(state.milestoneRuns, 2);
  assert.equal(act(state, 'milestone', { level: 3 }, undefined, late).changed, false);
  state = finish(state, late + 4 * 60_000);
  assert.equal(state.history[0].participation, 40);
  assert.equal(state.milestoneRuns, 3);
  assert.equal(act(state, 'milestone', { level: 3 }, undefined, late + 4 * 60_000).changed, true);
});

test('five rounds auto-extract and an expired unfinished round settles only completed rounds', () => {
  let { state } = act(game.createState(), 'start');
  for (let index = 0; index < game.ROUNDS; index++) {
    ({ state } = act(state, 'pass'));
    if (index < game.ROUNDS - 1) ({ state } = act(state, 'continue'));
  }
  assert.equal(state.history[0].reason, 'limit');
  assert.equal(state.history[0].rounds, game.ROUNDS);
  assert.equal(state.history[0].participation, 0);
  ({ state } = act(state, 'start'));
  const oldToken = game.turnToken(state.run);
  const timedOut = act(state, 'pass', {}, undefined, state.run.expiresAt).state;
  assert.equal(timedOut.history[0].reason, 'clock');
  assert.equal(timedOut.history[0].rounds, 0);
  assert.equal(timedOut.history[0].participation, 0);
  const restarted = act(timedOut, 'start').state;
  assert.equal(act(restarted, 'pass', { token: oldToken }).changed, false);
});

test('daily rewards use the Shanghai day and never double-claim', () => {
  const before = Date.parse('2026-11-19T15:59:59Z');
  let { state } = act(game.createState(), 'checkin', {}, undefined, before);
  assert.equal(state.wallet, game.CHECK_IN);
  assert.equal(act(state, 'checkin', {}, undefined, before).changed, false);
  ({ state } = act(state, 'checkin', {}, undefined, before + 1000));
  assert.equal(state.wallet, game.CHECK_IN * 2);
  assert.equal(game.dayKey(before), '2026-11-19');
  assert.equal(game.dayKey(before + 1000), '2026-11-20');
});

test('offline allowance accrues across reloads and claims whole intervals exactly once', () => {
  const first = act(game.createState(), 'afk-start', {}, undefined, noon).state;
  assert.equal(act(first, 'afk-start', {}, undefined, noon + 750_000).changed, false);
  assert.equal(act(first, 'claim-afk', {}, undefined, noon + 599_999).changed, false);
  const stored = JSON.parse(JSON.stringify(first));
  const payout = act(stored, 'claim-afk', {}, undefined, noon + 1_250_000);
  assert.equal(payout.coins, 2);
  assert.equal(payout.state.wallet, 2);
  assert.equal(payout.state.afkEarned, 2);
  assert.equal(game.afkStatus(payout.state, noon + 1_250_000).nextIn, 550_000);
  assert.equal(act(payout.state, 'claim-afk', {}, undefined, noon + 1_250_000).changed, false);
  const next = act(payout.state, 'claim-afk', {}, undefined, noon + 1_800_000);
  assert.equal(next.state.wallet, 3);
});

test('offline allowance stops accruing at eight hours and restarts when claimed', () => {
  const legacy = game.createState();
  delete legacy.afkSince;
  delete legacy.afkEarned;
  legacy.wallet = 60;
  const first = act(legacy, 'afk-start', {}, undefined, noon).state;
  const later = noon + 25 * 60 * 60 * 1000;
  assert.equal(game.afkStatus(first, later).coins, 48);
  const claim = act(first, 'claim-afk', {}, undefined, later);
  assert.equal(claim.state.wallet, 108);
  assert.equal(claim.state.afkSince, later);
  assert.equal(game.afkStatus(claim.state, later).coins, 0);
  assert.equal(game.afkStatus(claim.state, later - 60_000).coins, 0);
});

test('the 72-coin offline limit preserves unused inventory for the next Shanghai day', () => {
  const start = Date.parse('2026-11-19T07:59:00+08:00');
  const eightHours = 8 * 3_600_000;
  let { state } = act(game.createState(), 'afk-start', {}, undefined, start);
  const initialClaim = act(state, 'claim-afk', {}, undefined, start + eightHours);
  assert.equal(initialClaim.coins, 48);
  const secondTime = start + 2 * eightHours;
  ({ state } = act(initialClaim.state, 'claim-afk', {}, undefined, secondTime));
  assert.equal(state.wallet, 72);
  assert.equal(game.afkStatus(state, secondTime).coins, 24);
  assert.equal(game.afkStatus(state, secondTime).claimable, 0);
  assert.equal(act(state, 'claim-afk', {}, undefined, secondTime).changed, false);
  const midnightClaim = act(state, 'claim-afk', {}, undefined, secondTime + 60_000);
  assert.equal(midnightClaim.coins, 24);
  assert.equal(midnightClaim.state.wallet, 96);
});

test('upgrading preserves an earned legacy offline bank, claimed rewards and the booked run', () => {
  let { state } = act(game.createState(), 'start');
  state = {
    ...state, version: 1, wallet: 91, claimed: [1], eligibleRuns: 4,
    afkSince: noon - 9 * 3_600_000, afkEarned: 80,
  };
  const upgraded = game.restoreState(state, noon);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.wallet, 91);
  assert.deepEqual(upgraded.claimed, [1]);
  assert.equal(upgraded.milestoneRuns, 4);
  assert.deepEqual(upgraded.run.lots, state.run.lots);
  assert.equal(upgraded.run.legacyEconomy, true);
  assert.equal(upgraded.afkEarned, 80);
  assert.equal(game.afkStatus(upgraded, noon).coins, 96);
  const payout = act(upgraded, 'claim-afk').state;
  assert.equal(payout.wallet, 169);
  assert.equal(payout.afkEarned, 152);
  assert.equal(payout.scratchCards, 1);
  assert.equal(game.afkStatus(payout, noon).coins, 24);
  assert.equal(game.restoreState(payout, noon).afkCoins, 24);
  assert.equal(state.version, 1);
});

test('slot patterns debit once and grant the corresponding currency, collectible, or item', () => {
  const spin = (wallet, rolls, collection = []) => {
    const state = { ...game.createState(), wallet, collection };
    let index = 0;
    return act(state, 'spin-slots', {}, () => rolls[index++]);
  };
  assert.equal(spin(9, [0, 0, 0]).changed, false);
  const triples = spin(10, [0, 0, 0]).state;
  assert.equal(triples.wallet, 32);
  assert.deepEqual(triples.lastSpin.reels, ['coin', 'coin', 'coin']);
  assert.equal(spin(10, [0.91, 0, 0]).state.wallet, 8);
  const item = spin(10, [0.99, 0.99, 0.99]).state;
  assert.equal(item.wallet, 0);
  assert.equal(item.permits, 1);
  const reds = game.COLLECTION_ITEMS.filter(entry => entry.quality === 'red').map(entry => entry.name);
  const rare = spin(10, [0.65, 0.65, 0.65, 0], [reds[0]]).state;
  assert.equal(rare.wallet, 0);
  assert.deepEqual(rare.collection, reds.slice(0, 2));
  assert.equal(rare.lastSpin.collectible, reds[1]);
  assert.equal(spin(10, [0.65, 0.65, 0.65], reds).state.wallet, 20);
  const miss = spin(10, [0, 0.65, 0.91]).state;
  assert.equal(miss.wallet, 0);
  assert.deepEqual(miss.lastSpin, { reels: ['coin', 'rare', 'permit'], coins: 0, permits: 0, collectible: null });
});

test('offline upgrades honor old progress and compute the same payout across split claims', () => {
  const old = { ...game.createState(), afkEarned: 230, afkSince: noon };
  const all = act({ ...old, afkCoins: 48 }, 'claim-afk').state;
  const first = act({ ...old, afkCoins: 10 }, 'claim-afk').state;
  const rest = act({ ...first, afkCoins: 38 }, 'claim-afk').state;
  assert.equal(first.wallet, 11);
  assert.equal(game.afkStatus(first, noon).rankIndex, 2);
  assert.equal(all.wallet, 58);
  assert.equal(all.wallet, rest.wallet);
  assert.equal(all.afkBonusEarned, rest.afkBonusEarned);
  assert.equal(all.afkEarned, 278);
  assert.equal(all.scratchCards, 0);

  const nearCard = { ...all, afkCoins: 10 };
  const grant = act(nearCard, 'claim-afk');
  assert.equal(grant.cards, 1);
  assert.equal(grant.bonus, 2);
  assert.equal(grant.state.scratchCards, 1);
  assert.equal(grant.state.afkEarned, 288);
  assert.equal(game.afkStatus(grant.state, noon).cardProgress, 0);
  assert.equal(act(grant.state, 'claim-afk').changed, false);
});

test('growth bonuses cap at six or twelve and Beijing midnight resets the daily counters', () => {
  const supply = { ...game.createState(), afkSince: noon, afkCoins: 75 };
  const middle = act({ ...supply, afkEarned: 96 }, 'claim-afk');
  assert.equal(middle.coins, 78);
  assert.equal(middle.bonus, 6);
  assert.equal(middle.cards, 0);
  const mature = act({ ...supply, afkEarned: 240 }, 'claim-afk');
  assert.equal(mature.coins, 84);
  assert.equal(mature.cards, 1);
  assert.equal(game.afkStatus(mature.state, noon).claimable, 0);
  const midnight = Date.parse('2026-11-20T00:00:00+08:00');
  const nextDay = act({ ...mature.state, afkSince: midnight, afkCoins: 4 }, 'claim-afk', {}, undefined, midnight);
  assert.equal(nextDay.coins, 5);
  assert.equal(nextDay.state.afkBonusToday, 1);
  assert.equal(nextDay.state.afkBonusEarned, 13);
});

test('scratch cards debit inventory and pay only the configured currency tiers', () => {
  const old = { ...game.createState(), wallet: 12 };
  delete old.scratchCards;
  assert.equal(act(old, 'scratch-card').changed, false);
  const bought = act(old, 'exchange', { itemId: 'scratch-card' }).state;
  assert.equal(bought.wallet, 0);
  assert.equal(bought.scratchCards, 1);
  assert.equal(act(bought, 'exchange', { itemId: 'scratch-card' }).changed, false);
  for (const [roll, coins] of [[0.5999, 3], [0.6, 6], [0.9, 12], [0.99, 30]]) {
    const opened = act(bought, 'scratch-card', {}, () => roll).state;
    assert.equal(opened.wallet, coins);
    assert.equal(opened.lastScratch, coins);
    assert.equal(opened.permits, 0);
    assert.deepEqual(opened.collection, []);
    assert.equal(act(opened, 'scratch-card').changed, false);
  }
});

test('optional reel locks affect one spin and cannot create auction permits or red drops', () => {
  const old = { ...game.createState(), wallet: 16 };
  delete old.slotLocks;
  const lockedSpin = { lockCoin: true };
  assert.equal(act(old, 'spin-slots', lockedSpin).changed, false);
  const stocked = act(old, 'exchange', { itemId: 'slot-lock' }).state;
  assert.equal(stocked.wallet, 10);
  assert.equal(act({ ...stocked, wallet: 9 }, 'spin-slots', lockedSpin).changed, false);
  for (const [roll, id] of [[0.1, 'coin'], [0.6, 'rare'], [0.9, 'permit']]) {
    const used = act(stocked, 'spin-slots', lockedSpin, () => roll).state;
    assert.equal(used.slotLocks, 0);
    assert.deepEqual(used.lastSpin.reels, ['coin', id, id]);
    assert.equal(used.wallet, id === 'coin' ? 32 : 0);
    assert.equal(used.permits, 0);
    assert.deepEqual(used.collection, []);
  }
  const regular = act(stocked, 'spin-slots', {}, () => 0.9).state;
  assert.equal(regular.slotLocks, 1);
  assert.equal(regular.permits, 1);
});

test('milestone and report reward require actual play and maintain the exchange balance', () => {
  let state = game.createState();
  assert.equal(act(state, 'report-shared').changed, false);
  assert.equal(act(state, 'milestone', { level: 1 }).changed, false);
  ({ state } = act(state, 'start'));
  for (let index = 0; index < game.ROUNDS; index++) {
    if (index === 0) ({ state } = act(state, 'bid', { bid: state.run.lots[0].reserve + 10 }));
    else ({ state } = act(state, 'pass'));
    if (index < game.ROUNDS - 1) ({ state } = act(state, 'continue'));
  }
  ({ state } = act(state, 'milestone', { level: 1 }));
  assert.equal(state.permits, 1);
  assert.equal(act(state, 'milestone', { level: 1 }).changed, false);
  ({ state } = act(state, 'report-shared', { reportId: state.history[0].id }));
  const copiedAgain = act(state, 'report-shared', { reportId: state.history[0].id }).state;
  assert.equal(copiedAgain.wallet, state.wallet);
  assert.equal(copiedAgain.reportsShared, 2);
  const oldWallet = state.wallet;
  assert.equal(act(state, 'exchange', { itemId: 'game-resources' }).changed, false);
  assert.equal(act(state, 'exchange', { itemId: 'unknown' }).changed, false);
  assert.equal(act(game.createState(), 'exchange', { itemId: 'escort-permit' }).changed, false);
  ({ state } = act(state, 'exchange', { itemId: 'escort-permit' }));
  assert.equal(state.wallet, oldWallet - game.PERMIT_COST);
  assert.equal(state.permits, 2);
});
