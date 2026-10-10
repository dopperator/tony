// Item/mob/effect enums come from gamedata/ (built from the server's own 26.3 data);
// index.js validates against the same sets, so the two can't drift apart.
const G = require('./gamedata');

module.exports = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 2,
    allowed_domains: ['minecraft.wiki', 'minecraft.fandom.com', 'papermc.io', 'docs.papermc.io'],
    allowed_callers: ['direct'],
  },
  {
    name: 'mc_say',
    description: 'Speak to the player in chat without executing any game action. This is the DEFAULT — use it the vast majority of the time. Rude, sarcastic, snarky, dismissive, mocking. Good for refusals, insults, jokes, and just chatting. Does NOT run any game command.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What you say back. Keep it short (under 25 words).' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_tp',
    description: 'Teleport one online player to another online player. Only use if the caller gave a genuinely good reason. Both players must be online.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Exact username of the player to move' },
        target: { type: 'string', description: 'Exact username of the player to move them to' },
      },
      required: ['player', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_difficulty',
    description: "Change the server's gameplay difficulty. **OWNER-ONLY** — only Dopperator may invoke this. Affects mob damage, hunger drain, mob spawns. Server-side locked to the Don regardless of what you call.",
    input_schema: {
      type: 'object',
      properties: {
        difficulty: { type: 'string', enum: ['peaceful', 'easy', 'normal', 'hard'] },
      },
      required: ['difficulty'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_weather',
    description: 'Change overworld weather.',
    input_schema: {
      type: 'object',
      properties: {
        weather: { type: 'string', enum: ['clear', 'rain', 'thunder'] },
      },
      required: ['weather'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_time',
    description: 'Set overworld time to a named phase.',
    input_schema: {
      type: 'object',
      properties: {
        time: { type: 'string', enum: ['day', 'night', 'noon', 'midnight'] },
      },
      required: ['time'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_effect',
    description: "Apply a potion effect to a player. 'target' controls who gets it — omit for self, set to another name for cross-player. NON-OWNERS CAN ONLY TARGET THEMSELVES and only get the helpful effects (" + G.data.effectsPositive.join(', ') + "), at level I for up to 120s. Everything else is OWNER-ONLY: harmful ones (nausea, blindness, poison, wither, levitation, wind_charged, oozing, weaving, infested...) and exploitable ones (invisibility, hero_of_the_village, bad_omen, raid_omen, trial_omen). Duration up to 600s.",
    input_schema: {
      type: 'object',
      properties: {
        effect: {
          type: 'string',
          enum: [...G.data.effectsPositive, ...G.data.effectsOwnerOnly],
        },
        duration: { type: 'integer', minimum: 1, maximum: 600, description: 'Duration in seconds (1-600)' },
        amplifier: { type: 'integer', minimum: 0, maximum: 255, description: 'Amplifier = level - 1. So "Nausea 10" = amplifier 9, "Speed 6" = amplifier 5. Range 0-255. Non-owners are force-capped to 0 (level 1) regardless of what you pass.' },
        target: { type: 'string', description: "Optional. Exact online player name to receive the effect. Omit to target the caller." },
      },
      required: ['effect', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_summon',
    description: "Summon a passive mob at a player's location. If caller says 'spawn sheep for me' / 'gimme a cow', leave 'target' empty and it spawns at them. If caller says 'send sheep to alex' / 'spawn chickens on luna', set 'target' to that player's name. HOSTILE MOBS ARE FORBIDDEN — enum is passive only (includes 26.x mobs like sulfur_cube, copper_golem, happy_ghast, nautilus, camel_husk). For multiple mobs (e.g., 'give her 2 sheep'), call mc_summon twice, BOTH with the same target.",
    input_schema: {
      type: 'object',
      properties: {
        mob: {
          type: 'string',
          enum: G.data.summonPassive,
        },
        target: { type: 'string', description: "Optional. Exact online player name where the mob should spawn. Omit to spawn on the caller." },
      },
      required: ['mob'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_summon_hostile',
    description: "Summon a HOSTILE or RESTRICTED mob at a player's location (restricted = valuable or dangerous non-hostile mobs: villager, wandering_trader, iron_golem, bee, polar_bear, pufferfish, trader_llama). **OWNER-ONLY** — only Dopperator may invoke this. Server-side hard-locked to the Don regardless of who you call it for. Use this when the Don wants to grief, fight, or test combat. For multiple mobs, call multiple times with same target. Targets default to caller (Don) if omitted.",
    input_schema: {
      type: 'object',
      properties: {
        mob: {
          type: 'string',
          enum: G.data.summonOwnerOnly,
        },
        target: { type: 'string', description: "Optional. Exact online player name where the mob should spawn. Omit to spawn on the caller (Don)." },
      },
      required: ['mob'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_give_common',
    description: "Give common, non-valuable items: building blocks in every wood/stone/color variant (planks, logs, slabs, stairs, walls, fences, doors, wool, carpet, concrete, terracotta, glass, bricks...), decor and plants (flowers, saplings, leaves, lanterns, beds, banners, dyes, candles), everyday utility blocks (crafting table, furnace, chest, barrel, ladder, scaffolding...) and basic food, raw or cooked. Up to 64 per call. Use freely if the player has ANY half-decent reason. Ores, ingots, gems, gear, potions and spawn eggs are NOT here. For golden apples, pearls and xp use mc_give_rare. If caller says 'give me X' leave target empty; if 'give PLAYER X' set target to that player.",
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          enum: G.data.giveCommon,
        },
        count: { type: 'integer', minimum: 1, maximum: 64 },
        target: { type: 'string', description: "Optional. Exact online player name to give it to. Omit for the caller themselves." },
      },
      required: ['item', 'count'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_tp_coords',
    description: "Teleport a player to specific x/y/z coordinates, optionally in a specific dimension. Use this AFTER mc_query last_death to send someone back to their death spot. Also handles any 'tp me to X,Y,Z' request. Non-owners can only tp THEMSELVES (target must equal caller). Owner can tp anyone. If dimension not specified, target's current dimension is used.",
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Exact online player name to teleport' },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        dimension: { type: 'string', enum: ['overworld', 'the_nether', 'the_end'], description: 'Optional. Omit to keep the target in their current dimension.' },
      },
      required: ['target', 'x', 'y', 'z'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_tp_spawn',
    description: "Teleport a player to their RESPAWN POINT (the bed or respawn anchor they last slept at). Use this for 'tp me home', 'take me home', 'send me to my bed', 'bring me to my spawn', etc. — these all map to spawnpoint, NOT to some imagined 'home' coord. If the player has never slept in a bed, the tool will fail cleanly and you should mc_say so. Non-owners can only target themselves; the Don can target anyone.",
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: "Optional. Exact online player name to send to their spawnpoint. Omit for the caller themselves." },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mc_lightning',
    description: "Strike lightning at a target player's location. This damages them unless they're in water, underground, or holding a channeling trident. Effectively a PvP weapon. STRICT. Default refuse — only use if the caller has an extraordinarily compelling reason. OWNER DOPPERATOR gets it freely.",
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Exact online player name to strike.' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_query',
    description: "Look up in-game info about an online player: their current location (dimension + coordinates), held item (with enchantments and durability), inventory summary, last death location, spawnpoint (bed/anchor respawn), or nearby_entities (counts of non-player mobs within 32 blocks of them — useful when a player asks 'what mob is this' or you want to verify what they're actually looking at). 'last_death', 'spawn', and 'nearby_entities' are not sensitive — grant freely. 'location'/'held_item'/'inventory' are SURVEILLANCE — require persuasion, default refuse. After you get the data, respond with mc_say to report it in Tony's voice.",
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Exact player name to inspect (must be online).' },
        aspect: { type: 'string', enum: ['location', 'held_item', 'inventory', 'last_death', 'spawn', 'nearby_entities'] },
      },
      required: ['target', 'aspect'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_give_rare',
    description: "Give a RARE valuable item (golden apple, enchanted golden apple, ender pearl, xp bottle). Max 4 per call. ONLY USE IF EXCEPTIONALLY CONVINCING — genuine clever argument, creative flattery, real humor, or compelling emotional reason. 'please'/'i need it'/generic flattery → refuse. Never give more than 1 enchanted golden apple at a time. If caller tells you to give to ANOTHER player, set 'target' to that player's name.",
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          enum: ['golden_apple', 'enchanted_golden_apple', 'ender_pearl', 'experience_bottle', 'honey_bottle', 'glistering_melon_slice'],
        },
        count: { type: 'integer', minimum: 1, maximum: 4 },
        target: { type: 'string', description: "Optional. Exact online player name to give it to. Omit for the caller themselves." },
      },
      required: ['item', 'count'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_give_any',
    description: "**OWNER-ONLY** — give Dopperator (or whoever he names) ANY item in Minecraft " + G.GAME_VERSION + ": diamonds, netherite, gear, elytra, totems, spawn eggs, new 26.x items, anything. Server-side hard-locked to the Don. Use the exact item ID without 'minecraft:' (e.g. diamond_block, netherite_sword, totem_of_undying, mace, wind_charge). If you're unsure of an ID, guess the most likely one — a wrong ID is rejected with suggestions, and the Don can correct you. Never use this for non-owners; they get mc_give_common / mc_give_rare.",
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Exact Minecraft item ID, lowercase, no namespace (e.g. diamond, elytra, sulfur_cube_bucket).' },
        count: { type: 'integer', minimum: 1, maximum: 64 },
        target: { type: 'string', description: 'Optional. Exact online player name to give it to. Omit for the Don himself.' },
      },
      required: ['item', 'count'],
      additionalProperties: false,
    },
  },
];
