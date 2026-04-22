import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import EngineerWorkspace from "./ui/EngineerWorkspace"

export default function EngineerWorkspaceIsland() {
  return (
    <ConvexProviderWrapper>
      <EngineerWorkspace />
    </ConvexProviderWrapper>
  )
}
