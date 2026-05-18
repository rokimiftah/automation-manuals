// @vitest-environment node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vitest"

type ResolveIdHook =
  | ((this: unknown, id: string, importer?: string) => unknown | Promise<unknown>)
  | { handler: (this: unknown, id: string, importer?: string) => unknown | Promise<unknown> }

type VitePlugin = {
  name?: string
  resolveId?: ResolveIdHook
}

type AstroConfig = {
  vite?: {
    plugins?: unknown[]
  }
}

async function loadAstroConfig() {
  const configUrl = pathToFileURL(path.join(process.cwd(), "astro.config.mjs")).href
  const configModule = (await import(configUrl)) as { default: AstroConfig }
  return configModule.default
}

function flattenPlugins(plugins: unknown[] = []): VitePlugin[] {
  return plugins.flatMap((plugin) => (Array.isArray(plugin) ? flattenPlugins(plugin) : [plugin as VitePlugin]))
}

async function resolvePluginId(plugin: VitePlugin, id: string) {
  if (typeof plugin.resolveId === "function") {
    return plugin.resolveId.call({}, id)
  }

  if (plugin.resolveId && "handler" in plugin.resolveId) {
    return plugin.resolveId.handler.call({}, id)
  }

  return undefined
}

describe("Astro config", () => {
  it("resolves astro server app reload id to a Vite-loadable file path", async () => {
    const config = await loadAstroConfig()
    const compatPlugin = flattenPlugins(config.vite?.plugins).find((plugin) => plugin.name === "astro:server-app-compat")

    expect(compatPlugin).toBeDefined()
    await expect(resolvePluginId(compatPlugin as VitePlugin, "astro:server-app.js")).resolves.toBe(
      path.join(process.cwd(), "node_modules/astro/dist/vite-plugin-app/createAstroServerApp.js")
    )
  })
})
