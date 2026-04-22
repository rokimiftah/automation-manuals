import type { GenericId } from "convex/values"

export type AppRole = "admin" | "engineer"

export type CurrentViewer = {
  canManageDocuments: boolean
  email: string
  isAllowed: boolean
  name: string
  role: AppRole
  userId: GenericId<"users">
}
