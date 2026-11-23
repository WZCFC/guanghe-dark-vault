const BID_TIME = 30_000;
const REVEAL_TIME = 8_000;
const ROOM_ROUNDS = 3;
const ROOM_CAPACITY = 4;
const STARTING_CHIPS = 720;
const ROOM_SCANS = 2;
const ROOM_CODE = /^[A-F0-9]{8}$/;
const ROOM_TOKEN = /^[a-f0-9]{32}$/;
const roomReply = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const roomError = (message, status = 409) => roomReply({ message }, status);
const newMember = (token, seat) => ({ token, seat, spent: 0, value: 0, left: false, bid: undefined });
const roomExpiry = (mode, now) => now + (mode === 'quick' ? 120_000 : 30 * 60_000);

function createRoom(mode, token, now) {
  return {
    code: crypto.randomUUID().slice(0, 8).toUpperCase(), mode, phase: 'lobby', hostSeat: 1,
    players: [newMember(token, 1)], nextSeat: 2, round: 1, lots: [], history: [],
    deadline: 0, expiresAt: roomExpiry(mode, now),
  };
}

function beginRoom(room, now) {
  const game = globalThis.DarkVaultGame;
  const { state } = game.reduce(game.createState(), { type: 'start' }, { now });
  room.lots = state.run.lots.slice(0, ROOM_ROUNDS).map(lot => {
    const { id, name, low, high, reserve, value, scanLow, scanHigh } = lot;
    const pieces = game.boxItems(lot).map(({ quality, column, row, width, height, shape, label, tiles, categories, low, high }) =>
      ({ quality, column, row, width, height, shape, label, tiles, categories, low, high }));
    return { id, name, low, high, reserve, value, scanLow, scanHigh, pieces };
  });
  room.phase = 'bidding';
  room.deadline = now + BID_TIME;
  room.expiresAt = now + 20 * 60_000;
}

function revealRoom(room, now) {
  const lot = room.lots[room.round - 1];
  const { id, name, low, high, reserve, value } = lot;
  const bids = room.players.map(player => ({ seat: player.seat, bid: player.bid ?? null }));
  const highest = Math.max(...bids.map(({ bid }) => bid ?? -1));
  const highestPlayers = bids.filter(({ bid }) => bid === highest);
  const winner = highestPlayers.length === 1 ? highestPlayers[0].seat : null;
  if (winner !== null) {
    const player = room.players.find(({ seat }) => seat === winner);
    player.spent += highest;
    player.value += lot.value;
  }
  room.history.push({ round: room.round, lot: { id, name, low, high, reserve, value }, bids, winner, tie: highestPlayers.length > 1 });
  room.phase = room.round === ROOM_ROUNDS ? 'done' : 'reveal';
  room.deadline = room.phase === 'done' ? 0 : now + REVEAL_TIME;
}

function advanceRoom(room, now) {
  let changed = false;
  while (room.phase === 'bidding' || room.phase === 'reveal') {
    if (room.phase === 'bidding') {
      if (now < room.deadline && !room.players.every(p => p.left || p.bid !== undefined)) break;
      revealRoom(room, Math.min(now, room.deadline));
    } else {
      if (now < room.deadline) break;
      room.round++;
      room.phase = 'bidding';
      room.deadline += BID_TIME;
      for (const player of room.players) delete player.bid;
    }
    changed = true;
  }
  return changed;
}

function roomView(room, token, now) {
  const self = room.players.find(player => player.token === token);
  const lot = room.lots[room.round - 1];
  const scans = self?.scannedRounds ?? [];
  const scan = room.phase === 'bidding' && scans.includes(room.round) && lot.pieces
    ? { low: lot.scanLow, high: lot.scanHigh, pieces: lot.pieces } : null;
  return {
    code: room.code, mode: room.mode, phase: room.phase,
    hostSeat: room.hostSeat, selfSeat: self?.seat, selfBid: self?.bid,
    capacity: room.mode === 'quick' ? 2 : ROOM_CAPACITY,
    round: room.round, rounds: ROOM_ROUNDS, now, deadline: room.deadline,
    lot: lot && { id: lot.id, name: lot.name, reserve: lot.reserve, low: lot.low, high: lot.high },
    scan, scansLeft: ROOM_SCANS - scans.length,
    players: room.players.map(({ seat, spent, value, left, bid }) =>
      ({ seat, left, submitted: bid !== undefined, remaining: STARTING_CHIPS - spent, net: value - spent })),
    latest: room.history[room.history.length - 1] ?? null,
    results: room.phase === 'done' ? room.history : undefined,
  };
}

async function updateRoom(db, row, room) {
  const queued = Number(room.mode === 'quick' && room.phase === 'lobby' && room.players.length > 0);
  const change = await db.prepare(
    'UPDATE online_rooms SET revision = revision + 1, state = ?, queued = ?, expires_at = ? WHERE code = ? AND revision = ?',
  ).bind(JSON.stringify(room), queued, room.expiresAt, row.code, row.revision).run();
  return change.meta.changes === 1;
}

async function newOrMatchedRoom(db, action, token, now) {
  await db.prepare('DELETE FROM online_rooms WHERE expires_at <= ?').bind(now).run();
  const mode = action === 'quick' ? 'quick' : 'private';
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = mode === 'quick' ? await db.prepare(
      'SELECT code, revision, state FROM online_rooms WHERE queued = 1 AND expires_at > ?',
    ).bind(now).first() : null;
    if (row) {
      const room = JSON.parse(row.state);
      if (room.players.some(player => player.token === token)) return roomReply(roomView(room, token, now));
      room.players.push(newMember(token, room.nextSeat++));
      beginRoom(room, now);
      if (await updateRoom(db, row, room)) return roomReply(roomView(room, token, now));
      continue;
    }
    const room = createRoom(mode, token, now);
    const insert = await db.prepare('INSERT OR IGNORE INTO online_rooms VALUES (?, 0, ?, ?, ?)')
      .bind(room.code, Number(mode === 'quick'), room.expiresAt, JSON.stringify(room)).run();
    if (insert.meta.changes === 1) return roomReply(roomView(room, token, now));
  }
  return roomError('房间正在更新，请重试。', 503);
}

function applyRoomAction(room, member, input, now) {
  switch (input.action) {
    case 'start':
      if (room.mode !== 'private' || room.phase !== 'lobby' || member.seat !== room.hostSeat || room.players.length < 2) {
        return roomError('邀请至少一位玩家后，由房主开局。');
      }
      beginRoom(room, now);
      return true;
    case 'bid': {
      if (room.phase !== 'bidding' || input.round !== room.round) return roomError('本轮已结束，请查看最新状态。');
      if (member.bid !== undefined) return roomError('本轮已提交暗标。');
      const reserve = room.lots[room.round - 1].reserve;
      const bid = input.bid;
      if (bid !== null && (!Number.isInteger(bid) || bid % 10 || bid < reserve || bid > STARTING_CHIPS - member.spent)) {
        return roomError('出价须达到起拍价，以 10 筹码为单位，且不超过剩余筹码。', 400);
      }
      member.bid = bid;
      advanceRoom(room, now);
      return true;
    }
    case 'scan': {
      if (room.phase !== 'bidding' || input.round !== room.round || member.bid !== undefined) {
        return roomError('请在本轮提交暗标前扫描。');
      }
      if (!room.lots[room.round - 1].pieces) return roomError('该房间开局时尚未启用扫描。');
      const scanned = member.scannedRounds ?? [];
      if (scanned.includes(room.round)) return false;
      if (scanned.length >= ROOM_SCANS) return roomError('本局扫描次数已用完。');
      member.scannedRounds = [...scanned, room.round];
      return true;
    }
    case 'leave':
      if (room.phase === 'lobby') {
        room.players = room.players.filter(player => player !== member);
        room.hostSeat = room.players[0]?.seat ?? null;
        if (!room.players.length) room.expiresAt = now;
      } else {
        member.left = true;
        advanceRoom(room, now);
      }
      return true;
    default:
      return false;
  }
}

async function roomRequest(request, db) {
  if (request.method !== 'POST') return roomError('请使用 POST。', 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return roomError('访问来源不匹配。', 403);
  if (!db) return roomError('联机房间暂未连接。', 503);
  let input;
  try {
    if (Number(request.headers.get('Content-Length')) > 1000) return roomError('请求太大。', 413);
    const body = await request.text();
    if (body.length > 1000) return roomError('请求太大。', 413);
    input = JSON.parse(body);
  } catch { return roomError('房间请求格式不正确。', 400); }
  const { action, token, code } = input ?? {};
  if (typeof token !== 'string' || !ROOM_TOKEN.test(token)) return roomError('请重新打开联机页。', 400);
  if (action === 'create' || action === 'quick') return newOrMatchedRoom(db, action, token, Date.now());
  if (!['join', 'start', 'bid', 'scan', 'leave', 'status'].includes(action) ||
      typeof code !== 'string' || !ROOM_CODE.test(code)) return roomError('请输入 8 位房间码。', 400);

  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const row = await db.prepare('SELECT code, revision, state FROM online_rooms WHERE code = ? AND expires_at > ?')
      .bind(code, now).first();
    if (!row) return roomError('房间不存在或已过期。', 404);
    const room = JSON.parse(row.state);
    let member = room.players.find(player => player.token === token && !player.left);
    if (action === 'join' && !member) {
      if (room.mode !== 'private' || room.phase !== 'lobby' || room.players.length >= ROOM_CAPACITY) {
        return roomError('此房间已满、已开局或不接受邀请。');
      }
      member = newMember(token, room.nextSeat++);
      room.players.push(member);
      if (!await updateRoom(db, row, room)) continue;
      return roomReply(roomView(room, token, now));
    }
    if (!member) return roomError('此会话未加入该房间。', 403);
    const advanced = advanceRoom(room, now);
    const applied = applyRoomAction(room, member, input, now);
    if ((advanced || applied === true) && !await updateRoom(db, row, room)) continue;
    if (applied instanceof Response) return applied;
    return roomReply(action === 'leave' ? { left: true } : roomView(room, token, now));
  }
  return roomError('房间正在更新，请重试。', 503);
}
