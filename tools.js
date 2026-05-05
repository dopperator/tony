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
    description: "Apply a potion effect (positive or negative) to a player. 'target' controls who gets it — omit for self, set to another name for cross-player. NON-OWNERS CAN ONLY TARGET THEMSELVES, and non-owners are limited to positive effects (speed, jump_boost, luck, etc). OWNER can target anyone with any effect including negatives (nausea, blindness, weakness, slowness, poison, etc). Duration up to 600s.",
    input_schema: {
      type: 'object',
      properties: {
        effect: {
          type: 'string',
          enum: [
            'speed', 'slow_falling', 'jump_boost', 'night_vision',
            'regeneration', 'fire_resistance', 'water_breathing',
            'luck', 'haste', 'strength', 'resistance',
            'nausea', 'blindness', 'weakness', 'slowness', 'poison', 'wither',
            'hunger', 'mining_fatigue', 'levitation', 'darkness', 'glowing', 'bad_omen',
          ],
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
    description: "Summon a passive mob at a player's location. If caller says 'spawn sheep for me' / 'gimme a cow', leave 'target' empty and it spawns at them. If caller says 'send sheep to alex' / 'spawn chickens on luna', set 'target' to that player's name. HOSTILE MOBS ARE FORBIDDEN — enum is passive only. For multiple mobs (e.g., 'give her 2 sheep'), call mc_summon twice, BOTH with the same target.",
    input_schema: {
      type: 'object',
      properties: {
        mob: {
          type: 'string',
          enum: ['cow', 'pig', 'chicken', 'sheep', 'rabbit', 'cat', 'parrot', 'horse', 'fox', 'axolotl', 'frog'],
        },
        target: { type: 'string', description: "Optional. Exact online player name where the mob should spawn. Omit to spawn on the caller." },
      },
      required: ['mob'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_summon_hostile',
    description: "Summon a HOSTILE mob at a player's location. **OWNER-ONLY** — only Dopperator may invoke this. Server-side hard-locked to the Don regardless of who you call it for. Use this when the Don wants to grief, fight, or test combat. For multiple mobs, call multiple times with same target. Targets default to caller (Don) if omitted.",
    input_schema: {
      type: 'object',
      properties: {
        mob: {
          type: 'string',
          enum: [
            'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
            'witch', 'pillager', 'vindicator', 'evoker', 'ravager',
            'husk', 'drowned', 'stray', 'wither_skeleton', 'phantom',
            'blaze', 'ghast', 'magma_cube', 'slime', 'silverfish', 'endermite',
            'hoglin', 'zoglin', 'piglin_brute', 'guardian', 'shulker',
            'breeze', 'bogged', 'creaking', 'vex', 'warden',
          ],
        },
        target: { type: 'string', description: "Optional. Exact online player name where the mob should spawn. Omit to spawn on the caller (Don)." },
      },
      required: ['mob'],
      additionalProperties: false,
    },
  },
  {
    name: 'mc_give_common',
    description: "Give common building materials or basic food. Up to 64 per call — one stack. Use freely if the player has ANY half-decent reason. Categories: building blocks (dirt, stone, wood, glass, sand, bricks, quartz), basic food (beef, chicken, bread, apple, carrot, potato, etc — both raw and cooked variants). For rare food like golden apples use mc_give_rare instead. If caller says 'give me X' leave target empty; if 'give PLAYER X' set target to that player.",
    input_schema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          enum: [
            'dirt', 'coarse_dirt', 'grass_block', 'cobblestone', 'stone', 'deepslate', 'cobbled_deepslate',
            'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks',
            'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
            'glass', 'sand', 'gravel', 'red_sand', 'sandstone',
            'bricks', 'stone_bricks', 'smooth_stone', 'terracotta',
            'quartz', 'quartz_block', 'smooth_quartz_block', 'quartz_bricks', 'quartz_pillar', 'chiseled_quartz_block',
            'nether_bricks', 'red_nether_bricks', 'blackstone', 'polished_blackstone',
            'calcite', 'tuff', 'dripstone_block', 'pointed_dripstone', 'amethyst_block', 'amethyst_shard', 'budding_amethyst',
            'basalt', 'smooth_basalt', 'polished_basalt', 'obsidian', 'end_stone', 'end_stone_bricks',
            'glowstone', 'sea_lantern', 'lantern', 'soul_lantern', 'soul_torch',
            'purpur_block', 'purpur_pillar', 'prismarine', 'prismarine_bricks', 'dark_prismarine',
            'mossy_cobblestone', 'mossy_stone_bricks', 'cracked_stone_bricks',
            'cobblestone_wall', 'stone_brick_wall',
            'mud', 'packed_mud', 'mud_bricks',
            'andesite', 'diorite', 'granite', 'polished_andesite', 'polished_diorite', 'polished_granite',
            'torch', 'crafting_table', 'furnace', 'chest', 'ladder',
            'white_wool', 'gray_wool', 'black_wool', 'red_wool', 'blue_wool', 'green_wool', 'yellow_wool',
            'white_concrete', 'gray_concrete', 'black_concrete', 'red_concrete', 'blue_concrete', 'green_concrete', 'yellow_concrete',
            'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'porkchop', 'cooked_porkchop',
            'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'cod', 'cooked_cod', 'salmon', 'cooked_salmon',
            'bread', 'apple', 'carrot', 'potato', 'baked_potato', 'beetroot',
            'pumpkin_pie', 'cake', 'melon_slice', 'sweet_berries', 'dried_kelp',
          ],
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
];
