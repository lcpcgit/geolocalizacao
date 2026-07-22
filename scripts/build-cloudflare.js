const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "public");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

fs.cpSync(path.join(root, "static"), path.join(out, "static"), { recursive: true });
fs.copyFileSync(path.join(root, "service-worker.js"), path.join(out, "service-worker.js"));

console.log("Cloudflare assets generated in public/");
