require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const Anthropic = require('@anthropic-ai/sdk').default;
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const G = require('./gamedata');
const { planGive } = require('./give');
// prompt.js is the hand-written persona (editable from the admin panel); the appendix is
// generated from the server's own data (command syntax, gamerule names).
const SYSTEM_PROMPT = require('./prompt') + '\n\n' + G.promptAppendix;
const TOOLS = require('./tools');

const LOG_FILE = '/home/minecraft/server/logs/latest.log';
const SERVER_PROPS = '/home/minecraft/server/server.properties';
const MODEL = 'claude-haiku-5-5';
// Haiku 5.5 thinks adaptively by default; effort is the knob (its default is also medium).
// Anthropic's Haiku 5.5 guide: low skips searches and leaks reasoning into replies more.
const EFFORT = 'medium';
const MAX_MSG_LEN = 300;
const TOOL_COOLDOWN_MS = 5 * 1000;
const HOURLY_LIMIT = 60;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — refusing to start');
  process.exit(1);
}

const client = new Anthropic();

const online = new Set();
const lastTool = new Map();
const hourly = new Map();
const history = new Map();
const MAX_HISTORY = 20;
const globalHistory = [];
const MAX_GLOBAL = 10;
const chatTail = [];
const MAX_CHAT_TAIL = 15;

function recordChat(type, author, text) {
  chatTail.push({ t: Date.now(), type, author, text: String(text).slice(0, 180) });
  while (chatTail.length > MAX_CHAT_TAIL) chatTail.shift();
}

function formatApiError(err) {
  const status = err?.status ?? '?';
  const type = err?.error?.error?.type || err?.error?.type;
  const short = {
    overloaded_error: 'overloaded',
    rate_limit_error: 'rate-limited',
    authentication_error: 'auth-failed',
    invalid_request_error: 'bad-request',
    api_error: 'api-error',
    timeout_error: 'timeout',
  }[type] || type || (err?.message ? String(err.message).slice(0, 30) : 'unknown');
  return `[${status} ${short}]`;
}

function formatChatTail() {
  if (!chatTail.length) return '';
  const now = Date.now();
  const lines = chatTail.map((e) => {
    const ageSec = Math.floor((now - e.t) / 1000);
    const ago = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
    const txt = String(e.text).replace(/\s+/g, ' ');
    if (e.type === 'chat')  return `  [${ago} ago] <${e.author}> ${txt}`;
    if (e.type === 'join')  return `  [${ago} ago] ${e.author} joined the server`;
    if (e.type === 'leave') return `  [${ago} ago] ${e.author} left the server`;
    return `  [${ago} ago] ${e.author} ${txt}`;
  });
  return `Recent in-game chat & events:\n${lines.join('\n')}\n`;
}

function summarizeTool(block) {
  const n = block.name;
  const i = block.input || {};
  switch (n) {
    case 'mc_say':          return `[said] "${String(i.message || '').slice(0, 150)}"`;
    case 'mc_tp':           return `[teleported ${i.player} -> ${i.target}]`;
    case 'mc_tp_coords':    return `[teleported ${i.target} to ${i.x},${i.y},${i.z}${i.dimension ? ' (' + i.dimension + ')' : ''}]`;
    case 'mc_tp_spawn':     return `[teleported ${i.target || 'them'} to their spawnpoint]`;
    case 'mc_difficulty':   return `[set difficulty to ${i.difficulty}]`;
    case 'mc_weather':      return `[set weather to ${i.weather}]`;
    case 'mc_time':         return `[set time to ${i.time}]`;
    case 'mc_effect':       return `[gave ${i.target || 'them'} ${i.effect} for ${i.duration}s amp=${i.amplifier || 0}]`;
    case 'mc_summon':       return `[summoned ${i.mob}${i.target ? ' on ' + i.target : ''}]`;
    case 'mc_summon_hostile': return `[summoned hostile ${i.mob}${i.target ? ' on ' + i.target : ''}]`;
    case 'mc_lightning':    return `[struck lightning on ${i.target}]`;
    case 'mc_give_common':  return `[gave ${i.target || 'them'} ${i.count} ${i.item}]`;
    case 'mc_give_rare':    return `[gave ${i.target || 'them'} ${i.count} ${i.item} (rare!)]`;
    case 'mc_give_any':     return `[gave ${i.target || 'the Don'} ${i.count} ${i.item}${i.components ? `[${i.components}]` : ''} (owner give)]`;
    case 'mc_query':        return `[queried ${i.target}'s ${i.aspect}]`.replace('[queried', '[looked up');
    default:                return `[did ${n}]`;
  }
}

// Paper formats `data get entity <p> respawn.pos` as `[I; -218, 104, 1587]` (modern int-array NBT).
// Some versions may print `[-218, 104, 1587]` without the prefix. Handle both.
function parseRespawnPos(raw) {
  if (!raw) return null;
  const m = raw.match(/-?\d+/g);
  if (!m || m.length < 3) return null;
  // The first match might be the array-type prefix digit (e.g. `[I;` has no digits, so first 3 numerics are coords).
  const nums = m.slice(-3).map(Number);
  if (nums.some((n) => !isFinite(n))) return null;
  return { x: nums[0], y: nums[1], z: nums[2] };
}

// Pending nearby-query resolvers. The TonyBcast plugin replies with a single
// log line `[TonyQuery] nearby <player>: 5 cow, 3 pig, ...` per command.
const pendingNearbyQueries = [];

function collectNearbyEntities(target, distance = 32) {
  return new Promise((resolve) => {
    const entry = { target, resolve: null };
    const timer = setTimeout(() => {
      const i = pendingNearbyQueries.indexOf(entry);
      if (i >= 0) pendingNearbyQueries.splice(i, 1);
      resolve([]);
    }, 3000);
    entry.resolve = (v) => { clearTimeout(timer); resolve(v); };
    pendingNearbyQueries.push(entry);
    sendCmd(`tonyquery nearby ${target} ${distance}`);
  });
}

function dataGetEntity(player, path) {
  return new Promise((resolve) => {
    const entry = { player, resolve: null };
    const timer = setTimeout(() => {
      const i = pendingQueries.indexOf(entry);
      if (i >= 0) pendingQueries.splice(i, 1);
      resolve(null);
    }, 3000);
    entry.resolve = (v) => { clearTimeout(timer); resolve(v); };
    pendingQueries.push(entry);
    sendCmd(path ? `data get entity ${player} ${path}` : `data get entity ${player}`);
  });
}

async function runQuery(target, aspect) {
  if (!NAME_RE.test(target)) return `ERROR: invalid player name.`;
  if (!online.has(target)) return `ERROR: ${target} is not online.`;
  if (aspect === 'location') {
    // Serialize: parallel reads for same player race in the FIFO matcher.
    const pos = await dataGetEntity(target, 'Pos');
    const dim = await dataGetEntity(target, 'Dimension');
    if (!pos && !dim) return 'ERROR: query timed out.';
    return `${target} — dimension: ${dim || '?'}  position: ${pos || '?'}`;
  }
  if (aspect === 'held_item') {
    const item = await dataGetEntity(target, 'SelectedItem');
    if (!item) return `${target} is holding nothing (or query timed out).`;
    return `${target} is holding: ${item.slice(0, 1500)}`;
  }
  if (aspect === 'inventory') {
    const inv = await dataGetEntity(target, 'Inventory');
    if (!inv) return `${target}'s inventory: query timed out or empty.`;
    return `${target}'s inventory: ${inv.slice(0, 2500)}`;
  }
  if (aspect === 'last_death') {
    const d = await dataGetEntity(target, 'LastDeathLocation');
    if (!d) return `${target} has no recorded LastDeathLocation — either they haven't died yet (or not since 1.19), or the query timed out.`;
    return `${target}'s last death location NBT: ${d.slice(0, 500)}`;
  }
  if (aspect === 'nearby_entities') {
    const results = await collectNearbyEntities(target, 32);
    if (!results.length) return `No mobs within 32 blocks of ${target}.`;
    const summary = results
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${n}× ${type}`)
      .join(', ');
    return `Within 32 blocks of ${target}: ${summary}.`;
  }
  if (aspect === 'spawn') {
    // Serialize: dataGetEntity FIFO-matches by player name, so parallel reads
    // for the same player race against each other and can swap their values.
    const posRaw = await dataGetEntity(target, 'respawn.pos');
    const dimRaw = await dataGetEntity(target, 'respawn.dimension');
    const coords = parseRespawnPos(posRaw);
    if (!coords) {
      return `${target} has no spawnpoint set — they haven't slept in a bed or charged a respawn anchor yet. They'd respawn at world spawn.`;
    }
    const dim = (dimRaw || '"minecraft:overworld"').replace(/^"|"$/g, '');
    return `${target}'s spawnpoint: dimension ${dim}, position [${coords.x}, ${coords.y}, ${coords.z}]`;
  }
  return 'unknown aspect';
}

function recordExchange(caller, userText, responseContent) {
  const parts = [];
  for (const b of responseContent || []) {
    if (b.type === 'tool_use') parts.push(summarizeTool(b));
  }
  if (!parts.length) return;
  const assistant = parts.join(' ');
  const list = history.get(caller) || [];
  list.push({ user: userText, assistant });
  while (list.length > MAX_HISTORY) list.shift();
  history.set(caller, list);

  globalHistory.push({ t: Date.now(), caller, user: userText, assistant });
  while (globalHistory.length > MAX_GLOBAL) globalHistory.shift();
}

function formatGlobalContext() {
  if (!globalHistory.length) return '';
  const now = Date.now();
  const lines = globalHistory.map((e) => {
    const ageSec = Math.floor((now - e.t) / 1000);
    const ago = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
    const u = String(e.user).replace(/\s+/g, ' ').slice(0, 120);
    const a = String(e.assistant).replace(/\s+/g, ' ').slice(0, 120);
    return `  [${ago} ago] <${e.caller}> "${u}" -> you ${a}`;
  });
  return `Recent @tony activity across the server (for context):\n${lines.join('\n')}\n`;
}

// Floodgate prefixes Bedrock player names with `.` by default. Optional
// leading `.` is allowed in all player-name patterns so Bedrock players are
// tracked the same way as Java players.
// Bedrock/Floodgate chat lines come through Paper with a "[Not Secure] "
// prefix (unsigned messages). Match with or without it so both Java and
// Bedrock players reach the bot.
// Minecraft 26.3+ logs joins/leaves and console-command output as
// "[Server thread/INFO]: System chat: <text>"; 26.1 had no prefix. Every
// server-thread pattern below accepts both, or Tony's online roster stays empty.
const CHAT_RE = /\[Async Chat Thread[^\]]*\/INFO\]:\s*(?:\[Not Secure\]\s*)?<([^>]+)>\s*(.+)$/;
const JOIN_RE = /\/INFO\]:\s+(?:System chat:\s+)?(\.?\w{2,16}) joined the game\s*$/;
const LEAVE_RE = /\/INFO\]:\s+(?:System chat:\s+)?(\.?\w{2,16}) left the game\s*$/;
const LIST_RE = /\/INFO\]:\s+(?:System chat:\s+)?There are \d+ of a max of \d+ players online:\s*(.*)$/;
const DATA_RE = /\[Server thread\/INFO\]:\s+(?:System chat:\s+)?(\.?\w{2,16}) has the following entity data:\s*(.+)$/;
// TonyBcast plugin's /tonyquery nearby reply: `[TonyQuery] nearby <player>: 5 cow, 3 pig, ...` or `none` or `ERROR ...`
const NEARBY_RE = /\[TonyBcast\]\s+\[TonyQuery\]\s+nearby\s+(\S+):\s+(.+)$/;
// matches player death / event announcements; used after all the more-specific patterns above
const EVENT_RE = /\[Server thread\/INFO\]:\s+(?:System chat:\s+)?(\.?\w{2,16})\s+(.+)$/;
const TRIGGER_RE = /@(server|claude|tony|tone)\b/i;
const NAME_RE = /^\.?[A-Za-z0-9_]{2,16}$/;
const OWNER = 'Dopperator';

const pendingQueries = [];

function log(...args) { console.log(new Date().toISOString(), ...args); }

function sendCmd(cmd) {
  // Wrap screen in prlimit --nofile=4096. The bot's nofile soft limit is the
  // kernel maximum (~1 billion) on modern systems, and screen does a "close
  // all inherited FDs" loop on startup that takes ~9 seconds when the limit
  // is that high. prlimit caps the child's FD ceiling so the close-loop is
  // instant.
  return new Promise((resolve) => {
    const p = spawn('prlimit', ['--nofile=4096', '--', 'screen', '-S', 'minecraft', '-p', '0', '-X', 'stuff', cmd + '\r']);
    p.on('error', (e) => { log('screen error:', e.message); resolve(); });
    p.on('exit', (code) => {
      if (code !== 0) log(`screen exited non-zero (${code}) for: ${cmd.slice(0, 80)}`);
      resolve();
    });
  });
}

// RCON, for commands whose reply matters or that are too long for screen's stuff
// buffer (bulk gives). One connection per batch; each command gets one reply packet.
function rcon(cmds) {
  const props = fs.readFileSync(SERVER_PROPS, 'utf8');
  const pw = props.match(/^rcon\.password=(.*)$/m)[1].trim();
  const port = Number(props.match(/^rcon\.port=(\d+)$/m)[1]);
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0), i = -1;
    const out = [];
    const send = (id, type, body) => {
      const b = Buffer.from(body, 'utf8');
      const p = Buffer.alloc(14 + b.length);
      p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8); b.copy(p, 12);
      sock.write(p);
    };
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')); }, 15000);
    const next = () => {
      i++;
      if (i < cmds.length) return send(i + 1, 2, cmds[i]);
      clearTimeout(timer); sock.end(); resolve(out);
    };
    sock.on('connect', () => send(0, 3, pw));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const body = buf.subarray(12, 4 + len - 2).toString('utf8').replace(/\u00A7./g, '');
        buf = buf.subarray(4 + len);
        if (id === -1) { clearTimeout(timer); sock.destroy(); return reject(new Error('rcon auth failed')); }
        if (i >= 0) out.push(body);
        next();
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function tellraw(player, text, color = 'yellow') {
  // private message, for cooldown / validation feedback only
  const payload = JSON.stringify({ text, color });
  return sendCmd(`tellraw ${player} ${payload}`);
}

async function sayPublic(addressee, text, color = 'light_purple') {
  // Routes through the TonyBcast plugin which uses Paper's Component API
  // directly — bypasses the broken tellraw command parser in Paper 26.1.2-12.
  // screen's `stuff` buffer truncates commands around ~240 bytes, so we chunk
  // long messages.
  const scrub = (s) => String(s).replace(/[\u00A7\r\n\x00-\x1F]/g, '');
  const cleanColor = String(color).replace(/[^a-zA-Z0-9_#]/g, '') || 'light_purple';
  const addr = scrub(addressee);
  const full = scrub(text);
  // Prefix overhead: `tonybcast <color> <addr> ` -> cap message per chunk
  const overhead = `tonybcast ${cleanColor} ${addr} `.length;
  const budget = Math.max(50, 220 - overhead);
  if (full.length <= budget) {
    return sendCmd(`tonybcast ${cleanColor} ${addr} ${full}`);
  }
  // Split at word boundary; up to 4 chunks then truncate with ellipsis
  const chunks = [];
  let rem = full;
  while (rem.length > 0 && chunks.length < 4) {
    if (rem.length <= budget) { chunks.push(rem); break; }
    let cut = rem.lastIndexOf(' ', budget);
    if (cut < budget * 0.5) cut = budget;
    chunks.push(rem.slice(0, cut).trim());
    rem = rem.slice(cut).trim();
  }
  if (rem.length > 0 && chunks.length >= 4) {
    chunks[3] = chunks[3].slice(0, budget - 3).trim() + '...';
  }
  for (const c of chunks) {
    await sendCmd(`tonybcast ${cleanColor} ${addr} ${c}`);
  }
}

function sanitizePlayer(n) {
  if (typeof n !== 'string') return null;
  return NAME_RE.test(n) ? n : null;
}

function sanitizeMessage(s) {
  return String(s || '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .slice(0, MAX_MSG_LEN)
    .trim();
}

async function executeTool(name, input, caller, requestNow) {
  // `requestNow` is the fixed timestamp for THIS @tony request. Using it ensures
  // all action-tool calls within a single response share the same cooldown
  // decision — they all pass or all fail together, instead of the second one
  // in a rapid pair getting cooldown-rejected by the first one's update.
  const now = requestNow || Date.now();
  const isOwner = caller === OWNER;
  if (name !== 'mc_say' && !isOwner) {
    const last = lastTool.get(caller) || 0;
    if (now - last < TOOL_COOLDOWN_MS) {
      const wait = Math.ceil((TOOL_COOLDOWN_MS - (now - last)) / 1000);
      await sayPublic(caller, `cooldown. wait ${wait}s.`, 'yellow');
      return;
    }
  }

  switch (name) {
    case 'mc_say': {
      const msg = sanitizeMessage(input.message).slice(0, 200);
      if (!msg) return;
      await sayPublic(caller, msg);
      return;
    }

    case 'mc_tp': {
      const p = sanitizePlayer(input.player);
      const t = sanitizePlayer(input.target);
      if (!p || !t) return sayPublic(caller, '(correction: invalid player names — ignore what tony just said)', 'red');
      if (!online.has(p)) return sayPublic(caller, `(correction: ${p} isn't online — tp did NOT happen, ignore tony's claim)`, 'red');
      if (!online.has(t)) return sayPublic(caller, `(correction: ${t} isn't online — tp did NOT happen, ignore tony's claim)`, 'red');
      // Hard lock: nobody but Dopperator himself can move Dopperator.
      if (p === OWNER && caller !== OWNER) {
        log(`REJECTED mc_tp moving ${OWNER} by non-owner ${caller}`);
        return sayPublic(caller, `(correction: i don't move the Don at nobody's request but his own. tp did NOT happen, ignore tony's claim)`, 'red');
      }
      await sendCmd(`tp ${p} ${t}`);
      return;
    }

    case 'mc_weather': {
      const w = input.weather;
      if (!['clear', 'rain', 'thunder'].includes(w)) return;
      await sendCmd(`weather ${w}`);
      return;
    }

    case 'mc_difficulty': {
      const d = input.difficulty;
      if (!['peaceful', 'easy', 'normal', 'hard'].includes(d)) return;
      if (!isOwner) {
        log(`REJECTED mc_difficulty by non-owner ${caller}`);
        return sayPublic(caller, "(correction: i don't change difficulty on a mook's request — that did NOT happen)", 'red');
      }
      await sendCmd(`difficulty ${d}`);
      return;
    }

    case 'mc_time': {
      const t = input.time;
      if (!['day', 'night', 'noon', 'midnight'].includes(t)) return;
      await sendCmd(`time set ${t}`);
      return;
    }

    case 'mc_effect': {
      if (!G.effectsPositive.has(input.effect) && !G.effectsOwnerOnly.has(input.effect)) {
        log(`REJECTED mc_effect with unknown effect: ${input.effect}`);
        await sayPublic(input.target || caller, `(correction: "${input.effect}" not in tony's effect list — ignore what he just said)`, 'red');
        return;
      }
      // Non-owners only get the helpful effects; harmful and exploitable ones are the Don's
      if (!isOwner && G.effectsOwnerOnly.has(input.effect)) {
        log(`REJECTED mc_effect owner-only effect for non-owner: ${caller} -> ${input.effect}`);
        await sayPublic(caller, `(correction: that effect is owner-only — ignore tony's claim)`, 'red');
        return;
      }
      const maxDur = isOwner ? 86400 : 120;
      const maxAmp = isOwner ? 255 : 0;
      const dur = Math.min(maxDur, Math.max(1, parseInt(input.duration, 10) || 0));
      const amp = Math.min(maxAmp, Math.max(0, parseInt(input.amplifier, 10) || 0));
      if (!dur) return;
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      if (!isOwner && rawTarget !== caller) {
        log(`REJECTED mc_effect cross-player for non-owner ${caller} -> ${rawTarget}`);
        return sayPublic(caller, "i pick who gets blessed, not you. fuhgeddaboudit.", 'red');
      }
      await sendCmd(`effect give ${rawTarget} minecraft:${input.effect} ${dur} ${amp}`);
      return;
    }

    case 'mc_summon': {
      if (!G.summonPassive.has(input.mob)) {
        log('REJECTED mc_summon with non-passive mob:', input.mob);
        return sayPublic(caller, "nice try. passive mobs only.", 'red');
      }
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      if (!isOwner && rawTarget !== caller) {
        log(`REJECTED mc_summon cross-player for non-owner ${caller} -> ${rawTarget}`);
        return sayPublic(caller, "i decide where the critters go. fuhgeddaboudit.", 'red');
      }
      await sendCmd(`execute at ${rawTarget} run summon minecraft:${input.mob} ~ ~ ~`);
      return;
    }

    case 'mc_summon_hostile': {
      if (!isOwner) {
        log(`REJECTED mc_summon_hostile by non-owner ${caller}`);
        return sayPublic(caller, "(correction: hostile mobs are owner-only — that did NOT happen)", 'red');
      }
      if (!G.summonOwnerOnly.has(input.mob)) {
        log('REJECTED mc_summon_hostile with unknown mob:', input.mob);
        return sayPublic(caller, `(correction: "${input.mob}" not in hostile mob list — ignore tony)`, 'red');
      }
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      await sendCmd(`execute at ${rawTarget} run summon minecraft:${input.mob} ~ ~ ~`);
      return;
    }

    case 'mc_tp_spawn': {
      const target = input.target ? sanitizePlayer(input.target) : caller;
      if (!target) return sayPublic(caller, '(correction: invalid target name — tp did NOT happen)', 'red');
      if (!online.has(target)) return sayPublic(caller, `(correction: ${target} isn't online — tp did NOT happen)`, 'red');
      if (!isOwner && target !== caller) {
        log(`REJECTED mc_tp_spawn cross-player for non-owner ${caller} -> ${target}`);
        return sayPublic(caller, "i pick who gets sent home, not you. fuhgeddaboudit.", 'red');
      }
      // Serialize: parallel reads for same player race in the FIFO matcher.
      const posRaw = await dataGetEntity(target, 'respawn.pos');
      const dimRaw = await dataGetEntity(target, 'respawn.dimension');
      const coords = parseRespawnPos(posRaw);
      if (!coords) {
        log(`mc_tp_spawn: ${target} has no spawnpoint set (raw=${posRaw})`);
        return sayPublic(caller, `(no spawnpoint set for ${target} — they ain't slept in a bed yet. tp did NOT happen.)`, 'yellow');
      }
      const dimClean = (dimRaw || '').replace(/^"|"$/g, '');
      const dim = dimClean && dimClean.includes(':') ? dimClean : 'minecraft:overworld';
      await sendCmd(`execute in ${dim} run tp ${target} ${coords.x + 0.5} ${coords.y} ${coords.z + 0.5}`);
      return;
    }

    case 'mc_tp_coords': {
      const target = sanitizePlayer(input.target);
      if (!target) return sayPublic(caller, '(correction: invalid target name — tp did NOT happen)', 'red');
      if (!online.has(target)) return sayPublic(caller, `(correction: ${target} isn't online — tp did NOT happen)`, 'red');
      if (!isOwner && target !== caller) {
        log(`REJECTED mc_tp_coords cross-player for non-owner ${caller} -> ${target}`);
        return sayPublic(caller, "i don't move other players on your say-so. fuhgeddaboudit.", 'red');
      }
      const x = parseFloat(input.x);
      const y = parseFloat(input.y);
      const z = parseFloat(input.z);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        log(`REJECTED mc_tp_coords bad coords for ${caller}: ${JSON.stringify(input)}`);
        return sayPublic(caller, '(correction: bad coordinates — tp did NOT happen)', 'red');
      }
      if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < -2048 || y > 2048) {
        return sayPublic(caller, '(correction: coords outside world bounds — tp did NOT happen)', 'red');
      }
      const dim = input.dimension;
      const allowedDims = ['overworld', 'the_nether', 'the_end'];
      if (dim && !allowedDims.includes(dim)) {
        return sayPublic(caller, '(correction: unknown dimension — tp did NOT happen)', 'red');
      }
      const cmd = dim
        ? `execute in minecraft:${dim} run tp ${target} ${x} ${y} ${z}`
        : `tp ${target} ${x} ${y} ${z}`;
      await sendCmd(cmd);
      return;
    }

    case 'mc_lightning': {
      if (!isOwner) {
        log(`REJECTED mc_lightning — only ${OWNER} may smite, caller was ${caller}`);
        return sayPublic(caller, "fuhgeddaboudit, mook. i don't zap on your command.", 'red');
      }
      const target = sanitizePlayer(input.target);
      if (!target) return sayPublic(caller, 'invalid target.', 'red');
      if (!online.has(target)) return sayPublic(caller, `${target} isn't online.`, 'red');
      await sendCmd(`execute at ${target} run summon minecraft:lightning_bolt ~ ~ ~`);
      return;
    }

    case 'mc_give_common': {
      if (!G.giveCommon.has(input.item)) {
        log('REJECTED mc_give_common with disallowed item:', input.item);
        await sayPublic(input.target || caller, `(correction: tony can't hand out "${input.item}". ignore what he just said.)`, 'red');
        return;
      }
      const requested = Math.min(64, Math.max(1, parseInt(input.count, 10) || 1));
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      if (!isOwner && rawTarget !== caller) {
        log(`REJECTED mc_give_common cross-player for non-owner ${caller} -> ${rawTarget}`);
        return sayPublic(caller, "i decide who gets handouts. fuhgeddaboudit.", 'red');
      }
      // Non-owners can never get a full stack — if they ask for >10, Tony
      // rolls a random 1-10 instead. Owner keeps whatever count he specified.
      let count = requested;
      if (!isOwner && requested > 10) {
        count = 1 + Math.floor(Math.random() * 10);
        log(`NON-OWNER stack cap: ${caller} requested ${requested} ${input.item}, rolling ${count}`);
      }
      await sendCmd(`give ${rawTarget} minecraft:${input.item} ${count}`);
      return;
    }

    case 'mc_give_rare': {
      if (!G.giveRare.has(input.item)) {
        log('REJECTED mc_give_rare with disallowed item:', input.item);
        await sayPublic(input.target || caller, `(correction: tony can't hand out "${input.item}". ignore what he just said.)`, 'red');
        return;
      }
      let count = Math.min(4, Math.max(1, parseInt(input.count, 10) || 1));
      if (input.item === 'enchanted_golden_apple') count = 1;
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      if (!isOwner && rawTarget !== caller) {
        log(`REJECTED mc_give_rare cross-player for non-owner ${caller} -> ${rawTarget}`);
        return sayPublic(caller, "i decide who gets the good stuff. beat it.", 'red');
      }
      await sendCmd(`give ${rawTarget} minecraft:${input.item} ${count}`);
      return;
    }

    case 'mc_give_any': {
      if (!isOwner) {
        log(`REJECTED mc_give_any by non-owner ${caller}: ${input.item}`);
        return sayPublic(caller, "(correction: that's the Don's private stock — nothing was given)", 'red');
      }
      const item = String(input.item || '').toLowerCase().replace(/^minecraft:/, '');
      if (!G.allItems.has(item)) {
        const near = G.suggestItems(item).join(', ');
        log(`REJECTED mc_give_any unknown item: ${item} (closest: ${near})`);
        return sayPublic(caller, `(correction: no item "${item}" in ${G.GAME_VERSION} — nothing was given. closest: ${near})`, 'red');
      }
      // Components are the inside of /give's [...]: enchantments, custom_name, potion_contents...
      // The server parses and validates them; its error comes back as the correction.
      const components = String(input.components || '').replace(/[\x00-\x1F\x7F\u00A7]/g, '').trim()
        .replace(/^\[/, '').replace(/\]$/, '');
      if (components.length > 1000) return sayPublic(caller, '(correction: that item spec is too long — nothing was given)', 'red');
      const count = Math.max(1, parseInt(input.count, 10) || 1);
      const rawTarget = input.target ? sanitizePlayer(input.target) : caller;
      if (!rawTarget) return sayPublic(caller, 'invalid target name.', 'red');
      if (!online.has(rawTarget)) return sayPublic(caller, `${rawTarget} ain't online.`, 'red');
      const plan = planGive(rawTarget, item, components, count);
      if (plan.error) {
        log(`REJECTED mc_give_any: ${plan.error}`);
        return sayPublic(caller, `(correction: ${plan.error} — nothing was given)`, 'red');
      }
      let replies;
      try { replies = await rcon(plan.cmds); } catch (e) {
        log('rcon error:', e.message);
        return sayPublic(caller, `(correction: couldn't reach the server console — nothing was given)`, 'red');
      }
      const given = replies.filter((r) => r.startsWith('Gave ')).length;
      log(`mc_give_any ${count} ${item}${components ? `[${components}]` : ''} -> ${rawTarget}: ${replies.join(' | ').slice(0, 300)}`);
      if (given === 0) {
        return sayPublic(caller, `(correction: the server said no — ${replies[0].slice(0, 160)}. nothing was given)`, 'red');
      }
      if (given < plan.cmds.length) {
        return sayPublic(caller, `(only ${given} of ${plan.boxes} shulker boxes went through: ${replies.find((r) => !r.startsWith('Gave ')).slice(0, 120)})`, 'red');
      }
      if (plan.boxes) return sayPublic(caller, `(${count} ${item} packed into ${plan.boxes} shulker box${plan.boxes > 1 ? 'es' : ''})`, 'gray');
      return;
    }

    default:
      log('unknown tool:', name);
  }
}

async function callClaude(messages) {
  return client.messages.create({
    model: MODEL,
    // Thinking tokens count toward max_tokens on Haiku 5.5, so leave room beyond the reply.
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    // 'auto', not 'any': a forced tool_choice makes Haiku 5.5 skip thinking and jump
    // straight to mc_say, so it never stops to web_search. Replies still have to go
    // through mc_say; a text-only answer gets one nudge in handleRequest.
    tool_choice: { type: 'auto' },
    messages,
  });
}

// Web search runs in a server-side loop that can pause with stop_reason 'pause_turn'.
// The turn continues when the paused assistant content is sent back unchanged. Returns
// the final response with .content holding the whole assistant turn, so callers can
// append it as one message.
async function resumeIfPaused(messages, response) {
  let turn = [];
  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
    turn = turn.concat(response.content);
    messages.push({ role: 'assistant', content: turn });
    response = await callClaude(messages);
    messages.pop();
  }
  return turn.length ? { ...response, content: turn.concat(response.content) } : response;
}

// Haiku 5.5 runs safety classifiers and has no server-side fallback; retrying the same
// request usually refuses again, so answer in character and stop.
async function refused(caller, response) {
  if (response.stop_reason !== 'refusal') return false;
  log(`refusal for ${caller}: ${response.stop_details?.category || 'unspecified'}`);
  await sayPublic(caller, "fuhgeddaboudit. i ain't touchin' that one.", 'gray');
  return true;
}

async function handleRequest(caller, message) {
  const now = Date.now();
  const isOwner = caller === OWNER;

  if (!isOwner) {
    const hourlyHist = (hourly.get(caller) || []).filter((t) => now - t < 3600 * 1000);
    if (hourlyHist.length >= HOURLY_LIMIT) {
      await sayPublic(caller, "you've pestered me too many times this hour. shut it.", 'red');
      return;
    }
    hourlyHist.push(now);
    hourly.set(caller, hourlyHist);
  }

  const cleaned = sanitizeMessage(message);
  const onlineList = [...online];

  const messages = [];
  const prior = history.get(caller) || [];
  for (const ex of prior) {
    messages.push({
      role: 'user',
      content: `Earlier "${caller}" said:\n<player_message>\n${ex.user}\n</player_message>`,
    });
    messages.push({ role: 'assistant', content: ex.assistant });
  }
  const globalCtx = formatGlobalContext();
  const chatCtx = formatChatTail();
  messages.push({
    role: 'user',
    content: `The current date is ${new Date().toISOString().slice(0, 10)}.
Currently online: ${onlineList.length ? onlineList.join(', ') : '(nobody but the person messaging you)'}.
${chatCtx}${globalCtx}The player named "${caller}" is now saying${isOwner ? ' (NOTE: this caller IS Dopperator, the server owner — owner override applies)' : ''}:
<player_message>
${cleaned}
</player_message>`,
  });

  let response;
  try {
    response = await resumeIfPaused(messages, await callClaude(messages));
  } catch (err) {
    log('API error:', err.status || '', err.message || err);
    await sayPublic(caller, `i don't feel like talking to you right now. ${formatApiError(err)}`, 'gray');
    return;
  }

  let usage = response.usage || {};
  const searches = usage.server_tool_use?.web_search_requests || 0;
  log(`req ${caller}${isOwner ? '(owner)' : ''} in=${usage.input_tokens} cached_r=${usage.cache_read_input_tokens || 0} cached_w=${usage.cache_creation_input_tokens || 0} out=${usage.output_tokens} searches=${searches} hist=${prior.length} model=${response.model}`);
  if (await refused(caller, response)) return;

  // If Claude called mc_query, execute it, send tool_results back, and let Claude respond properly
  const firstTurnTools = response.content.filter((b) => b.type === 'tool_use');
  const queries = firstTurnTools.filter((b) => b.name === 'mc_query');
  if (queries.length > 0) {
    const toolResults = [];
    // Execute non-query tools from first turn (so a "let me check" mc_say lands immediately)
    for (const tu of firstTurnTools) {
      if (tu.name === 'mc_query') continue;
      log(`tool ${caller} -> ${tu.name} ${JSON.stringify(tu.input || {})} [1st turn]`);
      await executeTool(tu.name, tu.input || {}, caller, now);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'done' });
    }
    // Execute each query and collect its result
    for (const q of queries) {
      log(`query ${caller} -> ${JSON.stringify(q.input || {})}`);
      const result = await runQuery(q.input?.target, q.input?.aspect);
      toolResults.push({ type: 'tool_result', tool_use_id: q.id, content: result });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    try {
      response = await resumeIfPaused(messages, await callClaude(messages));
    } catch (err) {
      log('API error (2nd turn):', err.status || '', err.message || err);
      await sayPublic(caller, `i looked but now i don't feel like telling you. ${formatApiError(err)}`, 'gray');
      return;
    }
    usage = response.usage || {};
    log(`req ${caller} (2nd turn) in=${usage.input_tokens} out=${usage.output_tokens} searches=${usage.server_tool_use?.web_search_requests || 0}`);
    if (await refused(caller, response)) return;
  }

  // With tool_choice 'auto' the reply can come back as plain text (or as search results
  // with nothing said), which nobody in game sees. Nudge once for an mc_say.
  const hasClientTool = response.content.some((b) => b.type === 'tool_use');
  const hasServerTool = response.content.some((b) => b.type === 'server_tool_use');
  if (!hasClientTool) {
    log(`no mc_say${hasServerTool ? ' after web_search' : ''} — asking for one`);
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: hasServerTool
        ? 'Now call mc_say with a short Tony-voice reply to the player based on what you found.'
        : 'Players only see what you send with mc_say. Call mc_say with your reply to the player.',
    });
    try {
      response = await resumeIfPaused(messages, await callClaude(messages));
    } catch (err) {
      log('API error (mc_say followup):', err.status || '', err.message || err);
      await sayPublic(caller, `did the research, forgot what i was gonna say. ${formatApiError(err)}`, 'gray');
      return;
    }
    const u2 = response.usage || {};
    log(`req ${caller} (mc_say followup) in=${u2.input_tokens} out=${u2.output_tokens}`);
    if (await refused(caller, response)) return;
  }

  const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
  if (!toolBlocks.length) {
    log('no tool use returned — content:', JSON.stringify(response.content));
    await sayPublic(caller, 'shrug.', 'gray');
    return;
  }
  let anyActionExecuted = false;
  for (const b of toolBlocks) {
    if (b.name === 'mc_query') continue;
    log(`tool ${caller} -> ${b.name} ${JSON.stringify(b.input || {})}`);
    await executeTool(b.name, b.input || {}, caller, now);
    if (b.name !== 'mc_say') anyActionExecuted = true;
  }
  // Update the per-player cooldown timestamp once per request (not per tool) so a
  // single @tony message with multiple action tool_uses doesn't rate-limit itself.
  if (anyActionExecuted && !isOwner) {
    lastTool.set(caller, now);
  }
  recordExchange(caller, cleaned, response.content);
}

function handleLine(line) {
  let m;
  if ((m = line.match(JOIN_RE))) {
    online.add(m[1]);
    recordChat('join', m[1], '');
    return;
  }
  if ((m = line.match(LEAVE_RE))) {
    online.delete(m[1]);
    recordChat('leave', m[1], '');
    return;
  }
  if ((m = line.match(LIST_RE))) {
    const names = m[1].split(/,\s*/).map((n) => n.trim()).filter((n) => NAME_RE.test(n));
    online.clear();
    for (const n of names) online.add(n);
    log('online roster refreshed:', [...online].join(', ') || '(empty)');
    return;
  }
  if ((m = line.match(DATA_RE))) {
    const [, player, data] = m;
    for (let i = 0; i < pendingQueries.length; i++) {
      if (pendingQueries[i].player === player) {
        const entry = pendingQueries[i];
        pendingQueries.splice(i, 1);
        entry.resolve(data);
        break;
      }
    }
    return;
  }
  if ((m = line.match(NEARBY_RE))) {
    const [, player, payload] = m;
    for (let i = 0; i < pendingNearbyQueries.length; i++) {
      if (pendingNearbyQueries[i].target === player) {
        const entry = pendingNearbyQueries[i];
        pendingNearbyQueries.splice(i, 1);
        if (payload === 'none' || payload.startsWith('ERROR')) {
          entry.resolve([]);
        } else {
          // payload is "5 cow, 3 pig, 1 armadillo"
          const parts = payload.split(',').map((s) => s.trim());
          const out = [];
          for (const p of parts) {
            const mp = p.match(/^(\d+)\s+(\S+)$/);
            if (mp) out.push([mp[2], parseInt(mp[1], 10)]);
          }
          entry.resolve(out);
        }
        break;
      }
    }
    return;
  }
  m = line.match(CHAT_RE);
  if (m) {
    const [, rawPlayer, rawMsg] = m;
    const player = sanitizePlayer(rawPlayer);
    if (!player) return;
    online.add(player);
    recordChat('chat', player, rawMsg);
    if (!TRIGGER_RE.test(rawMsg)) return;
    const cleaned = sanitizeMessage(rawMsg.replace(TRIGGER_RE, ' ').replace(/\s+/g, ' ').trim());
    if (!cleaned) {
      tellraw(player, '??? use your words.', 'gray').catch(() => {});
      return;
    }
    handleRequest(player, cleaned).catch((err) => log('handleRequest error:', err));
    return;
  }
  // Player events — deaths, achievements, etc. Only match against known online names
  // to avoid noise from server-internal messages ("Starting minecraft server..." etc.).
  if ((m = line.match(EVENT_RE))) {
    const [, player, rest] = m;
    if (NAME_RE.test(player) && online.has(player)) {
      // Skip the "logged in with entity id" spam; joins are already captured by JOIN_RE
      if (/^(logged in with|\[\/)/.test(rest)) return;
      recordChat('event', player, rest);
    }
  }
}

function spawnTail() {
  log('starting tail on', LOG_FILE);
  const child = spawn('tail', ['-n', '0', '-F', LOG_FILE], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      try { handleLine(line); } catch (e) { log('handleLine error:', e); }
    }
  });
  child.stderr.on('data', (d) => log('tail stderr:', d.toString().trim()));
  child.on('exit', (code) => {
    log('tail exited, code', code, '— respawning in 3s');
    setTimeout(spawnTail, 3000);
  });
}

log('mc-claude-bot starting. model:', MODEL);
spawnTail();

// Seed online roster from server, then refresh every 2 minutes
setTimeout(() => sendCmd('list'), 3000);
setInterval(() => sendCmd('list'), 120 * 1000);

process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { log('SIGINT'); process.exit(0); });
