import { describe, expect, it } from 'vitest';
import { ConnectionStatusViewModel } from './connection-status-view-model';
import type {
  ConnectionEventEmitter,
  ConnectionStatus,
} from '../../../network/connection-event-emitter';

class FakeConnectionEmitter implements ConnectionEventEmitter {
  private handlers: ((text: string, connected: boolean) => void)[] = [];
  private status: ConnectionStatus;

  constructor(initial: ConnectionStatus) {
    this.status = initial;
  }

  onStatusUpdate(handler: (text: string, connected: boolean) => void): void {
    this.handlers.push(handler);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  emitStatus(text: string, connected: boolean): void {
    this.status = { text, connected };
    for (const handler of this.handlers) {
      handler(text, connected);
    }
  }
}

describe('ConnectionStatusViewModel', () => {
  it('tracks the latest status', () => {
    const connection = new FakeConnectionEmitter({
      text: 'Disconnected',
      connected: false,
    });
    const viewModel = new ConnectionStatusViewModel(connection);

    expect(viewModel.getSnapshot()).toEqual({
      text: 'Disconnected',
      connected: false,
    });

    connection.emitStatus('Connected', true);
    expect(viewModel.getSnapshot()).toEqual({
      text: 'Connected',
      connected: true,
    });
  });
});
