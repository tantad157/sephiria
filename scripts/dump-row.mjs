import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const file = process.argv[2] || "Weapons.html";
const rowIdx = +process.argv[3] || 4;
const raw = fs.readFileSync(path.join(root, file), "utf8");
const html = raw.includes("</style>")
  ? raw.slice(raw.indexOf("</style>") + 8)
  : raw;
const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)[1];
const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
const row = rows[rowIdx][1];
const re = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
let m;
let i = 0;
while ((m = re.exec(row))) {
  const attrs = m[1];
  const rs = (attrs.match(/rowspan="(\d+)"/) || [, "1"])[1];
  const cs = (attrs.match(/colspan="(\d+)"/) || [, "1"])[1];
  const inner = m[2];
  const text = inner
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const imgM = inner.match(/src="([^"]+)"/);
  const img = imgM ? imgM[1] : "";
  console.log(i++, "rs", rs, "cs", cs, "text", JSON.stringify(text), "img", img);
}
