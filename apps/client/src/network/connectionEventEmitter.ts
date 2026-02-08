export interface ConnectionStatus {
  text: string;
  connected: boolean;
}

export interface ConnectionEventEmitter {
  onStatusUpdate(handler: (text: string, connected: boolean) => void): void;
  getStatus(): ConnectionStatus;
}
