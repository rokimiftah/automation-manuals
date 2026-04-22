import { useEffect, useMemo, useState } from "react"

import { useAuthActions } from "@convex-dev/auth/react"

type AuthMode = "signIn" | "signUp" | "magicLink" | "resetRequest" | "resetConfirm"

const PASSWORD_PROVIDER = "password"
const MAGIC_LINK_PROVIDER = "resend-magic-link"

function readResetCode() {
  if (typeof window === "undefined") {
    return ""
  }

  return new URLSearchParams(window.location.search).get("code")?.trim() ?? ""
}

export default function AuthScreen() {
  const { signIn } = useAuthActions()
  const [mode, setMode] = useState<AuthMode>("signIn")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [resetCode, setResetCode] = useState("")
  const [status, setStatus] = useState<string>()
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const code = readResetCode()
    if (code) {
      setResetCode(code)
      setMode("resetConfirm")
      setStatus("Verification code detected. Finish the password reset below.")
    }
  }, [])

  const heading = useMemo(() => {
    switch (mode) {
      case "magicLink":
        return "Sign in with a magic link"
      case "signUp":
        return "Create a workspace account"
      case "resetRequest":
        return "Request a password reset"
      case "resetConfirm":
        return "Finish resetting your password"
      default:
        return "Sign in to PLC Manuals"
    }
  }, [mode])

  const helperText = useMemo(() => {
    switch (mode) {
      case "magicLink":
        return "We will email a one-time sign-in link to the address you provide."
      case "signUp":
        return "Create an approved account with a password and join the controlled workspace."
      case "resetRequest":
        return "Send a password reset email to the account address."
      case "resetConfirm":
        return "Paste the verification code from your email and choose a new password."
      default:
        return "Use the approved email allowlist to access the protected workspace."
    }
  }, [mode])

  const submitLabel = useMemo(() => {
    switch (mode) {
      case "magicLink":
        return "Send magic link"
      case "signUp":
        return "Create account"
      case "resetRequest":
        return "Send reset link"
      case "resetConfirm":
        return "Save new password"
      default:
        return "Sign in"
    }
  }, [mode])

  const showPasswordField = mode !== "magicLink" && mode !== "resetRequest"
  const isResetFlow = mode === "resetConfirm"

  return (
    <section className="flex min-h-screen items-center px-6 py-12">
      <div className="mx-auto w-full max-w-xl space-y-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.45em] text-cyan-300 uppercase">PLC Manuals access</p>
          <h1 className="text-3xl leading-tight font-semibold text-white">{heading}</h1>
          <p className="text-sm leading-6 text-slate-300">{helperText}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-1">
          <button
            aria-pressed={mode !== "magicLink"}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${mode === "magicLink" ? "text-slate-300" : "bg-slate-800 text-white"}`}
            type="button"
            onClick={() => setMode("signIn")}
          >
            Password
          </button>
          <button
            aria-pressed={mode === "magicLink"}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${mode === "magicLink" ? "bg-slate-800 text-white" : "text-slate-300"}`}
            type="button"
            onClick={() => setMode("magicLink")}
          >
            Magic link
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(undefined)
            setStatus(undefined)
            setIsSubmitting(true)

            const normalizedEmail = email.trim()
            const normalizedPassword = password.trim()
            const normalizedResetCode = resetCode.trim()

            try {
              if (!normalizedEmail) {
                throw new Error("Email is required")
              }

              if (mode === "magicLink") {
                await signIn(MAGIC_LINK_PROVIDER, {
                  email: normalizedEmail,
                  redirectTo: "/app"
                })
                setStatus("Check your email for the magic link.")
                return
              }

              if (mode === "resetRequest") {
                await signIn(PASSWORD_PROVIDER, {
                  email: normalizedEmail,
                  flow: "reset"
                })
                setStatus("Check your email for the password reset link.")
                return
              }

              if (mode === "resetConfirm") {
                if (!normalizedResetCode) {
                  throw new Error("Reset code is required")
                }
                if (!normalizedPassword) {
                  throw new Error("New password is required")
                }

                await signIn(PASSWORD_PROVIDER, {
                  code: normalizedResetCode,
                  email: normalizedEmail,
                  flow: "reset-verification",
                  newPassword: normalizedPassword
                })
                setPassword("")
                setResetCode("")
                setMode("signIn")
                setStatus("Password updated. You can sign in now.")
                return
              }

              if (!normalizedPassword) {
                throw new Error("Password is required")
              }

              const result = await signIn(PASSWORD_PROVIDER, {
                email: normalizedEmail,
                flow: mode,
                password: normalizedPassword
              })

              setPassword("")
              setStatus(result.signingIn ? "Signed in. Open the workspace when you are ready." : "Sign-in request submitted.")
            } catch (error) {
              setError(error instanceof Error ? error.message : "Authentication failed. Please try again.")
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label className="block space-y-2 text-sm text-slate-200">
            <span>Email</span>
            <input
              autoComplete="email"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white transition outline-none placeholder:text-slate-500 focus:border-cyan-400"
              name="email"
              placeholder="engineer@company.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {showPasswordField ? (
            <label className="block space-y-2 text-sm text-slate-200">
              <span>{isResetFlow ? "New password" : "Password"}</span>
              <input
                autoComplete={mode === "signUp" || isResetFlow ? "new-password" : "current-password"}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white transition outline-none placeholder:text-slate-500 focus:border-cyan-400"
                name="password"
                placeholder={isResetFlow ? "Choose a new password" : "Enter your password"}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : null}

          {isResetFlow ? (
            <label className="block space-y-2 text-sm text-slate-200">
              <span>Reset code</span>
              <input
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white transition outline-none placeholder:text-slate-500 focus:border-cyan-400"
                name="code"
                placeholder="Paste the code from your reset email"
                type="text"
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
              />
            </label>
          ) : null}

          {status ? (
            <p
              aria-live="polite"
              className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
            >
              {status}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            disabled={isSubmitting}
            type="submit"
          >
            {submitLabel}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
          {mode === "magicLink" ? null : mode === "resetRequest" || mode === "resetConfirm" ? (
            <button
              className="font-medium text-cyan-300 transition hover:text-cyan-200"
              type="button"
              onClick={() => setMode("signIn")}
            >
              Back to sign in
            </button>
          ) : (
            <button
              className="font-medium text-cyan-300 transition hover:text-cyan-200"
              type="button"
              onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
            >
              Use {mode === "signIn" ? "sign up" : "sign in"} instead
            </button>
          )}

          {mode === "signIn" ? (
            <button
              className="font-medium text-slate-300 transition hover:text-white"
              type="button"
              onClick={() => setMode("resetRequest")}
            >
              Forgot password?
            </button>
          ) : null}

          <a className="ml-auto font-medium text-cyan-300 transition hover:text-cyan-200" href="/app">
            Open workspace
          </a>
        </div>
      </div>
    </section>
  )
}
