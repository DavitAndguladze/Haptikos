import { Server } from 'socket.io';
import { createServer } from 'http';
import os from 'os';
import QRCode from 'qrcode';
import type { HapticEvent } from '../types.js';

export interface RoomCounts {
  phones: number;
  dashboards: number;
}

export function createSocketManager(httpServer: ReturnType<typeof createServer>) {
  const io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    const role = socket.handshake.query['role'];

    if (role === 'phone') {
      socket.join('phones');
    } else {
      socket.join('dashboard');
    }

    socket.on('haptic', (event: HapticEvent) => {
      io.to('phones').emit('haptic', event);
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

export async function generateQrDataUrl(port: number): Promise<string> {
  const ip = getLocalIp();
  const url = `http://${ip}:${port}`;
  return QRCode.toDataURL(url);
}

export function getRoomCounts(io: Server): RoomCounts {
  const phoneSockets = io.sockets.adapter.rooms.get('phones');
  const dashboardSockets = io.sockets.adapter.rooms.get('dashboard');
  return {
    phones: phoneSockets?.size ?? 0,
    dashboards: dashboardSockets?.size ?? 0,
  };
}
