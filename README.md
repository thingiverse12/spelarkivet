# 🐱 Katt Runner

Ett 2D endless runner där du spelar som **Silver** eller **Skugga**.

**Nytt:** 🤖 **J.A.R.V.I.S.** (`jarvis.html`) — en AI-assistent du kan skriva med, byggd enbart på gratis AI-tjänster.

## Spela lokalt (gratis, alltid)

```bash
python3 -m http.server 8080
```

Öppna `http://localhost:8080` (spelet) och `http://localhost:8080/jarvis.html` (JARVIS)

## 🤖 J.A.R.V.I.S. — gratis AI-chatt

Chattassistent i Iron Man-stil som drivs av **gratis AI-tjänster** — fungerar direkt utan någon nyckel:

| Tjänst | Nyckel? | Modell-exempel |
|--------|---------|----------------|
| **Pollinations** | Nej ✅ | openai, mistral m.fl. |
| **Puter.js** | Nej ✅ | GPT-5-nano m.fl. |
| **Groq** | Ja, gratis | Llama 3.3 70B, Qwen3 |
| **Google Gemini** | Ja, gratis | Gemini 2.5 Flash |
| **Cerebras** | Ja, gratis | Llama 3.3 70B |
| **OpenRouter** | Ja, gratis | `:free`-modeller |
| **GitHub Models** | Ja, gratis (PAT) | GPT-4o-mini |
| **Mistral** | Ja, gratis | Mistral Small |
| **Hugging Face** | Ja, gratis | Llama 3.1 8B |

Funktioner:

- **Automatisk failover** — svarar en tjänst inte byter JARVIS till nästa automatiskt
- **Streaming** av svar där tjänsten stödjer det
- **Gratis verktyg**: `/väder <ort>` (Open-Meteo), `/wiki <ämne>`, `/skämt` (JokeAPI), `/kattfakta`, `/bild <beskrivning>` (Pollinations-bilder), `/tid`, `/kasta`, `/hjälp`
- **Röst**: prata med mikrofonen (taligenkänning) och få röstsvar (Web Speech API)
- Chatthistorik sparas lokalt; API-nycklar lämnar aldrig webbläsaren

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
| `jarvis.html` | J.A.R.V.I.S. AI-chatt (gratis tjänster) |
| `assets/` | Sprites, bakgrund, logo |
| `netlify.toml` | Netlify-config |
| `_headers` | Cache/security headers |
