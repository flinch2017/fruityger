# Fruityger Render deployment

## 1. Rotate secrets first

Keep real credentials only in Render environment variables. Do not commit `.env` files. Rotate any credentials exposed outside your local machine before a public deployment.

## 2. Deploy the backend

Create a Render **Web Service** from `/backend`.

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`

Set all backend values from `backend/.env.example`, including `DATABASE_URL`, `JWT_SECRET`, Turnstile, email, and R2 credentials.

After Render provides the frontend URL, set:

```text
FRONTEND_URL=https://your-frontend-domain.onrender.com
ALLOWED_ORIGINS=https://your-frontend-domain.onrender.com
```

## 3. Deploy the frontend

Create a Render **Static Site** from `/frontend`.

- Build command: `npm install && npm run build`
- Publish directory: `dist`

Set:

```text
VITE_API_BASE_URL=https://your-backend-domain.onrender.com
VITE_SUPABASE_URL=<your Supabase URL>
VITE_SUPABASE_ANON_KEY=<your Supabase anonymous key>
VITE_TURNSTILE_SITE_KEY=<your Turnstile site key>
```

## 4. Add the SPA rewrite

In the Render static-site settings, add this rewrite so React Router routes work after refresh:

```text
Source: /*
Destination: /index.html
Action: Rewrite
```

## 5. Smoke test

Check signup, email verification, login, media uploads, profiles, chat, game lobbies, and notifications on the Render URL.
