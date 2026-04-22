import { httpRouter } from "convex/server"

import { auth } from "./auth"
import { mineruCallback } from "./ingestion"

const http = httpRouter()

auth.addHttpRoutes(http)
http.route({
  path: "/providers/mineru/callback",
  method: "POST",
  handler: mineruCallback
})

export default http
