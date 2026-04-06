import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseCsv } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function sliceAfterStyle(html) {
  const i = html.indexOf("</style>");
  return i >= 0 ? html.slice(i + 8) : html;
}

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtmlAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function stripHtmlTags(html) {
  if (!html) return "";
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
}

function cleanStyleAttr(styleStr) {
  const parts = String(styleStr)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (k === "color") {
      if (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(v))
        out.push(`${k}: ${v}`);
    } else if (k === "font-weight" && /^(bold|normal|bolder|lighter|\d{3})$/.test(v)) {
      out.push(`${k}: ${v}`);
    } else if (k === "font-size" && /^[\d.]+\s*(pt|px|%|em)$/.test(v)) {
      out.push(`${k}: ${v}`);
    } else if (
      k === "text-decoration" ||
      k === "text-decoration-skip-ink" ||
      k === "-webkit-text-decoration-skip"
    ) {
      out.push(`${k}: ${v}`);
    }
  }
  return out.join("; ");
}

function sanitizeSheetHtml(inner) {
  if (!inner) return "";
  let s = inner.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<a\s+[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  s = s.replace(/<br\s*\/?>/gi, "<br>");
  s = s.replace(/<\/?div[^>]*>/gi, "");
  for (let pass = 0; pass < 24; pass++) {
    const next = s.replace(
      /<span\s+style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi,
      (match, style, content) => {
        const cleaned = cleanStyleAttr(style);
        if (!cleaned) return content;
        return `<span style="${escapeHtmlAttr(cleaned)}">${content}</span>`;
      }
    );
    if (next === s) break;
    s = next;
  }
  s = s.replace(/<(?!\/?(?:br|span)\b)[^>]+>/gi, "");
  return s.trim();
}

function cellHtmlForText(inner) {
  return inner.replace(/<div[^>]*>[\s\S]*?<img[^>]*>[\s\S]*?<\/div>/gi, "").trim();
}

function parseRowInner(inner) {
  const imgM = inner.match(/src="([^"]+)"/);
  const img = imgM ? imgM[1] : "";
  const forHtml = cellHtmlForText(inner);
  const html = sanitizeSheetHtml(forHtml);
  const text = stripHtmlTags(html);
  return {
    text,
    html,
    img,
  };
}

function parseCells(rowHtml) {
  const cells = [];
  const re = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const attrs = m[1];
    const rs = +((attrs.match(/rowspan="(\d+)"/) || [, "1"])[1] || 1);
    const cs = +((attrs.match(/colspan="(\d+)"/) || [, "1"])[1] || 1);
    const inner = m[2];
    const { text, html, img } = parseRowInner(inner);
    cells.push({ rs, cs, text, html, img, raw: inner });
  }
  return cells;
}

function isSep(c) {
  return !c.img && !String(c.text || "").trim();
}

function buildWeaponGrid(trs) {
  const grid = [];
  for (let r = 0; r < trs.length; r++) {
    const cells = parseCells(trs[r]);
    let c = 0;
    let cellIdx = 0;
    while (cellIdx < cells.length) {
      while (grid[r]?.[c] != null) {
        c++;
      }
      const cell = cells[cellIdx++];
      const rs = cell.rs || 1;
      const cs = cell.cs || 1;
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][c + dc] = {
            cell,
            anchor: dr === 0 && dc === 0,
          };
        }
      }
      c += cs;
    }
  }
  return grid;
}

function findBaseColumnRanges(grid, tier1RowIndex) {
  const row = grid[tier1RowIndex];
  if (!row) return [];
  const starts = [];
  for (let c = 0; c < row.length; c++) {
    const slot = row[c];
    if (slot?.anchor && /Tier\s*1/i.test(slot.cell.text || "")) {
      starts.push(c);
    }
  }
  const ends = starts.slice(1).concat([row.length]);
  return starts.map((s, i) => ({ start: s, end: ends[i] }));
}

function getCellsInBaseRange(grid, rowIndex, range) {
  const row = grid[rowIndex];
  if (!row) return [];
  const out = [];
  for (let c = range.start; c < range.end; c++) {
    const slot = row[c];
    if (slot?.anchor) {
      out.push(slot.cell);
    }
  }
  return out;
}

function parseTier1Row(cells) {
  const bases = [];
  let i = 2;
  while (i < cells.length) {
    const c = cells[i];
    if (isSep(c)) {
      i++;
      continue;
    }
    if (c.cs === 3 && c.text.includes("Tier 1")) {
      const nameLine = c.text.split(/\n/)[0].replace(/\s*Tier\s*1\s*$/i, "").trim();
      const nameRaw = c.raw || "";
      const nameHtml = sanitizeSheetHtml(
        nameRaw.split(/<br[^>]*>/i)[0] || nameRaw
      );
      const icon = cells[i + 1]?.img || "";
      const descCell = cells[i + 2];
      const desc = descCell?.text || "";
      const descHtml = descCell?.html || "";
      bases.push({
        name: nameLine,
        tier1NameHtml: nameHtml,
        tier1Icon: icon,
        tier1Description: desc,
        tier1DescriptionHtml: descHtml,
      });
      i += 3;
      continue;
    }
    i++;
  }
  return bases;
}

function parseWeapons(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) return { bases: [], upgradesByBase: [] };
  const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (trs.length < 5) return { bases: [], upgradesByBase: [] };

  const tier1Cells = parseCells(trs[1]);
  const bases = parseTier1Row(tier1Cells);
  const n = bases.length;

  const grid = buildWeaponGrid(trs);
  const baseRanges = findBaseColumnRanges(grid, 1);
  if (baseRanges.length !== n) {
    console.warn(
      `Weapons: Tier 1 column ranges (${baseRanges.length}) != bases (${n})`
    );
  }

  const upgradesByBase = bases.map(() => []);

  for (let r = 4; r < trs.length; r++) {
    for (let b = 0; b < n; b++) {
      const range = baseRanges[b];
      const blockCells = range ? getCellsInBaseRange(grid, r, range) : [];
      if (!blockCells.length) continue;

      const st = upgradesByBase[b];
      const last = st[st.length - 1];
      const inCont =
        last &&
        last._open &&
        last.tier3.length < last._need;

      if (inCont && blockCells.length >= 3) {
        if (!String(blockCells[1]?.text || "").trim()) continue;
        last.tier3.push({
          icon: blockCells[0].img || "",
          name: blockCells[1].text || "",
          nameHtml: blockCells[1].html || "",
          description: blockCells[2].text || "",
          descriptionHtml: blockCells[2].html || "",
        });
        if (last.tier3.length >= last._need) {
          delete last._open;
          delete last._need;
        }
        continue;
      }

      for (let offset = 0; offset + 6 <= blockCells.length; offset += 6) {
        const slice = blockCells.slice(offset, offset + 6);
        const t2i = slice[0];
        const t2n = slice[1];
        const t2s = slice[2];
        const t3i = slice[3];
        const t3n = slice[4];
        const t3s = slice[5];
        if (!String(t2n.text || "").trim()) continue;

        const rs = t2i.rs || t2n.rs || t2s.rs || 1;

        const entry = {
          tier2Icon: t2i.img || "",
          tier2Name: t2n.text || "",
          tier2NameHtml: t2n.html || "",
          tier2Stats: t2s.text || "",
          tier2StatsHtml: t2s.html || "",
          tier3: [
            {
              icon: t3i.img || "",
              name: t3n.text || "",
              nameHtml: t3n.html || "",
              description: t3s.text || "",
              descriptionHtml: t3s.html || "",
            },
          ],
        };

        if (rs > 1) {
          entry._open = true;
          entry._need = rs;
        }

        st.push(entry);
      }
    }
  }

  for (const list of upgradesByBase) {
    for (const u of list) {
      delete u._open;
      delete u._need;
    }
  }

  return { bases, upgradesByBase };
}

function rowIsSpacer(cells) {
  if (cells.length < 100) return false;
  let nonempty = 0;
  for (let i = 2; i < cells.length; i++) {
    const c = cells[i];
    if (c.text?.trim()) nonempty++;
  }
  return nonempty < 3;
}

function cs5Values(cells) {
  const out = [];
  for (const c of cells) {
    if (c.cs >= 5 && c.text.trim()) out.push(c.text.trim());
  }
  return out;
}

function cs5HtmlFields(cells) {
  const out = [];
  for (const c of cells) {
    if (c.cs >= 5 && c.text.trim()) out.push(c.html || "");
  }
  return out;
}

function cs3ComboSetNames(cells) {
  const out = [];
  for (const c of cells) {
    if (c.cs === 3 && c.text.trim()) {
      const t = c.text.trim();
      if (t !== "[Unique]") out.push(t);
    }
  }
  return out;
}

function findArtifactBaseRanges(grid, nameRowIndex) {
  const row = grid[nameRowIndex];
  if (!row) return [];
  const starts = [];
  for (let c = 0; c < row.length; c++) {
    const slot = row[c];
    if (!slot?.anchor) continue;
    const cell = slot.cell;
    const t = cell.text.trim();
    if (
      cell.cs >= 5 &&
      t.length > 1 &&
      !t.startsWith("★") &&
      !t.includes("Physical DMG") &&
      !t.includes("Common Artifact")
    ) {
      starts.push(c);
    }
  }
  const ends = starts.slice(1).concat([row.length]);
  return starts.map((s, i) => ({ start: s, end: ends[i] }));
}

function comboSetsPerArtifactColumn(sectionRows) {
  const grid = buildWeaponGrid(sectionRows);
  const ranges = findArtifactBaseRanges(grid, 0);
  if (!ranges.length) return [];
  return ranges.map((range) => {
    const cells = getCellsInBaseRange(grid, 4, range);
    const names = [];
    for (const c of cells) {
      if (c.cs === 3 && c.text.trim()) {
        const t = c.text.trim();
        if (t !== "[Unique]") names.push(t);
      }
    }
    return names;
  });
}

function extractImagesFromRow(html) {
  const imgs = [];
  const re = /src="([^"]+cellImage[^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) imgs.push(m[1]);
  return imgs;
}

function rowLooksLikeNameRow(cells) {
  const v = cs5Values(cells);
  return v.some(
    (t) =>
      t.length > 2 &&
      !t.startsWith("★") &&
      !/^\d+$/.test(t) &&
      !t.includes("Physical DMG") &&
      !t.includes("Common Artifact")
  );
}

function trimArtifactSection(rows) {
  let i = 0;
  while (i < rows.length && !rowLooksLikeNameRow(parseCells(rows[i]))) i++;
  return rows.slice(i);
}

function parseArtifactSections(trs) {
  const sections = [];
  let buf = [];
  const pushSection = (rows) => {
    const trimmed = trimArtifactSection(rows);
    if (trimmed.length > 8) sections.push(trimmed);
  };

  for (let i = 0; i < trs.length; i++) {
    const cells = parseCells(trs[i]);
    if (rowIsSpacer(cells)) {
      if (buf.length === 0) continue;
      while (buf.length > 11) {
        pushSection(buf.slice(0, 11));
        buf = buf.slice(11);
      }
      if (buf.length === 11) {
        pushSection(buf);
        buf = [];
        continue;
      }
      buf.push(trs[i]);
      continue;
    }
    if (buf.length === 11) {
      pushSection(buf);
      buf = [];
    }
    buf.push(trs[i]);
  }
  while (buf.length >= 11) {
    pushSection(buf.slice(0, 11));
    buf = buf.slice(11);
  }
  return sections;
}

function parseArtifactSection(sectionRows) {
  if (sectionRows.length < 11) return [];
  const names = cs5Values(parseCells(sectionRows[0])).filter(
    (t) => t.length > 1 && !t.startsWith("★")
  );
  const stars = cs5Values(parseCells(sectionRows[1])).filter((t) =>
    t.includes("★")
  );
  const row3Imgs = extractImagesFromRow(sectionRows[2] || "");
  const comboSetsCol = comboSetsPerArtifactColumn(sectionRows);
  const comboSetNamesFlat = cs3ComboSetNames(parseCells(sectionRows[4] || ""));
  const placement = cs5Values(parseCells(sectionRows[6] || ""));
  const placementHtml = cs5HtmlFields(parseCells(sectionRows[6] || ""));
  const stats = cs5Values(parseCells(sectionRows[7] || ""));
  const statsHtml = cs5HtmlFields(parseCells(sectionRows[7] || ""));
  const flavor = cs5Values(parseCells(sectionRows[9] || ""));
  const flavorHtml = cs5HtmlFields(parseCells(sectionRows[9] || ""));
  const rarity = cs5Values(parseCells(sectionRows[10] || ""));
  const rarityHtml = cs5HtmlFields(parseCells(sectionRows[10] || ""));

  const n = Math.max(
    names.length,
    stars.length,
    stats.length,
    flavor.length,
    rarity.length
  );

  const artifacts = [];
  for (let i = 0; i < n; i++) {
    const setsFromCol = comboSetsCol[i] || [];
    const sets =
      setsFromCol.length > 0
        ? setsFromCol
        : comboSetNamesFlat.length === n && comboSetNamesFlat[i]
          ? [comboSetNamesFlat[i]]
          : [];
    artifacts.push({
      id: `artifact-${globalArtifactIndex++}`,
      name: names[i] || `Unknown ${i + 1}`,
      stars: stars[i] || "",
      icon: row3Imgs[i] || "",
      comboSet: sets[0] || "",
      comboSets: sets,
      placement: placement[i] || "",
      placementHtml: placementHtml[i] || "",
      stats: stats[i] || "",
      statsHtml: statsHtml[i] || "",
      flavor: flavor[i] || "",
      flavorHtml: flavorHtml[i] || "",
      rarity: rarity[i] || "",
      rarityHtml: rarityHtml[i] || "",
    });
  }
  return artifacts;
}

let globalArtifactIndex = 0;

function parseArtifacts(html) {
  globalArtifactIndex = 0;
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) return [];
  const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const sections = parseArtifactSections(trs);
  const all = [];
  for (const sec of sections) {
    all.push(...parseArtifactSection(sec));
  }
  return all;
}

function isComboEffectsHeaderRow(cells) {
  if (cells.length !== 14 && cells.length !== 17) return false;
  const t3 = String(cells[3]?.text || "").trim();
  if (!cells[2]?.img || cells[3]?.cs !== 4 || !t3) return false;
  if (/^\+|^\-/.test(t3)) return false;
  if (/^\d/.test(t3)) return false;
  if (t3.includes("Activate")) return false;
  if (t3.includes("Doubles")) return false;
  if (t3.includes("%") && t3.length > 12) return false;
  if (t3.length > 22) return false;
  return true;
}

function isComboEffectsDataRow(cells) {
  if (cells.length !== 14 && cells.length !== 17) return false;
  if (isComboEffectsHeaderRow(cells)) return false;
  if (cells[3]?.cs !== 4) return false;
  const lv = String(cells[2]?.text || "").trim();
  return /^\d+$/.test(lv);
}

function extractComboHeader(cells) {
  const names = [];
  const icons = [];
  for (let i = 0; i < 4; i++) {
    const ic = cells[2 + 3 * i];
    const nm = cells[3 + 3 * i];
    if (!nm?.text?.trim()) break;
    names.push(nm.text.trim());
    icons.push(ic?.img || "");
  }
  return { names, icons };
}

function extractComboDataRow(cells, setCount) {
  const out = [];
  const n = Math.min(setCount, 4);
  for (let i = 0; i < n; i++) {
    const levelCell = cells[2 + 3 * i];
    const effectCell = cells[3 + 3 * i];
    if (!effectCell) {
      out.push(null);
      continue;
    }
    const levelRaw = String(levelCell?.text || "").trim();
    const effect = String(effectCell?.text || "").trim();
    const effectHtml = sanitizeSheetHtml(
      cellHtmlForText(effectCell.raw || "")
    );
    if (!effect) {
      out.push(null);
      continue;
    }
    const pieces = parseInt(levelRaw, 10);
    out.push({
      pieces: Number.isFinite(pieces) ? pieces : levelRaw,
      effect,
      effectHtml: effectHtml || effect,
    });
  }
  return out;
}

function parseComboEffects(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) return [];
  const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const byName = new Map();

  let r = 0;
  while (r < trs.length) {
    const cells = parseCells(trs[r]);
    if (!isComboEffectsHeaderRow(cells)) {
      r++;
      continue;
    }
    const { names, icons } = extractComboHeader(cells);
    if (!names.length) {
      r++;
      continue;
    }
    r++;
    while (r < trs.length) {
      const dc = parseCells(trs[r]);
      if (isComboEffectsHeaderRow(dc)) break;
      if (dc.length >= 26) break;
      if (isComboEffectsDataRow(dc)) {
        const rowTiers = extractComboDataRow(dc, names.length);
        names.forEach((name, i) => {
          const t = rowTiers[i];
          if (!t) return;
          if (!byName.has(name)) {
            byName.set(name, {
              name,
              icon: icons[i] || "",
              tiers: [],
            });
          } else if (icons[i] && !byName.get(name).icon) {
            byName.get(name).icon = icons[i];
          }
          byName.get(name).tiers.push(t);
        });
      }
      r++;
    }
  }

  const comboSets = [...byName.values()].map((s) => {
    s.tiers.sort((a, b) => {
      const pa = typeof a.pieces === "number" ? a.pieces : 0;
      const pb = typeof b.pieces === "number" ? b.pieces : 0;
      return pa - pb;
    });
    return s;
  });
  comboSets.sort((a, b) => a.name.localeCompare(b.name));
  return comboSets;
}

function applyComboSetOverrides(comboSets, overridesList) {
  if (!overridesList?.length) return comboSets;
  const map = new Map(comboSets.map((s) => [s.name, { ...s, tiers: [...s.tiers] }]));
  for (const o of overridesList) {
    if (!o?.name || !Array.isArray(o.tiers)) continue;
    const prev = map.get(o.name);
    map.set(o.name, {
      name: o.name,
      icon: o.icon || prev?.icon || "",
      tiers: o.tiers.map((t) => ({ ...t })),
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadComboSetOverrides(rootDir) {
  const p = path.join(rootDir, "data", "comboSets.overrides.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(raw) ? raw : raw.overrides ?? [];
  } catch {
    return [];
  }
}

function applyArtifactOverrides(artifacts, overridesList) {
  if (!overridesList?.length) return artifacts;
  const byName = new Map(overridesList.map((o) => [o.name, o]));
  return artifacts.map((a) => {
    const o = byName.get(a.name);
    if (!o) return a;
    const next = { ...a };
    if (Array.isArray(o.comboSets) && o.comboSets.length) {
      next.comboSets = [...o.comboSets];
      next.comboSet = o.comboSets[0] || "";
    }
    return next;
  });
}

function loadArtifactOverrides(rootDir) {
  const p = path.join(rootDir, "data", "artifacts.overrides.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(raw) ? raw : raw.overrides ?? [];
  } catch {
    return [];
  }
}

function rowIsSpacerCsv(cells) {
  if (cells.length < 100) return false;
  let nonempty = 0;
  for (let i = 2; i < cells.length; i++) {
    if (String(cells[i] || "").trim()) nonempty++;
  }
  return nonempty < 3;
}

function rowLooksLikeArtifactNameRowCsv(row) {
  for (const c of row) {
    const t = String(c || "").trim();
    if (t.length <= 2 || t.startsWith("★")) continue;
    if (/^\d+$/.test(t)) continue;
    if (t.includes("Physical DMG") || t.includes("Common Artifact")) continue;
    if (t.length > 2) return true;
  }
  return false;
}

function trimCsvArtifactSection(rows) {
  let i = 0;
  while (i < rows.length && !rowLooksLikeArtifactNameRowCsv(rows[i])) i++;
  return rows.slice(i);
}

function splitCsvArtifactSections(rows) {
  const sections = [];
  let buf = [];
  const pushSection = (b) => {
    const t = trimCsvArtifactSection(b);
    if (t.length > 8) sections.push(t);
  };
  for (const line of rows) {
    if (rowIsSpacerCsv(line)) {
      if (!buf.length) continue;
      while (buf.length > 11) {
        pushSection(buf.slice(0, 11));
        buf = buf.slice(11);
      }
      if (buf.length === 11) {
        pushSection(buf);
        buf = [];
        continue;
      }
      buf.push(line);
      continue;
    }
    if (buf.length === 11) {
      pushSection(buf);
      buf = [];
    }
    buf.push(line);
  }
  while (buf.length >= 11) {
    pushSection(buf.slice(0, 11));
    buf = buf.slice(11);
  }
  return sections;
}

function artifactNameColumnIndicesCsv(nameRow) {
  const idx = [];
  for (let i = 0; i < nameRow.length; i++) {
    const t = String(nameRow[i] || "").trim();
    if (t.length > 1 && !t.startsWith("★") && !/^\d+$/.test(t)) {
      if (t.includes("Physical DMG") || t.includes("Common Artifact")) continue;
      idx.push(i);
    }
  }
  return idx;
}

function comboSetsForArtifactCsv(comboRow1, comboRow2, start, end) {
  const names = [];
  const seen = new Set();
  for (const row of [comboRow1, comboRow2]) {
    if (!row) continue;
    for (let i = start; i < end && i < row.length; i++) {
      const t = String(row[i] || "").trim();
      if (t && t !== "[Unique]" && !seen.has(t)) {
        seen.add(t);
        names.push(t);
      }
    }
  }
  return names;
}

function parseCsvSectionComboSets(sec) {
  if (sec.length < 11) return [];
  const nameRow = sec[0];
  const combo1 = sec[4] || [];
  const combo2 = sec[5] || [];
  const indices = artifactNameColumnIndicesCsv(nameRow);
  if (!indices.length) return [];
  const rowLen = Math.max(nameRow.length, combo1.length, combo2.length);
  const namesOrdered = indices.map((i) => String(nameRow[i] || "").trim());
  const out = [];
  for (let j = 0; j < indices.length; j++) {
    const start = indices[j];
    const end = j + 1 < indices.length ? indices[j + 1] : rowLen;
    const sets = comboSetsForArtifactCsv(combo1, combo2, start, end);
    out.push({ name: namesOrdered[j], comboSets: sets });
  }
  return out;
}

function loadArtifactComboSetsFromCsv(rootDir) {
  const csvPath = path.join(rootDir, "Kean's Sephiria Compendium - Artifacts.csv");
  if (!fs.existsSync(csvPath)) return {};
  let rows;
  try {
    rows = parseCsv(fs.readFileSync(csvPath, "utf8"), {
      relax_column_count: true,
      skip_empty_lines: false,
    });
  } catch {
    return {};
  }
  const sections = splitCsvArtifactSections(rows);
  const byName = {};
  for (const sec of sections) {
    for (const e of parseCsvSectionComboSets(sec)) {
      if (e.name && e.comboSets?.length) byName[e.name] = e.comboSets;
    }
  }
  return byName;
}

function mergeArtifactComboSetsFromCsv(artifacts, comboByName) {
  if (!comboByName || !Object.keys(comboByName).length) return artifacts;
  return artifacts.map((a) => {
    const cs = comboByName[a.name];
    if (!cs?.length) return a;
    return { ...a, comboSets: [...cs], comboSet: cs[0] || "" };
  });
}

function main() {
  const weaponsHtml = fs.readFileSync(path.join(root, "Weapons.html"), "utf8");
  const artifactsHtml = fs.readFileSync(
    path.join(root, "Artifacts.html"),
    "utf8"
  );
  const comboEffectsHtml = fs.readFileSync(
    path.join(root, "Combo Effects.html"),
    "utf8"
  );

  const wParsed = parseWeapons(sliceAfterStyle(weaponsHtml));
  const weapons = wParsed.bases.map((base, i) => ({
    id: `weapon-base-${i}`,
    ...base,
    upgrades: wParsed.upgradesByBase[i] || [],
  }));

  let artifacts = parseArtifacts(sliceAfterStyle(artifactsHtml));
  artifacts = mergeArtifactComboSetsFromCsv(
    artifacts,
    loadArtifactComboSetsFromCsv(root)
  );
  artifacts = applyArtifactOverrides(artifacts, loadArtifactOverrides(root));
  let comboSets = parseComboEffects(sliceAfterStyle(comboEffectsHtml));
  comboSets = applyComboSetOverrides(
    comboSets,
    loadComboSetOverrides(root)
  );

  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "weapons.json"),
    JSON.stringify({ weapons }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dataDir, "artifacts.json"),
    JSON.stringify({ artifacts }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dataDir, "comboSets.json"),
    JSON.stringify({ comboSets }, null, 2),
    "utf8"
  );

  console.log(
    "Wrote",
    weapons.length,
    "weapon families,",
    artifacts.length,
    "artifacts,",
    comboSets.length,
    "combo sets"
  );
}

main();
