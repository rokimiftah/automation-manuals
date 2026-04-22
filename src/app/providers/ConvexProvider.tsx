import type { ReactNode } from "react"

import { ConvexProvider as ConvexProviderBase, ConvexReactClient } from "convex/react"

import { CONVEX_URL } from "astro:env/client"

import { getPublicAppEnv } from "@shared/config/env"

const { convexUrl } = getPublicAppEnv({ CONVEX_URL })

const client = new ConvexReactClient(convexUrl)

export function ConvexProviderWrapper({ children }: { children: ReactNode }) {
  return <ConvexProviderBase client={client}>{children}</ConvexProviderBase>
}

export { client }
