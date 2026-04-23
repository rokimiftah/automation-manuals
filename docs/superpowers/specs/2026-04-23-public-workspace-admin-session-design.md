# Public Workspace and Minimal Admin Session Design

## 1. Goal

Replace the current full application authentication model with a public engineer workspace at `/` and a minimal admin-only login at `/admin`.

The new design removes all end-user authentication, role gates, and Convex Auth integration from the public product flow while preserving a server-enforced protection boundary for document upload and admin-only ingestion operations.

## 2. Current Codebase Understanding

The current product has two functional surfaces built on top of Astro and Convex:

- The engineer workspace asks questions against the document corpus, saves chat history, generates grounded answer packets, and opens cited PDF pages in the evidence viewer.
- The admin console registers manuals, queues ingestion jobs, retries failed jobs, and monitors provider progress for MinerU-based extraction and embedding.

Historically, authentication was implemented with Convex Auth. That older model introduced four separate coupling points:

- package and provider coupling through `@convex-dev/auth`, `@auth/core`, and `ConvexAuthProvider`
- frontend route and component gating through `/auth`, `AuthGate`, `RoleGate`, and `SignOutButton`
- backend viewer and access logic through the old generic current-user query, the old viewer helper module, and `convex/lib/roles.ts`
- schema and HTTP coupling through `authTables`, `convex/auth.ts`, `convex/auth.config.ts`, and auth HTTP routes in `convex/http.ts`

At the time this design was written, the working tree had already removed large parts of that stack but still left behind transitional assumptions such as viewer helpers and fake anonymous user IDs. Those transitional shortcuts were not the target design.

## 3. Target Product Behavior

The final route surface is reduced to two pages only:

- `/` serves the engineer workspace directly and does not require login
- `/admin` serves the admin login gate and the admin console after session validation

There is no `/auth` page and no `/app` page. The current engineer workspace behavior moves from `/app` to `/`.

The public product behavior becomes:

- any visitor can ask grounded questions
- any visitor can open evidence viewer assets returned by those grounded answers
- no user account, role, or allowlist is required for the public question-answer flow

The protected admin behavior becomes:

- upload and ingestion operations require a valid admin session
- admin session validation happens on the server for every protected function
- client-side route gating is only a convenience layer and is not the security boundary

## 4. Security Model

This design intentionally does not keep partial Convex Auth or role-based application users. Instead it introduces a narrow, explicit admin session system with the smallest security surface that still protects the sensitive operations.

### 4.1 Admin Credentials

Admin credentials are configured through Convex deployment environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_TTL_MS`

The password is not stored as plaintext in application code, database records, or deployment configuration. The deployment stores a one-way password hash only. Login verifies the password submitted by the user against that hash.

This design does not use `ADMIN_PASSWORD` plaintext because a leaked deployment environment would otherwise reveal an immediately usable password.

### 4.2 Session Strategy

Admin login returns an opaque random session token, not a JWT. The raw token is returned once at login time and stored client-side in `sessionStorage`.

The database stores only a hash of the session token and session metadata. Protected admin functions accept a `sessionToken` argument and verify it server-side against the hashed session record and expiry.

This gives the design the following properties:

- revocable sessions
- short, explicit lifetime
- no token contents that can be trusted without a database lookup
- no false assumption that the browser route itself is secure

### 4.3 Security Constraints

The new admin auth layer must enforce all of the following:

- fail closed if admin env variables are missing or invalid
- generic login errors that do not reveal whether username or password failed
- rate limiting for repeated login attempts
- no password logging and no token logging
- no token in URL, query string, or document markup
- server-side checks on every protected admin query or mutation
- session revoke support on logout
- audit logging for login success, login failure, logout, and admin-sensitive actions

This design accepts the trade-off that `sessionStorage` is weaker than an `httpOnly` cookie against XSS. That trade-off is intentional because the current architecture uses direct Convex client calls from React islands. Moving admin auth to secure cookies would require a larger server-proxy architecture for all admin operations, which is out of scope for this migration.

## 5. Schema Changes

The schema should stop pretending that public visitors are authenticated users.

### 5.1 Remove User-Centric Auth Data

The following auth-era model is removed:

- `users` table
- all Convex Auth tables previously introduced through `authTables`
- any field whose only meaning was “the authenticated user who performed this action” in the public app flow

### 5.2 Public Data Simplification

The following fields are removed because the public workspace no longer has signed-in users:

- `chatSessions.userId`
- `chatMessages.userId`

Chat sessions become anonymous public sessions identified only by their session document ID.

### 5.3 Admin Metadata Replacement

Admin-owned records should no longer reference a `users` table. Replace those relationships with explicit metadata:

- `documents.createdByAdmin: string`
- `ingestionJobs.requestedByAdmin: string`

Audit records should be made independent from application users. Instead of `actorUserId`, the audit model should carry explicit admin actor metadata such as:

- `actorType`
- `actorLabel`
- optional `adminSessionId`

The exact field names can remain small, but the model must clearly represent admin activity without a fake user document.

### 5.4 New Admin Security Tables

Add an `adminSessions` table containing at minimum:

- `username`
- `tokenHash`
- `createdAt`
- `expiresAt`
- optional `revokedAt`
- optional `lastUsedAt`

Add a login-attempt tracking table, for example `adminLoginAttempts`, to support server-side rate limiting and auditability.

## 6. Backend Architecture

### 6.1 Remove Legacy Auth Boundaries

The remaining public auth-era modules and references targeted by this migration were:

- `convex/auth.ts`
- `convex/auth.config.ts`
- the generic current-user query module
- the viewer helper module
- any imports of `@convex-dev/auth` or `@auth/core`

The backend should have no viewer role model and no generic “current user” query after this migration. That cleanup is now complete in the current runtime.

### 6.2 New Admin Auth Module

Introduce a focused admin auth surface:

- `convex/adminAuth.ts` for public auth entry points
- `convex/lib/adminAuth.ts` for shared validation and session helpers

The public function surface should remain small:

- `signIn`
- `signOut`
- `validateSession`

The helper layer should own:

- environment validation
- password hash verification
- token generation
- token hashing
- session lookup and expiry checks
- rate limit enforcement
- audit event creation for auth events

### 6.3 Protected Function Boundaries

Every admin-only function must require a valid `sessionToken` argument and call the shared admin-session requirement helper before doing work.

The protected Convex functions include:

- `documents.listAdmin`
- `documents.create`
- `ingestion.listJobs`
- `ingestion.enqueue`
- `ingestion.retry`
- `evaluations.seedDefaults`

The public functions remain public and do not take admin auth arguments:

- `search.ask`
- `assets.resolveViewerAsset`
- public chat retrieval used by the engineer workspace

## 7. Frontend Architecture

### 7.1 Public Workspace Route

`src/pages/index.astro` becomes the engineer workspace entry point.

The previous `/app` route is removed. Any landing-page copy that assumes a separate protected workspace should be rewritten or deleted so the route now behaves like the product, not a pre-auth marketing shell.

### 7.2 Admin Route

`src/pages/admin/index.astro` remains, but it becomes a composition of:

- a minimal admin session gate
- a login form when no valid session exists
- the existing admin console when a valid session exists

Create a small new feature for the login UI and local session handling, for example:

- `src/features/admin-auth/ui/AdminLoginForm.tsx`
- `src/features/admin-auth/model/useAdminSession.ts`

The implementation can stay simpler if the hook and form live together, but the responsibility split should stay clear: local session handling for admin, not generic application auth.

### 7.3 Token Handling in the Client

The admin UI reads and writes the session token from `sessionStorage` only.

The admin React flow is:

1. load token from `sessionStorage`
2. validate token with `adminAuth.validateSession`
3. if valid, render admin console and pass token to protected admin queries and mutations
4. if invalid, clear token and return to the login form

Admin queries should use Convex’s `"skip"` pattern when no session token is available so protected queries do not execute before auth state is known.

## 8. Admin Flow

### 8.1 Sign In

The sign-in sequence is:

1. user opens `/admin`
2. frontend shows the login form if no valid token exists
3. login form submits username and password to `adminAuth.signIn`
4. backend rate-limits the attempt
5. backend verifies username and password hash
6. backend creates a random session token, stores only the token hash, and returns the raw token once
7. frontend stores the raw token in `sessionStorage`
8. frontend revalidates and then unlocks the admin console

### 8.2 Sign Out and Expiry

The sign-out sequence is:

1. frontend calls `adminAuth.signOut`
2. backend revokes the matching session
3. frontend clears local session state and `sessionStorage`
4. `/admin` returns to the login form

Expired or revoked sessions follow the same user-visible result: protected calls fail, the token is cleared locally, and the user must sign in again.

## 9. Testing Strategy

This migration changes both security boundaries and domain schema, so the verification plan must cover both behavior and regressions.

### 9.1 Backend Tests

Add tests for:

- username mismatch rejection
- password mismatch rejection
- login rate limiting
- successful session issuance
- successful session validation
- expired session rejection
- revoked session rejection
- admin-only function rejection without a valid session token
- admin-only function acceptance with a valid session token
- logout revocation behavior

### 9.2 Frontend Tests

Add tests for:

- `/admin` showing the login form when no session exists
- successful login storing the session token and rendering the console
- invalid or expired session returning the UI to the login state
- protected admin queries being skipped when no session token exists
- `/` rendering the engineer workspace without any auth gate

### 9.3 Verification Commands

The implementation phase must finish with, at minimum:

- targeted Vitest coverage for the new admin auth behavior
- full project test run
- `bun run lint`

The implementation is not complete until the codebase is type-clean and lint-clean.

## 10. Documentation and Migration

The migration documentation must describe the change as a move from full user auth to a split model:

- no authentication for the public engineer workspace
- minimal admin-only session auth for `/admin`

Update the following documentation artifacts:

- `README.md`
- `.env.local.example`

The migration guide should cover:

- removed packages and files
- removed routes
- new admin environment variables
- schema changes and old auth-table cleanup
- operational steps for generating and setting `ADMIN_PASSWORD_HASH`
- behavior differences between the old role-based app and the new public-plus-admin model

## 11. Out of Scope

The following are intentionally out of scope for this migration:

- replacing the direct Convex admin UI with a proxy-based server architecture
- adding multi-user admin management
- adding password reset or email recovery for admin login
- public-user identity, saved accounts, or role restoration
- expanding admin auth beyond the minimum required to protect upload and ingestion flows

## 12. Recommended Outcome

The recommended end state is a codebase with:

- no end-user authentication dependencies
- no auth-themed public routes or components
- a public workspace at `/`
- a server-protected `/admin` using minimal opaque sessions
- explicit schema fields that model admin actions honestly rather than pretending that anonymous visitors are authenticated users

This design keeps the security boundary narrow, removes auth coupling from the public product, and avoids carrying dead or misleading authentication structures into the next stage of the project.
