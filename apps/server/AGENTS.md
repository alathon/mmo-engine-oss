# AGENTS.md

Read the [main AGENTS.md](../../AGENTS.md) file for general guidelines.

## Game server guidelines

The game server is responsible for maintaining the authoritative state of the
game world, validating and applying player input, and advancing the game state
and world.

## Colyseus Guidelines
- Define shared schemas in packages/shared when client needs access.
- Use @type() for all schema fields; keep Schema classes data-only.
- Keep rooms thin; move logic to commands/services/systems.
- Use server clock for timers.
- Run updates using deltaTime in milliseconds whenever possible.
- Cascade update() calls to child components, systems, etc., rather than
  huge parent update() methods.