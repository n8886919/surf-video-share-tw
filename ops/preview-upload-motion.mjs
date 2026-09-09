import { createServer } from "vite";
import { fileURLToPath } from "node:url";

// An isolated local canvas study. This server never loads the Worker, secrets,
// production routes, upload API or Cloudflare/Vinext deployment configuration.
const root = fileURLToPath(new URL("../preview/upload-motion", import.meta.url));
const logo = fileURLToPath(new URL("../public/brand-logo.png", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    fs: { allow: [root, logo] },
  },
});
await server.listen();
server.printUrls();
