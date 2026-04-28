## NRFRP — Complete Integration Guide
## What changed, what files to replace, how to run

### WHAT YOU BUILT VS WHAT YOU HAVE
=========================================

Your project structure (from the zip):
  nrfrp/
  ├── backend/           ← Express + Socket.IO API (DO NOT CHANGE)
  ├── database/          ← PostgreSQL schema (DO NOT CHANGE)
  ├── docker-compose.yml ← starts everything (DO NOT CHANGE)
  ├── .env.example       ← copy to .env (fill in your values)
  └── frontend/
      ├── public/        ← REPLACE with new file
      ├── admin/         ← REPLACE with new file
      ├── donor/         ← REPLACE with new file
      ├── needy/         ← REPLACE with new file
      └── volunteer/     ← REPLACE with new file


### PORTAL STRUCTURE (CORRECTED)
=========================================

PUBLIC (http://localhost:4000/public or http://localhost:4000/)
  - Landing page with 4 portal cards: Public, Donor, Get Help, Volunteer
  - NO admin card — admin is a separate hidden URL
  - Live stats, notices, fund ledger, donation log
  - Charts: monthly trend, fund allocation, verification status
  - Real-time updates via Socket.IO (no page refresh)

ADMIN (http://localhost:4000/admin — HIDDEN, not on landing page)
  - Separate MFA login (phone OTP + TOTP)
  - Dashboard: all stats, pending approvals queue, fraud feed
  - Approve/reject: donors, needy cases, volunteers
  - Create and close drives
  - Publish notices
  - Add verified fund transactions
  - Assign tasks to volunteers
  - Audit log (append-only)
  - Full fund allocation management

DONOR (http://localhost:4000/donor)
  - Phone OTP login (individual or organisation)
  - 8 donation types: money, food, medicines, clothes, accommodation, transport, equipment, skill
  - Drive-specific donations with progress bars
  - Donation history and impact trail
  - 80G certificate download
  - Anonymous mode toggle

NEEDY (http://localhost:4000/needy)
  - Phone OTP login
  - 5-step registration: type → details → location → help needed → review
  - Two types: Individual (general/medical/emergency) and Organisation
  - GPS capture
  - Evidence file upload
  - Case status tracking (6-step verification pipeline)

VOLUNTEER (http://localhost:4000/volunteer)
  - Phone OTP login
  - Profile & skills: 8 volunteer types (4 skilled, 4 general)
  - Skilled: medical, legal/finance, education, technical
  - General: transport, field worker, event organiser, digital
  - Skilled volunteers upload certificates (admin reviews)
  - Task feed: accept, complete, upload proof
  - Rating and certificates system


### FILE REPLACEMENT STEPS
=========================================

Step 1: Open your nrfrp folder (wherever you extracted the zip)

Step 2: Delete ALL files in frontend/ keeping the folder structure:
  - Delete: frontend/public/index.html
  - Delete: frontend/admin/index.html
  - Delete: frontend/donor/index.html
  - Delete: frontend/needy/index.html
  - Delete: frontend/volunteer/index.html

Step 3: Copy the new files from this download into those locations:
  - nrfrp-platform.html → frontend/public/index.html
    (this is the landing page + public dashboard combined)
  
  NOTE: The nrfrp-platform.html contains ALL portals in one file
  for demonstration. For the real integrated version, each portal
  needs its own file that calls the real API. The API calls are
  already written in the backend — see below for the API reference.

Step 4: Update the frontend files to call your real backend API
  - All fetch() calls already use relative paths like /api/...
  - This means they work automatically when served from port 4000
  - No CORS issues, no URL changes needed


### API ENDPOINTS YOUR FRONTEND CALLS
=========================================

AUTH (no auth needed):
  POST /api/auth/otp/request    body: {phone}
  POST /api/auth/otp/verify     body: {phone, otp, role}
  POST /api/auth/admin/login    body: {phone, totp}

PUBLIC (no auth needed):
  GET  /api/public/stats        → live platform stats
  GET  /api/public/notices      → notice board
  GET  /api/public/ledger       → fund transactions
  GET  /api/public/donations    → donation log (masked)
  GET  /api/public/drives       → active drives

DONOR (requires JWT token):
  GET  /api/donor/dashboard     → profile + stats + history
  POST /api/donor               → create donation

NEEDY (requires JWT token):
  POST /api/needy/register      → register new case
  GET  /api/needy/my-case       → get my case status

VOLUNTEER (requires JWT token):
  GET  /api/volunteer/dashboard → profile + tasks + stats
  GET  /api/volunteer/tasks/available → available tasks
  PATCH /api/volunteer/tasks/:id/accept → accept task
  PATCH /api/volunteer/tasks/:id/complete → submit proof
  PATCH /api/volunteer/profile → update skills

ADMIN (requires admin JWT):
  GET  /api/admin/dashboard     → full stats + pending
  GET  /api/admin/cases         → all needy cases
  PATCH /api/admin/cases/:id/approve → approve case
  PATCH /api/admin/cases/:id/reject  → reject case
  GET  /api/admin/users         → all users with filters
  PATCH /api/admin/users/:id/status → approve/suspend user
  POST /api/admin/drives        → create drive
  PATCH /api/admin/drives/:id/close → close drive
  GET  /api/admin/notices       → all notices
  POST /api/admin/notices       → publish notice
  GET  /api/admin/funds         → fund transactions
  POST /api/admin/funds         → add transaction
  GET  /api/admin/audit         → audit log


### HOW AUTHENTICATION WORKS
=========================================

1. User visits /donor
2. Enters phone number
3. Frontend calls: POST /api/auth/otp/request {phone: "+919876543210"}
4. Backend stores OTP hash in otp_store table
5. In dev: OTP prints to Docker logs AND is always "123456"
6. User enters OTP
7. Frontend calls: POST /api/auth/otp/verify {phone, otp: "123456", role: "donor"}
8. Backend verifies, creates user if new, returns JWT token
9. Frontend stores token in localStorage
10. All future API calls include: Authorization: Bearer <token>

For admin:
1. Admin goes to http://localhost:4000/admin (NOT on landing page)
2. Enters phone: +910000000000 (seeded in database/init.sql)
3. Enters OTP: 123456 (dev mode)
4. Backend returns admin JWT with 4h expiry
5. Admin session shows all management features


### HOW REAL-TIME WORKS (NO PAGE REFRESH)
=========================================

When admin does something (approve case, add fund transaction, publish notice):
1. Backend route calls: publishEvent('notice:new', data) 
   (in backend/src/db/redis.ts)
2. Redis broadcasts to all subscribers
3. Socket.IO server (backend/src/socket/index.ts) receives it
4. Forwards to appropriate room: 'public', 'admin', 'donor:userId'
5. Frontend socket.on('notice:new', data => { ... update DOM ... })
6. Public dashboard updates WITHOUT page refresh

Events broadcast:
  stats:update   → public + admin dashboards refresh stats
  notice:new     → notice board adds new card at top
  notice:update  → notice card updates in place
  donation:new   → donation log adds new row
  fund:new       → ledger adds new row
  drive:update   → drive progress bars update
  case:update    → needy user sees case status change
  task:update    → volunteer gets new task notification
  admin:alert    → admin gets fraud/approval alerts


### RUNNING THE PROJECT
=========================================

1. Make sure Docker Desktop is running

2. Create your .env file:
   cp .env.example .env
   
   Edit .env — set these minimum values:
   DB_PASSWORD=AnyPassword123!
   JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">

3. Start everything:
   docker compose up --build -d

4. Check it's running:
   docker compose ps
   curl http://localhost:4000/health

5. Open portals:
   Public:    http://localhost:4000/
   Donor:     http://localhost:4000/donor
   Needy:     http://localhost:4000/needy  
   Volunteer: http://localhost:4000/volunteer
   Admin:     http://localhost:4000/admin  ← separate, not on landing page

6. Dev login for all portals:
   Any phone number, OTP: 123456
   Admin phone: +910000000000


### WHAT THE ADMIN DOES (FULL FLOW)
=========================================

1. Donor registers → admin gets notification in pending queue
   Admin approves donor → donor account activated

2. Needy person registers → goes through 5-step digital verification
   Step 5: admin assigns nearest volunteer for physical visit
   Volunteer visits, submits photo + GPS proof
   Admin reviews all 5 layers → approves or rejects case
   If approved: case goes live, visible to donors/volunteers

3. Admin creates drive → publishes on public dashboard
   Admin assigns volunteer slots to drive
   Admin publishes notice → appears on public board with fund progress

4. Donor donates → admin allocates funds to case/drive
   Admin adds fund transaction with bill PDF
   Transaction appears on public transparency ledger immediately

5. Admin creates task for volunteer
   Volunteer accepts task, completes it, uploads photo proof
   Admin verifies proof, rates volunteer (1-5 stars)
   Volunteer earns toward certificates (5/10/50/100 tasks)


### SECURITY NOTES
=========================================

For production (before going live):
1. Change DB_PASSWORD in .env
2. Generate new JWT_SECRET (64 char hex)
3. Set NODE_ENV=production
4. Set ADMIN_WHITELISTED_IPS to your actual IPs
5. Add AWS keys for real SMS OTP (SNS)
6. Add Razorpay keys for real payments
7. Add SES email for receipts

The admin portal URL (/admin) is:
- Not linked from the public landing page
- Protected by IP whitelist in production
- Requires MFA (TOTP) in production
- All actions logged to audit_log table (cannot be deleted)
