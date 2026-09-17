// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
	// Requires the NEXT_INC_CACHE_R2_BUCKET binding in wrangler.jsonc — see DEPLOY.md
	incrementalCache: r2IncrementalCache,
});
