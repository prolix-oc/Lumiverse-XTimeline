# Lumiverse Timeline

A private Twitter-like timeline extension for Lumiverse. Users can write **weaves** as a selected persona, react and reply in threads, publish a weave from the current chat, and invite active Council members or character cards to make their own in-character posts.

## What it includes

- A global **Timeline** drawer tab and a **Weave current chat** action in the chat input Extras menu. It immediately publishes as the selected persona and automatically invites the active chat character to respond; chat weaves can also save a configurable snapshot of recent messages for that reply.
- Persona-authored weaves, threaded replies, and lightweight reactions.
- An invite-only actor roster: invited Council members and character cards post on a randomized, configurable cadence, with an explicit **Weave now** option for one-off posts.
- Twitter-style `@` mentions for Council members and character cards, including a removable multi-mention stack and randomized multi-actor reply order.
- Character-led thread replies: when someone replies beneath an actor's weave, the nearest actor in that thread responds in character.
- Council members and character cards as timeline actors, including actor-originated weaves and replies.
- Chat weaves are generated as the selected persona. When enabled, their configurable context snapshot is retained privately for thread replies.
- Per-user private timeline storage via `spindle.userStorage`.
- A Timeline settings reset that clears posts, reactions, threads, and roster invitations while preserving the chosen persona, sidecar, and cadence.

## Permissions

The manifest requests:

- `generation` for actor posts/replies and chat summaries.
- `characters`, `personas`, and `images` to build the actor directory and avatars.
- `chats` and `chat_mutation` to safely read the current chat when the user explicitly chooses to weave about it.

If a permission is not granted, the timeline remains usable where possible and hides the dependent action.

## Development

```bash
bun install
bun run typecheck
bun run build
```

Lumiverse can also build `src/backend.ts` and `src/frontend.ts` automatically on install when `dist/` is absent.
