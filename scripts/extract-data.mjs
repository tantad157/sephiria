import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

function splitWeaponBlocks(cells) {
  const blocks = [];
  let cur = [];
  for (let i = 2; i < cells.length; i++) {
    const c = cells[i];
    if (isSep(c) && cur.length) {
      blocks.push(cur);
      cur = [];
    } else if (!isSep(c)) {
      cur.push(c);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
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

  const upgradesByBase = bases.map(() => []);

  for (let r = 4; r < trs.length; r++) {
    const rowCells = parseCells(trs[r]);
    const blocks = splitWeaponBlocks(rowCells);
    while (blocks.length < n) blocks.push([]);
    for (let b = 0; b < n; b++) {
      const blockCells = blocks[b] || [];
      if (!blockCells.length) continue;

      const st = upgradesByBase[b];
      const last = st[st.length - 1];
      const inCont =
        last &&
        last._open &&
        last.tier3.length < last._need;

      if (inCont && blockCells.length >= 3) {
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

      if (blockCells.length < 6) continue;

      const t2i = blockCells[0];
      const t2n = blockCells[1];
      const t2s = blockCells[2];
      const t3i = blockCells[3];
      const t3n = blockCells[4];
      const t3s = blockCells[5];
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
  for (let i = 0; i < trs.length; i++) {
    const cells = parseCells(trs[i]);
    if (buf.length && rowIsSpacer(cells)) {
      const trimmed = trimArtifactSection(buf);
      if (trimmed.length > 8) sections.push(trimmed);
      buf = [];
    } else {
      buf.push(trs[i]);
    }
  }
  const trimmed = trimArtifactSection(buf);
  if (trimmed.length > 8) sections.push(trimmed);
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
    artifacts.push({
      id: `artifact-${globalArtifactIndex++}`,
      name: names[i] || `Unknown ${i + 1}`,
      stars: stars[i] || "",
      icon: row3Imgs[i] || "",
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

function main() {
  const weaponsHtml = fs.readFileSync(path.join(root, "Weapons.html"), "utf8");
  const artifactsHtml = fs.readFileSync(
    path.join(root, "Artifacts.html"),
    "utf8"
  );

  const wParsed = parseWeapons(sliceAfterStyle(weaponsHtml));
  const weapons = wParsed.bases.map((base, i) => ({
    id: `weapon-base-${i}`,
    ...base,
    upgrades: wParsed.upgradesByBase[i] || [],
  }));

  const artifacts = parseArtifacts(sliceAfterStyle(artifactsHtml));

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

  console.log(
    "Wrote",
    weapons.length,
    "weapon families,",
    artifacts.length,
    "artifacts"
  );
}

main();
