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
    <section className="wire-border animate-expand relative mx-auto mt-[12vh] flex max-w-115 flex-col bg-white">
      <form
        className="flex flex-col gap-8 bg-white p-8 md:p-10"
        onSubmit={async (event) => {
          event.preventDefault()
          await onSubmit({ password, username })
        }}
      >
        <div className="space-y-6">
          <label className="flex flex-col gap-3">
            <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">ID String</span>
            <input
              className="wire-border w-full bg-[#FAFAFA] px-5 py-4 text-[14px] font-medium text-[#000000] transition-colors outline-none placeholder:text-[#999999] focus:bg-white"
              placeholder="admin"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-3">
            <span className="font-mono text-[11px] tracking-widest text-[#000000] uppercase">Passphrase</span>
            <input
              className="wire-border w-full bg-[#FAFAFA] px-5 py-4 text-[14px] font-medium tracking-widest text-[#000000] transition-colors outline-none placeholder:text-[#999999] focus:bg-white"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </div>

        {error ? (
          <div className="wire-border relative flex items-start gap-4 overflow-hidden bg-white p-4 font-mono text-[13px] text-[#000000]">
            <div className="diagonal-bg pointer-events-none absolute inset-0 opacity-20"></div>
            <span className="relative z-10 shrink-0 bg-[#000000] px-2 py-0.5 text-[10px] tracking-widest text-white uppercase">
              ERR
            </span>
            <span className="relative z-10">{error}</span>
          </div>
        ) : null}

        <button
          className="wire-border mt-4 w-full bg-[#000000] px-8 py-5 text-[13px] font-medium tracking-[0.2em] text-white uppercase transition-colors hover:border-[#000000] hover:bg-white hover:text-[#000000] active:scale-[0.98] disabled:pointer-events-none disabled:bg-[#FAFAFA] disabled:text-[#999999]"
          disabled={pending}
          type="submit"
        >
          {pending ? "Verifying" : "Access"}
        </button>
      </form>
    </section>
  )
}
