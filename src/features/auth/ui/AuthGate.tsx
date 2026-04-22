import type { ReactNode } from "react"

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import AuthScreen from "./AuthScreen"

export function AuthGate({ children }: { children: ReactNode }) {
  const viewer = useQuery(api.users.current, {})

  return (
    <>
      <AuthLoading>
        <div className="p-6 text-sm text-slate-400">Checking session...</div>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        {viewer === undefined ? (
          <div className="p-6 text-sm text-slate-400">Loading workspace...</div>
        ) : viewer?.isAllowed ? (
          children
        ) : (
          <div className="p-6 text-sm text-amber-300">This account is signed in but not allowed to use the workspace.</div>
        )}
      </Authenticated>
    </>
  )
}
