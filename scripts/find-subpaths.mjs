import fs from "node:fs";
import path from "node:path";

function scan(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") {
      scan(p);
    } else if (/\.(md|ts|js|mjs)$/.test(e.name)) {
      const c = fs.readFileSync(p, "utf8");
      const m = c.match(/cinecode\/[a-zA-Z0-9_\-\/]+/g);
      if (m) console.log(p + ": " + Array.from(new Set(m)).join(", "));
    }
  }
}

scan("docs");
scan("examples");
scan("scripts");
