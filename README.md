# 🕹 Spelarkivet

Samling av spel byggda i repo't. Just nu:

| Spel | Typ | Mapp |
|------|-----|------|
| **Leif & Billy 3D – Skuldbrevsjakten i Sörbäcken** | 3D third person collect-&-evade (Three.js) | [`leif-billy-3d/`](leif-billy-3d/) |
| **Katt Runner** | 2D endless runner | rot (`index.html`) |

---

# 🌲 Leif & Billy 3D – Skuldbrevsjakten i Sörbäcken

Ett 3D-spel inspirerat av SVT-serien *Leif & Billy*. Spela som **Leif** eller **Billy**
och samla alla gulkronor i Sörbäcken innan tiden rinner ut – samtidigt som du undviker
**Kronofogden** (och älgen!). Tre nivåer: Snustorkan, Tjuvjakten och Hembräntsraiden.

```bash
cd leif-billy-3d
python3 -m http.server 8080
```

Öppna `http://localhost:8080`

## Kontroller

- **W A S D / pilar** – spring · **MUS/DRAG** – vrid kamera
- **MELLANSLAG** – hoppa · **SKIFT** – spurta · **E** – snusa (speedboost)
- **P / ESC** – paus · **R** – starta om · **M** – ljud på/av
- Mobil: virtuell joystick + knappar

## Detaljer

- Helt originaalskapade lowpoly-modeller (bröderna, fogden, älgen, husvagnen,
  raggar-Volvon, utedasset, faluröda torp) byggda i kod med Three.js (vendoad i `vendor/`).
- Proceduralt ljud och musik via WebAudio – inga samples.
- Menypanelen "Om serien" summerar fakta om SVT-serien (premiär 2017, 7 säsonger /
  50 avsnitt, Kristallen 2020 & 2023 m.m.).
- **Ett officielt fritt fantribut**: ingen kod, bild, modell eller ljud från SVT/Jarowskij
  används. Serien och rollfigurerna © SVT/Jarowskij; spelets utförande är eget.

| Fil | Roll |
|-----|------|
| `leif-billy-3d/index.html` | UI, HUD, meny |
| `leif-billy-3d/js/game.js` | Spelloop, AI, nivåer |
| `leif-billy-3d/js/chars.js` | Karaktärsbyggen + animation |
| `leif-billy-3d/js/world.js` | Världsbyggen (by, skog, fordon) |
| `leif-billy-3d/js/audio.js` | WebAudio-SFX och musik |
| `leif-billy-3d/vendor/three.module.min.js` | Three.js r160 (MIT) |

---

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
