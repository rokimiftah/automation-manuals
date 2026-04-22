export type PublicAppEnvInput = {
  CONVEX_SITE_URL?: string
  CONVEX_URL?: string
}

export type PublicAppEnv = {
  convexSiteUrl: string
  convexUrl: string
}

export function getPublicAppEnv({ CONVEX_SITE_URL, CONVEX_URL }: PublicAppEnvInput): PublicAppEnv {
  const convexUrl = CONVEX_URL?.trim()
  if (!convexUrl) {
    throw new Error("CONVEX_URL is required")
  }

  const convexSiteUrl = CONVEX_SITE_URL?.trim()
  if (!convexSiteUrl) {
    throw new Error("CONVEX_SITE_URL is required")
  }

  return { convexSiteUrl, convexUrl }
}
