import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function sliceAfterStyle(html) {
  const i = html.indexOf("</style>");
  return i >= 0 ? html.slice(i + 8) : html;
}

function parseCells(rowHtml) {
  const cells = [];
  const re = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const attrs = m[1];
    const rs = (attrs.match(/rowspan="(\d+)"/) || [, "1"])[1];
    const cs = (attrs.match(/colspan="(\d+)"/) || [, "1"])[1];
    const text = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    cells.push({ rs: +rs, cs: +cs, text });
  }
  return cells;
}

const file = process.argv[2] || "Weapons.html";
const raw = fs.readFileSync(path.join(root, file), "utf8");
const html = sliceAfterStyle(raw);
const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
if (!body) {
  console.error("no tbody");
  process.exit(1);
}
const rows = [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
console.log(file, "tbody rows", rows.length);
for (let i = 0; i < Math.min(25, rows.length); i++) {
  const c = parseCells(rows[i][1]);
  console.log(
    "row",
    i,
    "n",
    c.length,
    c
      .slice(0, 10)
      .map((x) => ({ t: x.text.slice(0, 50), rs: x.rs, cs: x.cs }))
  );
}
