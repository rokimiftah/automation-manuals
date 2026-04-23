import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

  it("shows the login form when no session token exists", () => {
    useQuery.mockReturnValue("skip")

    render(<AdminSessionGate>{() => <div>Admin console</div>}</AdminSessionGate>)

    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument()
    expect(screen.queryByText("Admin console")).not.toBeInTheDocument()
  })

  it("stores the returned session token and renders children after sign in", async () => {
    useQuery.mockReturnValueOnce("skip").mockReturnValue({ expiresAt: 123_456, username: "admin" })
    signIn.mockResolvedValue({ expiresAt: 123_456, sessionToken: "token-123", username: "admin" })

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
})
