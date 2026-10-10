#!/usr/bin/env node
// Builds Tony's game data (what he may give/summon/apply, and a command reference)
// from the vanilla server's own reports, so every ID is real for the server's version.
//
// Upkeep when the server moves to a new Minecraft version <ver>:
//   1. cd /home/minecraft/bot && mkdir -p datagen-<ver> && cd datagen-<ver>
//      java -DbundlerMainClass=net.minecraft.data.Main \
//        -jar /home/minecraft/orphanage/cache/mojang_<ver>.jar --reports --output generated
//      unzip -o -j versions/<ver>/server-<ver>.jar 'data/minecraft/enchantment/*.json' -d generated/enchantment
//      then keep only generated/reports/{registries,commands}.json, generated/reports/minecraft/components/item/
//      and generated/enchantment/ (rm -rf libraries versions logs and the other reports)
//   2. node gamedata/build.js <ver>        (reads datagen-<ver>, writes gamedata/<ver>.json,
//                                           asks the running server for /help usage over RCON)
//   3. point GAME_VERSION in gamedata/index.js at <ver>, then: pm2 restart mc-claude-bot
// Review the printed diff of lists before restarting. Then check the live server accepts every ID
// (experimental items can be in the registry but disabled): `give @a[name=__nobody__] minecraft:<id> 1`
// must answer "No player was found", not "Unknown item".
const fs = require('fs');
const path = require('path');
const net = require('net');

const VERSION = process.argv[2] || '26.3';
const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(ROOT, `datagen-${VERSION}`, 'generated', 'reports');
const SERVER_PROPS = '/home/minecraft/orphanage/server.properties';

const registries = require(path.join(REPORTS, 'registries.json'));
const ids = (reg) => Object.keys(registries[reg].entries).map((s) => s.replace(/^minecraft:/, '')).sort();
const ITEMS = ids('minecraft:item');
const ENTITIES = new Set(ids('minecraft:entity_type'));
const EFFECTS = new Set(ids('minecraft:mob_effect'));
const POTIONS = ids('minecraft:potion');

// Stack sizes (only the ones that aren't 64), so bulk gives fill shulker slots correctly.
const COMPONENTS = path.join(REPORTS, 'minecraft', 'components', 'item');
const stackSizes = {};
for (const item of ITEMS) {
  const size = require(path.join(COMPONENTS, `${item}.json`)).components['minecraft:max_stack_size'];
  if (size !== 64) stackSizes[item] = size;
}
// Enchantments are data-driven, so they come from the server jar's built-in datapack, not the registries report.
const ENCHANT_DIR = path.join(ROOT, `datagen-${VERSION}`, 'generated', 'enchantment');
const enchantments = Object.fromEntries(fs.readdirSync(ENCHANT_DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => [f.slice(0, -5), require(path.join(ENCHANT_DIR, f)).max_level]));

// ---------------------------------------------------------------- policy ---
// Common handouts: ordinary building/decor blocks and everyday food. Anything
// matching DENY is never common, even if it matches ALLOW.
const DENY = [
  /netherite|diamond|emerald|gold|iron|copper|lapis|redstone|amethyst_cluster|ancient_debris|quartz_ore|_ore$|^raw_/,
  /spawn_egg|command_block|structure_|jigsaw|barrier|^light$|debug|bedrock|spawner|vault|trial|test_/,
  /shulker|elytra|totem|beacon|conduit|nether_star|dragon|_head$|_skull$|music_disc|smithing_template|_pottery_sherd|disc_fragment/,
  /enchanted|potion|tipped_arrow|experience_bottle|end_portal|end_gateway|reinforced_deepslate|heavy_core|ominous|echo_shard|sculk_catalyst|sculk_shrieker/,
  /^tnt|respawn_anchor|lodestone|ender_|end_crystal|crying_obsidian|bundle$|_bundle$|_harness$|saddle|name_tag|lead$|_armor|_horse_armor|_spear$/,
  /_sword$|_axe$|_pickaxe$|_shovel$|_hoe$|^bow$|crossbow|trident|^mace$|shield|_helmet$|_chestplate$|_leggings$|_boots$|wind_charge|firework/,
  // metal-made or rare despite innocent names; infested blocks release silverfish
  /weighted_pressure_plate|bucket|^bell$|blast_furnace|smithing_table|sponge|infested/,
];
const ALLOW = [
  /_planks$|_log$|_wood$|^stripped_|_stem$|_hyphae$|_slab$|_stairs$|_wall$|_fence$|_fence_gate$|_door$|_trapdoor$|_pressure_plate$|_button$/,
  /_wool$|_carpet$|_concrete$|_concrete_powder$|terracotta$|_stained_glass$|_stained_glass_pane$|^glass$|^glass_pane$|^tinted_glass$/,
  /_bricks$|_tiles$|^bricks$|_brick$|^stone$|^smooth_stone$|cobblestone$|^cobbled_deepslate$|^deepslate$|^polished_|^chiseled_|^cut_|^cracked_|^mossy_/,
  /^(granite|diorite|andesite|tuff|calcite|dripstone_block|pointed_dripstone|sand|red_sand|gravel|clay|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|grass_block|mud|packed_mud|moss_block|snow_block|ice|packed_ice|blue_ice|netherrack|soul_sand|soul_soil|blackstone|gilded_blackstone|basalt|smooth_basalt|end_stone|obsidian|glowstone|sea_lantern|shroomlight|magma_block|purpur_block|purpur_pillar|prismarine|dark_prismarine|quartz|quartz_block|smooth_quartz|quartz_pillar|smooth_sandstone|sandstone|red_sandstone|smooth_red_sandstone|hay_block|bookshelf|pale_moss_block|pale_moss_carpet|resin_block|sulfur|cinnabar|budding_amethyst|amethyst_block|amethyst_shard|nether_wart_block|warped_wart_block|bone_block|dried_kelp_block|sponge|wet_sponge|slime_block|honey_block|honeycomb_block|mushroom_stem|brown_mushroom_block|red_mushroom_block)$/,
  /_sapling$|_leaves$|_propagule$|^azalea$|^flowering_azalea$|_tulip$|^(dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|torchflower|pitcher_plant|pink_petals|wildflowers|short_grass|tall_grass|fern|large_fern|dead_bush|vine|lily_pad|seagrass|kelp|cactus|sugar_cane|bamboo)$/,
  /_dye$|^(torch|soul_torch|lantern|soul_lantern|campfire|soul_campfire|crafting_table|furnace|smoker|blast_furnace|chest|barrel|ladder|scaffolding|composter|cartography_table|fletching_table|loom|stonecutter|smithing_table|grindstone|lectern|bell|flower_pot|decorated_pot|candle|chain|_candle)$|_bed$|_sign$|_hanging_sign$|_banner$/,
  /^(bread|apple|carrot|potato|baked_potato|beetroot|beetroot_soup|mushroom_stew|rabbit_stew|pumpkin_pie|cake|cookie|melon_slice|sweet_berries|glow_berries|dried_kelp|beef|cooked_beef|chicken|cooked_chicken|porkchop|cooked_porkchop|mutton|cooked_mutton|rabbit|cooked_rabbit|cod|cooked_cod|salmon|cooked_salmon|wheat|wheat_seeds|pumpkin|melon|carved_pumpkin|jack_o_lantern|egg|sugar|bowl|stick|string|bone_meal|paper|book|coal|charcoal|clay_ball|brick|flint|feather|leather|arrow)$/,
];
const common = ITEMS.filter((i) => !DENY.some((r) => r.test(i)) && ALLOW.some((r) => r.test(i)));
const RARE = ['golden_apple', 'enchanted_golden_apple', 'ender_pearl', 'experience_bottle', 'honey_bottle', 'glistering_melon_slice'];

// Mobs: anyone may summon PASSIVE; HOSTILE_OR_RESTRICTED is owner-only. Mobs in
// neither list (wither, ender_dragon, giant, decorative entities) are never summoned.
const PASSIVE = ['allay', 'armadillo', 'axolotl', 'bat', 'camel', 'camel_husk', 'cat', 'chicken', 'cod', 'copper_golem', 'cow',
  'dolphin', 'donkey', 'fox', 'frog', 'glow_squid', 'goat', 'happy_ghast', 'horse', 'llama', 'mooshroom', 'mule', 'nautilus',
  'ocelot', 'panda', 'parrot', 'pig', 'rabbit', 'salmon', 'sheep', 'skeleton_horse', 'sniffer', 'snow_golem', 'squid', 'strider',
  'sulfur_cube', 'tadpole', 'tropical_fish', 'turtle', 'wolf', 'zombie_horse'];
const HOSTILE_OR_RESTRICTED = ['blaze', 'bogged', 'breeze', 'cave_spider', 'creaking', 'creeper', 'drowned', 'elder_guardian', 'enderman',
  'endermite', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'illusioner', 'magma_cube', 'parched', 'phantom', 'piglin', 'piglin_brute',
  'pillager', 'ravager', 'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex', 'vindicator', 'warden', 'witch',
  'wither_skeleton', 'zoglin', 'zombie', 'zombie_nautilus', 'zombie_villager', 'zombified_piglin',
  // not hostile, but valuable or dangerous enough to keep owner-only
  'bee', 'iron_golem', 'polar_bear', 'pufferfish', 'trader_llama', 'villager', 'wandering_trader'];

// Effects: POSITIVE for anyone (short, level I); everything else in the registry is owner-only.
const POSITIVE = ['absorption', 'breath_of_the_nautilus', 'conduit_power', 'dolphins_grace', 'fire_resistance', 'haste', 'health_boost',
  'instant_health', 'jump_boost', 'luck', 'night_vision', 'regeneration', 'resistance', 'saturation', 'slow_falling', 'speed',
  'strength', 'water_breathing'];

// ----------------------------------------------------------- validation ---
const bad = [...RARE.filter((i) => !ITEMS.includes(i)).map((i) => 'item ' + i),
  ...[...PASSIVE, ...HOSTILE_OR_RESTRICTED].filter((m) => !ENTITIES.has(m)).map((m) => 'mob ' + m),
  ...POSITIVE.filter((e) => !EFFECTS.has(e)).map((e) => 'effect ' + e)];
if (bad.length) { console.error('IDs not in', VERSION, 'registries:', bad.join(', ')); process.exit(1); }
const RESTRICTED_EFFECTS = [...EFFECTS].filter((e) => !POSITIVE.includes(e)).sort();

// ------------------------------------------------------ command reference ---
// Usage strings straight from the running server's /help, so syntax matches the version.
const HELP_COMMANDS = ['give', 'clear', 'effect', 'enchant', 'experience', 'gamemode', 'difficulty', 'time', 'weather',
  'tp', 'teleport', 'spawnpoint', 'setworldspawn', 'locate', 'summon', 'kill', 'attribute', 'damage', 'fill', 'setblock', 'clone',
  'item', 'loot', 'recipe', 'seed', 'worldborder', 'execute', 'data', 'tellraw', 'title', 'playsound', 'particle', 'scoreboard', 'tag',
  'team', 'msg', 'list', 'stopwatch', 'waypoint', 'tick'];
// One command at a time; a reply can span several packets, so read until the
// connection has been quiet for a moment before sending the next command.
function rcon(cmds) {
  const props = fs.readFileSync(SERVER_PROPS, 'utf8');
  const pw = props.match(/^rcon\.password=(.*)$/m)[1].trim();
  const port = Number(props.match(/^rcon\.port=(\d+)$/m)[1]);
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0), authed = false, current = '', quiet = null, i = 0;
    const out = [];
    const send = (type, body) => { const b = Buffer.from(body, 'utf8'); const p = Buffer.alloc(14 + b.length);
      p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(i + 10, 4); p.writeInt32LE(type, 8); b.copy(p, 12); sock.write(p); };
    const next = () => {
      if (i >= cmds.length) { clearTimeout(timer); sock.end(); resolve(out); return; }
      current = ''; send(2, `minecraft:help ${cmds[i]}`);
    };
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`rcon timeout at ${cmds[i]}`)); }, 120000);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0);
        const body = buf.subarray(12, 4 + len - 2).toString('utf8');
        buf = buf.subarray(4 + len);
        if (!authed) { authed = true; next(); continue; }
        current += body;
        clearTimeout(quiet);
        quiet = setTimeout(() => { out.push(current); i++; next(); }, 150);
      }
    });
    sock.on('connect', () => send(3, pw));
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

(async () => {
  let help = [];
  try { help = await rcon(HELP_COMMANDS); } catch (e) { console.error('RCON /help failed:', e.message); process.exit(1); }
  const usage = help.map((h) => h.replace(/§./g, '').split('/').filter(Boolean).map((u) => '/' + u.trim()).join('\n')).join('\n')
    + '\n/gamerule <rule> [<value>]   (rule names are listed separately)';
  const tree = require(path.join(REPORTS, 'commands.json'));
  const gamerules = Object.keys(tree.children.gamerule.children).filter((g) => !g.includes(':')).sort();

  const out = { version: VERSION, generatedAt: new Date().toISOString(), giveCommon: common, giveRare: RARE, allItems: ITEMS,
    summonPassive: PASSIVE, summonOwnerOnly: HOSTILE_OR_RESTRICTED, effectsPositive: POSITIVE, effectsOwnerOnly: RESTRICTED_EFFECTS,
    commandUsage: usage, gamerules, stackSizes, enchantments, potions: POTIONS };
  const file = path.join(__dirname, `${VERSION}.json`);
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`wrote ${file}: ${common.length} common items, ${RARE.length} rare, ${ITEMS.length} total items, ` +
    `${PASSIVE.length} passive / ${HOSTILE_OR_RESTRICTED.length} owner-only mobs, ${POSITIVE.length} / ${RESTRICTED_EFFECTS.length} effects, ` +
    `${usage.split('\n').length} usage lines, ${gamerules.length} gamerules, ${Object.keys(stackSizes).length} non-64 stack sizes, ` +
    `${Object.keys(enchantments).length} enchantments, ${POTIONS.length} potions`);
  if (prev) for (const k of ['giveCommon', 'summonPassive', 'summonOwnerOnly', 'effectsPositive']) {
    const a = new Set(prev[k]), b = new Set(out[k]);
    const add = [...b].filter((x) => !a.has(x)), rem = [...a].filter((x) => !b.has(x));
    if (add.length || rem.length) console.log(`  ${k}: +${add.length} -${rem.length}`, add.slice(0, 20).join(' '), rem.length ? '| removed: ' + rem.join(' ') : '');
  }
})();
