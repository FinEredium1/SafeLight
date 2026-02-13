# SafeLight

SafeLight is a full-stack web app with a REST API backend and a Postgres database. This repo is set up for local development and production deployment (Neon Postgres + Render or similar).

## Tech Stack

- Backend: Django (Django REST Framework)
- Database: PostgreSQL (Neon recommended)
- Auth: Token or JWT (configure based on your implementation)
- Deploy: Render (web service) + Neon (DB)

## Repo Structure (typical)

> Adjust these names to match your repo.

.
├── backend/
│ ├── manage.py
│ ├── safelight/ # Django project folder
│ ├── api/ # Django app(s) for REST endpoints
│ └── requirements.txt
├── frontend/ # Optional (React/Next/etc.)
└── README.md


## Prerequisites

- Python 3.10+ (3.11 recommended)
- pip
- PostgreSQL database (Neon or local Postgres)
- Git

## Local Setup

### 1) Clone the repo
```bash
git clone <YOUR_REPO_URL>
cd <YOUR_REPO_FOLDER>
2) Create and activate a virtual environment
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
3) Install dependencies
cd backend
pip install -r requirements.txt
4) Environment variables
Create a .env file in backend/ (or wherever your settings expect it):

DEBUG=True
SECRET_KEY=replace-me

# Neon Postgres URL example:
# postgres://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
DATABASE_URL=postgres://USER:PASSWORD@HOST/DBNAME

# If using JWT:
JWT_SIGNING_KEY=replace-me

# CORS / Allowed hosts (update as needed)
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:3000
Notes:

If you are not using DATABASE_URL, set DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT instead and update settings.py.

For Neon, keep sslmode=require.

5) Run migrations
python manage.py migrate
6) Create a superuser (optional)
python manage.py createsuperuser
7) Start the server
python manage.py runserver
Backend should be available at:

http://127.0.0.1:8000/

API
Health check (example)
GET /api/health/

Auth (examples)
Depending on your implementation:

POST /api/auth/register/

POST /api/auth/login/

GET /api/auth/me/

Main endpoints (examples)
Replace with your real routes:

GET /api/items/

POST /api/items/

GET /api/items/{id}/

PUT /api/items/{id}/

DELETE /api/items/{id}/

If you have Swagger/OpenAPI:

/api/docs/ or /swagger/

Database (Neon)
Recommended settings:

Postgres version: 17 (if that is what you selected)

Enable SSL (sslmode=require)

Store the connection string in DATABASE_URL

Deployment (Render + Neon)
1) Neon
Create a Neon project and database

Copy the connection string

Add it to Render as DATABASE_URL

2) Render web service
Typical Render settings:

Build command:

pip install -r backend/requirements.txt
Start command (example with Gunicorn):

cd backend && gunicorn safelight.wsgi:application
Environment variables:

SECRET_KEY

DEBUG=False

DATABASE_URL

ALLOWED_HOSTS=<your-render-domain>

Any auth keys (JWT, etc.)

3) Static files (if used)
If your Django app serves static files:

python manage.py collectstatic --noinput
Make sure STATIC_ROOT is configured, and Render is set up appropriately