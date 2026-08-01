# Spelarkivet

En fristående prototyp för ett kurerat webspelarkiv. Öppna `index.html` i en modern webbläsare.

## Admin
Adminportalen öppnas från knappen **ADMIN**. Den inkluderade prototypkoden är den som angavs vid beställning. Uppladdade spel sparas endast lokalt i webbläsarens `localStorage`; HTML-filer kan öppnas under aktuell session. ZIP-filer registreras som arkivposter.

> För en publik tjänst måste inloggning, filvalidering, virusskanning och lagring flyttas till en säker backend. En adminhemlighet ska då ligga i en miljövariabel — aldrig i klientkod.
