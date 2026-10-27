# Railway pe test deploy (backend + 2 Postgres), frontends Vercel pe

## 1) Railway project banao
1. Railway > New Project > **Deploy from GitHub repo** (backend folder ka repo) ya `railway up` (CLI) se `backend/` upload.
   Root directory = `backend`. `Dockerfile` + `railway.toml` already ready hain (PORT, healthcheck `/api/health`, 1 replica).
   **Replicas 1 hi rakhna** (online/typing/call state memory me hai).
2. Project me **2 Postgres** add karo: ek ka naam `Postgres-Retail`, dusre ka `Postgres-Bullion`
   (alag service = alag database, wahi chahiye).

## 2) Backend ke Variables (Railway > backend service > Variables)
```
DATABASE_URL_RETAIL  = ${{Postgres-Retail.DATABASE_URL}}
DATABASE_URL_BULLION = ${{Postgres-Bullion.DATABASE_URL}}
SECRET_KEY           = (32+ random chars, ek hi)
ALLOWED_ORIGINS      = https://goldpos.swag.sa,https://swag-gold-react.vercel.app   # test ke liye apne test frontend URLs bhi daalo
ACCESS_TOKEN_EXPIRE_MINUTES = 480
```
Baaki purane .env se (agar chahiye): `EXTERNAL_API_*`, `TURN_*`, `VAPID_*`.
Settings > Networking > **Generate Domain** -> API URL milega (e.g. `https://xxx.up.railway.app`).
Pehli baar start pe tables aur 3 roles dono DB me khud ban jate hain.

## 3) Data (agar purane data pe test karna hai) ya fresh users
- **Fresh test**: ek user dono DB me banao (neeche `sync_users`/Railway shell). Real data ki zaroorat nahi.
- **Real data copy**: purane VM se dump, Railway DB me restore (Railway > Postgres service > Connect > *Public* URL):
  ```
  pg_dump -Fc OLD_RETAIL_DB  > retail.dump   &&  pg_restore --no-owner --clean -d "<Postgres-Retail PUBLIC url>" retail.dump
  pg_dump -Fc OLD_BULLION_DB > bullion.dump  &&  pg_restore --no-owner --clean -d "<Postgres-Bullion PUBLIC url>" bullion.dump
  ```
  Phir backend redeploy. (Ye sirf test copy hai, VM wale DB ko haath nahi lagta.)
- Users align (local machine se, `DATABASE_URL_RETAIL/BULLION` = dono PUBLIC urls export karke, backend folder me):
  `python scripts/sync_users.py report`  ->  `copy --from retail --to bullion --users ali,sara`  ->  `passwords --from retail`

## 4) Test
```
python scripts/smoke_test.py https://xxx.up.railway.app --user <username> --password '<password>'
```
Ye health, dono apps ka login, bina password switch, aur "ek app ka record dusre me nahi dikhta" check karta hai. `ALL GOOD` aana chahiye.

## 5) Frontends (test)
Dono ko Vercel pe naya preview/test project banao (ya purane me env change):
```
VITE_API_BASE=https://xxx.up.railway.app/api
VITE_RETAIL_URL=<retail frontend URL>
VITE_BULLION_URL=<bullion frontend URL>
```
Backend `ALLOWED_ORIGINS` me ye dono URL hone chahiye (warna CORS error). Phir Retail pe login > `⇄` switcher dabao.

## Dhyan
- Railway Postgres ka URL `postgresql://` hota hai, theek hai (psycopg2). Agar kabhi `postgres://` dikhe to `postgresql://` kar do.
- Free/trial plan pe service sleep ho sakti hai: pehli request slow, websocket calls toot sakte hain. Test ke liye theek.
- Test ke baad real switch: `DEPLOY.md` (VM wala) ya yahi Railway setup.
