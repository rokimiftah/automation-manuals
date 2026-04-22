import type { ReactNode } from "react"

import { ConvexReactClient } from "convex/react"

import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { CONVEX_SITE_URL, CONVEX_URL } from "astro:env/client"

import { getPublicAppEnv } from "@shared/config/env"

const { convexUrl } = getPublicAppEnv({ CONVEX_SITE_URL, CONVEX_URL })

const client = new ConvexReactClient(convexUrl)

export { client }

export function ConvexProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={client} storageNamespace="automation-manuals">
      {children}
    </ConvexAuthProvider>
  )
}
