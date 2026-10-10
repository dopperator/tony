// Plans the Don's mc_give_any into server commands. Small orders are a plain /give.
// Bulk orders are packed into shulker boxes so they don't spill on the floor: an
// inventory only holds 36 stacks, and vanilla drops the rest at the player's feet
// where it despawns after 5 minutes.
// The commands go over RCON, which takes up to ~1446 bytes, unlike screen's ~240.
const G = require('./gamedata');

const PACK_OVER_STACKS = 9;   // more stacks than this get packed into shulker boxes
const MAX_BOXES = 27;         // one double chest of shulkers per request
const MAX_DIRECT_STACKS = 100; // vanilla /give refuses more than 100 stacks
const MAX_RCON_CMD = 1400;

function stackSize(item) {
  return G.data.stackSizes[item] || 64;
}

// item: a known item ID without namespace. components: the inside of the [...] in
// /give syntax, e.g. 'enchantments={sharpness:5},custom_name="Excalibur"', or ''.
// Returns { cmds, boxes } or { error }.
function planGive(target, item, components, count) {
  const max = stackSize(item);
  const stacks = Math.ceil(count / max);
  const packable = !components && !/shulker_box$/.test(item) && stacks > PACK_OVER_STACKS;
  if (!packable) {
    if (stacks > MAX_DIRECT_STACKS) {
      return { error: components
        ? `items with extras max out at ${MAX_DIRECT_STACKS * max}`
        : `max ${MAX_DIRECT_STACKS * max} ${item} per give` };
    }
    return { cmds: [`give ${target} minecraft:${item}${components ? `[${components}]` : ''} ${count}`], boxes: 0 };
  }

  // Box size: 27 slots, fewer when the item ID is long enough to push the command past RCON's limit.
  const prefix = `give ${target} minecraft:shulker_box[container=[]] 1`.length;
  const entry = `{slot:26,item:{id:${item},count:${max}}},`.length;
  const perBox = Math.min(27, Math.floor((MAX_RCON_CMD - prefix) / entry));
  const boxes = Math.ceil(stacks / perBox);
  if (boxes > MAX_BOXES) return { error: `max ${MAX_BOXES * perBox * max} ${item} per give (${MAX_BOXES} shulker boxes)` };

  const cmds = [];
  let left = count;
  for (let b = 0; b < boxes; b++) {
    const slots = [];
    for (let s = 0; s < perBox && left > 0; s++) {
      const n = Math.min(max, left);
      slots.push(`{slot:${s},item:{id:${item},count:${n}}}`);
      left -= n;
    }
    cmds.push(`give ${target} minecraft:shulker_box[container=[${slots.join(',')}]] 1`);
  }
  return { cmds, boxes };
}

module.exports = { planGive, stackSize };
