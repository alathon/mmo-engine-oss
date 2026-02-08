import { defineServer, defineRoom, monitor, playground } from "colyseus";
import basicAuth from "express-basic-auth";
import { ZoneRoom } from "./world/zones/zoneRoom";
import { logger } from "@mmo/shared-servers";

export const server = defineServer({
  logger,
  express: (app) => {
    const basicAuthMiddleware = basicAuth({
      // list of users and passwords
      users: {
        admin: process.env.MONITOR_PASSWORD || "admin",
      },
      // sends WWW-Authenticate header, which will prompt the user to fill
      // credentials in
      challenge: true,
    });

    app.use("/monitor", basicAuthMiddleware, monitor());

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }

    app.get("/healthz", (_req, res) => {
      res.send("ok");
    });
  },
  rooms: {
    zone: defineRoom(ZoneRoom).filterBy(["zoneId"]),
  },
});

export default server;
