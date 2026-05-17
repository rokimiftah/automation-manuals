import type { ReactNode } from "react"

import { useCallback, useEffect, useState } from "react"

import { useAction, useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"

import { AdminLoginForm } from "./AdminLoginForm"

const STORAGE_KEY = "adminSessionToken"
const EXPIRED_MESSAGE = "Admin session expired. Please sign in again."

function AdminSessionLoadingState() {
  return (
    <section className="wire-border animate-expand relative flex w-full max-w-115 flex-col bg-white p-8 text-center md:p-10">
      <span className="font-mono text-[11px] tracking-[0.2em] text-[#000000] uppercase">Validating admin session...</span>
    </section>
  )
}

function AdminAuthLayout({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh w-screen items-center justify-center bg-[#FAFAFA] p-6">{children}</main>
}

export function AdminSessionGate({
  children
}: {
  children: (session: {
    expiresAt: number
    onSessionInvalid: (message?: string) => void
    onSignOut: () => Promise<void>
    sessionToken: string
    username: string
  }) => ReactNode
}) {
  const signIn = useAction(api.adminAuth.signIn)
  const signOut = useMutation(api.adminAuth.signOut)
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null | undefined>(undefined)

  const clearSession = useCallback((message?: string) => {
    sessionStorage.removeItem(STORAGE_KEY)
    setSessionToken(null)
    setError(message)
  }, [])

  useEffect(() => {
    setSessionToken(sessionStorage.getItem(STORAGE_KEY))
  }, [])

  const session = useQuery(api.adminAuth.validateSession, sessionToken ? { sessionToken } : "skip")

  useEffect(() => {
    if (sessionToken && session === null) {
      clearSession(EXPIRED_MESSAGE)
    }
  }, [session, sessionToken, clearSession])

  useEffect(() => {
    if (!sessionToken || !session) {
      return
    }

    const timeoutMs = session.expiresAt - Date.now()
    if (timeoutMs <= 0) {
      clearSession(EXPIRED_MESSAGE)
      return
    }

    const timeoutId = window.setTimeout(() => {
      clearSession(EXPIRED_MESSAGE)
    }, timeoutMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [session, sessionToken, clearSession])

  if (sessionToken === undefined) {
    return (
      <AdminAuthLayout>
        <AdminSessionLoadingState />
      </AdminAuthLayout>
    )
  }

  if (!sessionToken) {
    return (
      <AdminAuthLayout>
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
      </AdminAuthLayout>
    )
  }

  if (session === undefined) {
    return (
      <AdminAuthLayout>
        <AdminSessionLoadingState />
      </AdminAuthLayout>
    )
  }

  if (!session) {
    return null
  }

  return children({
    expiresAt: session.expiresAt,
    onSessionInvalid: (message = EXPIRED_MESSAGE) => {
      clearSession(message)
    },
    onSignOut: async () => {
      const token = sessionToken
      clearSession()
      try {
        await signOut({ sessionToken: token })
      } catch {
        // Local session state is already cleared; remote revocation is best effort.
      }
    },
    sessionToken,
    username: session.username
  })
}
