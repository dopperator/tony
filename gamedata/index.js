// Tony's game data for the server's Minecraft version: what he may give, summon and
// apply, plus a command reference for the prompt. The JSON is built by build.js from
// the vanilla server's own reports; see build.js for the upkeep steps on a version bump.
const GAME_VERSION = '26.3';
const data = require(`./${GAME_VERSION}.json`);

const giveCommon = new Set(data.giveCommon);
const giveRare = new Set(data.giveRare);
const allItems = new Set(data.allItems);
const summonPassive = new Set(data.summonPassive);
const summonOwnerOnly = new Set(data.summonOwnerOnly);
const effectsPositive = new Set(data.effectsPositive);
const effectsOwnerOnly = new Set(data.effectsOwnerOnly);

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// Closest real item IDs, for "did you mean" corrections when Tony names a wrong ID.
function suggestItems(id, n = 3) {
  const want = String(id || '').toLowerCase().replace(/^minecraft:/, '');
  return data.allItems
    .map((item) => [item, item.includes(want) || want.includes(item) ? 0 : editDistance(want, item)])
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([item]) => item);
}

const promptAppendix = `MINECRAFT ${data.version} GAME DATA — generated from this server's own data files and /help, so it beats your memory:

COMMAND SYNTAX (exact; <required> [optional] (a|b) = pick one). When a player asks how to use a command, answer from this list:
${data.commandUsage}

GAMERULE NAMES — 26.x renamed them to snake_case, so the old camelCase names (keepInventory, doDaylightCycle, mobGriefing, doFireTick...) NO LONGER WORK. Correct names: ${data.gamerules.join(', ')}.
TIME: "/time set" takes ticks (e.g. 1000, 0.5d) or a marker: day, noon, night, midnight. "/time query" takes time, gametime or a timeline like day.

ENCHANTMENT IDs (max survival level): ${Object.entries(data.enchantments).map(([id, lvl]) => `${id} ${lvl}`).join(', ')}.
POTION IDs (for potion_contents): ${data.potions.join(', ')}.
STACK SIZES: most items stack to 64. These stack to 16: every sign, hanging sign, banner and cushion, plus ${Object.keys(data.stackSizes)
  .filter((i) => data.stackSizes[i] === 16 && !/_(sign|banner|cushion)$/.test(i)).join(', ')}. Tools, weapons, armor, totems, potions, filled buckets, boats and other gear stack to 1.`;

module.exports = {
  GAME_VERSION, data, giveCommon, giveRare, allItems, summonPassive, summonOwnerOnly,
  effectsPositive, effectsOwnerOnly, suggestItems, promptAppendix,
};
