import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { redisSub } from '../db/redis';

export let io: SocketServer;

// Rooms:
// 'public'         - anyone, no auth needed (public dashboard)
// 'admin'          - admin only
// 'donor:{id}'     - specific donor
// 'volunteer:{id}' - specific volunteer
// 'needy:{id}'     - specific needy user

export function initSocket(server: HttpServer) {
  io = new SocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // Allow unauthenticated for public room
      socket.data.role = 'public';
      socket.data.userId = null;
      return next();
    }
    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
      socket.data.role = decoded.role;
      socket.data.userId = decoded.id;
      next();
    } catch {
      socket.data.role = 'public';
      socket.data.userId = null;
      next();
    }
  });

  io.on('connection', (socket) => {
    const { role, userId } = socket.data;

    // Auto-join rooms based on role
    socket.join('public');
    if (role === 'admin') socket.join('admin');
    if (userId) {
      socket.join(`${role}:${userId}`);
    }

    socket.on('disconnect', () => {});
  });

  // Subscribe to Redis channels and forward to socket rooms
  subscribeRedisToSocket();

  console.log('[Socket] Initialized');
  return io;
}

async function subscribeRedisToSocket() {
  const channels = [
    'stats:update',
    'notice:new',
    'notice:update',
    'donation:new',
    'donation:update',
    'drive:update',
    'case:update',
    'task:update',
    'fund:new',
    'admin:alert',
    'fraud:flag',
  ];

  for (const channel of channels) {
    await redisSub.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);
        // Broadcast to appropriate rooms
        if (['stats:update', 'notice:new', 'notice:update', 'donation:new', 'drive:update', 'fund:new'].includes(channel)) {
          io.to('public').emit(channel, data);
        }
        if (['admin:alert', 'fraud:flag', 'case:update'].includes(channel)) {
          io.to('admin').emit(channel, data);
        }
        if (channel === 'task:update' && data.volunteerId) {
          io.to(`volunteer:${data.volunteerId}`).emit(channel, data);
        }
        if (channel === 'donation:update' && data.donorId) {
          io.to(`donor:${data.donorId}`).emit(channel, data);
        }
        // Always send everything to admin
        io.to('admin').emit(channel, data);
      } catch {}
    });
  }
}

// Helper to emit and also publish to Redis (for multi-instance support)
export function emitEvent(channel: string, data: any) {
  if (!io) return;
  io.to('public').emit(channel, data);
  io.to('admin').emit(channel, data);
}
