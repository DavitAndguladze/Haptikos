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

  const broadcastPhoneCount = () => {
    const count = io.sockets.adapter.rooms.get('phones')?.size ?? 0;
    io.to('dashboard').emit('phone-count', count);
  };

  io.on('connection', (socket) => {
    const role = socket.handshake.query['role'];

    if (role === 'phone') {
      socket.join('phones');
      broadcastPhoneCount();
      io.to('dashboard').emit('phone-connected');  // triggers latency measurement
    } else {
      socket.join('dashboard');
    }

    socket.on('haptic', (event: HapticEvent) => {
      io.to('phones').emit('haptic', event);
    });

    // Latency measurement relay for Spotify beat-sync timing.
    // Dashboard emits ping-phone → server relays to phones → phones reply pong-phone
    // → server relays back to dashboard → dashboard measures RTT/2.
    socket.on('ping-phone', (t0: number) => {
      io.to('phones').emit('ping-phone', t0);
    });
    socket.on('pong-phone', (t0: number) => {
      io.to('dashboard').emit('pong-phone', t0);
    });

    socket.on('disconnect', () => {
      broadcastPhoneCount();
    });
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
