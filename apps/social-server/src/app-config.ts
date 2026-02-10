import { defineServer, defineRoom, monitor, playground } from 'colyseus';
import basicAuth from 'express-basic-auth';
/**
 * Import your Room files
 */
import { SocialRoom } from './rooms/social-room';

export const server = defineServer({
  rooms: {
    social: defineRoom(SocialRoom),
  },
  express: (app) => {
    const basicAuthMiddleware = basicAuth({
      // list of users and passwords
      users: {
        admin: process.env.MONITOR_PASSWORD || 'admin',
      },
      // sends WWW-Authenticate header, which will prompt the user to fill
      // credentials in
      challenge: true,
    });

    app.use('/monitor', basicAuthMiddleware, monitor());

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== 'production') {
      app.use('/', playground());
    }

    app.get('/healthz', (_req, res) => {
      res.send('ok');
    });
  },
});

export default server;
