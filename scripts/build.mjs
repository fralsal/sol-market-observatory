import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const types = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};
const page = await readFile("public/index.html", "utf8");
const assets = {};
for (const name of await readdir("public")) {
  const type = types[extname(name)];
  if (!type) continue;
  const binary = !type.includes("charset");
  assets["/assets/" + name] = { type, binary, body: await readFile("public/" + name, binary ? "base64" : "utf8") };
}
const worker = await readFile("worker/index.js", "utf8");
await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", `const PAGE = ${JSON.stringify(page)};\nconst ASSETS = ${JSON.stringify(assets)};\n${worker}`);
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json").catch(error => {
  if (error.code !== "ENOENT") throw error;
});
