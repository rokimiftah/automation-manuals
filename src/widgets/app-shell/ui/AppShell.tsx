import type { ReactNode } from "react"

export default function AppShell({ actions, children, title }: { actions?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <main className="relative box-border flex h-dvh w-full flex-col overflow-x-hidden overflow-y-auto p-6 font-sans lg:overflow-hidden">
      {title || actions ? (
        <header className="flex shrink-0 items-center justify-between pb-4">
          {title ? <h1 className="font-mono text-[11px] tracking-[0.2em] uppercase">{title}</h1> : <div />}
          {actions ? <div className="flex items-center gap-4">{actions}</div> : null}
        </header>
      ) : null}
      <div className="animate-expand flex w-full flex-1 flex-col lg:min-h-0">{children}</div>
    </main>
  )
}
