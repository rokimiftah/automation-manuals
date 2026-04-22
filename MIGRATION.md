# Migration Guide: Public Workspace with Admin-Only Auth

This document describes the migration from Convex Auth to a minimal admin-only session system.

## Overview

The project has been converted from an authenticated application (using @convex-dev/auth with email/password and magic link) to a public workspace with minimal admin-only authentication.

## Final Architecture

- **Public Workspace (`/`)**: No authentication required. Anyone can access the engineer workspace.
- **Admin Console (`/admin`)**: Protected by minimal server-enforced admin session auth.
- **No End-User Accounts**: Removed role-based access control and Convex Auth integration.
- **Honest Public Records**: Replaced fake anonymous user IDs with explicit admin metadata.

## Changes Made

### Removed Files

| File                       | Reason                                                           |
| -------------------------- | ---------------------------------------------------------------- |
| `convex/auth.ts`           | Auth configuration with providers                                |
| `convex/auth.config.ts`    | Auth site configuration                                          |
| `convex/lib/roles.ts`      | Role-based access control                                        |
| `convex/lib/roles.test.ts` | Tests for roles                                                  |
| `src/features/auth/**`     | All auth UI components (AuthGate, RoleGate, SignOutButton, etc.) |
| `src/pages/auth.astro`     | Auth page                                                        |
| `src/pages/app.astro`      | Old authenticated app page                                       |

### Added Files

| File                       | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `convex/adminAuth.ts`      | Admin session management and login logic                        |
| `convex/adminAuth.test.ts` | Tests for admin auth                                             |
| `src/features/admin-auth/**` | Admin login UI components                                        |
| `src/pages/admin.astro`    | Admin console page with auth gate                               |
| `scripts/hash-admin-password.mjs` | Password hash generation script                              |

### Modified Files

| File                                                      | Changes                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `convex/schema.ts`                                        | Removed `authTables`, added `adminSessions` and `adminLoginAttempts` |
| `convex/lib/viewer.ts`                                    | Simplified to return public viewer with admin metadata       |
| `convex/users.ts`                                         | Simplified `current` query to return public viewer info      |
| `convex/chats.ts`                                         | Uses explicit admin metadata instead of fake user IDs         |
| `convex/search.ts`                                        | Removed viewer requirement from ask action                    |
| `convex/documents.ts`                                     | Uses explicit admin metadata                                  |
| `convex/ingestion.ts`                                     | Uses explicit admin metadata                                  |
| `convex/assets.ts`                                        | Removed viewer requirement                                    |
| `convex/evaluations.ts`                                   | Removed admin check from seedDefaults                         |
| `src/app/providers/ConvexProvider.tsx`                    | Removed ConvexAuthProvider wrapper                            |
| `src/widgets/app-shell/island.tsx`                        | Removed AuthGate/RoleGate wrappers                            |
| `src/widgets/app-shell/ui/AppShell.tsx`                   | Removed viewer info display and SignOutButton                 |
| `src/widgets/admin-console/ui/AdminConsole.tsx`           | Now wrapped in admin auth gate                                |
| `src/widgets/engineer-workspace/ui/EngineerWorkspace.tsx` | Now public, no auth gate                                      |

### Database Schema Changes

#### Removed Tables

- `authTables` (from @convex-dev/auth): `users`, `sessions`, `authenticators`, `verificationTokens`

#### Added Tables

```typescript
adminSessions: defineTable({
  token: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  lastSeenAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_expires", ["expiresAt"]),

adminLoginAttempts: defineTable({
  username: v.string(),
  success: v.boolean(),
  attemptedAt: v.number(),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
})
  .index("by_username", ["username"]),
```

#### Simplified Tables

The `users` table was simplified from the @convex-dev/auth schema to:

```typescript
users: defineTable({
  email: v.string()
})
```

## How It Works Now

- **Public Access**: `/` is a public engineer workspace with no authentication required
- **Admin Protection**: `/admin` requires login with username and password
- **Session-Based Auth**: Admin sessions are stored in Convex with configurable TTL
- **No End-User Accounts**: Removed role-based access control and Convex Auth integration
- **Explicit Admin Metadata**: Actions record admin session tokens instead of fake user IDs

## Environment Variables

### Removed Variables

The following environment variables are no longer used:

| Variable                | Purpose                               |
| ----------------------- | ------------------------------------- |
| `AUTH_RESEND_KEY`       | Resend API key for magic link emails  |
| `AUTH_EMAIL_FROM`       | Sender email for auth emails          |
| `ADMIN_EMAILS`          | Comma-separated admin emails          |
| `ALLOWED_EMAILS`        | Comma-separated allowed emails        |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated allowed email domains |

### Added Variables

| Variable                | Purpose                               |
| ----------------------- | ------------------------------------- |
| `ADMIN_USERNAME`         | Admin username for `/admin` access    |
| `ADMIN_PASSWORD_HASH`   | Argon2id hash of admin password       |
| `ADMIN_SESSION_TTL_MS`  | Admin session timeout in milliseconds |

## Setup Instructions

### 1. Generate Admin Password Hash

```bash
node scripts/hash-admin-password.mjs "your-strong-password"
```

This will output an encoded Argon2id hash that you can use in your environment variables.

### 2. Configure Environment Variables

Set the following in `.env.local` (for development) or Convex Dashboard (for production):

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<hash-from-step-1>
ADMIN_SESSION_TTL_MS=1800000
```

### 3. Deploy to Convex

```bash
bun run convex:deploy
```

### 4. Verify Setup

- Visit `/` - should be publicly accessible without login
- Visit `/admin` - should redirect to login page
- Login with your admin credentials - should access admin console

## API Changes

### Queries

| Query           | Change                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| `users.current` | Now returns `{ canManageDocuments: true, isAllowed: true, isAdmin: boolean }`    |
| `adminAuth.validate` | New query to validate admin session tokens                                    |

### Mutations

| Mutation            | Change                           |
| ------------------- | -------------------------------- |
| `adminAuth.login`   | New mutation for admin login     |
| `adminAuth.logout`  | New mutation for admin logout    |
| `documents.create`  | Records admin session token     |
| `ingestion.enqueue` | Records admin session token     |
| `ingestion.retry`   | Records admin session token     |

## Security Considerations

### Current State

- **Public Workspace**: No authentication on `/` - suitable for internal tools or public documentation
- **Admin Console**: Minimal session-based auth on `/admin` - suitable for trusted environments
- **No End-User Accounts**: Removed complexity of user management and role-based access

### Recommendations

For production deployments:

1. **Use Strong Passwords**: Generate secure password hashes with the provided script
2. **Set Appropriate TTL**: Configure `ADMIN_SESSION_TTL_MS` based on your security requirements
3. **Monitor Login Attempts**: Review `adminLoginAttempts` table for suspicious activity
4. **Use HTTPS**: Ensure your Convex deployment uses HTTPS
5. **Consider Additional Layers**: For high-security requirements, consider:
   - Reverse proxy authentication (Authelia, Auth0)
   - IP whitelisting for `/admin`
   - Multi-factor authentication

## Migration Checklist

- [ ] Removed `@convex-dev/auth` and `@auth/core` dependencies
- [ ] Removed old auth routes and UI gates
- [ ] Replaced fake anonymous user IDs with explicit admin metadata
- [ ] Added `adminSessions` and `adminLoginAttempts` tables
- [ ] Generated `ADMIN_PASSWORD_HASH` with provided script
- [ ] Set `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_TTL_MS` in Convex dashboard
- [ ] Confirmed `/` is public and accessible without login
- [ ] Confirmed `/admin` requires login and protects admin features
- [ ] Removed all auth-era environment variables
- [ ] Updated documentation to reflect new architecture

## Rollback Plan

To restore the previous Convex Auth implementation:

1. Install dependencies: `npm install @convex-dev/auth @auth/core`
2. Restore `convex/auth.ts` with provider configuration
3. Restore `convex/auth.config.ts`
4. Restore `convex/lib/roles.ts`
5. Restore auth tables in `convex/schema.ts`
6. Restore the `users` query with proper auth integration
7. Update all viewer functions to use `getAuthUserId`
8. Restore AuthGate and RoleGate components
9. Restore the auth page and provider
10. Set auth environment variables (`AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, etc.)