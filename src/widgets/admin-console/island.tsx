import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import AdminConsole from "./ui/AdminConsole"

export default function AdminConsoleIsland() {
  return (
    <ConvexProviderWrapper>
      <AdminConsole />
    </ConvexProviderWrapper>
  )
}
