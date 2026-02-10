/**
 * Client-side application state identifiers.
 */
export const ClientGameState = {
  Login: 'login',
  CharacterSelect: 'characterSelect',
  Ingame: 'ingame',
} as const;

/**
 * Client game state keys.
 */
export type ClientGameStateKey = (typeof ClientGameState)[keyof typeof ClientGameState];
