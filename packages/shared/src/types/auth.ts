export interface AuthTokenPayload {
  playerId: string;
  displayName: string;
}

export interface LoginResponse {
  token: string;
  playerId: string;
  displayName: string;
}
