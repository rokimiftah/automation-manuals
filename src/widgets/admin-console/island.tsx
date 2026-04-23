import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import { AdminSessionGate } from "@features/admin-auth/ui"

import AdminConsole from "./ui/AdminConsole"

export default function AdminConsoleIsland() {
  return (
    <ConvexProviderWrapper>
      <AdminSessionGate>
        {(session) => (
          <AdminConsole
            onSessionInvalid={session.onSessionInvalid}
            onSignOut={session.onSignOut}
            sessionToken={session.sessionToken}
            username={session.username}
          />
        )}
      </AdminSessionGate>
    </ConvexProviderWrapper>
  )
}
