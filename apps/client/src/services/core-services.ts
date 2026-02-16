import { ClientSession } from "../state/client-session";

export interface CoreServices {
  session: ClientSession;
}

export const createCoreServices = (): CoreServices => {
  const session = new ClientSession();
  return { session };
};
