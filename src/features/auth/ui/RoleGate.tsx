import type { ReactNode } from "react"

import { useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

export function RoleGate({ children, requiredRole }: { children: ReactNode; requiredRole: "admin" | "engineer" }) {
  const viewer = useQuery(api.users.current, {})

  if (viewer === undefined) {
    return <div className="p-6 text-sm text-slate-400">Loading permissions...</div>
  }

  if (!viewer || viewer.role !== requiredRole) {
    return <div className="p-6 text-sm text-rose-300">You do not have access to this page.</div>
  }

  return <>{children}</>
}
