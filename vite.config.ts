import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      ".template-archive/**",
      "apps/web/dist/**",
      "apps/web/.vinxi/**",
      "apps/web/.tanstack/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/backend/seeddata/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    ignorePatterns: [
      "node_modules/**",
      "**/node_modules/**",
      ".template-archive/**",
      "apps/web/dist/**",
      "apps/web/.vinxi/**",
      "apps/web/.tanstack/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/backend/seeddata/**",
      ".alchemy/**",
      ".wrangler/**",
      "**/.wrangler/**",
    ],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
