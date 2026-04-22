import type { ReactNode } from "react"

import { ConvexProvider, ConvexReactClient } from "convex/react"

import { CONVEX_URL } from "astro:env/client"

const client = new ConvexReactClient(CONVEX_URL)

export { client }

export function ConvexProviderWrapper({ children }: { children: ReactNode }) {
  return <ConvexProvider client={client}>{children}</ConvexProvider>
}
