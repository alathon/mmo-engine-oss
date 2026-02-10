# MMO OSS (WIP)

A work-in-progress MMO engine built as a pnpm + Turborepo monorepo. It uses Colyseus for authoritative servers and Babylon.js for the browser client.

# Technical details
## Requirements
- Node.js >= 22
- pnpm >= 10

## Run (Dev)
1. Install dependencies: `pnpm install`
2. Start all apps: `turbo dev`
3. Open the client at `http://localhost:5173`

## Core architecture
The following pieces make up the core architecture:
- The [web client](./apps/client) which is the players entry-point.
- The [game server](./apps/server) which handles the game logic.
- The [social server](./apps/social-server) which handles the social interactions (chat, friends list, guilds, etc).
- The [login server](./apps/login-server) which handles the authentication and authorization of players/accounts.

The basic flow for a client connecting to the game is:
- The client connects to the login server to authenticate and authorize the player.
- The login server verifies the player's credentials and issues a JWT token.
- The client uses the token to connect to the game server, and the
social server.
- The game/social server verifies the token and allows the player to join the game and chat.

## Default Local Ports
- Game server (Colyseus): `ws://localhost:2567`
- Social server (Colyseus): `ws://localhost:2568`
- Login server (Express): `http://localhost:3000`

## Notes
- Set `AUTH_TOKEN_SECRET` to keep auth tokens consistent across servers. In dev, it defaults to `dev-secret` if not set.

# Game systems: Implemented (in part)
## Combat (NPCs don't hit back yet)
- Aggro lists, dealing damage and healing cause aggro. NPCs chase top aggro targets.
- Combat events go to battle tab. Rich system for describing combat
  events with text/actor name replacement etc.
- Line of Sight (LoS) is calculated server-side and streamed to
  clients to be cached, so it is easy to use client-side instantly
  without needing server validation.

## NPC AI
- Extremely basic NPC AI, that wanders aimlessly unless the NPC
  goes into combat -- at which point it follows the top aggro target
  around forever, until it gets into melee range.

## Event log system
- Game events are logged to a central event log, such as combat
  events, abilities, etc. These events are streamed to clients
  in batches, and intelligently re-fetched if needed.
- As an example, this is what lets the client display the combat
  log text.

## Ability system
- Abilities can miss, hit, be blocked, crit, be dodged.
- Abilities can have 1 or more 'effects', each of which can be
  either healing, damage, or applying status effects (beneficial or detrimental).
- Ability status effects can block ability types or movement through a tag system (e.g). They can even grant abilities too.
- Global Cooldown (2.5s) on GCD ability use.
- off-GCD abilities can be used during GCD cooldown, although they
  are still subject to an internal 0.7s cooldown.
- Abilities are built to be smooth and responsive on the client,
  meaning even if you have lag, you will still feel like you're
  using abilities smoothly most of the time.
- Abilities generate 'floating combat text' for damage and
  healing, although only for your own abilities at the moment.

## Chat system
- Chat is handled by the social server, which is separate from the game server.
- Chat messages are broadcasted to all connected clients right now.

## Movement system
- Entities move along the navmesh of the scene.
- Movement is built to be smooth and responsive on the client, without letting the client get away with cheating.
- Client-side prediction, interpolation (of remote entities), and
reconciliation (of server-authoritative position syncs).

## Game UI
- Game UI using react components.
- Hotbar with pre-populated slots. Keybinds work, so does left-clicking. Mouse-over to see tooltips.
- Connection status indicator in top right corner.
- Chat system in bottom left.

## Client state model
- Client 'state model' for context switching between e.g., login
state, character selection state and ingame state.

## Input handling system
- Inputs are picked up by e.g., the DOMInputManager.
- Inputs are forwarded to' input handlers' in priority order, who each may 'consume' the input. If they don't, it passes to the next handler.

## Zone system
- Zones are defined by the game server, and are used to define areas of the game world.
- Zones have assets, a scene (the 3D environment), a Navmesh, and
  spawn points for entities.
- Zones have a 'lifecycle' where-by NPCs/objects can spawn, and
other things can in theory happen.

# Game systems: Not implemented at all
## Model animations
## Persistent player/world data
## Audio system
## Moving between zones
## Character Progression
### Classes
### ...
## Equipment
## Inventory
## Trading between players
## Queests/NPC dialog/whatever that layer will be
