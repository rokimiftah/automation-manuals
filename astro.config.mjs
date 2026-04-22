// @ts-check

import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@astrojs/react"
import { defineConfig, envField } from "astro/config"

import tailwindcss from "@tailwindcss/vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  devToolbar: { enabled: false },
  env: { schema: { CONVEX_URL: envField.string({ access: "public", context: "client" }) } },
  integrations: [react()],
  server: { host: "localhost", port: 3000 },
  site: "https://navigineer.web.id",
  trailingSlash: "never",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@app": path.resolve(__dirname, "./src/app"),
        "@pages": path.resolve(__dirname, "./src/pages"),
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
