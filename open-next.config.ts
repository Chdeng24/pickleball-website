import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No R2 incremental cache — nearly every route here is dynamic (session-aware
// layouts, live DB reads), so there's almost nothing for it to cache, and its
// deploy-time cache pre-warm step was reliably timing out (reproduced across
// three different networks, including GitHub Actions' own runners — not a
// wifi issue). Defaults to the in-memory cache instead.
export default defineCloudflareConfig({});
