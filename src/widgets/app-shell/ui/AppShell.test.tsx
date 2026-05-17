// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import AppShell from "./AppShell"

afterEach(cleanup)

describe("AppShell", () => {
  it("keeps desktop panels locked while allowing mobile vertical scroll", () => {
    render(
      <AppShell title="Workspace">
        <div>Content</div>
      </AppShell>
    )

    expect(screen.getByRole("main")).toHaveClass("h-dvh")
    expect(screen.getByRole("main")).toHaveClass("overflow-x-hidden")
    expect(screen.getByRole("main")).toHaveClass("overflow-y-auto")
    expect(screen.getByRole("main")).toHaveClass("lg:overflow-hidden")
  })

  it("renders the title in the header", () => {
    render(
      <AppShell title="Engineer Workspace">
        <div>Content</div>
      </AppShell>
    )

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Engineer Workspace")
  })
})
