import { configDefaults, defineConfig } from "vitest/config";

// Agent worktrees under .claude/ hold stale copies of the suite; never run them.
export default defineConfig({ test: { environment: "node", exclude: [...configDefaults.exclude, ".claude/**"] } });
