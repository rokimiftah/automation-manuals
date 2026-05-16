// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import AppShell from "./AppShell"

describe("AppShell", () => {
  it("locks the app to the viewport so nested panels can scroll", () => {
    render(
      <AppShell title="Workspace">
        <div>Content</div>
      </AppShell>
    )

    expect(screen.getByRole("main")).toHaveClass("h-dvh")
    expect(screen.getByRole("main")).toHaveClass("overflow-hidden")
  })
})
