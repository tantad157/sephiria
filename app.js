const DATA_BASE = new URL(".", import.meta.url);

const HIGHLIGHT_RULES = [
  {
    re: /\b(?:cold\s*dmg|ice\s*dmg|frostbite|frost(?!\w)|freeze|freezing|chill|glacial|blizzard|icy)\b/gi,
    className: "hl-ice",
  },
  {
    re: /\b(?:fire\s*dmg|burn(?:ing)?|ignite|flame|embers)\b/gi,
    className: "hl-fire",
  },
  {
    re: /\b(?:lightning\s*dmg|lightning|electrocution|electric|shock(?:ing)?)\b/gi,
    className: "hl-lightning",
  },
  { re: /\-\d+(?:\.\d+)?%/g, className: "hl-neg" },
];

async function loadJson(name) {
  const url = new URL(`data/${name}`, DATA_BASE).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${name}`);
  return res.json();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function richContent(html, plain) {
  const h = (html && String(html).trim()) || "";
  const inner = h || esc(plain ?? "");
  return `<span class="rich-text">${inner}</span>`;
}

function findNextSemanticMatch(text, start) {
  let best = null;
  for (const rule of HIGHLIGHT_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags || "gi");
    re.lastIndex = start;
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = {
        index: m.index,
        len: m[0].length,
        className: rule.className,
      };
    }
  }
  return best;
}

function enhanceRichText(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    if (!node.parentElement) continue;
    const t = node.textContent;
    if (!t || t.length < 2) continue;
    if (!/[a-z]/i.test(t)) continue;
    if (node.parentElement.closest('span[style*="color"]')) continue;
    if (!/cold|ice|frost|freeze|chill|glacial|blizzard|fire|burn|flame|lightning|electr|shock|\-\d+%/i.test(t))
      continue;

    let i = 0;
    const parent = node.parentNode;
    if (!parent) continue;
    const frag = document.createDocumentFragment();

    while (i < t.length) {
      const match = findNextSemanticMatch(t, i);
      if (!match) {
        frag.appendChild(document.createTextNode(t.slice(i)));
        break;
      }
      if (match.index > i) {
        frag.appendChild(document.createTextNode(t.slice(i, match.index)));
      }
      const span = document.createElement("span");
      span.className = match.className;
      span.textContent = t.slice(match.index, match.index + match.len);
      frag.appendChild(span);
      i = match.index + match.len;
    }

    parent.replaceChild(frag, node);
  }
}

function postProcessRich(root) {
  if (!root) return;
  root.querySelectorAll(".rich-text").forEach((el) => enhanceRichText(el));
}

function imgSmall(src, alt, cls) {
  if (!src) {
    return `<div class="${cls} ${cls}--empty">—</div>`;
  }
  const u = new URL(src, DATA_BASE).href;
  return `<img class="${cls}" src="${esc(u)}" alt="${esc(alt)}" loading="lazy" />`;
}

function weaponTier2ModalHtml(u) {
  const t3 = (u.tier3 || [])
    .map(
      (t) => `
    <div class="tier3-card tier3-card--modal">
      ${imgSmall(t.icon, t.name, "tier3-card__icon")}
      <div class="tier3-card__text">
        <h4>${richContent(t.nameHtml, t.name)}</h4>
        <p>${richContent(t.descriptionHtml, t.description)}</p>
      </div>
    </div>`
    )
    .join("");
  const headIcon = imgSmall(u.tier2Icon, u.tier2Name, "modal-tier2-icon");
  return `
    <div class="weapon-modal-tier2">
      <div class="weapon-modal-tier2__head">${headIcon}
        <div>
          <p class="weapon-modal-tier2__label">Tier 2</p>
          <p class="weapon-modal-tier2__name">${richContent(u.tier2NameHtml, u.tier2Name)}</p>
        </div>
      </div>
      <p class="weapon-modal-tier2__stats">${richContent(u.tier2StatsHtml, u.tier2Stats)}</p>
      <p class="tier3-label">Tier 3 upgrades</p>
      <div class="tier3-grid tier3-grid--modal">${t3 || `<p class="empty-state">No tier 3 data.</p>`}</div>
    </div>`;
}

function renderWeapons(weapons, nav) {
  const root = document.getElementById("weapons-root");
  const baseId = nav && nav.baseId;
  const parts = [];

  if (baseId) {
    const w = weapons.find((x) => x.id === baseId);
    if (!w) {
      nav.baseId = null;
      return renderWeapons(weapons, nav);
    }

    const titleHtml = w.tier1NameHtml
      ? richContent(w.tier1NameHtml, w.name)
      : esc(w.name);

    parts.push(`
      <div class="weapon-nav">
        <button type="button" class="weapon-nav__back" data-weapons-back aria-label="Back to base weapons">
          ← Back
        </button>
        <div class="weapon-nav__title">
          <span class="weapon-nav__eyebrow">Tier 2 paths</span>
          <div class="weapon-nav__h">${titleHtml}</div>
        </div>
      </div>
      <p class="weapon-nav__hint">Choose a tier 2 weapon to see tier 3 upgrades.</p>
    `);

    const upgrades = w.upgrades || [];
    if (!upgrades.length) {
      parts.push(`<p class="empty-state">No upgrade data.</p>`);
    } else {
      for (let i = 0; i < upgrades.length; i++) {
        const u = upgrades[i];
        parts.push(`
      <button type="button" class="artifact-card weapon-tier2-card" data-base-id="${esc(
        w.id
      )}" data-tier2-index="${i}">
        ${imgSmall(u.tier2Icon, u.tier2Name, "artifact-card__icon")}
        <div class="artifact-card__meta">
          <h3>${richContent(u.tier2NameHtml, u.tier2Name)}</h3>
          <p class="weapon-tier2-card__stats">${richContent(u.tier2StatsHtml, u.tier2Stats)}</p>
        </div>
      </button>`);
      }
    }

    root.innerHTML = parts.join("") || `<p class="empty-state">Nothing here.</p>`;
    postProcessRich(root);
    return;
  }

  for (const w of weapons) {
    const titleHtml = w.tier1NameHtml
      ? richContent(w.tier1NameHtml, w.name)
      : esc(w.name);

    parts.push(`
      <button type="button" class="artifact-card weapon-base-card" data-base-id="${esc(
        w.id
      )}">
        ${imgSmall(w.tier1Icon, w.name, "artifact-card__icon")}
        <div class="artifact-card__meta">
          <h3 class="weapon-base-card__title">${titleHtml}</h3>
          <p class="weapon-base-card__tier">Base · Tier 1</p>
          <div class="weapon-base-card__desc">${richContent(
            w.tier1DescriptionHtml,
            w.tier1Description
          )}</div>
        </div>
      </button>`);
  }

  root.innerHTML =
    parts.join("") ||
    `<p class="empty-state">No weapon data.</p>`;
  postProcessRich(root);
}

function artifactComboSetNames(a) {
  if (a.comboSets && a.comboSets.length) return a.comboSets;
  return a.comboSet ? [a.comboSet] : [];
}

function artifactRarityKind(rarity) {
  const r = String(rarity || "").toLowerCase();
  if (r.includes("rare bond")) return "bond";
  if (r.includes("eternal")) return "eternal";
  if (r.includes("legendary")) return "legendary";
  if (r.includes("rare")) return "rare";
  if (r.includes("advanced")) return "advanced";
  if (r.includes("common")) return "common";
  return "";
}

function artifactRaritySortRank(rarity) {
  const r = String(rarity || "").toLowerCase();
  if (r.includes("eternal")) return 6;
  if (r.includes("legendary")) return 5;
  if (r.includes("rare bond")) return 4;
  if (r.includes("rare")) return 3;
  if (r.includes("advanced")) return 2;
  if (r.includes("common")) return 1;
  return 0;
}

function sortArtifactsByRarity(artifacts) {
  return [...artifacts].sort((a, b) => {
    const ra = artifactRaritySortRank(a.rarity);
    const rb = artifactRaritySortRank(b.rarity);
    if (rb !== ra) return rb - ra;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function artifactRarityClass(rarity) {
  const k = artifactRarityKind(rarity);
  return k ? `artifact-card--${k}` : "";
}

function comboSetNamesWithIcons(names, comboByName, iconClass, placeholderClass) {
  const chips = (names || []).map((n) => {
    const set = comboByName && comboByName[n];
    const icon = set?.icon
      ? `<img class="${iconClass}" src="${esc(
          new URL(set.icon, DATA_BASE).href
        )}" alt="" loading="lazy" />`
      : `<span class="${placeholderClass}" aria-hidden="true"></span>`;
    return `<span class="combo-set-inline">${icon}<span class="combo-set-inline__name">${esc(
      n
    )}</span><span class="combo-set-inline__suffix"> set</span></span>`;
  });
  return chips.join(`<span class="combo-set-inline-sep"> · </span>`);
}

function renderArtifactSetChips(comboSets, selectedFilter) {
  const wrap = document.getElementById("artifact-set-filters");
  if (!wrap) return;

  const sel = (selectedFilter || "").trim();
  const list = (comboSets || [])
    .map((s) => s.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const allActive = !sel ? " is-active" : "";
  const chips = [
    `<button type="button" class="set-chip set-chip--all${allActive}" data-set-filter="" aria-pressed="${!sel}">
      <span class="set-chip__name">All sets</span>
    </button>`,
  ];

  for (const name of list) {
    const active = sel === name ? " is-active" : "";
    const set = comboSets.find((s) => s.name === name);
    const iconHtml = set?.icon
      ? `<img class="set-chip__icon" src="${esc(
          new URL(set.icon, DATA_BASE).href
        )}" alt="" loading="lazy" />`
      : `<span class="set-chip__icon set-chip__icon--placeholder" aria-hidden="true"></span>`;
    chips.push(
      `<button type="button" class="set-chip${active}" data-set-filter="${esc(
        name
      )}" aria-pressed="${sel === name}">
        ${iconHtml}
        <span class="set-chip__name">${esc(name)}</span>
      </button>`
    );
  }

  wrap.innerHTML = chips.join("");
}

function renderArtifacts(artifacts, setFilter, comboByName) {
  const sf = (setFilter || "").trim();
  const root = document.getElementById("artifacts-root");
  const parts = [];
  const cb = comboByName || {};

  if (!artifacts.length) {
    root.innerHTML = `<p class="empty-state">No artifact data.</p>`;
    return;
  }

  const filtered = artifacts.filter((a) => {
    if (!sf) return true;
    return artifactComboSetNames(a).includes(sf);
  });
  if (!filtered.length) {
    root.innerHTML = `<p class="empty-state">No artifacts in this set.</p>`;
    return;
  }

  const sorted = sortArtifactsByRarity(filtered);
  for (const a of sorted) {
    const icon =
      a.icon &&
      `<img class="artifact-card__icon" src="${esc(
        new URL(a.icon, DATA_BASE).href
      )}" alt="" loading="lazy" />`;
    const ph = !a.icon && `<div class="artifact-card__placeholder"></div>`;

    const rarityCls = artifactRarityClass(a.rarity);
    const rk = artifactRarityKind(a.rarity);
    const names = artifactComboSetNames(a);
    const comboLine =
      names.length > 0
        ? `<p class="artifact-card__combo-set">${comboSetNamesWithIcons(
            names,
            cb,
            "artifact-card__set-icon",
            "artifact-card__set-icon artifact-card__set-icon--empty"
          )}</p>`
        : "";
    const rarityLabelCls = rk
      ? `artifact-card__rarity artifact-card__rarity--${rk}`
      : "artifact-card__rarity";
    parts.push(`
      <button type="button" class="artifact-card${rarityCls ? ` ${rarityCls}` : ""}" data-artifact-id="${esc(
        a.id
      )}">
        ${icon || ph}
        <div class="artifact-card__meta">
          <h3>${esc(a.name)}</h3>
          <p class="artifact-card__stars">${esc(a.stars)}</p>
          ${comboLine}
          <p class="${rarityLabelCls}">${esc(a.rarity)}</p>
        </div>
      </button>`);
  }

  root.innerHTML = parts.join("") || `<p class="empty-state">No artifacts.</p>`;
}

function renderComboEffects(comboSets) {
  const root = document.getElementById("combo-effects-root");
  if (!root) return;

  const parts = (comboSets || []).map((s) => {
    const headIcon = s.icon
      ? `<img class="combo-effect-card__icon" src="${esc(
          new URL(s.icon, DATA_BASE).href
        )}" alt="" loading="lazy" />`
      : `<div class="combo-effect-card__icon combo-effect-card__icon--empty">—</div>`;
    const rows = (s.tiers || [])
      .map(
        (t) => `
          <tr>
            <td>${esc(String(t.pieces))}</td>
            <td>${richContent(t.effectHtml, t.effect)}</td>
          </tr>`
      )
      .join("");
    return `
      <article class="combo-effect-card">
        <header class="combo-effect-card__head">
          ${headIcon}
          <h3 class="combo-effect-card__title">${esc(s.name)}</h3>
        </header>
        <table class="combo-set-table">
          <thead>
            <tr>
              <th scope="col">Pieces</th>
              <th scope="col">Effect</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </article>`;
  });

  root.innerHTML =
    parts.join("") ||
    `<p class="empty-state">No combo set data.</p>`;
  postProcessRich(root);
}

function openModal(title, html) {
  const modal = document.getElementById("modal");
  const body = document.getElementById("modal-body");
  body.innerHTML = `<h3 id="modal-title">${esc(title)}</h3>${html}`;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  postProcessRich(body);
}

function closeModal() {
  const modal = document.getElementById("modal");
  modal.hidden = true;
  document.body.style.overflow = "";
}

function artifactModalHtml(a, comboByName) {
  const setNames = artifactComboSetNames(a);
  const setPanels = setNames
    .map((setName, idx) => {
      const set = comboByName && comboByName[setName];
      const titleId = `combo-set-title-${idx}`;
      if (set) {
        return `
    <section class="combo-set-panel" aria-labelledby="${titleId}">
      <h4 id="${titleId}" class="combo-set-panel__title">
        ${
          set.icon
            ? `<img class="combo-set-panel__set-icon" src="${esc(
                new URL(set.icon, DATA_BASE).href
              )}" alt="" loading="lazy" />`
            : ""
        }
        <span>${esc(set.name)} set effects</span>
      </h4>
      <table class="combo-set-table">
        <thead>
          <tr>
            <th scope="col">Pieces</th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          ${set.tiers
            .map(
              (t) => `
          <tr>
            <td>${esc(String(t.pieces))}</td>
            <td>${richContent(t.effectHtml, t.effect)}</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
      }
      return `<p class="combo-set-missing">No tier list in data for “${esc(
        setName
      )}”.</p>`;
    })
    .join("");

  const rk = artifactRarityKind(a.rarity);
  const rarityRow = rk
    ? `<span class="artifact-rarity-text artifact-rarity-text--${rk}">${esc(
        a.rarity
      )}</span>`
    : richContent(a.rarityHtml, a.rarity);

  const comboDd =
    setNames.length > 0
      ? comboSetNamesWithIcons(
          setNames,
          comboByName,
          "artifact-modal__set-icon",
          "artifact-modal__set-icon artifact-modal__set-icon--empty"
        )
      : "—";

  const comboEffectsSection =
    setNames.length > 0
      ? `<section class="artifact-detail-combo" aria-labelledby="artifact-combo-fx-title">
      <h4 id="artifact-combo-fx-title" class="artifact-detail-combo__title">Combo set effects</h4>
      <div class="artifact-detail-combo__panels">
        ${setPanels}
      </div>
    </section>`
      : "";

  return `<div class="artifact-modal">
    <dl class="modal-dl modal-dl--artifact">
      <dt>Stars</dt><dd>${esc(a.stars)}</dd>
      <dt>Combo set</dt><dd class="modal-dd--combo-sets">${comboDd}</dd>
      <dt>Rarity</dt><dd>${rarityRow}</dd>
      <dt>Placement</dt><dd>${richContent(a.placementHtml, a.placement)}</dd>
      <dt>Stats / effects</dt><dd>${richContent(a.statsHtml, a.stats)}</dd>
      <dt>Flavor</dt><dd>${richContent(a.flavorHtml, a.flavor)}</dd>
    </dl>
    ${comboEffectsSection}
  </div>`;
}

function main() {
  let weaponsData = [];
  let artifactsData = [];
  let comboSets = [];
  let comboByName = {};
  const weaponNavState = { baseId: null };
  let artifactSetFilter = "";

  const tabs = document.querySelectorAll(".tabs__btn");
  const panelWeapons = document.getElementById("panel-weapons");
  const panelArtifacts = document.getElementById("panel-artifacts");
  const panelComboEffects = document.getElementById("panel-combo-effects");

  function refresh() {
    renderWeapons(weaponsData, weaponNavState);
    renderArtifacts(artifactsData, artifactSetFilter, comboByName);
    renderArtifactSetChips(comboSets, artifactSetFilter);
    renderComboEffects(comboSets);
  }

  function activatePanel(panel) {
    const isWeapons = panel === "weapons";
    const isArtifacts = panel === "artifacts";
    const isCombo = panel === "combo-effects";

    panelWeapons.classList.toggle("is-active", isWeapons);
    panelWeapons.hidden = !isWeapons;
    panelArtifacts.classList.toggle("is-active", isArtifacts);
    panelArtifacts.hidden = !isArtifacts;
    panelComboEffects.classList.toggle("is-active", isCombo);
    panelComboEffects.hidden = !isCombo;

    tabs.forEach((b) => {
      b.classList.toggle("is-active", b.dataset.panel === panel);
    });
  }

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel;
      if (panel === "weapons") activatePanel("weapons");
      else if (panel === "artifacts") activatePanel("artifacts");
      else if (panel === "combo-effects") activatePanel("combo-effects");
    });
  });

  document.getElementById("artifact-set-filters")?.addEventListener("click", (e) => {
    const chip = e.target.closest(".set-chip");
    if (!chip) return;
    artifactSetFilter = chip.dataset.setFilter ?? "";
    refresh();
  });

  document.getElementById("weapons-root").addEventListener("click", (e) => {
    const back = e.target.closest("[data-weapons-back]");
    if (back) {
      weaponNavState.baseId = null;
      renderWeapons(weaponsData, weaponNavState);
      return;
    }
    const baseBtn = e.target.closest(".weapon-base-card");
    if (baseBtn) {
      weaponNavState.baseId = baseBtn.dataset.baseId;
      renderWeapons(weaponsData, weaponNavState);
      return;
    }
    const t2 = e.target.closest(".weapon-tier2-card");
    if (t2) {
      const w = weaponsData.find((x) => x.id === t2.dataset.baseId);
      const idx = +t2.dataset.tier2Index;
      if (!w?.upgrades?.[idx]) return;
      openModal(w.upgrades[idx].tier2Name, weaponTier2ModalHtml(w.upgrades[idx]));
    }
  });

  document.getElementById("artifacts-root").addEventListener("click", (e) => {
    const btn = e.target.closest(".artifact-card");
    if (!btn) return;
    const id = btn.dataset.artifactId;
    const a = artifactsData.find((x) => x.id === id);
    if (!a) return;
    let iconBlock = "";
    if (a.icon) {
      const u = new URL(a.icon, DATA_BASE).href;
      iconBlock = `<p class="modal-icon"><img src="${esc(
        u
      )}" alt="" loading="lazy" /></p>`;
    }
    openModal(a.name, iconBlock + artifactModalHtml(a, comboByName));
  });

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeModal());
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modal = document.getElementById("modal");
    if (!modal.hidden) {
      closeModal();
      return;
    }
    if (weaponNavState.baseId) {
      weaponNavState.baseId = null;
      renderWeapons(weaponsData, weaponNavState);
    }
  });

  loadJson("weapons.json")
    .then((d) => {
      weaponsData = d.weapons || [];
      return loadJson("artifacts.json");
    })
    .then((d) => {
      artifactsData = d.artifacts || [];
      return loadJson("comboSets.json").catch(() => ({ comboSets: [] }));
    })
    .then((d) => {
      comboSets = d.comboSets || [];
      comboByName = Object.fromEntries(comboSets.map((s) => [s.name, s]));
      refresh();
    })
    .catch((err) => {
      document.getElementById("weapons-root").innerHTML = `<p class="empty-state">${esc(
        String(err.message)
      )}</p>`;
      document.getElementById("artifacts-root").innerHTML = "";
      const comboRoot = document.getElementById("combo-effects-root");
      if (comboRoot) comboRoot.innerHTML = "";
    });
}

main();
