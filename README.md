# 🐱 Katt Runner

Ett 2D endless runner där du spelar som **Silver** eller **Skugga**.

## Spela lokalt (gratis, alltid)

```bash
python3 -m http.server 8080
```

Öppna `http://localhost:8080`

## Kontroller

- **Mellanslag** / **Upp** / **W** / **klick** — hoppa  
- **← →** i lobbyn — byt katt  
- **Enter** / **R** — spela igen  

---

## Publicera gratis (välj en)

I den här Agent-miljön blockeras ofta Netlify/Vercel/Surge (TLS), men **GitHub fungerar**. Därför är koden pushad till GitHub.

### 1) GitHub Pages (rekommenderat, gratis)

Repo: https://github.com/thingiverse12/spelarkivet  
PR: https://github.com/thingiverse12/spelarkivet/pull/3  

1. Merga PR:n till `main` (eller välj branchen nedan)  
2. Gå till **Settings → Pages**  
3. **Source**: Deploy from a branch  
4. Branch: `main` (eller `arena/01a02dee-spelarkivet`), folder: `/ (root)`  
5. Save  

Spelet publiceras på ungefär:

`https://thingiverse12.github.io/spelarkivet/`

### 2) Netlify Drop (gratis, ingen CLI)

1. Öppna https://app.netlify.com/drop  
2. Dra in hela mappen (med `index.html` + `assets/`)  
3. Klar — du får en `*.netlify.app`-länk  

### 3) Netlify CLI (gratis)

```bash
netlify login
netlify deploy --dir=. --prod
```

(`netlify.toml` finns redan i projektet.)

### 4) Cloudflare Pages / Vercel / Surge

Samma sak: ladda upp den **statiska mappen** (ingen build).  
Fungerar på din egen dator; kan vara blockerat i vissa sandboxes.

---

## Kod

| Fil | Roll |
|-----|------|
| `index.html` | Hela spelet |
| `assets/` | Sprites, bakgrund, logo |
| `netlify.toml` | Netlify-config |
| `_headers` | Cache/security headers |
