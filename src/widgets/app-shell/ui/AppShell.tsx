import type { ReactNode } from "react"

export default function AppShell({ actions, children }: { actions?: ReactNode; children: ReactNode; title: string }) {
  return (
    <main className="relative box-border flex min-h-dvh w-screen flex-col overflow-x-hidden p-4 font-sans md:p-6 lg:h-dvh lg:overflow-hidden">
      {actions ? <div className="absolute top-4 right-4 z-50 flex items-center gap-4 md:top-6 md:right-6">{actions}</div> : null}
      <div className="animate-expand flex h-full min-h-0 w-full flex-1 flex-col">{children}</div>
    </main>
  )
}
