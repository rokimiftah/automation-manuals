import { useState } from "react"

import { useAuthActions } from "@convex-dev/auth/react"

export function SignOutButton() {
  const { signOut } = useAuthActions()
  const [isSigningOut, setIsSigningOut] = useState(false)

  return (
    <button
      className="inline-flex items-center justify-center rounded-2xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSigningOut}
      type="button"
      onClick={async () => {
        setIsSigningOut(true)
        try {
          await signOut()
        } finally {
          setIsSigningOut(false)
        }
      }}
    >
      Sign out
    </button>
  )
}
