import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

type PackageJson = {
  scripts: Record<string, string>
}

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as PackageJson
}

describe("package scripts", () => {
  it("keeps lint as a non-mutating check command", () => {
    const lintScript = readPackageJson().scripts.lint

    expect(lintScript).toContain("astro sync")
    expect(lintScript).toContain("biome check .")
    expect(lintScript).not.toContain("--write")
    expect(lintScript).not.toContain("--unsafe")
  })

  it("does not ignore committed Convex generated code", () => {
    const gitignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8")

    expect(gitignore).not.toMatch(/^convex\/_generated\/$/m)
  })
})
