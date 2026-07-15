import { readFile } from "node:fs/promises";
import { basename, extname, normalize, resolve, sep } from "node:path";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function makeAssets(publicDirectory) {
  const root = resolve(publicDirectory);
  return {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relativePath = pathname.replace(/^\/+/, "") || "index.html";
      const target = resolve(root, normalize(relativePath));
      if (target !== root && !target.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 });
      try {
        const body = await readFile(target);
        return new Response(body, {
          headers: {
            "content-type": contentTypes[extname(basename(target)).toLowerCase()] || "application/octet-stream",
            "cache-control": "no-store",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}
