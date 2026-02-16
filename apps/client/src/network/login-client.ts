import { LoginResponse } from "@mmo/shared";

const DEFAULT_LOGIN_URL = "http://localhost:3000";

const isLoginResponse = (value: unknown): value is LoginResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const token = Reflect.get(value, "token");
  const playerId = Reflect.get(value, "playerId");
  const displayName = Reflect.get(value, "displayName");

  return (
    typeof token === "string" && typeof playerId === "string" && typeof displayName === "string"
  );
};

/**
 * Requests an auth token from the login server.
 *
 * @return the login response containing token and player identity.
 * @throws if the login request fails.
 */
export const login = async (): Promise<LoginResponse> => {
  const loginUrl = import.meta.env.VITE_LOGIN_SERVER_URL || DEFAULT_LOGIN_URL;
  const response = await fetch(`${loginUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!isLoginResponse(data)) {
    throw new Error("Invalid login response shape.");
  }

  return data;
};
