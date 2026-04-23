import { httpRouter } from "convex/server"

import { mineruCallback } from "./ingestion"

const http = httpRouter()

http.route({
  path: "/providers/mineru/callback",
  method: "POST",
  handler: mineruCallback
})

export default http
