import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect(tenantId: string, onConnect?: () => void, onDisconnect?: () => void) {
    if (this.socket) return this.socket;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const apiBase = (import.meta as any).env?.VITE_API_BASE || `http://${hostname}:3000`;
    const serverUrl = `${apiBase}/events?tenantId=${tenantId}`;

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      if (onConnect) onConnect();
    });

    this.socket.on('disconnect', () => {
      if (onDisconnect) onDisconnect();
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

export const socketService = new SocketService();
