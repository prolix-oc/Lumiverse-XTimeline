import type { SpindleFrontendContext, SpindleSelectHandle } from 'lumiverse-spindle-types'
import {
  MAX_WEAVE_LENGTH,
  REACTION_EMOJIS,
  type TimelineActor,
  type TimelineChatSource,
  type TimelinePost,
  type TimelineSnapshot,
} from './shared'

type UnknownRecord = Record<string, unknown>
const MAX_VISIBLE_ACTORS = 30
const MAX_MENTION_MATCHES = 20

interface TimelineBackendMessage {
  type: string
  snapshot?: TimelineSnapshot
  message?: string
  active?: boolean
  actorName?: string | null
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is TimelineSnapshot {
  return isRecord(value)
    && isRecord(value.state)
    && Array.isArray(value.state.posts)
    && Array.isArray(value.personas)
    && Array.isArray(value.replyActors)
    && Array.isArray(value.connections)
}

function asMessage(value: unknown): TimelineBackendMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  return value as unknown as TimelineBackendMessage
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function button(label: string, className = 'xtl-button'): HTMLButtonElement {
  const element = createElement('button', className, label)
  element.type = 'button'
  return element
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 45_000) return 'now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

function actorMatchesSearch(actor: TimelineActor, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [actor.name, actor.handle, actor.bio, actor.role]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}

function actorSearchRank(actor: TimelineActor, query: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return 0

  const name = actor.name.toLocaleLowerCase()
  const handle = actor.handle.toLocaleLowerCase()
  const role = (actor.role ?? '').toLocaleLowerCase()
  const bio = actor.bio.toLocaleLowerCase()

  if (name === normalizedQuery || handle === normalizedQuery) return 100
  if (name.startsWith(normalizedQuery)) return 90
  if (handle.startsWith(normalizedQuery)) return 80
  if (name.includes(normalizedQuery)) return 70
  if (handle.includes(normalizedQuery)) return 60
  if (role.includes(normalizedQuery)) return 50
  if (bio.includes(normalizedQuery)) return 40
  return 0
}

interface ComposerMentionQuery {
  start: number
  end: number
  query: string
}

function mentionQueryAtCursor(text: string, cursor: number): ComposerMentionQuery | null {
  const beforeCursor = text.slice(0, cursor)
  const match = /(^|\s)@([a-zA-Z0-9_]*)$/.exec(beforeCursor)
  if (!match) return null
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2],
  }
}

function actorMatchesMention(actor: TimelineActor, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase()
  if (!normalizedQuery) return true
  return actor.name.toLocaleLowerCase().includes(normalizedQuery)
    || actor.handle.toLocaleLowerCase().includes(normalizedQuery)
}

function actorLeading(actor: TimelineActor) {
  if (actor.avatarUrl) {
    return {
      type: 'image' as const,
      src: actor.avatarUrl,
      rounded: true,
      fallback: {
        text: initials(actor.name),
        background: 'var(--lumiverse-fill-subtle)',
      },
    }
  }
  return {
    type: 'initial' as const,
    text: initials(actor.name),
    background: 'var(--lumiverse-fill-subtle)',
  }
}

function actorAvatar(actor: TimelineActor, size = 'normal'): HTMLElement {
  const holder = createElement('div', `xtl-avatar xtl-avatar--${size}`)
  holder.title = actor.name
  if (actor.avatarUrl) {
    const image = document.createElement('img')
    image.src = actor.avatarUrl
    image.alt = ''
    image.addEventListener('error', () => {
      image.remove()
      holder.textContent = initials(actor.name)
    }, { once: true })
    holder.appendChild(image)
  } else {
    holder.textContent = initials(actor.name)
  }
  return holder
}

function orderedPosts(posts: TimelinePost[]): Array<{ post: TimelinePost; depth: number }> {
  const byParent = new Map<string, TimelinePost[]>()
  const roots: TimelinePost[] = []
  const ids = new Set(posts.map((post) => post.id))

  for (const post of posts) {
    if (!post.replyToId || !ids.has(post.replyToId)) {
      roots.push(post)
      continue
    }
    const replies = byParent.get(post.replyToId) ?? []
    replies.push(post)
    byParent.set(post.replyToId, replies)
  }

  roots.sort((left, right) => right.createdAt - left.createdAt)
  for (const replies of byParent.values()) replies.sort((left, right) => left.createdAt - right.createdAt)

  const result: Array<{ post: TimelinePost; depth: number }> = []
  const visit = (post: TimelinePost, depth: number) => {
    result.push({ post, depth })
    for (const reply of byParent.get(post.id) ?? []) visit(reply, Math.min(depth + 1, 3))
  }
  for (const root of roots) visit(root, 0)
  return result
}

function actorWhoOwnsThread(post: TimelinePost, state: TimelineSnapshot): TimelineActor | null {
  const postsById = new Map(state.state.posts.map((candidate) => [candidate.id, candidate]))
  let cursor: TimelinePost | undefined = post
  const visited = new Set<string>()
  while (cursor && !visited.has(cursor.id)) {
    const current: TimelinePost = cursor
    visited.add(current.id)
    if (current.author.kind === 'character' || current.author.kind === 'council') {
      return current.author
    }
    cursor = current.replyToId ? postsById.get(current.replyToId) : undefined
  }
  return null
}

function replyContext(post: TimelinePost, state: TimelineSnapshot): string | null {
  if (!post.replyToId) return null
  const postsById = new Map(state.state.posts.map((candidate) => [candidate.id, candidate]))
  const recipients: TimelineActor[] = []
  const recipientKeys = new Set<string>()
  const visited = new Set<string>()
  let cursor = postsById.get(post.replyToId)

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    if (cursor.author.key !== post.author.key && !recipientKeys.has(cursor.author.key)) {
      recipients.push(cursor.author)
      recipientKeys.add(cursor.author.key)
    }
    cursor = cursor.replyToId ? postsById.get(cursor.replyToId) : undefined
  }

  if (!recipients.length) return null
  const [primary] = recipients
  const others = recipients.length - 1
  return `Replying to @${primary.handle}${others ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : ''}`
}

function timeUntil(timestamp: number | null): string {
  if (!timestamp || timestamp <= Date.now()) return 'due now'
  const minutes = Math.max(1, Math.ceil((timestamp - Date.now()) / 60_000))
  if (minutes < 60) return `in about ${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `in about ${hours}h${remainder ? ` ${remainder}m` : ''}`
}

export function setup(ctx: SpindleFrontendContext) {
  ctx.deferReady()

  let snapshot: TimelineSnapshot | null = null
  let draft = ''
  let replyToId: string | null = null
  let inviteActorKey = ''
  let chatSource: TimelineChatSource | null = null
  let includeCurrentChat = false
  let busy = false
  let busyActorName: string | null = null
  let error = ''
  let pendingDraft: {
    text: string
    replyToId: string | null
    chatSource: TimelineChatSource | null
    inviteActorKey: string
    mentionedActorKeys: string[]
    includeCurrentChat: boolean
  } | null = null
  let actorSearch = ''
  let mentionedActorKeys: string[] = []
  let personaPicker: SpindleSelectHandle | null = null
  let sliderHandles: any[] = []
  let disposeMentionPortal: (() => void) | null = null

  const tab = ctx.ui.registerDrawerTab({
    id: 'timeline',
    title: 'Lumiverse Timeline',
    shortName: 'Weave',
    headerTitle: 'Timeline',
    description: 'A private social timeline for your personas, Council, and character cards',
    keywords: ['timeline', 'weave', 'tweet', 'social', 'council', 'character'],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4.01c-.7.35-1.46.58-2.25.69.81-.49 1.43-1.26 1.72-2.18-.76.45-1.6.78-2.5.96A3.9 3.9 0 0 0 12.22 6c0 .31.03.61.1.9A11.08 11.08 0 0 1 3.2 2.3a3.9 3.9 0 0 0 1.21 5.2 3.9 3.9 0 0 1-1.77-.49v.05c0 1.89 1.34 3.46 3.13 3.82a3.84 3.84 0 0 1-1.76.07 3.9 3.9 0 0 0 3.65 2.7A7.83 7.83 0 0 1 2.8 15.3c-.32 0-.63-.02-.94-.05a11.04 11.04 0 0 0 5.97 1.75c7.17 0 11.09-5.94 11.09-11.09 0-.17 0-.34-.01-.5A7.9 7.9 0 0 0 22 4.01Z"/></svg>',
  })
  const root = createElement('div', 'xtl-app')
  tab.root.replaceChildren(root)

  const removeStyle = ctx.dom.addStyle(`
    .xtl-app { --xtl-blue: #1d9bf0; --xtl-blue-soft: color-mix(in srgb, var(--xtl-blue) 16%, transparent); --xtl-surface: #0d1014; --xtl-surface-raised: #14181e; --xtl-line: #2f3336; --xtl-muted: #8b98a5; color: #f4f7fa; min-height: 100%; max-width: 760px; margin: 0 auto; padding: 0 14px 32px; box-sizing: border-box; }
    .xtl-header { position: sticky; top: 4px; z-index: 1; display: flex; align-items: center; gap: 12px; min-height: 53px; margin: 4px -6px 12px; padding: 0 14px; background: color-mix(in srgb, var(--lumiverse-background, #0a0c10) 92%, transparent); border: 1px solid color-mix(in srgb, var(--xtl-line) 88%, transparent); border-radius: 12px; backdrop-filter: blur(16px); }
    .xtl-header-mark { display: grid; place-items: center; width: 30px; height: 30px; color: #f5f8fa; font-size: 20px; font-weight: 900; line-height: 1; }
    .xtl-title { flex: 1; margin: 0; font-size: 18px; line-height: 1.1; letter-spacing: -.02em; font-weight: 850; }
    .xtl-header-refresh { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border-color: transparent; font-size: 18px; }
    .xtl-card { background: var(--xtl-surface); border: 1px solid var(--xtl-line); border-radius: 16px; margin: 12px 0; overflow: visible; box-shadow: 0 10px 26px rgb(0 0 0 / 11%); }
    .xtl-composer { padding: 14px; background: linear-gradient(145deg, color-mix(in srgb, var(--xtl-blue) 10%, var(--xtl-surface)), var(--xtl-surface) 45%); }
    .xtl-composer-top, .xtl-composer-controls, .xtl-post-header, .xtl-post-actions, .xtl-roster-header, .xtl-settings-row { display: flex; align-items: center; gap: 9px; }
    .xtl-composer-top { justify-content: space-between; margin-bottom: 10px; }
    .xtl-composer-writing { display: flex; align-items: flex-start; gap: 11px; }
    .xtl-composer-writing .xtl-textarea { flex: 1; }
    .xtl-persona-picker { min-width: 250px; }
    .xtl-composer-label { color: #d9e3ec; font-size: 13px; font-weight: 700; }
    .xtl-compose-context { color: var(--xtl-muted); font-size: 12px; margin: 0 0 9px; }
    .xtl-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px; background: var(--xtl-blue-soft); color: #b9e0ff; font-size: 11px; font-weight: 650; }
    .xtl-textarea, .xtl-select { background: #0a0d11; color: #f4f7fa; border: 1px solid #3a4148; border-radius: 10px; box-sizing: border-box; font: inherit; }
    .xtl-textarea { display: block; width: 100%; min-height: 104px; padding: 12px; resize: vertical; outline: none; font-size: 15px; line-height: 1.45; }
    .xtl-textarea::placeholder { color: #75808c; }
    .xtl-textarea:focus, .xtl-select:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); outline: none; }
    .xtl-mention-popover { position: fixed; z-index: 2147483647; max-height: 264px; overflow-y: auto; border: 1px solid #3a4148; border-radius: 13px; background: #10151c; box-shadow: 0 12px 28px rgb(0 0 0 / 38%); padding: 5px; }
    .xtl-mention-popover[hidden] { display: none; }
    .xtl-mention-option { display: flex; align-items: center; width: 100%; gap: 9px; box-sizing: border-box; border: 0; border-radius: 9px; background: transparent; color: #f4f7fa; padding: 7px; cursor: pointer; font: inherit; text-align: left; }
    .xtl-mention-option:hover, .xtl-mention-option--active { background: var(--xtl-blue-soft); }
    .xtl-mention-option:focus-visible { outline: 2px solid var(--xtl-blue); outline-offset: -2px; }
    .xtl-mention-option-copy { min-width: 0; flex: 1; }
    .xtl-mention-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-mention-option-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 11px; margin-top: 1px; }
    .xtl-mention-empty { margin: 0; padding: 9px; color: var(--xtl-muted); font-size: 12px; }
    .xtl-mention-stack { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0 51px; }
    .xtl-mention-stack[hidden] { display: none; }
    .xtl-mention-chip { border: 1px solid color-mix(in srgb, var(--xtl-blue) 50%, #39424d); border-radius: 999px; background: var(--xtl-blue-soft); color: #b9e0ff; padding: 4px 8px; cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; }
    .xtl-mention-chip:hover { color: #fff; border-color: var(--xtl-blue); }
    .xtl-select { max-width: 210px; min-width: 0; padding: 7px 30px 7px 10px; font-size: 12px; font-weight: 600; }
    .xtl-composer-controls { justify-content: space-between; margin-top: 11px; flex-wrap: wrap; }
    .xtl-composer-actions { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
    .xtl-counter { margin-left: auto; font-size: 12px; color: var(--xtl-muted); font-variant-numeric: tabular-nums; }
    .xtl-button { appearance: none; border: 1px solid #3a4148; border-radius: 999px; background: transparent; color: #dfe8f0; padding: 7px 11px; cursor: pointer; font: inherit; font-size: 12px; line-height: 1.15; font-weight: 700; transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease; }
    .xtl-button:hover:not(:disabled) { border-color: var(--xtl-blue); color: #eaf6ff; background: var(--xtl-blue-soft); }
    .xtl-button:active:not(:disabled) { transform: scale(.97); }
    .xtl-button:disabled { opacity: .42; cursor: not-allowed; }
    .xtl-button--primary { background: var(--xtl-blue); border-color: var(--xtl-blue); color: #fff; padding-inline: 17px; }
    .xtl-button--primary:hover:not(:disabled) { background: #1488d4; border-color: #1488d4; color: #fff; }
    .xtl-button--selected { border-color: var(--xtl-blue); background: var(--xtl-blue-soft); color: #b9e0ff; }
    .xtl-button--quiet { border-color: transparent; color: var(--xtl-muted); padding: 6px 8px; }
    .xtl-button--danger { border-color: color-mix(in srgb, #f4215b 54%, #3a4148); color: #ff9fb8; }
    .xtl-button--danger:hover:not(:disabled) { border-color: #f4215b; background: color-mix(in srgb, #f4215b 14%, transparent); color: #ffd5df; }
    .xtl-notice { padding: 10px 12px; background: color-mix(in srgb, #f5a524 13%, var(--xtl-surface)); border: 1px solid color-mix(in srgb, #f5a524 56%, var(--xtl-line)); border-radius: 12px; font-size: 12px; line-height: 1.45; margin: 10px 0; }
    .xtl-notice--error { background: color-mix(in srgb, #f4215b 13%, var(--xtl-surface)); border-color: color-mix(in srgb, #f4215b 56%, var(--xtl-line)); }
    .xtl-post { padding: 15px 16px 12px; transition: background .15s ease; }
    .xtl-post:hover { background: #131820; }
    .xtl-post + .xtl-post { border-top: 1px solid var(--xtl-line); }
    .xtl-post--reply { margin-left: 22px; border-left: 2px solid color-mix(in srgb, var(--xtl-blue) 58%, transparent); }
    .xtl-post-header { align-items: flex-start; }
    .xtl-post-author { min-width: 0; flex: 1; }
    .xtl-post-name-row { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
    .xtl-post-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 800; }
    .xtl-post-handle, .xtl-post-time { color: var(--xtl-muted); font-size: 12px; white-space: nowrap; }
    .xtl-post-reply-context { margin-top: 2px; color: var(--xtl-muted); font-size: 11px; line-height: 1.25; }
    .xtl-avatar { flex: 0 0 auto; display: grid; place-items: center; width: 40px; height: 40px; border: 2px solid color-mix(in srgb, var(--xtl-blue) 44%, #45505c); border-radius: 50%; overflow: hidden; background: linear-gradient(135deg, #1d9bf0, #7856ff); color: #fff; font-size: 12px; font-weight: 800; }
    .xtl-avatar--small { width: 32px; height: 32px; font-size: 10px; }
    .xtl-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .xtl-post-body { margin: 8px 0 11px 50px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; color: #f0f4f7; }
    .xtl-post-source { margin: -3px 0 9px 50px; color: var(--xtl-blue); font-size: 11px; font-weight: 650; }
    .xtl-post-gif { display: block; width: calc(100% - 50px); max-width: none; height: auto; margin: 10px 0 20px 50px; border-radius: 12px; }
    .xtl-post-actions { margin: 8px 0 0 49px; gap: 8px; flex-wrap: wrap; }
    .xtl-post-actions .xtl-button { color: var(--xtl-muted); border-color: transparent; padding: 6px 8px; }
    .xtl-post-actions .xtl-button:hover:not(:disabled) { color: var(--xtl-blue); background: var(--xtl-blue-soft); }
    .xtl-reaction { min-width: 40px; }
    .xtl-reaction--active { color: #ff6b9a !important; background: color-mix(in srgb, #ff6b9a 14%, transparent) !important; }
    .xtl-empty { padding: 42px 28px; color: var(--xtl-muted); text-align: center; font-size: 14px; line-height: 1.55; }
    .xtl-roster { padding: 14px; background: var(--xtl-surface-raised); }
    .xtl-roster-header { justify-content: space-between; }
    .xtl-roster-browser-header { margin-top: 18px; padding-top: 15px; border-top: 1px solid var(--xtl-line); }
    .xtl-section-title { margin: 0; font-size: 15px; letter-spacing: -.015em; }
    .xtl-roster-copy { margin: 8px 0 0; color: var(--xtl-muted); font-size: 12px; line-height: 1.45; }
    .xtl-actor-search-wrap { margin-top: 12px; }
    .xtl-actor-search { display: block; width: 100%; box-sizing: border-box; border: 1px solid #3a4148; border-radius: 999px; background: #0a0d11; color: #f4f7fa; padding: 9px 13px; font: inherit; font-size: 12px; outline: none; }
    .xtl-actor-search::placeholder { color: #75808c; }
    .xtl-actor-search:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); }
    .xtl-roster-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin-top: 12px; }
    .xtl-roster-empty, .xtl-roster-access { grid-column: 1 / -1; margin: 2px 0 0; color: var(--xtl-muted); font-size: 12px; line-height: 1.5; }
    .xtl-actor-card[hidden], .xtl-roster-empty[hidden] { display: none !important; }
    .xtl-roster-access { margin-top: 10px; }
    .xtl-actor-card { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px; border: 1px solid #38404a; border-radius: 12px; background: #0c0f13; }
    .xtl-actor-card-info { min-width: 0; flex: 1; }
    .xtl-actor-card-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
    .xtl-actor-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-actor-card-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 11px; margin-top: 2px; }
    .xtl-actor-card .xtl-button { color: #9bd7ff; border-color: color-mix(in srgb, var(--xtl-blue) 46%, #39424d); font-size: 11px; padding: 6px 9px; }
    .xtl-settings { padding: 0 14px 14px; background: #0b0e12; }
    .xtl-settings summary { cursor: pointer; color: #b8c4cf; font-size: 12px; font-weight: 700; padding: 13px 0 9px; }
    .xtl-settings-copy { color: var(--xtl-muted); font-size: 12px; line-height: 1.5; margin: 0 0 10px; }
    .xtl-settings-row { justify-content: space-between; align-items: flex-start; padding-top: 10px; border-top: 1px solid var(--xtl-line); }
    .xtl-settings-label { font-size: 13px; font-weight: 750; }
    .xtl-settings-hint { color: var(--xtl-muted); font-size: 11px; max-width: 240px; line-height: 1.4; margin-top: 3px; }
    .xtl-interval-inputs { display: flex; align-items: center; gap: 6px; color: var(--xtl-muted); font-size: 12px; }
    .xtl-number-input { width: 64px; box-sizing: border-box; border: 1px solid #3a4148; border-radius: 9px; background: #0a0d11; color: #f4f7fa; padding: 7px 6px; font: inherit; font-size: 12px; font-weight: 650; }
    .xtl-number-input:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); outline: none; }
    .xtl-loading { padding: 44px 16px; color: var(--xtl-muted); font-size: 14px; text-align: center; }
    @media (max-width: 520px) { .xtl-app { padding: 0 9px 24px; } .xtl-header { margin-inline: -9px; padding-inline: 13px; } .xtl-subtitle { display: none; } .xtl-post-body, .xtl-post-source, .xtl-post-gif { margin-left: 0 !important; } .xtl-post-gif { width: 100%; } .xtl-post-actions { margin-left: -6px; } .xtl-post--reply { margin-left: 10px; } .xtl-composer-top, .xtl-settings-row { align-items: flex-start; flex-direction: column; } .xtl-select, .xtl-persona-picker { max-width: 100%; width: 100%; } .xtl-roster-list { grid-template-columns: 1fr; } .xtl-actor-card-actions { margin-left: auto; } }
  `)

  const selectedPersona = (): TimelineActor | null => {
    if (!snapshot) return null
    const desired = snapshot.state.settings.selectedPersonaId ?? snapshot.activePersonaId
    return snapshot.personas.find((persona) => persona.sourceId === desired) ?? snapshot.personas[0] ?? null
  }

  const selectedReplyTarget = (): TimelinePost | null => {
    if (!snapshot || !replyToId) return null
    return snapshot.state.posts.find((post) => post.id === replyToId) ?? null
  }

  const send = (payload: UnknownRecord) => ctx.sendToBackend(payload)

  const focusComposer = () => {
    queueMicrotask(() => root.querySelector<HTMLTextAreaElement>('.xtl-textarea')?.focus())
  }

  const renderHeader = () => {
    const header = createElement('header', 'xtl-header')
    const mark = createElement('span', 'xtl-header-mark', '𝕏')
    mark.setAttribute('aria-hidden', 'true')
    const title = createElement('h2', 'xtl-title', 'Timeline')
    const refresh = button('↻', 'xtl-button xtl-header-refresh')
    refresh.title = 'Refresh timeline'
    refresh.setAttribute('aria-label', 'Refresh timeline')
    refresh.addEventListener('click', () => send({ type: 'load_timeline' }))
    header.append(mark, title, refresh)
    return header
  }

  const renderError = () => {
    if (!error) return null
    const notice = createElement('div', 'xtl-notice xtl-notice--error')
    const copy = createElement('span', undefined, error)
    const dismiss = button('Dismiss', 'xtl-button xtl-button--quiet')
    dismiss.addEventListener('click', () => {
      error = ''
      render()
    })
    notice.append(copy, dismiss)
    return notice
  }

  const renderComposer = (state: TimelineSnapshot) => {
    const card = createElement('section', 'xtl-card xtl-composer')
    const top = createElement('div', 'xtl-composer-top')
    const title = createElement('div', 'xtl-composer-label', selectedReplyTarget() ? 'Reply as' : 'Weave as')
    const personaPickerSlot = createElement('div', 'xtl-persona-picker')
    top.append(title, personaPickerSlot)
    card.appendChild(top)

    personaPicker = ctx.components.mountSelect(personaPickerSlot, {
      value: selectedPersona()?.sourceId ?? '',
      placeholder: state.personas.length ? 'Choose persona…' : 'You',
      searchPlaceholder: 'Search personas…',
      searchThreshold: 0,
      emptyMessage: 'No personas are available.',
      noResultsMessage: 'No personas match your search.',
      ariaLabel: 'Timeline persona',
      align: 'right',
      minWidth: 250,
      options: state.personas.map((persona) => ({
        value: persona.sourceId,
        label: `${persona.name} @${persona.handle}`,
        sublabel: persona.bio || 'Timeline persona',
        leading: actorLeading(persona),
      })),
      onChange: (personaId) => send({ type: 'update_settings', selectedPersonaId: personaId || null }),
    })

    const replyTarget = selectedReplyTarget()
    const replyThreadOwner = replyTarget ? actorWhoOwnsThread(replyTarget, state) : null
    if (replyTarget) {
      const context = createElement('p', 'xtl-compose-context')
      context.append('Replying to ', createElement('strong', undefined, `@${replyTarget.author.handle}`), document.createTextNode('. '))
      if (replyThreadOwner) {
        context.append(createElement('span', 'xtl-chip', `@${replyThreadOwner.handle} will respond`))
      }
      const clear = button('Cancel reply', 'xtl-button xtl-button--quiet')
      clear.addEventListener('click', () => {
        replyToId = null
        render()
      })
      context.appendChild(clear)
      card.appendChild(context)
    }

    if (chatSource) {
      const context = createElement('p', 'xtl-compose-context')
      context.append(createElement('span', 'xtl-chip', `Sharing ${chatSource.chatName}`))
      if (state.state.settings.includeChatContext) {
        context.append(createElement('span', 'xtl-chip', `Last ${state.state.settings.chatContextMessageCount} messages available to replies`))
      }
      const clear = button('Remove chat link', 'xtl-button xtl-button--quiet')
      clear.addEventListener('click', () => {
        chatSource = null
        render()
      })
      context.appendChild(clear)
      card.appendChild(context)
    }

    const textarea = document.createElement('textarea')
    textarea.className = 'xtl-textarea'
    textarea.maxLength = MAX_WEAVE_LENGTH
    textarea.placeholder = replyTarget ? `Reply to @${replyTarget.author.handle}…` : 'What is happening in your Lumiverse?'
    textarea.value = draft
    textarea.disabled = busy
    const writingRow = createElement('div', 'xtl-composer-writing')
    const mentionPopover = createElement('div', 'xtl-mention-popover')
    mentionPopover.hidden = true
    mentionPopover.setAttribute('role', 'listbox')
    mentionPopover.setAttribute('aria-label', 'Mention an actor')
    const ownerDocument = tab.root.ownerDocument
    const ownerWindow = ownerDocument.defaultView
    const positionMentionPopover = () => {
      const rect = textarea.getBoundingClientRect()
      const viewportWidth = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth
      const viewportHeight = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight
      const edge = 8
      const width = Math.max(200, Math.min(rect.width, viewportWidth - edge * 2))
      const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge))
      const spaceBelow = viewportHeight - rect.bottom - edge
      const spaceAbove = rect.top - edge
      const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow
      const maxHeight = Math.max(72, Math.min(264, placeAbove ? spaceAbove : spaceBelow))
      mentionPopover.style.left = `${left}px`
      mentionPopover.style.width = `${width}px`
      mentionPopover.style.maxHeight = `${maxHeight}px`
      mentionPopover.style.top = `${placeAbove ? Math.max(edge, rect.top - maxHeight - 6) : rect.bottom + 6}px`
    }
    const rootStyles = ownerWindow?.getComputedStyle(root)
    for (const property of ['--xtl-blue', '--xtl-blue-soft']) {
      const value = rootStyles?.getPropertyValue(property)
      if (value) mentionPopover.style.setProperty(property, value)
    }
    const removeMentionPortal = () => {
      ownerWindow?.removeEventListener('resize', positionMentionPopover)
      ownerDocument.removeEventListener('scroll', positionMentionPopover, true)
      mentionPopover.remove()
      if (disposeMentionPortal === removeMentionPortal) disposeMentionPortal = null
    }
    disposeMentionPortal = removeMentionPortal
    ownerDocument.body.appendChild(mentionPopover)
    ownerWindow?.addEventListener('resize', positionMentionPopover)
    ownerDocument.addEventListener('scroll', positionMentionPopover, true)
    positionMentionPopover()
    const persona = selectedPersona()
    writingRow.append(persona ? actorAvatar(persona) : createElement('div', 'xtl-avatar', 'Y'), textarea)
    card.appendChild(writingRow)
    const mentionStack = createElement('div', 'xtl-mention-stack')
    mentionStack.hidden = true
    card.appendChild(mentionStack)

    const controls = createElement('div', 'xtl-composer-controls')
    const actions = createElement('div', 'xtl-composer-actions')

    let inviteSelect: HTMLSelectElement | null = null
    if (state.replyActors.length && !replyThreadOwner) {
      inviteSelect = document.createElement('select')
      inviteSelect.className = 'xtl-select'
      inviteSelect.setAttribute('aria-label', 'Invite a reply')
      const none = document.createElement('option')
      none.value = ''
      none.textContent = 'No invited reply'
      inviteSelect.appendChild(none)
      for (const actor of state.replyActors) {
        const option = document.createElement('option')
        option.value = actor.key
        option.textContent = `Invite ${actor.name}`
        inviteSelect.appendChild(option)
      }
      inviteSelect.value = inviteActorKey
      inviteSelect.disabled = busy || !state.permissions.includes('generation')
      inviteSelect.addEventListener('change', (event) => {
        inviteActorKey = (event.currentTarget as HTMLSelectElement).value
      })
      actions.appendChild(inviteSelect)
    }

    const weave = button(
      replyThreadOwner ? `Weave + @${replyThreadOwner.handle} reply` : inviteActorKey ? 'Weave + invite' : 'Weave',
      'xtl-button xtl-button--primary',
    )
    const currentChatToggle = button('Current chat', `xtl-button${includeCurrentChat ? ' xtl-button--selected' : ''}`)
    currentChatToggle.setAttribute('aria-pressed', String(includeCurrentChat))
    currentChatToggle.title = 'Attach the active chat as context and invite its character to reply'
    currentChatToggle.disabled = busy || !state.permissions.includes('chats') || !state.permissions.includes('chat_mutation')
    currentChatToggle.addEventListener('click', () => {
      includeCurrentChat = !includeCurrentChat
      render()
      focusComposer()
    })
    let activeMentionQuery: ComposerMentionQuery | null = null
    let mentionMatches: TimelineActor[] = []
    let activeMentionIndex = 0

    const selectedMentionActors = () => mentionedActorKeys
      .map((key) => state.replyActors.find((actor) => actor.key === key))
      .filter((actor): actor is TimelineActor => Boolean(actor))
    const draftStillMentions = (actor: TimelineActor, text: string) => text
      .toLocaleLowerCase()
      .includes(`@${actor.handle}`.toLocaleLowerCase())
    const updateWeaveLabel = () => {
      const replyActorKeys = new Set<string>([
        ...(replyThreadOwner ? [replyThreadOwner.key] : []),
        ...selectedMentionActors().filter((actor) => draftStillMentions(actor, textarea.value)).map((actor) => actor.key),
        ...(inviteActorKey ? [inviteActorKey] : []),
      ])
      const replyCount = state.permissions.includes('generation') ? replyActorKeys.size : 0
      weave.textContent = replyCount
        ? `Weave + ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}${includeCurrentChat ? ' + chat' : ''}`
        : includeCurrentChat ? 'Weave + chat' : 'Weave'
    }
    const renderMentionStack = () => {
      const actors = selectedMentionActors().filter((actor) => draftStillMentions(actor, textarea.value))
      mentionStack.replaceChildren()
      mentionStack.hidden = actors.length === 0
      for (const actor of actors) {
        const chip = button(`@${actor.handle} ×`, 'xtl-mention-chip')
        chip.title = `Remove @${actor.handle} mention`
        chip.addEventListener('click', () => {
          const marker = `@${actor.handle}`
          const index = textarea.value.toLocaleLowerCase().indexOf(marker.toLocaleLowerCase())
          if (index >= 0) {
            textarea.value = `${textarea.value.slice(0, index)}${textarea.value.slice(index + marker.length)}`.replace(/ {2,}/g, ' ')
          }
          mentionedActorKeys = mentionedActorKeys.filter((key) => key !== actor.key)
          syncComposerControls()
          textarea.focus()
        })
        mentionStack.appendChild(chip)
      }
    }
    const insertMention = (actor: TimelineActor) => {
      if (!activeMentionQuery) return
      const before = textarea.value.slice(0, activeMentionQuery.start)
      const after = textarea.value.slice(activeMentionQuery.end)
      const spacer = after && /^[\s.,!?;:)]/.test(after) ? '' : ' '
      const next = `${before}@${actor.handle}${spacer}${after}`.slice(0, MAX_WEAVE_LENGTH)
      const cursor = Math.min(next.length, before.length + actor.handle.length + 2)
      textarea.value = next
      if (!mentionedActorKeys.includes(actor.key)) mentionedActorKeys = [...mentionedActorKeys, actor.key]
      activeMentionQuery = null
      mentionMatches = []
      mentionPopover.hidden = true
      syncComposerControls()
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    }
    const updateMentionPopover = () => {
      activeMentionQuery = mentionQueryAtCursor(textarea.value, textarea.selectionStart ?? textarea.value.length)
      mentionMatches = activeMentionQuery
        ? state.replyActors
          .filter((actor) => !mentionedActorKeys.includes(actor.key) && actorMatchesMention(actor, activeMentionQuery?.query ?? ''))
          .map((actor) => ({ actor, rank: actorSearchRank(actor, activeMentionQuery?.query ?? '') }))
          .sort((left, right) => right.rank - left.rank || left.actor.name.localeCompare(right.actor.name))
          .slice(0, MAX_MENTION_MATCHES)
          .map(({ actor }) => actor)
        : []
      activeMentionIndex = Math.min(activeMentionIndex, Math.max(0, mentionMatches.length - 1))
      mentionPopover.replaceChildren()
      if (!activeMentionQuery || busy) {
        mentionPopover.hidden = true
        return
      }
      mentionPopover.hidden = false
      positionMentionPopover()
      if (!mentionMatches.length) {
        mentionPopover.appendChild(createElement('p', 'xtl-mention-empty', 'No characters or Council members match.'))
        return
      }
      mentionMatches.forEach((actor, index) => {
        const option = document.createElement('button')
        option.type = 'button'
        option.className = `xtl-mention-option${index === activeMentionIndex ? ' xtl-mention-option--active' : ''}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', String(index === activeMentionIndex))
        const copy = createElement('div', 'xtl-mention-option-copy')
        copy.append(
          createElement('div', 'xtl-mention-option-name', actor.name),
          createElement('div', 'xtl-mention-option-meta', `@${actor.handle} · ${actor.role ?? actor.bio}`),
        )
        option.append(actorAvatar(actor, 'small'), copy)
        option.addEventListener('mousedown', (event) => event.preventDefault())
        option.addEventListener('click', () => insertMention(actor))
        mentionPopover.appendChild(option)
      })
    }
    weave.disabled = busy || !draft.trim()
    const syncComposerControls = () => {
      draft = textarea.value.slice(0, MAX_WEAVE_LENGTH)
      mentionedActorKeys = selectedMentionActors()
        .filter((actor) => draftStillMentions(actor, draft))
        .map((actor) => actor.key)
      const counter = root.querySelector<HTMLElement>('.xtl-counter')
      if (counter) counter.textContent = `${draft.length}/${MAX_WEAVE_LENGTH}`
      weave.disabled = busy || !draft.trim()
      currentChatToggle.disabled = busy || !state.permissions.includes('chats') || !state.permissions.includes('chat_mutation')
      updateWeaveLabel()
      renderMentionStack()
      updateMentionPopover()
    }
    textarea.addEventListener('input', syncComposerControls)
    textarea.addEventListener('click', updateMentionPopover)
    textarea.addEventListener('focus', updateMentionPopover)
    textarea.addEventListener('keyup', (event) => {
      if (event.key !== 'Escape') updateMentionPopover()
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeMentionQuery) {
        event.preventDefault()
        activeMentionQuery = null
        mentionMatches = []
        mentionPopover.hidden = true
        return
      }
      if (!activeMentionQuery || !mentionMatches.length) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        activeMentionIndex = (activeMentionIndex + direction + mentionMatches.length) % mentionMatches.length
        updateMentionPopover()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        insertMention(mentionMatches[activeMentionIndex])
      }
    })
    weave.addEventListener('click', () => {
      const persona = selectedPersona()
      const invitedActorKey = inviteActorKey
      const mentionedKeys = [...mentionedActorKeys]
      const withCurrentChat = includeCurrentChat
      pendingDraft = {
        text: draft,
        replyToId,
        chatSource,
        inviteActorKey: invitedActorKey,
        mentionedActorKeys: mentionedKeys,
        includeCurrentChat: withCurrentChat,
      }
      const payload: UnknownRecord = {
        type: withCurrentChat ? 'weave_current_chat' : 'create_weave',
        content: draft,
        personaId: persona?.sourceId ?? null,
        replyToId,
        inviteActorKey: invitedActorKey,
        mentionedActorKeys: mentionedKeys,
        chatId: chatSource?.chatId,
      }
      draft = ''
      replyToId = null
      chatSource = null
      mentionedActorKeys = []
      includeCurrentChat = false
      busy = true
      busyActorName = withCurrentChat ? 'current chat' : invitedActorKey ? 'timeline reply' : null
      render()
      send(payload)
    })

    controls.append(actions, createElement('span', 'xtl-counter', `${draft.length}/${MAX_WEAVE_LENGTH}`), currentChatToggle, weave)
    card.appendChild(controls)
    updateWeaveLabel()
    updateMentionPopover()
    return card
  }

  const renderPost = (post: TimelinePost, depth: number, state: TimelineSnapshot) => {
    const article = createElement('article', `xtl-post${depth ? ' xtl-post--reply' : ''}`)
    article.style.setProperty('--xtl-depth', String(depth))
    const header = createElement('div', 'xtl-post-header')
    const author = createElement('div', 'xtl-post-author')
    const nameRow = createElement('div', 'xtl-post-name-row')
    nameRow.append(
      createElement('span', 'xtl-post-name', post.author.name),
      createElement('span', 'xtl-post-handle', `@${post.author.handle}`),
      createElement('span', 'xtl-post-time', `· ${relativeTime(post.createdAt)}`),
    )
    author.appendChild(nameRow)
    const context = replyContext(post, state)
    if (context) author.appendChild(createElement('div', 'xtl-post-reply-context', context))
    header.append(actorAvatar(post.author), author)
    article.appendChild(header)
    article.appendChild(createElement('div', 'xtl-post-body', post.content))
    if (post.gifUrl) {
      const img = document.createElement('img')
      const hq = Boolean(state.state.settings.highQualityGifs)
      img.src = hq ? post.gifUrl.replace(/AAAA[A-Za-z]\//, 'AAAAC/') : post.gifUrl.replace(/AAAA[A-Za-z]\//, 'AAAAM/')
      img.className = 'xtl-post-gif'
      img.alt = ''
      article.appendChild(img)
    }
    if (post.chatSource) {
      const source = createElement(
        'div',
        'xtl-post-source',
        post.chatContext ? `Chat context · ${post.chatContext.messageCount} messages` : 'From current chat',
      )
      source.title = `${post.chatSource.chatName}${post.chatSource.characterName ? ` · ${post.chatSource.characterName}` : ''}`
      article.appendChild(source)
    }

    const actions = createElement('div', 'xtl-post-actions')
    for (const emoji of REACTION_EMOJIS) {
      const reaction = post.reactions.find((entry) => entry.emoji === emoji)
      const active = Boolean(reaction?.actorKeys.includes('timeline_user'))
      const react = button(`${emoji}${reaction?.actorKeys.length ? ` ${reaction.actorKeys.length}` : ''}`, `xtl-button xtl-reaction${active ? ' xtl-reaction--active' : ''}`)
      react.disabled = busy
      react.addEventListener('click', () => send({ type: 'toggle_reaction', postId: post.id, emoji }))
      actions.appendChild(react)
    }
    const reply = button('Reply', 'xtl-button xtl-button--quiet')
    reply.disabled = busy
    reply.addEventListener('click', () => {
      replyToId = post.id
      inviteActorKey = actorWhoOwnsThread(post, state)?.key ?? ''
      chatSource = null
      render()
      focusComposer()
    })
    actions.appendChild(reply)

    if (state.permissions.includes('generation') && state.replyActors.length) {
      const invite = button('Invite reply', 'xtl-button xtl-button--quiet')
      invite.disabled = busy
      invite.addEventListener('click', () => {
        replyToId = post.id
        inviteActorKey = inviteActorKey || state.replyActors[0].key
        chatSource = null
        render()
        focusComposer()
      })
      actions.appendChild(invite)
    }
    article.appendChild(actions)
    return article
  }

  const renderTimeline = (state: TimelineSnapshot) => {
    const feed = createElement('section', 'xtl-card')
    const posts = orderedPosts(state.state.posts)
    if (!posts.length) {
      feed.appendChild(createElement('div', 'xtl-empty', 'No weaves yet. Start the feed with a thought from your selected persona, or let a Council member or character card post first.'))
      return feed
    }
    for (const { post, depth } of posts) feed.appendChild(renderPost(post, depth, state))
    return feed
  }

  const renderRoster = (state: TimelineSnapshot) => {
    const card = createElement('section', 'xtl-card xtl-roster')
    const header = createElement('div', 'xtl-roster-header')
    const invited = new Set(state.state.rosterActorKeys)
    const rosterActors = state.state.rosterActorKeys
      .map((key) => state.replyActors.find((actor) => actor.key === key))
      .filter((actor): actor is TimelineActor => Boolean(actor))
    const rosterCount = createElement('span', 'xtl-chip', `${rosterActors.length} invited`)
    header.append(
      createElement('h3', 'xtl-section-title', 'Actor roster'),
      rosterCount,
    )
    card.appendChild(header)
    const interval = `${state.state.settings.minActorWeaveIntervalMinutes}–${state.state.settings.maxActorWeaveIntervalMinutes} min`
    card.appendChild(createElement(
      'p',
      'xtl-roster-copy',
      rosterActors.length
        ? `One invited actor is picked at random for a timeline turn every ${interval}; they may weave, reply, or react. The next turn is ${timeUntil(state.state.nextRosterWeaveAt)}.`
        : `Invite actors to let the timeline choose one at random for a turn every ${interval}.`,
    ))

    const rosterList = createElement('div', 'xtl-roster-list')
    if (rosterActors.length) {
      for (const actor of rosterActors) {
        const item = createElement('div', 'xtl-actor-card')
        const details = createElement('div', 'xtl-actor-card-info')
        details.append(
          createElement('div', 'xtl-actor-card-name', actor.name),
          createElement('div', 'xtl-actor-card-meta', `@${actor.handle} · ${actor.role ?? actor.bio}`),
        )
        const actions = createElement('div', 'xtl-actor-card-actions')
        const weaveNow = button('Weave now', 'xtl-button')
        weaveNow.disabled = busy || !state.permissions.includes('generation')
        weaveNow.addEventListener('click', () => {
          busy = true
          busyActorName = actor.name
          render()
          send({ type: 'create_actor_weave', actorKey: actor.key })
        })
        const remove = button('Remove', 'xtl-button xtl-button--quiet')
        remove.disabled = busy
        remove.addEventListener('click', () => send({ type: 'toggle_roster_actor', actorKey: actor.key }))
        actions.append(weaveNow, remove)
        item.append(actorAvatar(actor, 'small'), details, actions)
        rosterList.appendChild(item)
      }
    } else {
      rosterList.appendChild(createElement('p', 'xtl-roster-empty', 'No one is invited to post on a schedule yet.'))
    }
    card.appendChild(rosterList)

    const browserHeader = createElement('div', 'xtl-roster-header xtl-roster-browser-header')
    const resultsCount = createElement('span', 'xtl-chip', `${state.replyActors.length} available`)
    browserHeader.append(createElement('h3', 'xtl-section-title', 'Invite actors'), resultsCount)
    card.appendChild(browserHeader)

    const list = createElement('div', 'xtl-roster-list')
    let accessHint = ''
    if (state.replyActors.length) {
      const searchWrap = createElement('div', 'xtl-actor-search-wrap')
      const search = document.createElement('input')
      search.type = 'search'
      search.className = 'xtl-actor-search'
      search.placeholder = 'Search actors by name, handle, role, or card…'
      search.value = actorSearch
      search.setAttribute('aria-label', 'Search actors to invite')
      searchWrap.appendChild(search)
      card.appendChild(searchWrap)

      const actorRows: Array<{ actor: TimelineActor; item: HTMLDivElement }> = []
      for (const actor of state.replyActors) {
        const item = createElement('div', 'xtl-actor-card')
        const details = createElement('div', 'xtl-actor-card-info')
        details.append(
          createElement('div', 'xtl-actor-card-name', actor.name),
          createElement('div', 'xtl-actor-card-meta', `@${actor.handle} · ${actor.role ?? actor.bio}`),
        )
        const invite = button(invited.has(actor.key) ? 'Remove' : 'Invite', invited.has(actor.key) ? 'xtl-button xtl-button--quiet' : 'xtl-button')
        invite.disabled = busy
        invite.addEventListener('click', () => {
          send({ type: 'toggle_roster_actor', actorKey: actor.key })
        })
        item.append(actorAvatar(actor, 'small'), details, invite)
        list.appendChild(item)
        actorRows.push({ actor, item })
      }

      const noMatches = createElement('p', 'xtl-roster-empty', 'No actors match that search.')
      list.appendChild(noMatches)
      const applySearch = () => {
        const rankedRows = actorRows
          .filter((row) => actorMatchesSearch(row.actor, actorSearch))
          .map((row) => ({ row, rank: actorSearchRank(row.actor, actorSearch) }))
          .sort((left, right) => right.rank - left.rank || left.row.actor.name.localeCompare(right.row.actor.name))
        const visibleRows = rankedRows.slice(0, MAX_VISIBLE_ACTORS)
        const visibleItems = new Set(visibleRows.map(({ row }) => row.item))
        for (const row of actorRows) {
          row.item.hidden = !visibleItems.has(row.item)
        }
        for (const { row } of visibleRows) list.insertBefore(row.item, noMatches)
        noMatches.hidden = rankedRows.length > 0
        resultsCount.textContent = actorSearch.trim() || rankedRows.length > MAX_VISIBLE_ACTORS
          ? `${visibleRows.length} of ${rankedRows.length} shown`
          : `${rankedRows.length} available`
      }
      const updateSearch = () => {
        actorSearch = search.value
        applySearch()
      }
      search.addEventListener('input', updateSearch)
      search.addEventListener('search', updateSearch)
      applySearch()
    } else {
      const missingCharacterPermission = !state.permissions.includes('characters')
      list.appendChild(createElement(
        'p',
        'xtl-roster-empty',
        missingCharacterPermission
          ? 'Character-card access is not enabled for Timeline. Grant the Characters permission in Extensions, then refresh. Council members will appear here once they are added to your Council.'
          : 'No character cards or active Council members are available for this account yet. Add one, then refresh this timeline.',
      ))
    }
    if (state.replyActors.length && !state.permissions.includes('characters')) {
      accessHint = 'Character-card access is not enabled, so this list currently shows Council members only.'
    }
    card.appendChild(list)
    if (accessHint) card.appendChild(createElement('p', 'xtl-roster-access', accessHint))
    return card
  }

  let settingsExpanded = false

  const renderSettings = (state: TimelineSnapshot) => {
    const card = createElement('section', 'xtl-card xtl-settings')
    const details = document.createElement('details')
    details.open = settingsExpanded
    details.addEventListener('toggle', () => {
      settingsExpanded = details.open
    })
    const summary = createElement('summary', undefined, 'Timeline settings')
    details.appendChild(summary)

    const copy = createElement('p', 'xtl-settings-copy', 'Choose a fast connection for background character and Council weaves. Your saved Timeline choice is used only by this extension.')
    details.appendChild(copy)
    const row = createElement('div', 'xtl-settings-row')
    const labels = createElement('div')
    labels.append(
      createElement('div', 'xtl-settings-label', 'Timeline sidecar'),
      createElement('div', 'xtl-settings-hint', 'Used only for actor weaves, replies, and optional chat summaries.'),
    )
    const connectionSelect = document.createElement('select')
    connectionSelect.className = 'xtl-select'
    connectionSelect.setAttribute('aria-label', 'Timeline sidecar connection')
    const unset = document.createElement('option')
    unset.value = ''
    unset.textContent = 'Choose connection…'
    connectionSelect.appendChild(unset)
    for (const connection of state.connections) {
      const option = document.createElement('option')
      option.value = connection.id
      option.textContent = `${connection.name} · ${connection.model || connection.provider}${connection.hasApiKey ? '' : ' (no key)'}`
      option.disabled = !connection.hasApiKey
      connectionSelect.appendChild(option)
    }
    connectionSelect.value = state.state.settings.sidecarConnectionId ?? ''
    connectionSelect.disabled = !state.permissions.includes('generation')
    connectionSelect.addEventListener('change', () => send({ type: 'update_settings', sidecarConnectionId: connectionSelect.value || null }))
    row.append(labels, connectionSelect)
    details.appendChild(row)

    const intervalRow = createElement('div', 'xtl-settings-row')
    const intervalLabels = createElement('div')
    intervalLabels.append(
      createElement('div', 'xtl-settings-label', 'Roster cadence'),
      createElement('div', 'xtl-settings-hint', 'The backend chooses one invited actor at random after a delay within this range.'),
    )
    const intervalInputs = createElement('div', 'xtl-interval-inputs')
    const minimum = document.createElement('input')
    minimum.type = 'number'
    minimum.className = 'xtl-number-input'
    minimum.min = '1'
    minimum.max = '1440'
    minimum.step = '1'
    minimum.value = String(state.state.settings.minActorWeaveIntervalMinutes)
    minimum.setAttribute('aria-label', 'Minimum roster weave interval in minutes')
    const maximum = document.createElement('input')
    maximum.type = 'number'
    maximum.className = 'xtl-number-input'
    maximum.min = '1'
    maximum.max = '1440'
    maximum.step = '1'
    maximum.value = String(state.state.settings.maxActorWeaveIntervalMinutes)
    maximum.setAttribute('aria-label', 'Maximum roster weave interval in minutes')
    const saveIntervals = (changed: 'minimum' | 'maximum') => {
      const minValue = Math.max(1, Math.min(1440, Math.round(Number(minimum.value) || 1)))
      const maxValue = Math.max(1, Math.min(1440, Math.round(Number(maximum.value) || 1)))
      if (changed === 'minimum' && minValue > maxValue) maximum.value = String(minValue)
      if (changed === 'maximum' && maxValue < minValue) minimum.value = String(maxValue)
      send({
        type: 'update_settings',
        minActorWeaveIntervalMinutes: Number(minimum.value),
        maxActorWeaveIntervalMinutes: Number(maximum.value),
      })
    }
    minimum.addEventListener('change', () => saveIntervals('minimum'))
    maximum.addEventListener('change', () => saveIntervals('maximum'))
    intervalInputs.append(minimum, document.createTextNode('to'), maximum, document.createTextNode('min'))
    intervalRow.append(intervalLabels, intervalInputs)
    details.appendChild(intervalRow)

    const gifChanceRow = createElement('div', 'xtl-settings-row')
    const gifChanceLabels = createElement('div')
    gifChanceLabels.append(
      createElement('div', 'xtl-settings-label', 'GIF Attachment Chance'),
      createElement('div', 'xtl-settings-hint', 'How often models attach a GIF to their weaves.'),
    )
    const gifChanceInputWrap = createElement('div', 'xtl-interval-inputs')
    const gifChanceInput = createElement('input', 'xtl-number-input')
    gifChanceInput.type = 'number'
    gifChanceInput.min = '0'
    gifChanceInput.max = '100'
    gifChanceInput.value = String(state.state.settings.gifChance ?? 35)
    gifChanceInput.disabled = busy
    
    gifChanceInput.addEventListener('change', () => {
      const val = Math.max(0, Math.min(100, Math.round(Number(gifChanceInput.value) || 0)))
      gifChanceInput.value = String(val)
      send({
        type: 'update_settings',
        gifChance: val,
      })
    })

    gifChanceInputWrap.append(gifChanceInput, document.createTextNode('%'))
    gifChanceRow.append(gifChanceLabels, gifChanceInputWrap)
    details.appendChild(gifChanceRow)

    const hqGifRow = createElement('div', 'xtl-settings-row')
    const hqGifLabels = createElement('div')
    hqGifLabels.append(
      createElement('div', 'xtl-settings-label', 'High Quality GIFs'),
      createElement('div', 'xtl-settings-hint', 'Download uncompressed media. Uses more data and slows down loading, but removes blurriness.'),
    )
    const hqGifInput = document.createElement('input')
    hqGifInput.type = 'checkbox'
    hqGifInput.checked = Boolean(state.state.settings.highQualityGifs)
    hqGifInput.disabled = busy
    hqGifInput.addEventListener('change', () => {
      send({
        type: 'update_settings',
        highQualityGifs: hqGifInput.checked,
      })
    })
    hqGifRow.append(hqGifLabels, hqGifInput)
    details.appendChild(hqGifRow)

    const chatContextRow = createElement('div', 'xtl-settings-row')
    const chatContextLabels = createElement('div')
    chatContextLabels.append(
      createElement('div', 'xtl-settings-label', 'Chat reply context'),
      createElement('div', 'xtl-settings-hint', 'Each chat weave saves a private snapshot for the active character to discuss or gossip about. The inserted message uses the same message count.'),
    )
    const chatContextControls = createElement('div', 'xtl-interval-inputs')
    const includeChatContext = document.createElement('input')
    includeChatContext.type = 'checkbox'
    includeChatContext.checked = state.state.settings.includeChatContext
    includeChatContext.disabled = busy
    includeChatContext.setAttribute('aria-label', 'Include chat context in actor replies')
    const chatContextCount = document.createElement('input')
    chatContextCount.type = 'number'
    chatContextCount.className = 'xtl-number-input'
    chatContextCount.min = '1'
    chatContextCount.max = '30'
    chatContextCount.step = '1'
    chatContextCount.value = String(state.state.settings.chatContextMessageCount)
    chatContextCount.disabled = busy || !includeChatContext.checked
    chatContextCount.setAttribute('aria-label', 'Number of recent chat messages for actor replies')
    includeChatContext.addEventListener('change', () => {
      chatContextCount.disabled = busy || !includeChatContext.checked
      send({ type: 'update_settings', includeChatContext: includeChatContext.checked })
    })
    chatContextCount.addEventListener('change', () => {
      const count = Math.max(1, Math.min(30, Math.round(Number(chatContextCount.value) || 1)))
      chatContextCount.value = String(count)
      send({ type: 'update_settings', chatContextMessageCount: count })
    })
    chatContextControls.append(includeChatContext, chatContextCount, document.createTextNode('recent messages'))
    chatContextRow.append(chatContextLabels, chatContextControls)
    details.appendChild(chatContextRow)

    const addSliderRow = (
      label: string,
      hint: string,
      min: number,
      max: number,
      step: number,
      value: number,
      key: keyof TimelineSnapshot['state']['settings']
    ) => {
      const row = createElement('div', 'xtl-settings-row')
      const labels = createElement('div')
      labels.append(
        createElement('div', 'xtl-settings-label', label),
        createElement('div', 'xtl-settings-hint', hint),
      )
      
      const sliderContainer = createElement('div')
      sliderContainer.style.flex = '1'
      sliderContainer.style.minWidth = '200px'
      sliderContainer.style.marginLeft = '16px'

      row.append(labels, sliderContainer)
      details.appendChild(row)

      const handle = ctx.components.mountRangeSlider(sliderContainer, {
        min,
        max,
        step,
        value,
        disabled: busy,
        label,
        format: { decimals: 2 },
        onCommit: (val) => send({ type: 'update_settings', [key]: val }),
      })
      sliderHandles.push(handle)
    }

    addSliderRow('Temperature', 'Controls randomness: Lowering results in less random completions.', 0, 2, 0.05, state.state.settings.temperature ?? 0.85, 'temperature')
    addSliderRow('Top P', 'Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered.', 0, 1, 0.01, state.state.settings.topP ?? 1.0, 'topP')
    addSliderRow('Presence Penalty', 'How much to penalize new tokens based on whether they appear in the text so far.', 0, 2, 0.05, state.state.settings.presencePenalty ?? 0.0, 'presencePenalty')
    addSliderRow('Frequency Penalty', 'How much to penalize new tokens based on their existing frequency in the text so far.', 0, 2, 0.05, state.state.settings.frequencyPenalty ?? 0.0, 'frequencyPenalty')

    const resetRow = createElement('div', 'xtl-settings-row')
    const resetLabels = createElement('div')
    resetLabels.append(
      createElement('div', 'xtl-settings-label', 'Reset timeline'),
      createElement('div', 'xtl-settings-hint', 'Deletes all weaves, reactions, threads, and roster invitations. Your persona, sidecar, and cadence settings stay saved.'),
    )
    const reset = button('Reset timeline', 'xtl-button xtl-button--danger')
    reset.disabled = busy
    reset.addEventListener('click', () => {
      const confirmed = tab.root.ownerDocument.defaultView?.confirm(
        'Reset this timeline? All weaves, reactions, threads, and roster invitations will be deleted.',
      )
      if (!confirmed) return
      draft = ''
      replyToId = null
      inviteActorKey = ''
      mentionedActorKeys = []
      chatSource = null
      includeCurrentChat = false
      pendingDraft = null
      send({ type: 'reset_timeline' })
    })
    resetRow.append(resetLabels, reset)
    details.appendChild(resetRow)

    if (!state.permissions.includes('generation')) {
      details.appendChild(createElement('div', 'xtl-notice', 'Generation permission is not currently granted, so actor-authored weaves and replies are unavailable.'))
    } else if (!state.connections.length) {
      const notice = createElement('div', 'xtl-notice')
      notice.append(document.createTextNode('No LLM connections are available for this account. Add one in Connections, then return here and refresh. '))
      const manageConnections = button('Open Connections', 'xtl-button')
      manageConnections.addEventListener('click', () => send({ type: 'open_connections' }))
      notice.appendChild(manageConnections)
      details.appendChild(notice)
    } else if (!state.state.settings.sidecarConnectionId) {
      details.appendChild(createElement('div', 'xtl-notice', 'Select a Timeline sidecar before inviting actor replies or starting the roster. You can still write your own weaves.'))
    }

    card.appendChild(details)
    return card
  }

  const render = () => {
    disposeMentionPortal?.()
    disposeMentionPortal = null
    personaPicker?.destroy()
    personaPicker = null
    sliderHandles.forEach(h => h.destroy())
    sliderHandles = []
    root.replaceChildren(renderHeader())
    const renderedError = renderError()
    if (renderedError) root.appendChild(renderedError)

    if (!snapshot) {
      root.appendChild(createElement('div', 'xtl-loading', 'Loading your timeline…'))
      return
    }

    if (busy) {
      root.appendChild(createElement('div', 'xtl-notice', busyActorName ? `${busyActorName} is weaving…` : 'Updating the timeline…'))
    }

    root.append(renderComposer(snapshot), renderTimeline(snapshot), renderRoster(snapshot), renderSettings(snapshot))
  }

  const unsubscribeMessages = ctx.onBackendMessage((payload) => {
    const message = asMessage(payload)
    if (!message) return

    if (message.type === 'timeline_state' && isSnapshot(message.snapshot)) {
      snapshot = message.snapshot
      if (pendingDraft) pendingDraft = null
      if (inviteActorKey && !snapshot.replyActors.some((actor) => actor.key === inviteActorKey)) inviteActorKey = ''
      render()
      return
    }
    if (message.type === 'timeline_error') {
      error = message.message ?? 'Timeline request failed.'
      if (pendingDraft) {
        if (!draft) draft = pendingDraft.text
        replyToId = pendingDraft.replyToId
        chatSource = pendingDraft.chatSource
        inviteActorKey = pendingDraft.inviteActorKey
        mentionedActorKeys = pendingDraft.mentionedActorKeys
        includeCurrentChat = pendingDraft.includeCurrentChat
        pendingDraft = null
      }
      busy = false
      busyActorName = null
      render()
      return
    }
    if (message.type === 'timeline_activity') {
      busy = Boolean(message.active)
      busyActorName = message.actorName ?? null
      render()
      return
    }
  })

  const inputAction = ctx.ui.registerInputBarAction({
    id: 'weave-current-chat',
    label: 'Weave current chat',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  })
  const unsubscribeInputAction = inputAction.onClick(() => {
    includeCurrentChat = true
    tab.activate()
    render()
    focusComposer()
  })
  const unsubscribeActivate = tab.onActivate(() => send({ type: 'load_timeline' }))

  render()
  send({ type: 'load_timeline' })
  ctx.ready()

  return () => {
    disposeMentionPortal?.()
    disposeMentionPortal = null
    personaPicker?.destroy()
    personaPicker = null
    sliderHandles.forEach(h => h.destroy())
    sliderHandles = []
    unsubscribeMessages()
    unsubscribeInputAction()
    unsubscribeActivate()
    inputAction.destroy()
    tab.destroy()
    removeStyle()
    root.replaceChildren()
    ctx.dom.cleanup()
  }
}
