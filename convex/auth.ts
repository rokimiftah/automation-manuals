import Resend from "@auth/core/providers/resend"
import { Password } from "@convex-dev/auth/providers/Password"
import { convexAuth } from "@convex-dev/auth/server"

const resendMagicLink = Resend({
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM,
  id: "resend-magic-link"
})

const resendPasswordReset = Resend({
  apiKey: process.env.AUTH_RESEND_KEY,
  from: process.env.AUTH_EMAIL_FROM,
  id: "resend-password-reset"
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ reset: resendPasswordReset }), resendMagicLink]
})
