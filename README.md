# SaveYoRupee

A mobile-first personal income and expense tracker with monthly reporting, planning, dues and repayment tracking, reminders, optional Kathmandu transaction locations, receipt attachments, a financial milestone timeline, CSV import/export, privacy controls, and database-backed email/password authentication.

## Kathmandu transaction map

- Add an optional exact location to an income or expense by searching a Kathmandu area, using device location, or dropping a pin.
- Save named places such as Home, Office, or a favorite shop and reuse them on later transactions.
- Review mapped entries at `/maps`, filter income and expenses, and inspect clustered markers.
- Exact coordinates are accepted only inside the configured Kathmandu map bounds. Free-text `area` remains available when no exact location is wanted.
- MapLibre renders keyless OpenFreeMap vector tiles derived from OpenStreetMap. The app applies its own low-clutter Kathmandu theme, hides buildings and secondary map labels, and adds a high-visibility neighborhood overlay. Override the source with `NEXT_PUBLIC_MAP_STYLE_URL` if needed.
- Live place suggestions use the authenticated server-side `PHOTON_SEARCH_URL` endpoint with input debouncing, caching, request pacing, and Kathmandu bounds. Use a hosted provider or self-hosted Photon as usage grows.

## Dues and reminders

- Track one-off payments and expected income separately from repeating entries.
- Keep lent and borrowed money by person, due date, partial repayment, and remaining balance.
- Reminder dates feed the always-visible bell on desktop and mobile.
- Settling an item can optionally create the matching income or expense ledger entry.
- JPG, PNG, WebP, and PDF receipts up to 3 MB can be kept privately with a transaction or due.
- The experimental receipt scanner can photograph a JPG, PNG, or WebP receipt, ask Gemini 3.5 Flash-Lite for category splits, and require a complete review before atomically adding the transactions. Camera photos are resized and re-encoded before upload to remove EXIF/GPS metadata, and an in-progress upload or analysis can be cancelled. One private scan source is shared by all resulting splits.

## Account balances and transfers

- Track a manually checked balance for each supported bank or digital wallet.
- Account balances are snapshots: transactions and transfers recorded after the snapshot adjust the displayed current balance automatically.
- Move money between tracked accounts with transfers; transfers do not count as income or expenses.
- Reconcile each bank or wallet manually once per month by comparing the calculated closing balance with the provider's real balance.
- Approved reconciliations update the account snapshot, preserve any explained difference in a locked audit record, and prevent later changes to already-audited activity.
- The dashboard and Reports page show the total tracked balance and how it is distributed across accounts.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Prisma ORM 7 + Supabase-hosted PostgreSQL
- Better Auth with persisted users, credential accounts, sessions, and reset tokens
- React Hook Form + Zod, Recharts, MapLibre GL JS, Phosphor Icons
- Vitest + ESLint

Supabase hosts PostgreSQL and the private receipt Storage bucket. The browser uploads receipt bytes directly to Storage only with a short-lived, server-issued upload token; all authorization and ownership checks still go through authenticated server routes and user-owned Prisma queries.

## Configure

1. Create a Supabase project and copy its PostgreSQL pooler connection string.
2. Copy `.env.example` to `.env.local`.
3. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the comma-separated `BETA_ALLOWED_EMAILS` allowlist.
4. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY`. A legacy `SUPABASE_SERVICE_ROLE_KEY` is also accepted. `SUPABASE_RECEIPTS_BUCKET` defaults to `receipts`; the private bucket is created on the first upload with the app's 3 MB and MIME-type restrictions.
5. To test camera receipt analysis, create a key at [Google AI Studio](https://aistudio.google.com/app/apikey) and set the server-only `GEMINI_API_KEY`. Never use a `NEXT_PUBLIC_` prefix or paste the key into client code. The Gemini free tier may use submitted images to improve Google products, so use synthetic/test receipts until the project is moved to an appropriate paid/private processing tier.
6. For production password-reset mail, set `RESEND_API_KEY` and `AUTH_EMAIL_FROM`. In development, reset links are printed in the server terminal when Resend is not configured.
7. Optionally set `NEXT_PUBLIC_MAP_STYLE_URL` and `PHOTON_SEARCH_URL` for alternative production map providers. Development defaults to OpenFreeMap Positron vector tiles and Photon search with visible attribution.
8. Apply the checked-in schema and generate the client:

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
- Server-side beta allowlisting for sign-up, sign-in, password resets, and every protected data endpoint

## CSV import format

Required columns are `date`, `type`, `category`, and `amount`. Optional columns are `subcategory`, `area`, `note`, `payment mode`, and `payment account id`. Payment mode accepts `cash`, `cheque`, or `online` and defaults to cash when left blank. Online rows must use an account ID from the user's configured payment accounts.

```csv
date,type,category,subcategory,area,note,amount,payment mode,payment account id
2026-07-15,expense,Food & Dining,Lunch,Thamel,"Lunch, team",1250,cash,
2026-07-15,income,Salary,Salary,,Monthly salary,85000,cash,
```

## Quality checks

```bash
npm run lint
npm test
npm run build
```

The ledger supports NPR, USD, and AUD as display currencies without exchange conversion. “Net saved” is monthly income minus monthly expenses; savings goals are planning records rather than bank balances.
