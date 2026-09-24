import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { cloudflare } from "@cloudflare/vite-plugin";
import { preparePdfWorker } from "./scripts/prepare-pdf-worker.mjs";

const { d1, r2 } = hostingConfig;
const localD1Binding = d1 || "DB";
const localR2Binding = r2 || "HOMEWORK_ASSETS";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: localD1Binding
    ? [
        {
          binding: localD1Binding,
          database_name: d1 ? "site-creator-d1" : "zhiti-question-bank",
          database_id: d1 ? "00000000-0000-4000-8000-000000000000" : "8d93b3dc-001f-4f32-adba-4bb5dc971c17",
        },
      ]
    : [],
  r2_buckets: localR2Binding
    ? [
        {
          binding: localR2Binding,
          bucket_name: r2 ? "site-creator-r2" : "zhiti-homework-assets",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  await preparePdfWorker();
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext({
        cache: { cdn: cdnAdapter() },
      }),
      sites(),
      cloudflare({
        ...(process.env.STUDIO_TEST_STATE ? { persistState: { path: process.env.STUDIO_TEST_STATE }, remoteBindings: false } : {}),
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
