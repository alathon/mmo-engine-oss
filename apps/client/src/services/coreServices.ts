import { ClientSession } from "../state/clientSession";

export interface CoreServices {
  session: ClientSession;
}

export const createCoreServices = (): CoreServices => {
  const session = new ClientSession();
  return { session };
};
