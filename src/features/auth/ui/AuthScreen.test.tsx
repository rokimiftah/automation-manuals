import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import AuthScreen from "./AuthScreen"

const signIn = vi.fn()

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn, signOut: vi.fn() })
}))

describe("AuthScreen", () => {
  it("submits password sign-in by default", () => {
    render(<AuthScreen />)

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "tech@example.com" } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "Secret123" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(signIn).toHaveBeenCalledWith(
      "password",
      expect.objectContaining({
        email: "tech@example.com",
        flow: "signIn",
        password: "Secret123"
      })
    )
  })
})
