/**
 * Production-like local serve: build once, preview, rebuild on change, auto-refresh.
 * Used by `pnpm dev`. For Vite HMR, use `pnpm dev:hmr`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = path.join(root, "vite.config.js");

let generation = 0;
let previewServer;

const reloadClient = `
<script>
(function () {
  let gen = null;
  async function tick() {
    try {
      const res = await fetch("/__dev_bundled_gen", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (gen === null) gen = data.generation;
      else if (data.generation !== gen) location.reload();
    } catch (_) {
      /* preview restarting */
    }
  }
  setInterval(tick, 800);
})();
</script>
`;

function bundledDevPlugins() {
  return [
    {
      name: "dev-bundled-reload-client",
      transformIndexHtml(html) {
        if (html.includes("/__dev_bundled_gen")) {
          return html;
        }
        return html.includes("</body>")
          ? html.replace("</body>", `${reloadClient}</body>`)
          : `${html}${reloadClient}`;
      },
    },
    {
      name: "dev-bundled-lifecycle",
      async closeBundle() {
        generation += 1;
        if (!previewServer) {
          previewServer = await preview({
            configFile,
            preview: {
              host: "0.0.0.0",
              port: 5173,
              strictPort: false,
            },
            plugins: [
              {
                name: "dev-bundled-gen-endpoint",
                configurePreviewServer(server) {
                  server.middlewares.use((req, res, next) => {
                    const url = req.url?.split("?")[0];
                    if (url !== "/__dev_bundled_gen") {
                      next();
                      return;
                    }
                    res.setHeader("Content-Type", "application/json");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(JSON.stringify({ generation }));
                  });
                },
              },
            ],
          });
          try {
            previewServer.printUrls();
          } catch {
            const port = previewServer.config.preview.port || 5173;
            console.log(`  ➜  Local:   http://127.0.0.1:${port}/`);
          }
          console.log("[dev] Bundled preview ready — file changes rebuild and refresh the browser.");
          return;
        }
        console.log(`[dev] Rebuild #${generation} ready — browser will refresh.`);
      },
    },
  ];
}

const watcher = await build({
  configFile,
  mode: "production",
  build: {
    watch: {},
    emptyOutDir: true,
  },
  plugins: bundledDevPlugins(),
});

async function shutdown() {
  try {
    await watcher?.close?.();
  } catch {
    /* ignore */
  }
  try {
    await previewServer?.close?.();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
