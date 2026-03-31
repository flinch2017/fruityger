# Fruityger Render Deploy Checklist

## 1. Rotate secrets first

Your local `.env` files contain real credentials. Before a public deploy, rotate these values in the providers they came from:

- `DATABASE_URL`
- `JWT_SECRET`
- `RECAPTCHA_SECRET`
- `SMTP_*`
- `R2_*`
- any Supabase keys if they were exposed beyond local use

Then keep only the new values in Render environment variables.

## 2. Deploy the backend

Create a Render **Web Service** from `/backend`.

- Environment: `Node`
- Build command: `npm install`
- Start command: `npm start`

Set these environment variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRY`
- `RECAPTCHA_SECRET`
- `FRONTEND_URL`
- `ALLOWED_ORIGINS`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_URL`

Recommended:

- `FRONTEND_URL=https://your-frontend-domain.onrender.com`
- `ALLOWED_ORIGINS=https://your-frontend-domain.onrender.com`

## 3. Deploy the frontend

Create a Render **Static Site** from `/frontend`.

- Build command: `npm install && npm run build`
- Publish directory: `dist`

Set these environment variables:

- `VITE_API_BASE_URL=https://your-backend-domain.onrender.com`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_RECAPTCHA_SITE_KEY`

## 4. Add SPA rewrite

In the Render static site settings, add a rewrite so React Router routes work on refresh:

- Source: `/*`
- Destination: `/index.html`
- Action: `Rewrite`

## 5. Smoke test after deploy

Check these flows on the live app:

- sign up
- email verification
- login
- create post with media
- hashtag search and hashtag page
- save hashtag
- edit profile and avatar upload
- settings email change flow
- notifications settings toggle

## 6. Current production hardening included in code

- frontend runtime now rewrites legacy `http://localhost:5000/...` fetch calls to `VITE_API_BASE_URL`
- backend CORS now respects `ALLOWED_ORIGINS` / `FRONTEND_URL`
- email-change confirmation links now prefer `FRONTEND_URL` consistently
- `.env.example` files now document required variables for both apps
