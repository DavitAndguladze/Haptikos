import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  createSocketManager,
  generateQrDataUrl,
  getRoomCounts,
} from './broadcast/socket-manager.js';

const PORT = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = createSocketManager(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/qr', async (_req, res) => {
  const dataUrl = await generateQrDataUrl(PORT);
  res.send(`<img src="${dataUrl}" alt="Scan to connect" />`);
});

app.get('/health', (_req, res) => {
  const { phones, dashboards } = getRoomCounts(io);
  res.json({ status: 'ok', phones, dashboards });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
