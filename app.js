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

function renderWeapons(weapons, query, nav) {
  const q = query.trim().toLowerCase();
  const root = document.getElementById("weapons-root");
  const baseId = nav && nav.baseId;
  const parts = [];

  if (baseId) {
    const w = weapons.find((x) => x.id === baseId);
    if (!w) {
      nav.baseId = null;
      return renderWeapons(weapons, query, nav);
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
        const blob = JSON.stringify(u)
          .replace(/<[^>]+>/g, " ")
          .toLowerCase();
        const match = !q || blob.includes(q);
        const hidden = match ? "" : " is-hidden";
        parts.push(`
      <button type="button" class="artifact-card weapon-tier2-card${hidden}" data-base-id="${esc(
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
    const searchBlob = JSON.stringify(w)
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    const match = !q || searchBlob.includes(q);
    const hidden = match ? "" : " is-hidden";

    const titleHtml = w.tier1NameHtml
      ? richContent(w.tier1NameHtml, w.name)
      : esc(w.name);

    parts.push(`
      <button type="button" class="artifact-card weapon-base-card${hidden}" data-base-id="${esc(
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
    `<p class="empty-state">No weapons match your search.</p>`;
  postProcessRich(root);
}

function renderArtifacts(artifacts, query) {
  const q = query.trim().toLowerCase();
  const root = document.getElementById("artifacts-root");
  const parts = [];

  for (const a of artifacts) {
    const searchBlob = JSON.stringify(a)
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    const match = !q || searchBlob.includes(q);
    const hidden = match ? "" : " is-hidden";

    const icon =
      a.icon &&
      `<img class="artifact-card__icon" src="${esc(
        new URL(a.icon, DATA_BASE).href
      )}" alt="" loading="lazy" />`;
    const ph = !a.icon && `<div class="artifact-card__placeholder"></div>`;

    parts.push(`
      <button type="button" class="artifact-card${hidden}" data-artifact-id="${esc(
        a.id
      )}">
        ${icon || ph}
        <div class="artifact-card__meta">
          <h3>${esc(a.name)}</h3>
          <p class="artifact-card__stars">${esc(a.stars)}</p>
          <p class="artifact-card__rarity">${esc(a.rarity)}</p>
        </div>
      </button>`);
  }

  root.innerHTML =
    parts.join("") ||
    `<p class="empty-state">No artifacts match your search.</p>`;
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

function artifactModalHtml(a) {
  return `
    <dl class="modal-dl">
      <dt>Stars</dt><dd>${esc(a.stars)}</dd>
      <dt>Rarity</dt><dd>${richContent(a.rarityHtml, a.rarity)}</dd>
      <dt>Placement</dt><dd>${richContent(a.placementHtml, a.placement)}</dd>
      <dt>Stats / effects</dt><dd>${richContent(a.statsHtml, a.stats)}</dd>
      <dt>Flavor</dt><dd>${richContent(a.flavorHtml, a.flavor)}</dd>
    </dl>
  `;
}

function main() {
  let weaponsData = [];
  let artifactsData = [];
  const weaponNavState = { baseId: null };

  const search = document.getElementById("search");
  const tabs = document.querySelectorAll(".tabs__btn");
  const panelWeapons = document.getElementById("panel-weapons");
  const panelArtifacts = document.getElementById("panel-artifacts");

  function currentQuery() {
    return search.value;
  }

  function refresh() {
    const q = currentQuery();
    renderWeapons(weaponsData, q, weaponNavState);
    renderArtifacts(artifactsData, q);
  }

  search.addEventListener("input", () => {
    weaponNavState.baseId = null;
    refresh();
  });

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel;
      tabs.forEach((b) => b.classList.toggle("is-active", b === btn));
      const isWeapons = panel === "weapons";
      panelWeapons.classList.toggle("is-active", isWeapons);
      panelWeapons.hidden = !isWeapons;
      panelArtifacts.classList.toggle("is-active", !isWeapons);
      panelArtifacts.hidden = isWeapons;
    });
  });

  document.getElementById("weapons-root").addEventListener("click", (e) => {
    const back = e.target.closest("[data-weapons-back]");
    if (back) {
      weaponNavState.baseId = null;
      renderWeapons(weaponsData, currentQuery(), weaponNavState);
      return;
    }
    const baseBtn = e.target.closest(".weapon-base-card");
    if (baseBtn) {
      weaponNavState.baseId = baseBtn.dataset.baseId;
      renderWeapons(weaponsData, currentQuery(), weaponNavState);
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
    openModal(a.name, iconBlock + artifactModalHtml(a));
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
      renderWeapons(weaponsData, currentQuery(), weaponNavState);
    }
  });

  loadJson("weapons.json")
    .then((d) => {
      weaponsData = d.weapons || [];
      return loadJson("artifacts.json");
    })
    .then((d) => {
      artifactsData = d.artifacts || [];
      refresh();
    })
    .catch((err) => {
      document.getElementById("weapons-root").innerHTML = `<p class="empty-state">${esc(
        String(err.message)
      )}</p>`;
      document.getElementById("artifacts-root").innerHTML = "";
    });
}

main();
