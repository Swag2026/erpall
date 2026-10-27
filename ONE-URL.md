# Ek URL: /retail aur /bullion (ek Vercel project)

- `vercel.json` + `build-all.sh` (repo root) dono frontends ko ek site me build karte hain:
  `https://<domain>/retail/`, `https://<domain>/bullion/`, aur `/` pe chhota chooser page.
- Vercel project: Root Directory = repo root (default), baaki `vercel.json` se. Env var sirf ek: `VITE_API_BASE=https://<railway-api>/api`.
- Switcher (⇄) ab same site ke andar chalta hai: login ek baar, dusre app me bina password ke.
- Har app ka login/theme/language browser me alag prefix (`retail:` / `bullion:`) se save hota hai, to ek ka logout dusre ko nahi hilata.
- Do alag URL (purana tarika) bhi chalta hai: frontend-* ko akele build karo (VITE_BASE na do).
- Railway `ALLOWED_ORIGINS` me sirf ye ek site ka URL chahiye.
