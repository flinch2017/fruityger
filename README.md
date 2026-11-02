Hey! This is a personal project called Fruityger. It is a social networking web app themed with an early web-era aesthetics and a touch of modern features perfect for creative people.
Fruityger is prepared for a Cloudflare Pages frontend deployment. See [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md) for the rollout and API migration requirements.

<img width="1917" height="1027" alt="image" src="https://github.com/user-attachments/assets/0eb9e1ef-af59-4bdf-a0af-f9598c90712a" />

Features:
Post captions, images, and videos
Multiplayer games
Chat system
User interactions
Moderated uploading/chatting/commenting systems
Users can report contents that violates community rules
Secured online activity

I used ReactJS for the frontend, NodeJS for the API, Supabase for the database, and Cloudflare R2 for file storage. The frontend deploys to Cloudflare Pages; the API needs the Workers migration described in the deployment guide.
