# SafeLight

SafeLight is an E2EE messaging app where clients pull messages via REST polling. It is designed as a small-scale, industry-style project with a hosted Postgres database and token-based authentication.

## Architecture

- Frontend: Firebase Hosting (or any static hosting)
- Backend: Node.js REST API (Express)
- Database: Neon Postgres (managed Postgres)

Messaging model: REST + polling
- Client periodically calls `GET /messages?since_id=...`
- Server returns any messages newer than `since_id` and a `next_since_id`

## Tech Stack

- Node.js + Express (REST API)
- Postgres (Neon) via `pg`
- JWT authentication via `jsonwebtoken`
- Password hashing via `bcrypt`
- Local env configuration via `dotenv`

## Local Development Setup

### 1) Prerequisites
- Node.js 20+ recommended
- A Neon account and a database connection string

### 2) Install dependencies

```bash
cd server
npm install
