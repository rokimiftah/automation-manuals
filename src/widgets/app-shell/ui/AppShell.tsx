import type { ReactNode } from "react"

export default function AppShell({ actions, children, title }: { actions?: ReactNode; children: ReactNode; title: string }) {
  return (
    <main className="relative box-border flex h-dvh w-screen flex-col overflow-hidden p-4 font-sans md:p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-mono text-[11px] tracking-[0.2em] uppercase">{title}</h1>
        {actions ? <div className="flex items-center gap-4">{actions}</div> : null}
      </header>
      <div className="animate-expand flex h-full min-h-0 w-full flex-1 flex-col">{children}</div>
    </main>
  )
}
