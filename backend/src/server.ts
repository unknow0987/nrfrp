import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import { waitForDB } from './db/pool';
import { connectRedis } from './db/redis';
import { initSocket } from './socket/index';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { adminRouter } from './routes/admin';
import { donorRouter } from './routes/donor';
import { needyRouter } from './routes/needy';
import { volunteerRouter } from './routes/volunteer';

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '4000');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(rateLimit({ windowMs: 60000, max: 600 }));
app.use(express.json({ limit: '20mb' }));
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'nrfrp', port: PORT }));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/admin', adminRouter);
app.use('/api/donor', donorRouter);
app.use('/api/needy', needyRouter);
app.use('/api/volunteer', volunteerRouter);

// Frontend static files
const frontendBase = process.env.FRONTEND_PATH || path.join(__dirname, '../../frontend');

// Public portals — accessible to everyone
['public', 'donor', 'needy', 'volunteer'].forEach(portal => {
  const pp = path.join(frontendBase, portal);
  app.use('/' + portal, express.static(pp));
  app.get('/' + portal, (_req, res) =>
    res.sendFile(path.join(pp, 'index.html'), err => err && res.status(404).send('Portal not found'))
  );
});

// Admin portal — NOT linked from landing page, IP-restricted in production
const adminPath = path.join(frontendBase, 'admin');
if (process.env.ADMIN_WHITELISTED_IPS) {
  const whitelist = process.env.ADMIN_WHITELISTED_IPS.split(',').map(ip => ip.trim());
  app.use('/admin', (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || '';
    const normalized = clientIP.replace('::ffff:', '');
    if (!whitelist.includes(normalized) && !whitelist.includes('*')) {
      return res.status(403).json({ error: 'Admin access not allowed from this IP.' });
    }
    next();
  });
}
app.use('/admin', express.static(adminPath));
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(adminPath, 'index.html'), err => err && res.status(404).send('Admin portal not found'))
);

// Root redirect
app.get('/', (_req, res) => res.redirect('/public'));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});

async function boot() {
  await waitForDB();
  await connectRedis();
  initSocket(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅  NRFRP is running`);
    console.log(`    Public:    http://localhost:${PORT}/`);
    console.log(`    Donor:     http://localhost:${PORT}/donor`);
    console.log(`    Needy:     http://localhost:${PORT}/needy`);
    console.log(`    Volunteer: http://localhost:${PORT}/volunteer`);
    console.log(`    Admin:     http://localhost:${PORT}/admin  ← NOT on landing page\n`);
  });
}

boot().catch(e => { console.error('[Fatal boot error]', e.message); process.exit(1); });
