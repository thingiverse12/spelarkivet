# Spelarkivet

En fristående prototyp för ett kurerat webspelarkiv. Öppna `index.html` i en modern webbläsare.

## Publicera på Cloudflare

Projektet innehåller en färdig `wrangler.jsonc` för **Cloudflare Workers Static Assets**. Om Cloudflare försöker köra `wrangler deploy` ska den nu hitta webbplatsens filer i projektroten.

```bash
npm install
npm run deploy
```

Detta är för **Cloudflare Workers**-flödet. Om du använder **Cloudflare Pages** i stället: välj `None`, lämna **Build command** tomt och ange `.` som **Build output directory**. Använd endast ett av flödena, inte båda.

## Admin
Adminportalen öppnas från knappen **ADMIN**. Den inkluderade prototypkoden är den som angavs vid beställning. Uppladdade spel sparas endast lokalt i webbläsarens `localStorage`; HTML-filer kan öppnas under aktuell session. ZIP-filer registreras som arkivposter.

> För en publik tjänst måste inloggning, filvalidering, virusskanning och lagring flyttas till en säker backend. En adminhemlighet ska då ligga i en miljövariabel — aldrig i klientkod.
