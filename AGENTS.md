# AGENTS.md

You are an advanced TypeScript expert with deep, practical knowledge of multiplayer games programming, performance optimization, and real-world problem solving based on current best practices.

## Commands
- Run a Turbo command on specific package(s): turbo --filter=<package> <command>
- Type-check: turbo check-types
- Build: turbo build
- Install dependencies: pnpm install
- Run tests (except client!): turbo test --filter=\!@mmo/client

## Repo Map (pnpm workspace)
The repository is a monorepo managed with pnpm. Applications are in the `apps/` directory, and libraries are in the `packages/` directory.

- apps/server: Colyseus game server (authoritative game state)
- apps/social-server: Colyseus social/chat server
- apps/login-server: Express login server (JWT auth)
- apps/client: Babylon.js client (browser)
- packages/shared: shared types, schemas, constants, utilities for both client and servers
- packages/shared-servers: shared server-only code (utilities/services not used by the client)
- packages/eslint: ESLint configuration for TypeScript projects

## Client flow
To get into the game, the client:
- First requests an auth token from the login server.
- Then connects to both the game server, and the social server, using that auth token.
- The client continually talks to the game server and social server, sending and receiving data.

## Tooling & frameworks
- Use Turborepo to run tasks from the root directory.
- Use pnpm as the package manager (not npm or yarn).
- Use vitest for testing.
- Use Colyseus for sharing state between client and server(s).
- Use Babylon.js for rendering the game world.

## Core Principles
- Server is authoritative. Clients send intentions.
- Prefer simple, readable TypeScript with clear naming and minimal allocation.
- Use `foo?: Type` for optional properties; avoid `Type | undefined` unless required by an external API.
- Avoid null and `Type | null` unless mandatory.
- Keep performance top of mind (GC, patch sizes, render cost).
- Whenever you've implemented some code, make sure it type-checks and compiles
without errors (by running `turbo --filter @mmo/PACKAGE check-types` for each package changed),
and that you run tests (`turbo test --filter=\!@mmo/client`).
- When changing anything in a library (under `packages`), the library must be built again
before dependant projects can see those changes.
- When working with external libraries like React, Colyseus and BabylonJS, check the docs with Ref / search_docs.

## Persistence Rules
- Use PostgreSQL for canonical data only.
- Game server keeps live gameplay state in memory.
- Login server owns accounts and players.
- Social server owns chat, friends, guilds, parties.
- Avoid cross-service writes; single-writer ownership per domain.
- All backend services write to the same shared database and schema.

## Feature Workflows
- For non-trivial changes, write a short plan in .agent/work as YYYY-MM-DD-feature.md.
- Keep changes small and composable; favor incremental changes and low complexity / low coupling.
- Add tests for game logic and integration paths when feasible.
- Consider client-server latency, authoritative server & dumb client.

## Performance Expectations
- Minimize allocations in tick loops and render loops.
- Keep schemas small and avoid over-syncing.
- Use object pools for frequently created objects.
- Prefer batching and instancing on the client.

## API Design Rules
- Avoid passing functions as method arguments, unless it is for things like an `onChange` handler.
- Prefer event emission + observers to reduce coupling (e.g., `AbilityEventListener` / `AbilityEngine`). Only use an interface to decouple when multiple things could reasonably implement it.
- Functions with more than 4-5 arguments indicate a design problem. Ask me before implementing such a function to confirm the design.

## Render/simulation loop
- The server and client both simulate the game world at a fixedTick() rate of TICK_MS. All game world simulation
must happen as part of fixedTick(), not update().
- The client does visual updates in the per-frame render loop, update().

# Colyseus framework specifics
- Use specific, correct numeric types for Schema fields (such as uint16 or int32), not the general 'number' type.
