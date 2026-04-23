import { useState } from "react"

export function AdminLoginForm({
  error,
  onSubmit,
  pending
}: {
  error?: string
  onSubmit: (input: { password: string; username: string }) => Promise<void>
  pending: boolean
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  return (
    <section className="mx-auto max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.4em] text-cyan-300 uppercase">Admin access</p>
        <h1 className="text-2xl font-semibold text-white">Admin sign in</h1>
        <p className="text-sm leading-6 text-slate-400">Sign in to register manuals and run ingestion jobs.</p>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          await onSubmit({ password, username })
        }}
      >
        <label className="block space-y-2 text-sm text-slate-200">
          <span>Username</span>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="block space-y-2 text-sm text-slate-200">
          <span>Password</span>
          <input
            className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:bg-slate-700 disabled:text-slate-300"
          disabled={pending}
          type="submit"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  )
}
