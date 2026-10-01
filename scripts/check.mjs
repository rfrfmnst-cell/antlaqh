import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
for (const file of [
  "server.cjs",
  "server.js",
  "lib/store.js",
  "lib/catalog.js",
  "lib/assistant.js",
  "lib/guided-assistant.js",
  "public/assistant.js",
  "lib/security.js",
  "lib/promotion.js",
  "lib/contracts.js",
  "lib/recovery.js",
  "public/integrations.js",
  "public/app.js",
]) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(1);
}
for (const file of [
  "public/index.html",
  "public/style.css",
  "public/brand.css",
  "public/assistant.css",
  "public/assets/brand-logo-transparent.png",
  "public/assets/brand-original.jpeg",
  ".env.example",
])
  if (!existsSync(file)) throw Error(`Missing ${file}`);
const { services } = await import("../lib/catalog.js");
for (const service of services)
  if (!existsSync("public/assets/catalog-" + (service.artwork || service.id) + ".webp"))
    throw Error("Missing artwork: " + service.id);
const html = readFileSync("public/index.html", "utf8");
if (!html.includes('dir="rtl"')) throw Error("RTL document is required");
console.log("Build verified. Deploy source; start with npm start.");
