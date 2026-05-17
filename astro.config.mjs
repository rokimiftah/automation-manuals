// @ts-check

import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@astrojs/react"
import { defineConfig, envField } from "astro/config"

import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Workaround for https://github.com/withastro/astro/issues/15952
 * Astro's `astro:server-app` virtual module lacks the `virtual:` prefix,
 * causing Vite 7 to append `.js` during dependency optimization reload.
 * The regex filter `^astro:server-app$` in Astro's resolveId hook does not
 * match `astro:server-app.js`, so resolution fails. This plugin intercepts
 * the `.js` variant and delegates to Astro's original resolution.
 */
function vitePluginAstroServerAppCompat() {
  const ASTRO_DEV_SERVER_APP_ID = "astro:server-app"
  const createAstroServerAppUrl = new URL(
    "./node_modules/astro/dist/vite-plugin-app/createAstroServerApp.js",
    `file://${__dirname}/`
  ).toString()
  const plugin = {
    name: "astro:server-app-compat",
    enforce: /** @type {"pre"} */ ("pre"),
    /** @param {string} id */
    resolveId(id) {
      if (id === `${ASTRO_DEV_SERVER_APP_ID}.js`) {
        return createAstroServerAppUrl
      }
    }
  }
  return /** @type {import("vite").Plugin} */ (plugin)
}

export default defineConfig({
  devToolbar: { enabled: false },
  env: {
    schema: {
      CONVEX_URL: envField.string({ access: "public", context: "client" })
    }
  },
  integrations: [react()],
  server: { host: "localhost", port: 3000 },
  site: "https://automation-manuals.web.id",
  trailingSlash: "never",
  vite: {
    plugins: [vitePluginAstroServerAppCompat(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@app": path.resolve(__dirname, "./src/app"),
        "@widgets": path.resolve(__dirname, "./src/widgets"),
        "@features": path.resolve(__dirname, "./src/features"),
        "@entities": path.resolve(__dirname, "./src/entities"),
        "@shared": path.resolve(__dirname, "./src/shared"),
        "@convex": path.resolve(__dirname, "./convex")
      }
    },
    server: { allowedHosts: ["dev.rokimiftah.id"] }
  }
})
