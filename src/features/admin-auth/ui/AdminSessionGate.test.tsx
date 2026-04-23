import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AdminSessionGate } from "./AdminSessionGate"

const signIn = vi.fn()
const signOut = vi.fn()
const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useAction: () => signIn,
  useMutation: () => signOut,
  useQuery: (...args: unknown[]) => useQuery(...args)
}))

describe("AdminSessionGate", () => {
  beforeEach(() => {
    sessionStorage.clear()
    signIn.mockReset()
    signOut.mockReset()
    useQuery.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("shows the login form when no session token exists", () => {
    useQuery.mockReturnValue("skip")

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
    expect(screen.queryByText("Admin console")).not.toBeInTheDocument()
  })

  it("stores the returned session token and renders children after sign in", async () => {
    const expiresAt = Date.now() + 60_000
    useQuery.mockReturnValueOnce("skip").mockReturnValue({ expiresAt, username: "admin" })
    signIn.mockResolvedValue({ expiresAt, sessionToken: "token-123", username: "admin" })

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    const usernameInput = screen.getAllByLabelText(/username/i)[0]
    const passwordInput = screen.getAllByLabelText(/password/i)[0]
    const signInButton = screen.getAllByRole("button", { name: /sign in/i })[0]

    fireEvent.change(usernameInput, { target: { value: "admin" } })
    fireEvent.change(passwordInput, { target: { value: "correct horse battery staple" } })
    fireEvent.click(signInButton)

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBe("token-123"))
    expect(await screen.findByText("Admin console")).toBeInTheDocument()
  })

  it("clears a stale stored token when session validation returns null", async () => {
    sessionStorage.setItem("adminSessionToken", "stale-token")
    useQuery.mockReturnValue(null)

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBeNull())
    expect(screen.getAllByRole("heading", { name: /admin sign in/i }).length).toBeGreaterThan(0)
  })

  it("clears the stored token when the validated session expires locally", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"))
    sessionStorage.setItem("adminSessionToken", "live-token")
    useQuery.mockReturnValueOnce(undefined).mockReturnValue({ expiresAt: Date.now() + 1_000, username: "admin" })

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    await act(async () => {})
    expect(screen.getAllByText("Admin console")).not.toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001)
    })

    expect(sessionStorage.getItem("adminSessionToken")).toBeNull()
    expect(screen.getAllByRole("heading", { name: /admin sign in/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/session expired/i)).toBeInTheDocument()
  })

  it("clears local session state even when sign out rejects", async () => {
    sessionStorage.setItem("adminSessionToken", "live-token")
    useQuery.mockImplementation((_, args) =>
      args === "skip" ? undefined : { expiresAt: Date.now() + 60_000, username: "admin" }
    )
    signOut.mockRejectedValue(new Error("Admin session expired"))

    render(
      <AdminSessionGate>
        {({ onSignOut }) => (
          <button type="button" onClick={() => void onSignOut()}>
            Leave admin
          </button>
        )}
      </AdminSessionGate>
    )

    fireEvent.click(await screen.findByRole("button", { name: /leave admin/i }))

    await waitFor(() => expect(sessionStorage.getItem("adminSessionToken")).toBeNull())
    expect(screen.getAllByRole("heading", { name: /admin sign in/i }).length).toBeGreaterThan(0)
  })
})
