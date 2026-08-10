// Zero-dependency static server. `npm start`, then open the printed URL.
// Also prints the LAN address so a phone on the same Wi-Fi can play — testing the
// touch layout on a real device is not optional for this game.

import { createServer } from "node:http";
import { createReadStream, statSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  // Contain every request inside ROOT.
  const target = join(ROOT, normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  const type = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    // Dev server: never let a stale module survive a reload.
    "cache-control": "no-store",
  });
  createReadStream(target).pipe(res);
});

function announce(port) {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal);
  console.log(`\n  PULSEFALL`);
  console.log(`  Local:      http://127.0.0.1:${port}`);
  if (lan) console.log(`  Same Wi-Fi: http://${lan.address}:${port}`);
  console.log("");
}

// Walk forward if the port is taken — another dev server should never be the reason
// you cannot run the game.
let port = PORT;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && port < PORT + 20) {
    console.log(`  port ${port} busy, trying ${port + 1}…`);
    server.listen(++port, HOST);
    return;
  }
  console.error(err.message);
  process.exit(1);
});
server.on("listening", () => announce(port));
server.listen(port, HOST);
