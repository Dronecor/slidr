export interface HubConfig {
  port: number;
  host: string;
  dataDir: string;
  metaApiKey: string;
  metaApiBase: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  supabaseBucket: string;
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export function loadConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  return {
    port: Number(env("HUB_PORT") || env("PORT", "8787")) || 8787,
    host: env("HUB_HOST", "0.0.0.0"),
    dataDir: env("DATA_DIR", ".data"),
    metaApiKey: env("META_API_KEY"),
    metaApiBase: env("META_API_BASE", "https://api.meta.ai/v1").replace(/\/$/, ""),
    supabaseUrl: env("SUPABASE_URL").replace(/\/$/, ""),
    supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    supabaseBucket: env("SUPABASE_BUCKET", "decks"),
    ...overrides,
  };
}

export function hasMetaKey(cfg: HubConfig): boolean {
  return cfg.metaApiKey.length > 0;
}
