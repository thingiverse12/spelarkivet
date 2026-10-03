# Duty Calls — browser FPS

A **Call of Duty-style first-person shooter** that runs in the browser: online
matchmaking, six maps, five game modes, customisable loadouts, killstreaks and a
full XP/unlock progression system.

> Named *Duty Calls* rather than *Call of Duty* — same genre, same feel, no
> trademark trouble. Everything (models, sounds, maps) is generated in code;
> there are no downloaded art assets.

![game modes](https://img.shields.io/badge/modes-TDM%20%7C%20FFA%20%7C%20DOM%20%7C%20S%26D%20%7C%20GunGame-orange)
![maps](https://img.shields.io/badge/maps-6-blue)
![deps](https://img.shields.io/badge/server%20deps-zero-success)

---

## Play it

### 1. With real multiplayer (recommended)

```bash
node server/server.js          # http://localhost:8000
```

One process serves the client **and** hosts authoritative matches over
WebSocket. Zero npm dependencies — plain Node 18+.

### 2. Static hosting (GitHub Pages / Netlify)

Just open `index.html` over any static host. With no server reachable the game
automatically switches to **local matches against bots** — same simulation,
same rules, no dead end.

### 3. Tests

```bash
npm test      # simulation, renderer geometry, server + matchmaking
npm run lint  # no-undef / dead code sweep
```

---

## What's in it

### Game modes

| Mode | Rules |
|---|---|
| **Team Deathmatch** | Two teams race to the kill limit. |
| **Free-for-All** | Every soldier for themselves. |
| **Domination** | Capture and hold three flags; holding scores over time. |
| **Search & Destroy** | One life per round, plant or defuse the bomb, sides swap every round. |
| **Gun Game** | FFA weapon ladder — every kill advances your gun. |

### Maps

`Rust` (tight industrial) · `Suburbia` (street + two houses) · `Skyline`
(rooftop at dusk) · `Sandstorm` (open desert lanes) · `Depot` (warehouse CQB) ·
`Outpost` (frozen radar station)

### Rulesets

| | Health | Damage | Friendly fire | Enemy health bars |
|---|---|---|---|---|
| **Hardcore** (default) | 30 | ×1.6 | on | hidden |
| **Classic** | 100 | ×1.0 | off | shown |
| **Arcade** | 100 | ×1.1 | off | shown, faster movement, shorter matches |

### Loadouts & progression

* **12 weapons** across SMG / AR / LMG / shotgun / sniper / pistol
* **7 attachments** (optics, foregrip, extended mags, silencer, FMJ) unlocked by
  *per-weapon* XP, one per slot
* **3 lethal + 3 tactical** grenades, **9 perks** in 3 slots
* **6 killstreaks**: UAV, Care Package, Counter-UAV, Sentry Gun, Predator
  Missile, Attack Helicopter — all real entities/effects in the simulation
* **30 player levels** with unlocks at every level, persisted in `localStorage`
  (and server-side in `.data/profiles.json` when playing online — offline
  progress is merged, never overwritten)

### Controls

| | |
|---|---|
| Move / Sprint / Jump / Crouch | `WASD` / `Shift` / `Space` / `Ctrl` |
| Fire / Aim | `LMB` / `RMB` |
| Reload / Lethal / Tactical | `R` / `G` / `Q` |
| Weapons / Killstreaks | `1 2` / `4 5 6` |
| Scoreboard / Plant-defuse / Chat | `Tab` / `E` / `Enter` |

---

## How it's built

The interesting decision: **one simulation, two hosts.**

```
js/shared/        ← the game rules. No DOM, no Three.js.
  sim.js            authoritative simulation (players, weapons, grenades,
                    killstreaks, damage, scoring)
  modes.js          TDM / FFA / Domination / S&D / Gun Game plugins
  bots.js           bot AI — writes into the same input struct a human sends
  physics.js        AABB world, grid broadphase, step-up, raycasts
  maps.js           six maps compiled from a tiny builder DSL
  weapons.js        weapon + attachment + grenade database
  perks.js  killstreaks.js  progression.js  math3.js

js/client/        ← browser
  main.js           state machine, prediction, interpolation, HUD wiring
  renderer.js       Three.js: merged world mesh, soldiers, viewmodel, effects
  hud.js            minimap, hitmarkers, damage numbers, killfeed
  audio.js          every sound synthesized with WebAudio
  input.js  net.js  i18n.js (EN/SV)

server/           ← Node, zero dependencies
  server.js         static hosting + matchmaking queues + match rooms + profiles
  ws.js             RFC-6455 WebSocket implementation written from scratch

vendor/three.module.min.js   three.js r160, vendored (MIT) so the game
                             works offline — CDNs are only a fallback
```

Because the server and the offline fallback run the *same* `Sim`, a bot-only
match and an online match behave identically.

**Netcode.** The client predicts its own movement with the shared physics and
sends input + position at 30 Hz (edge-triggered actions are never throttled).
The server validates movement (anti-teleport clamp, geometry check) and is
fully authoritative for hits, damage, kills, objectives and XP. Other players
are interpolated from 20 Hz snapshots.

---

## Deploying

| Target | What you get |
|---|---|
| **Any Node host** (Render, Fly, Railway, a VPS) | `node server/server.js` — full online multiplayer |
| **GitHub Pages / Netlify / Cloudflare Pages** | static upload, bot matches |

Environment variables: `PORT` (8000), `HOST` (0.0.0.0), `BOT_FILL=0` to disable
bot fill, `MAX_BOTS` for the per-team bot cap.

The existing workflow at `.github/workflows/static.yml` already uploads the
whole repository, so GitHub Pages needs no changes: **Settings → Pages →
branch `main`, folder `/ (root)`**.

---

## Repository layout

| Path | Contents |
|---|---|
| `/index.html`, `/js`, `/css`, `/vendor` | the FPS |
| `/server` | multiplayer server |
| `/test` | test suite |
| `/katt-runner` | the original 2D endless runner (moved here from the root) |

**Katt Runner** still works at `/katt-runner/` — it moved out of the repository
root to make room for this game.
