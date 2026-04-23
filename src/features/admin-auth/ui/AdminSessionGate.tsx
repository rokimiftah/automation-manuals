import type { ReactNode } from "react"

import { useEffect, useState } from "react"

import { useAction, useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import { AdminLoginForm } from "./AdminLoginForm"

const STORAGE_KEY = "adminSessionToken"

export function AdminSessionGate({
  children
}: {
  children: (session: { expiresAt: number; onSignOut: () => Promise<void>; sessionToken: string; username: string }) => ReactNode
}) {
  const signIn = useAction(api.adminAuth.signIn)
  const signOut = useMutation(api.adminAuth.signOut)
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  useEffect(() => {
    setSessionToken(sessionStorage.getItem(STORAGE_KEY))
  }, [])

  const session = useQuery(api.adminAuth.validateSession, sessionToken ? { sessionToken } : "skip")

  useEffect(() => {
    if (sessionToken && session === null) {
      sessionStorage.removeItem(STORAGE_KEY)
      setSessionToken(null)
      setError("Admin session expired. Please sign in again.")
    }
  }, [session, sessionToken])

  if (!sessionToken) {
    return (
      <AdminLoginForm
        error={error}
        pending={isPending}
        onSubmit={async (input) => {
          setError(undefined)
          setIsPending(true)
          try {
            const result = await signIn(input)
            sessionStorage.setItem(STORAGE_KEY, result.sessionToken)
            setSessionToken(result.sessionToken)
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Unable to sign in.")
          } finally {
            setIsPending(false)
          }
        }}
      />
    )
  }

  if (session === undefined) {
    return <div className="p-6 text-sm text-slate-400">Checking admin session...</div>
  }

  if (!session) {
    return null
  }

  return children({
    expiresAt: session.expiresAt,
    onSignOut: async () => {
      await signOut({ sessionToken })
      sessionStorage.removeItem(STORAGE_KEY)
      setSessionToken(null)
    },
    sessionToken,
    username: session.username
  })
}
