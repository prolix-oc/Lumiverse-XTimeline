# Lumiverse Timeline

A private Twitter-like timeline extension for Lumiverse. Users can write **weaves** as a selected persona, react and reply in threads, share a draft about the current chat, and invite active Council members or character cards to make their own in-character posts.

## What it includes

- A global **Timeline** drawer tab and a **Weave current chat** action in the chat input Extras menu.
- Persona-authored weaves, threaded replies, and lightweight reactions.
- An invite-only actor roster: invited Council members and character cards post on a randomized, configurable cadence, with an explicit **Weave now** option for one-off posts.
- Character-led thread replies: when someone replies beneath an actor's weave, that actor gets the final in-character response for the turn and can optionally mention a fitting participant.
- Council members and character cards as timeline actors, including actor-originated weaves and replies.
- A user-editable chat-share draft. The saved post keeps only the chat reference, never the transcript.
- Per-user private timeline storage via `spindle.userStorage`.

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
