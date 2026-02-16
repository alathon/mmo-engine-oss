import type {
  ConnectionEventEmitter,
  ConnectionStatus,
} from "../../../network/connection-event-emitter";

type Listener = () => void;

export class ConnectionStatusViewModel {
  private status: ConnectionStatus;
  private listeners = new Set<Listener>();
  private disposed = false;

  constructor(private connection: ConnectionEventEmitter) {
    this.status = connection.getStatus();

    this.connection.onStatusUpdate((text, connected) => {
      if (this.disposed) {
        return;
      }
      this.status = { text, connected };
      this.emit();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ConnectionStatus {
    return this.status;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
