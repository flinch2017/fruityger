# Fruityger Cloudflare deployment

## What is ready

The Vite/React frontend is configured for **Cloudflare Pages** in `frontend/wrangler.toml`.

1. In the Cloudflare dashboard, open **Workers & Pages** and create a Pages project from this repository.
2. Set the root directory to `frontend`.
3. Use `npm run build` as the build command and `dist` as the build output directory.
4. Set the production environment variables before the first build:
   - `VITE_API_BASE_URL=https://api.<your-domain>`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TURNSTILE_SITE_KEY`
5. Deploy from Git, or authenticate locally with `npx wrangler login` and run `npm run pages:deploy` in `frontend`.

Cloudflare Pages serves this React application as an SPA, so its client-side routes work without the Render rewrite rule.

## API migration status

The current Express API cannot be deployed unchanged to a Cloudflare Worker. Although Workers can run Express with Node compatibility, this API imports Node-only runtime features that do not exist in Workers:

- `multer` disk storage and `fs` temporary files for post uploads
- `child_process` and `ffmpeg-static` for video transcoding, thumbnails, and Tape edits
- Node-based TensorFlow/NSFW media moderation

Deploying it as-is would fail during bundling or when media endpoints execute. Move those jobs to a separate worker-compatible media pipeline (for example Cloudflare Queues plus a container/service for FFmpeg and model inference), or remove/replace those features before converting the Express application to the Workers request handler.

## Worker configuration after the media migration

Create a Worker for `backend` with Node compatibility and secrets. Do not commit secrets:

```toml
name = "fruityger-api"
main = "worker.js"
compatibility_date = "2026-11-02"
compatibility_flags = ["nodejs_compat"]
```

Store each current backend environment value with `wrangler secret put <NAME>`, including `DATABASE_URL`, `JWT_SECRET`, Turnstile, email, and R2 credentials. Set `FRONTEND_URL` and `ALLOWED_ORIGINS` to the final `https://<project>.pages.dev` URL (and the custom domain, if any). Then set the Pages `VITE_API_BASE_URL` to the deployed Worker URL.

## Cutover checks

- Test signup, verification, login, profile-image uploads, post media, chat, and game lobbies on the Pages URL.
- Add the Pages and Worker hostnames to Supabase redirect/origin settings and to Turnstile hostname settings.
- Only retire the existing Render services after the Pages frontend and every API/media flow pass these checks.
