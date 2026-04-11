import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import QRCode from 'qrcode';
import {
  createSocketManager,
  getLocalIp,
  getRoomCounts,
} from './broadcast/socket-manager.js';

const PORT = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = createSocketManager(httpServer);

// When compiled to dist/, __dirname = .../server/dist — public lives in src/public.
app.use(express.static(path.join(__dirname, '../src/public')));

app.get('/qr', async (_req, res) => {
  const url = `http://${getLocalIp()}:${PORT}`;
  const buf = await QRCode.toBuffer(url);
  res.set('Content-Type', 'image/png');
  res.send(buf);
});

app.get('/health', (_req, res) => {
  const { phones, dashboards } = getRoomCounts(io);
  res.json({ status: 'ok', phones, dashboards });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
