import jwt from "jsonwebtoken";
import type { AuthTokenPayload } from "@mmo/shared";

export const createAuthToken = (
  overrides: Partial<AuthTokenPayload> = {},
  secret: string = process.env.AUTH_TOKEN_SECRET ?? "test-secret",
): string => {
  const payload: AuthTokenPayload = {
    playerId: "player-1",
    displayName: "Test Player",
    ...overrides,
  };
  return jwt.sign(payload, secret);
};
