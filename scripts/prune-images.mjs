import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const resDir = path.join(root, "resources");

function walkCollectStrings(obj, out) {
  if (obj == null) return;
  if (typeof obj === "string") {
    const m = obj.match(/resources\/(cellImage[^"'\s]+\.(?:jpg|jpeg|png|gif|webp))/i);
    if (m) out.add(m[1]);
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) walkCollectStrings(x, out);
    return;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj)) walkCollectStrings(v, out);
  }
}

function main() {
  const needed = new Set();
  for (const name of ["weapons.json", "artifacts.json"]) {
    const p = path.join(root, "data", name);
    if (!fs.existsSync(p)) {
      console.warn("skip missing", name);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    walkCollectStrings(data, needed);
  }

  if (!fs.existsSync(resDir)) {
    console.log("No resources folder");
    return;
  }

  const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
  const files = fs.readdirSync(resDir);
  let removed = 0;
  let kept = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!exts.has(ext)) continue;
    if (!/^cellImage/i.test(f)) continue;
    if (needed.has(f)) {
      kept++;
      continue;
    }
    fs.unlinkSync(path.join(resDir, f));
    removed++;
    console.log("removed", f);
  }

  console.log(`Done. Kept ${kept}, removed ${removed}. Referenced ${needed.size} unique images.`);
}

main();
