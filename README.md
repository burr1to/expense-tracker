# Paper Ledger

A mobile-first personal income and expense tracker with monthly reporting, planning, CSV import/export, privacy controls, and database-backed email/password authentication.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Prisma ORM 7 + Supabase-hosted PostgreSQL
- Better Auth with persisted users, credential accounts, sessions, and reset tokens
- React Hook Form + Zod, Recharts, Phosphor Icons
- Vitest + ESLint

Supabase is the PostgreSQL host only. The browser never connects to Supabase and there is no local-storage database. All private data goes through authenticated server routes and user-owned Prisma queries.

## Configure

1. Create a Supabase project and copy its PostgreSQL pooler connection string.
2. Copy `.env.example` to `.env.local`.
3. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`.
4. For production password-reset mail, set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. In development, reset links are printed in the server terminal when Resend is not configured.
5. Apply the checked-in schema and generate the client:

```bash
npm install
npm run db:deploy
npm run db:generate
```

Prisma owns the complete schema in `prisma/schema.prisma`; the initial deployable migration is in `prisma/migrations`.

## Run

```bash
npm run dev
```

The app requires a working PostgreSQL connection. Sign-up creates the user, credential account, and database session; the first ledger request starts with empty persisted collections.

## Auth behavior

- Email/password sign-up and sign-in
- Scrypt password hashing through Better Auth
- HTTP-only, same-site session cookies backed by the `Session` table
- Forgot-password request and token-based password completion
- Password change with other-session revocation
- Password verification for the privacy lock
- Password-confirmed account deletion, cascading through all ledger data
- Server-side session validation plus `userId` ownership filtering on every ledger mutation

## CSV import format

Required columns are `date`, `type`, `category`, and `amount`. Optional columns are `note` and `tags`.

```csv
date,type,category,note,amount,tags
2026-07-11,expense,Food & Dining,"Lunch, team",1250,"work, food"
2026-07-10,income,Salary,Monthly salary,85400,work
```

## Quality checks

```bash
npm run lint
npm test
npm run build
```

The ledger supports NPR, USD, and AUD as display currencies without exchange conversion. “Net saved” is monthly income minus monthly expenses; savings goals are planning records rather than bank balances.
