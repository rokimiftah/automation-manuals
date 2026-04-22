import type { ReactNode } from "react"

import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"
import { AuthGate, RoleGate } from "@features/auth/ui"

import AppShell from "./ui/AppShell"

type AppShellIslandProps = {
  children: ReactNode
  accessRole?: "admin" | "engineer"
  title: string
}

export default function AppShellIsland({ accessRole = "engineer", children, title }: AppShellIslandProps) {
  const shell = <AppShell title={title}>{children}</AppShell>
  const protectedShell = accessRole === "admin" ? <RoleGate requiredRole="admin">{shell}</RoleGate> : shell

  return (
    <ConvexProviderWrapper>
      <AuthGate>{protectedShell}</AuthGate>
    </ConvexProviderWrapper>
  )
}
