# 🤖 J.A.R.V.I.S. — gratis AI-assistent

En AI-assistent i Iron Man-stil som du kan **skriva med** — byggd enbart på **gratis AI-tjänster**. Ingen registrering, ingen kostnad, inga hemligheter: en enda `index.html`, helt statisk.

![status](https://img.shields.io/badge/status-online-59ffa0) ![nyckel](https://img.shields.io/badge/api--nyckel-valfri-3fd0ff)

## Kör lokalt

```bash
python3 -m http.server 8080
```

Öppna `http://localhost:8080`

## Motorer (alla gratis)

Fungerar **direkt utan nyckel**:

| Tjänst | Modeller |
|--------|----------|
| 🌸 **Pollinations** | openai, mistral m.fl. (hämtas live) |
| ☁️ **Puter.js** | GPT-5-nano, GPT-4o-mini m.fl. |

Fler gratismotorer aktiveras med en gratis API-nyckel (klistras in under ⚙️ i appen, sparas bara i din webbläsare):

| Tjänst | Modeller | Nyckel |
|--------|----------|--------|
| ⚡ **Groq** | Llama 3.3 70B, Qwen3 | [console.groq.com](https://console.groq.com/keys) |
| ♊ **Google Gemini** | Gemini 2.5 Flash | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| 🧠 **Cerebras** | Llama 3.3 70B | [cloud.cerebras.ai](https://cloud.cerebras.ai/) |
| 🛰️ **OpenRouter** | `:free`-modeller | [openrouter.ai/keys](https://openrouter.ai/keys) |
| 🐙 **GitHub Models** | GPT-4o-mini, GPT-4o | [github.com/settings/tokens](https://github.com/settings/tokens) |
| 🌀 **Mistral** | Mistral Small | [console.mistral.ai](https://console.mistral.ai/api-keys/) |
| 🤗 **Hugging Face** | Llama 3.1 8B m.fl. | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |

- **Automatisk failover** — svarar en tjänst inte byter JARVIS automatiskt till nästa och visar vilken motor som svarade
- **Streaming** av svar där tjänsten stödjer det

## Verktyg (gratis API:er utan nyckel)

| Kommando | Gör | Källa |
|----------|-----|-------|
| `/väder <ort>` | Aktuellt väder | Open-Meteo 🌤️ |
| `/wiki <ämne>` | Wikipedia-sammanfattning | Wikipedia 📖 |
| `/skämt` | Slumpmässigt skämt | JokeAPI 😄 |
| `/kattfakta` | Kattfakta | catfact.ninja 🐱 |
| `/bild <beskrivning>` | Genererar AI-bild | Pollinations 🎨 |
| `/tid`, `/kasta`, `/modeller`, `/status`, `/hjälp`, `/rensa` | Lokala kommandon | — |

## Funktioner

- 🎙️ **Röst**: prata in med mikrofonknappen (sv-SE) och få röstsvar upplästa (Web Speech API)
- 💾 Chatthistorik sparas lokalt i webbläsaren + export till Markdown
- ⚙️ Inställningspanel för API-nycklar och motorval
- 🛑 Avbryt-knapp under generering
- 📱 Responsiv design med animerad arktreaktor och bootsekvens

## Publicera gratis

Statisk sajt — ingen build behövs.

**GitHub Pages:** Settings → Pages → Deploy from branch → `main` → `/ (root)`.
Klart på `https://<användare>.github.io/spelarkivet/`

**Netlify/Vercel/Cloudflare Pages:** dra in mappen som den är (`netlify.toml` + `_headers` finns redan).

## Kod

| Fil | Roll |
|-----|------|
| `index.html` | Hela JARVIS-appen (HTML + CSS + JS i en fil) |
| `netlify.toml` | Netlify-config |
| `_headers` | Cache/security headers |

## Integritet

API-nycklar sparas **endast i din webbläsare** (localStorage) och skickas bara direkt till vald AI-tjänst. Chattar skickas via respektive gratistjänsts publika API.
