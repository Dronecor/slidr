try { process.loadEnvFile(".env"); } catch { /* env already set by host */ }
import { loadConfig } from "./config.js";
import { createDeckStore } from "./storage.js";
import { createSparkClient } from "./meta.js";
import { createHub } from "./server.js";

const cfg = loadConfig();
const hub = createHub(cfg, createDeckStore(cfg), createSparkClient(cfg));
hub.http.listen(cfg.port, cfg.host, () => {
  console.log(`Stage Pilot hub listening on http://${cfg.host}:${cfg.port} (meta=${cfg.metaApiKey ? "configured" : "fake-client mode"})`);
});
