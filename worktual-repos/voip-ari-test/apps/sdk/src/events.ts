import { io, Socket } from 'socket.io-client';

export class EventsModule {
  private socket: Socket | null = null;

  connect(wsUrl: string, tenantId: string) {
    this.socket = io(`${wsUrl}?tenantId=${tenantId}`, {
      transports: ['websocket'],
    });
    return this.socket;
  }

  on(event: string, callback: (data: any) => void) {
    this.socket?.on(event, callback);
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
