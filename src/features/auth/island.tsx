import { ConvexProviderWrapper } from "@app/providers/ConvexProvider"

import AuthScreen from "./ui/AuthScreen"

export default function AuthIsland() {
  return (
    <ConvexProviderWrapper>
      <AuthScreen />
    </ConvexProviderWrapper>
  )
}
