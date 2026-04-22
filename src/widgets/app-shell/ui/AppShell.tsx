import type { ReactNode } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import { SignOutButton } from "@features/auth/ui"

export default function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const viewer = useQuery(api.users.current, {})

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.45em] text-cyan-300">Navigineer</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-white">{title}</h1>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                {viewer ? viewer.role : "Loading"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <p className="font-medium text-white">{viewer?.name ?? "Loading profile..."}</p>
              <p className="text-slate-400">{viewer?.email ?? "Fetching current session"}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  )
}
