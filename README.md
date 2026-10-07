# PassTrace

A live cybersecurity-awareness event disguised as a hacking puzzle. Everything in the game is fictional.

**Stack:** Node.js + Express, Server-Sent Events, vanilla HTML/CSS/JS, no build step, no database.
State lives in server memory and is persisted to `data/event-state.json`.

> **Run exactly one instance.** SSE connections and the event clock live in one process.
> Scaling horizontally would need shared state and a distributed event system.

## Run locally
```
cp .env.example .env     # fill in SESSION_SECRET, ADMIN_PASSWORD, FINAL_CODE
npm install
npm start                # http://localhost:3000  (admin: /admin)
```
Keep the real answer only in your private `.env` as `FINAL_CODE`. Never commit `.env`.

## Static files (no `public/` folder)
`index.html`, `css/`, `js/` and `assets/` live in the project root. Express serves the root through an **allowlist** (`/`, `/index.html`, `/css/`, `/js/`, `/assets/`), so `server.js`, `.env`, `data/` and `views/` are never reachable. `/assets/grammie/` returns 403 until the event starts.

## Replacing photos and clues
- Photos: put `photo1.jpg`-`photo4.jpg` in `assets/grammie/` and the avatar at `assets/profile/avatar.jpg`.
- Captions, image descriptions and profile content: edit `data/puzzle.json`. It is served only through `GET /api/puzzle` after the event starts, and never contains the answer.

## Classes, scheduling and GST
Players pick a class on arrival: grade 9 has sections A-G, grade 10 has sections A-H, and grades 11 and 12 have sections A-G. In `/admin`, set the start time in GST (UTC+4) and press SCHEDULE: the waiting screen shows a countdown and the event opens automatically at that time. START still works for an immediate start, and RESET clears the schedule. Each class can be claimed by one player (RESET clears claims, and `/admin` can release a class). Admins can write and release live hints or announcements to all players. The `proximity` command shows a player's hottest and coldest guess, rated COLD/WARM/HOT, up to 5 times. The admin panel also shows reported ping, closest wrong guess by class, and a recent guess waterfall.

## Environment
`AUTO_END_AFTER` (default `3`) ends the event automatically once that many players have solved it, then shows everyone the final leaderboard.
See `.env.example`. Set `COOKIE_SECURE=true` when served over HTTPS.

## Deploy: Render
1. New > Web Service, connect the repository.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variables: `SESSION_SECRET`, `ADMIN_PASSWORD`, `FINAL_CODE`, `COOKIE_SECURE=true`. Keep instances at 1.

## Deploy: Railway
1. New Project > Deploy from GitHub repo (the Dockerfile is picked up).
2. Variables tab: set the variables above. Railway provides `PORT`.
3. Deploy and keep replicas at 1. Mount a volume at `/app/data` to keep state across redeploys.

## Deploy: VPS
```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
git clone <repo> passtrace && cd passtrace
npm install --omit=dev && cp .env.example .env && nano .env
sudo npm i -g pm2 && pm2 start server.js --name passtrace && pm2 save && pm2 startup
```
Nginx (SSE needs buffering off):
```
server {
  server_name example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```
Then: `sudo certbot --nginx -d example.com` and set `COOKIE_SECURE=true`.

## Deploy: Docker
```
docker build -t passtrace .
docker run -d -p 3000:3000 --env-file .env -v passtrace-data:/app/data passtrace
```
