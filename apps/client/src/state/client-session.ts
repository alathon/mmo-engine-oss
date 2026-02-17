import type { LoginResponse } from "@mmo/shared-sim";

/**
 * Stores client-only session data across states.
 */
export class ClientSession {
  characterId?: string;
  characterName?: string;
  loginResponse?: LoginResponse;
}
