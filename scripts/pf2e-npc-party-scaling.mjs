const MODULE_ID = "pf2e-npc-party-scaling";
const PATCH_FLAG = Symbol(MODULE_ID);
const SHEET_FLAG = "scaleToPartyLevel";
const SCALING_SELECTORS = ["perception", "saving-throw", "skill-check"];
const SETTINGS = {
  partySource: "partySource",
  levelAggregation: "levelAggregation",
  modifierMode: "modifierMode",
  modifierMultiplier: "modifierMultiplier",
  modifierOffset: "modifierOffset",
};

Hooks.once("init", () => {
  registerSettings();
  patchNpcPrepareDerivedData();
});

Hooks.on("renderActorSheet", (app, html) => {
  injectScalingToggle(app, html);
});

Hooks.on("updateActor", (actor, changed) => {
  if (!shouldRefreshForActorChange(actor, changed)) return;
  refreshScaledNpcs();
});

Hooks.on("createActor", (actor) => {
  if (!isPartyLevelSourceActor(actor)) return;
  refreshScaledNpcs();
});

Hooks.on("deleteActor", (actor) => {
  if (!isPartyLevelSourceActor(actor)) return;
  refreshScaledNpcs();
});

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.partySource, {
    name: localize("settings.partySource.name"),
    hint: localize("settings.partySource.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "active-party-level-first",
    choices: {
      "active-party-level-first": localize("settings.partySource.choices.active-party-level-first"),
      "active-party-level-only": localize("settings.partySource.choices.active-party-level-only"),
      "active-party-members-first": localize("settings.partySource.choices.active-party-members-first"),
      "active-party-members-only": localize("settings.partySource.choices.active-party-members-only"),
      "player-characters": localize("settings.partySource.choices.player-characters"),
    },
    onChange: () => refreshScaledNpcs(),
  });

  game.settings.register(MODULE_ID, SETTINGS.levelAggregation, {
    name: localize("settings.levelAggregation.name"),
    hint: localize("settings.levelAggregation.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "average-round",
    choices: {
      "average-round": localize("settings.levelAggregation.choices.average-round"),
      "average-floor": localize("settings.levelAggregation.choices.average-floor"),
      "average-ceil": localize("settings.levelAggregation.choices.average-ceil"),
      highest: localize("settings.levelAggregation.choices.highest"),
      lowest: localize("settings.levelAggregation.choices.lowest"),
    },
    onChange: () => refreshScaledNpcs(),
  });

  game.settings.register(MODULE_ID, SETTINGS.modifierMode, {
    name: localize("settings.modifierMode.name"),
    hint: localize("settings.modifierMode.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "difference",
    choices: {
      difference: localize("settings.modifierMode.choices.difference"),
      "positive-only": localize("settings.modifierMode.choices.positive-only"),
      "negative-only": localize("settings.modifierMode.choices.negative-only"),
    },
    onChange: () => refreshScaledNpcs(),
  });

  game.settings.register(MODULE_ID, SETTINGS.modifierMultiplier, {
    name: localize("settings.modifierMultiplier.name"),
    hint: localize("settings.modifierMultiplier.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    onChange: () => refreshScaledNpcs(),
  });

  game.settings.register(MODULE_ID, SETTINGS.modifierOffset, {
    name: localize("settings.modifierOffset.name"),
    hint: localize("settings.modifierOffset.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 0,
    onChange: () => refreshScaledNpcs(),
  });
}

function patchNpcPrepareDerivedData() {
  const NPCClass = CONFIG.PF2E?.Actor?.documentClasses?.npc;
  if (!NPCClass) {
    console.warn(`${MODULE_ID} | PF2e NPC actor class was not found; party scaling is disabled.`);
    return;
  }

  if (NPCClass.prototype[PATCH_FLAG]) return;

  const originalPrepareDerivedData = NPCClass.prototype.prepareDerivedData;
  NPCClass.prototype.prepareDerivedData = function patchedPrepareDerivedData(...args) {
    applyPartyScalingAdjustments(this);
    return originalPrepareDerivedData.call(this, ...args);
  };
  NPCClass.prototype[PATCH_FLAG] = true;
}

function applyPartyScalingAdjustments(actor) {
  if (!isScalableNpc(actor)) return;

  const scaling = getNpcScalingState(actor);
  if (!scaling.enabled || scaling.partyLevel === null || scaling.delta === 0) return;

  for (const selector of SCALING_SELECTORS) {
    const adjustments = (actor.synthetics.modifierAdjustments[selector] ??= []);
    adjustments.push({
      slug: "base",
      getNewValue: (base) => base + scaling.delta,
      test: () => true,
    });
  }
}

function injectScalingToggle(app, html) {
  const actor = app?.actor ?? app?.document ?? null;
  if (!isScalableNpc(actor) || !app?.isEditable) return;

  const root = html?.[0] ?? html;
  if (!(root instanceof HTMLElement)) return;

  const sidebar = root.querySelector(".sidebar");
  const anchor = sidebar?.querySelector(".subsection.initiative") ?? sidebar?.querySelector(".subsection.health");
  if (!sidebar || !anchor) return;

  root.querySelector(`[data-${MODULE_ID}]`)?.remove();

  const scaling = getNpcScalingState(actor);
  const panel = buildScalingPanel(app, actor, scaling);
  anchor.insertAdjacentElement("afterend", panel);
}

function buildScalingPanel(app, actor, scaling) {
  const panel = document.createElement("div");
  panel.className = "subsection npc-party-scaling";
  panel.setAttribute(`data-${MODULE_ID}`, "true");

  const header = document.createElement("header");
  header.innerHTML = `
    <label>
      <i class="fa-solid fa-scale-balanced fa-fw" inert></i>
      <span>${game.i18n.localize(`${MODULE_ID}.sheet.title`)}</span>
    </label>
  `;

  const body = document.createElement("div");
  body.className = "side-bar-section-content";

  const checkboxRow = document.createElement("label");
  checkboxRow.className = "party-scaling-toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = scaling.enabled;
  checkbox.disabled = actor.isToken && actor.token?.isLinked === false && !actor.isOwner;

  const checkboxText = document.createElement("span");
  checkboxText.textContent = game.i18n.localize(`${MODULE_ID}.sheet.toggle`);

  checkboxRow.append(checkbox, checkboxText);

  const modifier = document.createElement("p");
  modifier.className = "party-scaling-modifier";
  modifier.textContent = getAppliedModifierLabel(scaling);

  const warning = document.createElement("p");
  warning.className = "party-scaling-warning";
  warning.textContent = localize("sheet.warning");

  checkbox.addEventListener("change", async () => {
    checkbox.disabled = true;
    try {
      await actor.setFlag(MODULE_ID, SHEET_FLAG, checkbox.checked);
      actor.reset();
      if (app.rendered) {
        await app.render(true);
      }
    } finally {
      checkbox.disabled = false;
    }
  });

  body.append(checkboxRow);
  if (scaling.enabled) {
    body.append(modifier, warning);
  }
  panel.append(header, body);
  return panel;
}

function getAppliedModifierLabel(scaling) {
  if (scaling.partyLevel === null) {
    return game.i18n.localize(`${MODULE_ID}.sheet.modifierUnavailable`);
  }

  if (scaling.rawDelta === scaling.delta) {
    return game.i18n.format(`${MODULE_ID}.sheet.appliedModifier`, {
      delta: formatSignedNumber(scaling.delta),
    });
  }

  return game.i18n.format(`${MODULE_ID}.sheet.adjustedModifier`, {
    rawDelta: formatSignedNumber(scaling.rawDelta),
    finalDelta: formatSignedNumber(scaling.delta),
  });
}

function getNpcScalingState(actor) {
  const enabled = !!actor.getFlag(MODULE_ID, SHEET_FLAG);
  const baseLevel = getBaseNpcLevel(actor);
  const partyData = getPartyLevelData();
  const partyLevel = partyData.level;
  const rawDelta = partyLevel === null ? 0 : partyLevel - baseLevel;
  const delta = partyLevel === null ? 0 : getConfiguredModifierDelta(rawDelta);

  return {
    enabled,
    baseLevel,
    partyLevel,
    rawDelta,
    delta,
    source: partyData.source,
    partyName: partyData.partyName,
  };
}

function getPartyLevelData() {
  const activeParty = game.actors?.party ?? null;
  const partySource = getSetting(SETTINGS.partySource);

  if (partySource === "active-party-level-first" || partySource === "active-party-level-only") {
    const activePartyLevel = Number(activeParty?.system?.details?.level?.value);
    if (Number.isFinite(activePartyLevel)) {
      return {
        level: activePartyLevel,
        source: "active-party-level",
        partyName: activeParty?.name ?? null,
      };
    }
    if (partySource === "active-party-level-only") {
      return createUnavailablePartyLevel();
    }
  }

  if (partySource === "active-party-members-first" || partySource === "active-party-members-only") {
    const activePartyLevels = getCharacterLevels(activeParty?.members ?? []);
    if (activePartyLevels.length > 0) {
      return {
        level: aggregateLevels(activePartyLevels),
        source: "active-party-members",
        partyName: activeParty?.name ?? null,
      };
    }
    if (partySource === "active-party-members-only") {
      return createUnavailablePartyLevel();
    }
  }

  if (partySource === "player-characters" || partySource.endsWith("-first")) {
    const fallbackCharacters = game.actors?.contents?.filter((actor) => actor?.type === "character" && actor.hasPlayerOwner) ?? [];
    const fallbackLevels = getCharacterLevels(fallbackCharacters);
    if (fallbackLevels.length > 0) {
      return {
        level: aggregateLevels(fallbackLevels),
        source: "characters",
        partyName: null,
      };
    }
  }

  return createUnavailablePartyLevel();
}

function getCharacterLevels(actors) {
  return actors
    .filter((actor) => actor?.type === "character")
    .map((actor) => Number(actor?.system?.details?.level?.value ?? actor?._source?.system?.details?.level?.value))
    .filter((level) => Number.isFinite(level));
}

function aggregateLevels(levels) {
  if (levels.length === 0) return null;

  const mode = getSetting(SETTINGS.levelAggregation);
  if (mode === "highest") return Math.max(...levels);
  if (mode === "lowest") return Math.min(...levels);

  const total = levels.reduce((sum, level) => sum + level, 0);
  const average = total / levels.length;
  if (mode === "average-floor") return Math.floor(average);
  if (mode === "average-ceil") return Math.ceil(average);
  return Math.round(average);
}

function getBaseNpcLevel(actor) {
  const level = Number(actor?.system?.details?.level?.base ?? actor?.system?.details?.level?.value ?? actor?._source?.system?.details?.level?.value ?? 0);
  return Number.isFinite(level) ? level : 0;
}

function refreshScaledNpcs() {
  const actors = new Map();

  for (const actor of game.actors?.contents ?? []) {
    if (isScalableNpc(actor) && actor.getFlag(MODULE_ID, SHEET_FLAG)) {
      actors.set(actor.uuid, actor);
    }
  }

  for (const token of canvas?.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (isScalableNpc(actor) && actor.getFlag(MODULE_ID, SHEET_FLAG)) {
      actors.set(actor.uuid, actor);
    }
  }

  for (const actor of actors.values()) {
    actor.reset();
    actor.sheet?.rendered && actor.sheet.render(false);
  }
}

function shouldRefreshForActorChange(actor, changed) {
  if (!isPartyLevelSourceActor(actor)) return false;
  if (actor.type === "character") {
    return hasPath(changed, "system.details.level");
  }
  if (actor.type === "party") {
    return hasPath(changed, "system.details.members");
  }
  return false;
}

function isPartyLevelSourceActor(actor) {
  return actor?.type === "character" || actor?.type === "party";
}

function isScalableNpc(actor) {
  return actor?.type === "npc" && game.system.id === "pf2e";
}

function hasPath(object, path) {
  return getPathValue(object, path) !== undefined;
}

function getPathValue(object, path) {
  return path.split(".").reduce((value, key) => (value && key in value ? value[key] : undefined), object);
}

function formatSignedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function getConfiguredModifierDelta(rawDelta) {
  let delta = rawDelta;
  const mode = getSetting(SETTINGS.modifierMode);
  if (mode === "positive-only") {
    delta = Math.max(0, delta);
  } else if (mode === "negative-only") {
    delta = Math.min(0, delta);
  }

  const multiplier = Number(getSetting(SETTINGS.modifierMultiplier));
  const offset = Number(getSetting(SETTINGS.modifierOffset));
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 1;
  const safeOffset = Number.isFinite(offset) ? offset : 0;

  return Math.round(delta * safeMultiplier + safeOffset);
}

function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

function createUnavailablePartyLevel() {
  return {
    level: null,
    source: "none",
    partyName: null,
  };
}

function localize(key) {
  return game.i18n.localize(`${MODULE_ID}.${key}`);
}
