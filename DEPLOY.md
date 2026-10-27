# SWAG Gold: Retail + Bullion (ek backend, do database, ek login)

## Kya bana hai
- **backend/**: ek hi FastAPI, do alag database. Retail -> `DATABASE_URL_RETAIL`, Bullion -> `DATABASE_URL_BULLION`.
  Kaun sa DB use hoga ye login token ke andar likha `app` decide karta hai (header se badla nahi ja sakta).
- **frontend-retail/** aur **frontend-bullion/**: dono apne purane look me, bas sidebar me `⇄ Switch to ...` button aur
  Users page me "Also give access to ..." checkbox naya hai.
- Login: same username + password dono me. Har app ki apni users table, apne roles/permissions, apna data.
  Switch karne par password dobara nahi poochta (server dusre app ka token deta hai).
- Password badalne par (ya admin reset karne par) dono app me automatically same ho jata hai.
- Kisi user ko sirf ek app ka access dena ho to dusre app me uska user mat banao (ya wahan disable karo).
- Gold unit per app: Retail = 21K-eq, Bullion = 24K-eq (shop loans, reports).

## Deploy (VM par)
0. **Backup pehle**: dono DB ka `pg_dump`, aur purana `backend/app` copy.
1. Dono DB jaise hain waise rahenge. `.env` me ye daalo (`backend/.env.example` dekho):
   `DATABASE_URL_RETAIL=...` (purana retail DB), `DATABASE_URL_BULLION=...` (purana bullion DB),
   `SECRET_KEY` (ek hi), `ALLOWED_ORIGINS` (dono frontend ke URL). Baaki EXTERNAL_API_*, TURN_*, VAPID_* purane .env se copy.
2. `backend/app` ko retail backend ki jagah rakho (packages same hain, requirements.txt dekho), rebuild.
   Ye api.swag.sa pe chalega; bullion-test-api wala alag backend ab band kar sakte ho.
3. Users align karo (backend folder se, same .env ke saath):
   ```
   python scripts/sync_users.py report                       # kaun kahan hai, password same ya DIFFERENT
   python scripts/sync_users.py copy --from retail --to bullion --users ali,sara --dry-run   # phir --dry-run hata do
   python scripts/sync_users.py passwords --from retail      # jo dono me hain unka password retail wala kar do
   ```
4. Frontends: dono me `VITE_API_BASE`, `VITE_RETAIL_URL`, `VITE_BULLION_URL` set karke build/deploy (Vercel env vars).
5. Sab ko ek baar dobara login karna padega (purane tokens me `app` nahi hai).

## Dhyan dene wali baatein
- **Retail pe bhi v4 ki hardening ab lagu hai**: cashier day open/close nahi kar sakta (Settings > Team & Access se on kar sakte ho),
  closing cash server nikalta hai, closed din ki entry sirf admin edit kare, cash+card = total check.
  Retail ke "Reopen day" ko `day.reopen` permission chahiye (pehle jaisa).
- Bullion frontend me "Reopen day" button nahi hai (uske source me tha hi nahi); API chalti hai, button chahiye to bol do.
- Bullion ka FULL backend (`swag-bullion-backend-FULL.zip`) se compare kiya: wo Retail source + v4 ki wahi 11 files hai (byte-by-byte same),
  bas ek extra migration line thi (`loan_shops.credit_limit`), wo ab isme hai. Matlab Bullion ka koi code chhuta nahi.
  `Dockerfile` aur pinned `requirements.txt` (fastapi 0.111, Python 3.12) unhi ke hain; isi stack pe saare tests aur stress chalaye.
- `seed.py` (demo data + default passwords) aur khali `alembic/` jaan-bujhkar nahi liye: production DBs me demo data nahi daalna.
- Retail ka pehla "Close day" ek baar dhyan se dekho: closing cash ab server formula se aata hai (Bullion wala, jo dashboard se match karta hai).
- Switch ke time token dusre site ke URL ke `#sso=` hash me jata hai (server ko nahi jata, turant address bar se hat jata hai).
- Test: backend `python -m pytest tests -q` (20 tests, SQLite pe): dono DB me same user id/invoice no. rakhke har GET endpoint dono token se check kiya, koi cross-leak nahi; websocket, typing, presence, backup bhi alag; 32 parallel threads x 5120 requests me 0 leak.
  Browser me Retail->Bullion->Retail switch bhi check kiya. Production Postgres pe pehle staging me ek baar check kar lo.
