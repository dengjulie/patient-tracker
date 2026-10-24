# CLAUDE.md

Instructions for Claude Code on this project. Product reasoning lives in
[PRODUCT.md](PRODUCT.md); architecture in [ARCHITECTURE.md](ARCHITECTURE.md).

## How we work
- **I make the product decisions.** When a choice affects what users see or
  what data we store, stop and ask me. Give options with a recommendation and
  the trade-offs. Don't decide silently.
- **Question the requirements.** The PRD is a starting point. When an
  established standard (FHIR, US Core) or a widely used product already solves
  the problem, bring that up, even if it means changing the PRD.
- **Build in small pieces.** Do one piece at a time, then explain what was
  built and why, so I understand every line before we move on.
- **Record every decision.** Product decisions go in PRODUCT.md with their
  reasoning. Deferred ideas go in its "Later" list, not in the code.
- **Keep ARCHITECTURE.md in sync.** When the schema, API or auth changes,
  update its matching section in the same commit.

## Code
- **Do the minimum the requirements need.** No speculative endpoints,
  abstractions or config. Simple, well-known libraries over custom code.
- **Write for readers.** Clear names, small functions, and comments that
  explain *why*, not *what*.
- **UX matters as much as correctness.** Error messages are written for the
  provider, not the developer. The front end shows the API's validation
  messages as they are.

## Verify before calling it done
- **Test the API against a running server**, including error paths. Test UI
  changes in the browser.
- **Report failures honestly**, along with the fix.

## Git
- **One logical change per commit**, with a message that explains the why.
- **Push after every commit**, so GitHub always matches local `main`.

## Running
See [README.md](README.md) for setup, scripts, the demo login, and project
structure. Keep it up to date when any of those change.
