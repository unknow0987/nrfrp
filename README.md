# NRFRP — Complete Platform Setup Guide

## Architecture: Single backend, all portals on one port

```
http://localhost:4000/          → redirects to /public
http://localhost:4000/public    → Public transparency dashboard
http://localhost:4000/admin     → Admin master control portal
http://localhost:4000/donor     → Donor portal (with image slider)
http://localhost:4000/needy     → Needy help request portal
http://localhost:4000/volunteer → Volunteer task portal
http://localhost:4000/api/*     → REST API (JSON)
http://localhost:4000           → WebSocket (Socket.IO, real-time)

Database: PostgreSQL  → localhost:5432
Cache:    Redis       → localhost:6379
```

All portals update in real-time via WebSocket. No page refresh needed.

---

## STEP 1 — Prerequisites

Install these if not already installed:
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Make sure Docker is running (you'll see the whale icon in taskbar)

That's it. You do NOT need Node.js, npm, or pnpm installed locally.

---

## STEP 2 — Configure your environment

```bash
# Copy the template
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it | Required? |
|---|---|---|
| DB_PASSWORD | Make up any strong password | YES |
| JWT_SECRET | Run: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` | YES |
| AWS_ACCESS_KEY_ID | AWS Console → IAM → Create access key | For file uploads |
| AWS_SECRET_ACCESS_KEY | Same page | For file uploads |
| RAZORPAY_KEY_ID | razorpay.com → Settings → API Keys | For payments |
| RAZORPAY_KEY_SECRET | Same page | For payments |
| SES_FROM_EMAIL | AWS SES → Verified identities | For emails |

**For development/testing**: only DB_PASSWORD and JWT_SECRET are required. OTP will print to Docker logs instead of SMS.

---

## STEP 3 — Deploy everything

```bash
# Start all services (builds backend, starts DB and Redis)
docker compose up --build -d

# Watch startup logs (Ctrl+C to stop watching, services keep running)
docker compose logs -f backend
```

Wait for: `NRFRP running on http://0.0.0.0:4000`

---

## STEP 4 — Verify everything is working

### Check all containers are running
```bash
docker compose ps
```
All 3 should show "running":
- nrfrp_db       (postgres)
- nrfrp_redis    (redis)
- nrfrp_api      (backend)

### Check backend health
```bash
curl http://localhost:4000/health
# Expected: {"status":"ok","service":"nrfrp","port":4000}
```

### Check database tables were created
```bash
docker exec -it nrfrp_db psql -U nrfrp -d nrfrp -c "\dt"
```
Should list: users, donors, needy_cases, volunteers, drives, donations, tasks, fund_transactions, notices, audit_log, otp_store

### Check seed data loaded
```bash
docker exec -it nrfrp_db psql -U nrfrp -d nrfrp -c "SELECT name, status FROM drives;"
```
Should show 4 drives (2 active, 1 completed, 1 active food drive)

---

## STEP 5 — Access the portals

Open in your browser:

| Portal | URL | Login |
|---|---|---|
| Public dashboard | http://localhost:4000/public | No login |
| Admin portal | http://localhost:4000/admin | Phone: +910000000000, OTP: 123456 |
| Donor portal | http://localhost:4000/donor | Any phone + OTP: 123456 |
| Needy portal | http://localhost:4000/needy | Any phone + OTP: 123456 |
| Volunteer portal | http://localhost:4000/volunteer | Any phone + OTP: 123456 |

**Dev OTP**: In development mode (default), the OTP is always `123456`. You can see the actual OTP in Docker logs:
```bash
docker compose logs backend | grep OTP
```

---

## STEP 6 — Test real-time (no refresh needed)

1. Open two browser windows side by side
2. Window 1: http://localhost:4000/public (Public dashboard)
3. Window 2: http://localhost:4000/admin (Admin portal, login as admin)
4. In Admin → Fund ledger → click "+ Add transaction"
5. Watch Window 1 update **without refreshing** — the new transaction appears instantly

Same works for:
- Admin publishes a notice → Public dashboard notice board updates live
- Donor makes a donation → Stats counter updates live on public dashboard
- Admin approves a case → Needy user's status changes live

---

## Common commands

```bash
# Stop everything
docker compose down

# Start again (fast, no rebuild)
docker compose up -d

# Rebuild after code changes
docker compose up --build -d

# View live logs
docker compose logs -f

# View only backend logs
docker compose logs -f backend

# Reset database (WARNING: deletes all data)
docker compose down -v
docker compose up --build -d

# Check Redis is working
docker exec -it nrfrp_redis redis-cli ping
# Expected: PONG

# Run a SQL query
docker exec -it nrfrp_db psql -U nrfrp -d nrfrp -c "SELECT * FROM platform_stats;"
```

---

## Troubleshooting

**Backend keeps restarting / "Cannot connect to database"**
```bash
docker compose logs postgres
# Wait for "database system is ready to accept connections"
# Then: docker compose restart backend
```

**Port 4000 already in use**
```bash
# Change port in docker-compose.yml:
# ports: - "4001:4000"   (use 4001 externally)
```

**OTP not working**
- In dev mode, OTP is always `123456`
- Check logs: `docker compose logs backend | grep OTP`

**Frontend not loading**
```bash
# Check the volume is mounted correctly
docker exec -it nrfrp_api ls /app/frontend
# Should show: admin  donor  needy  public  volunteer
```

**Database tables missing**
```bash
# The init.sql runs only on FIRST startup
# To re-run it, reset the database:
docker compose down -v && docker compose up --build -d
```

---

## Production deployment (VPS or EC2)

```bash
# On your server:
apt update && apt install -y docker.io docker-compose-v2
git clone your-repo nrfrp
cd nrfrp
cp .env.example .env
# Edit .env with production values
# Set NODE_ENV=production in .env
docker compose up --build -d
```

Then set up Nginx + SSL:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

SSL: `certbot --nginx -d yourdomain.com`
