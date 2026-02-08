# AGENTS.md

Read the [main AGENTS.md](../../AGENTS.md) file for general guidelines.

## Login server guidelines

The login server is responsible for authenticating users and issuing JWT tokens,
that the user can use to authenticate with the other servers such as social-server
and the game server.

- Keep this service focused on identity/session issuance only (no game or social logic).
- JWTs should include player identity claims (e.g., playerId, displayName) and a clear expiry.
- Sign tokens with AUTH_TOKEN_SECRET and keep token validation consistent with other services.
