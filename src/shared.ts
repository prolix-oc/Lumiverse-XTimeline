export const TIMELINE_STORAGE_PATH = 'timeline/state.json'
export const MAX_WEAVE_LENGTH = 500
export const MAX_POSTS = 320
export const MAX_ROSTER_ACTORS = 30
export const REACTION_EMOJIS = ['❤', '✨', '🔥', '😂'] as const

export type TimelineActorKind = 'persona' | 'character' | 'council'

export interface TimelineActor {
  key: string
  kind: TimelineActorKind
  sourceId: string
  name: string
  handle: string
  avatarUrl: string | null
  bio: string
  profile: string
  role?: string
}

export interface TimelineReaction {
  emoji: string
  actorKeys: string[]
}

export interface TimelineChatSource {
  kind: 'chat'
  chatId: string
  chatName: string
  characterName: string | null
}

export interface TimelinePost {
  id: string
  author: TimelineActor
  content: string
  createdAt: number
  replyToId: string | null
  threadRootId: string
  reactions: TimelineReaction[]
  source: 'manual' | 'model' | 'chat_share'
  chatSource?: TimelineChatSource
  gifUrl?: string
}

export interface TimelineSettings {
  selectedPersonaId: string | null
  sidecarConnectionId: string | null
  minActorWeaveIntervalMinutes: number
  maxActorWeaveIntervalMinutes: number
}

export interface TimelineState {
  version: 2
  posts: TimelinePost[]
  rosterActorKeys: string[]
  nextRosterWeaveAt: number | null
  settings: TimelineSettings
}

export interface TimelineConnection {
  id: string
  name: string
  provider: string
  model: string
  hasApiKey: boolean
}

export interface TimelineSnapshot {
  state: TimelineState
  personas: TimelineActor[]
  replyActors: TimelineActor[]
  connections: TimelineConnection[]
  activePersonaId: string | null
  permissions: string[]
}

export function createEmptyTimelineState(): TimelineState {
  return {
    version: 2,
    posts: [],
    rosterActorKeys: [],
    nextRosterWeaveAt: null,
    settings: {
      selectedPersonaId: null,
      sidecarConnectionId: null,
      minActorWeaveIntervalMinutes: 30,
      maxActorWeaveIntervalMinutes: 120,
    },
  }
}
