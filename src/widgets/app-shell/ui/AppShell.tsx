import type { ReactNode } from "react"

export default function AppShell({ actions, children, title }: { actions?: ReactNode; children: ReactNode; title: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-[0.45em] text-cyan-300 uppercase">Automation Manuals</p>
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  )
}
