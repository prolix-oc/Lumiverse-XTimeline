// src/shared.ts
var MAX_WEAVE_LENGTH = 500;
var MAX_DIRECT_MESSAGE_LENGTH = 1000;
var MIN_GENERATION_MAX_TOKENS = 32;
var MAX_GENERATION_MAX_TOKENS = 2048;
var DEFAULT_GENERATION_MAX_TOKENS = 2048;
var REACTION_EMOJIS = ["❤", "✨", "\uD83D\uDD25", "\uD83D\uDE02"];

// src/frontend.ts
var READY_MIN_VERSION = [1, 0, 6];
var MAX_VISIBLE_ACTORS = 30;
var MAX_MENTION_MATCHES = 20;
function parseVersionSegment(segment) {
  if (!segment)
    return 0;
  const match = segment.match(/\d+/);
  return match ? Number(match[0]) : 0;
}
function isVersionAtLeast(version, minimum) {
  const parts = version.split(".");
  for (let index = 0;index < minimum.length; index += 1) {
    const current = parseVersionSegment(parts[index]);
    const required = minimum[index];
    if (current > required)
      return true;
    if (current < required)
      return false;
  }
  return true;
}
async function shouldBroadcastReadyForHost() {
  try {
    const response = await fetch("/api/v1/system/info", { credentials: "same-origin" });
    if (!response.ok)
      return true;
    const payload = await response.json();
    const version = typeof payload?.backend?.version === "string" ? payload.backend.version : null;
    return version ? isVersionAtLeast(version, READY_MIN_VERSION) : true;
  } catch {
    return true;
  }
}
function createReadyGate(ctx) {
  if (typeof ctx.deferReady !== "function" || typeof ctx.ready !== "function") {
    return {
      dispose() {},
      release() {}
    };
  }
  ctx.deferReady();
  const shouldBroadcastReady = shouldBroadcastReadyForHost();
  let disposed = false;
  let released = false;
  return {
    dispose() {
      disposed = true;
    },
    release() {
      if (disposed || released)
        return;
      released = true;
      shouldBroadcastReady.then((allowed) => {
        if (!disposed && allowed)
          ctx.ready();
      });
    }
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSnapshot(value) {
  return isRecord(value) && isRecord(value.state) && Array.isArray(value.state.posts) && Array.isArray(value.personas) && Array.isArray(value.replyActors) && Array.isArray(value.connections) && Array.isArray(value.state.directThreads);
}
function asMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string")
    return null;
  return value;
}
function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className)
    element.className = className;
  if (text !== undefined)
    element.textContent = text;
  return element;
}
function button(label, className = "xtl-button") {
  const element = createElement("button", className, label);
  element.type = "button";
  return element;
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
function relativeTime(timestamp) {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 45000)
    return "now";
  if (delta < 3600000)
    return `${Math.floor(delta / 60000)}m`;
  if (delta < 86400000)
    return `${Math.floor(delta / 3600000)}h`;
  if (delta < 604800000)
    return `${Math.floor(delta / 86400000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
function gifDisplayUrl(gifUrl, highQuality) {
  return highQuality ? gifUrl.replace(/AAAA[A-Za-z]\//, "AAAAC/") : gifUrl.replace(/AAAA[A-Za-z]\//, "AAAAM/");
}
function limitCharacters(text, limit) {
  return Array.from(text).slice(0, limit).join("");
}
function actorMatchesSearch(actor, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery)
    return true;
  return [actor.name, actor.handle, actor.bio, actor.profile, actor.role].filter((value) => Boolean(value)).join(" ").toLocaleLowerCase().includes(normalizedQuery);
}
function actorSearchRank(actor, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery)
    return 0;
  const name = actor.name.toLocaleLowerCase();
  const handle = actor.handle.toLocaleLowerCase();
  const role = (actor.role ?? "").toLocaleLowerCase();
  const bio = actor.bio.toLocaleLowerCase();
  if (name === normalizedQuery || handle === normalizedQuery)
    return 100;
  if (name.startsWith(normalizedQuery))
    return 90;
  if (handle.startsWith(normalizedQuery))
    return 80;
  if (name.includes(normalizedQuery))
    return 70;
  if (handle.includes(normalizedQuery))
    return 60;
  if (role.includes(normalizedQuery))
    return 50;
  if (bio.includes(normalizedQuery))
    return 40;
  return 0;
}
function mentionQueryAtCursor(text, cursor) {
  const beforeCursor = text.slice(0, cursor);
  const match = /(^|\s)@([a-zA-Z0-9_]*)$/.exec(beforeCursor);
  if (!match)
    return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2]
  };
}
function actorMatchesMention(actor, query) {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery)
    return true;
  return actor.name.toLocaleLowerCase().includes(normalizedQuery) || actor.handle.toLocaleLowerCase().includes(normalizedQuery);
}
function actorLeading(actor) {
  if (actor.avatarUrl) {
    return {
      type: "image",
      src: actor.avatarUrl,
      rounded: true,
      fallback: {
        text: initials(actor.name),
        background: "var(--lumiverse-fill-subtle)"
      }
    };
  }
  return {
    type: "initial",
    text: initials(actor.name),
    background: "var(--lumiverse-fill-subtle)"
  };
}
function actorAvatar(actor, size = "normal") {
  const holder = createElement("div", `xtl-avatar xtl-avatar--${size}`);
  holder.title = actor.name;
  if (actor.avatarUrl) {
    const image = document.createElement("img");
    image.src = actor.avatarUrl;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      holder.textContent = initials(actor.name);
    }, { once: true });
    holder.appendChild(image);
  } else {
    holder.textContent = initials(actor.name);
  }
  return holder;
}
function orderedPosts(posts, sortBy) {
  const byParent = new Map;
  const roots = [];
  const ids = new Set(posts.map((post) => post.id));
  for (const post of posts) {
    if (!post.replyToId || !ids.has(post.replyToId)) {
      roots.push(post);
      continue;
    }
    const replies = byParent.get(post.replyToId) ?? [];
    replies.push(post);
    byParent.set(post.replyToId, replies);
  }
  for (const replies of byParent.values())
    replies.sort((left, right) => left.createdAt - right.createdAt);
  const threadActivity = new Map;
  const latestActivityAt = (post) => {
    const cached = threadActivity.get(post.id);
    if (cached !== undefined)
      return cached;
    const latest = (byParent.get(post.id) ?? []).reduce((currentLatest, reply) => Math.max(currentLatest, latestActivityAt(reply)), post.createdAt);
    threadActivity.set(post.id, latest);
    return latest;
  };
  roots.sort((left, right) => {
    const leftTime = sortBy === "activity" ? latestActivityAt(left) : left.createdAt;
    const rightTime = sortBy === "activity" ? latestActivityAt(right) : right.createdAt;
    return rightTime - leftTime || right.createdAt - left.createdAt;
  });
  const result = [];
  const visit = (post, depth) => {
    result.push({ post, depth });
    for (const reply of byParent.get(post.id) ?? [])
      visit(reply, Math.min(depth + 1, 3));
  };
  for (const root of roots)
    visit(root, 0);
  return result;
}
function actorWhoOwnsThread(post, state) {
  const postsById = new Map(state.state.posts.map((candidate) => [candidate.id, candidate]));
  let cursor = post;
  const visited = new Set;
  while (cursor && !visited.has(cursor.id)) {
    const current = cursor;
    visited.add(current.id);
    if (current.author.kind === "character" || current.author.kind === "council" || current.author.kind === "lumia") {
      return current.author;
    }
    cursor = current.replyToId ? postsById.get(current.replyToId) : undefined;
  }
  return null;
}
function replyContext(post, state) {
  if (!post.replyToId)
    return null;
  const postsById = new Map(state.state.posts.map((candidate) => [candidate.id, candidate]));
  const recipients = [];
  const recipientKeys = new Set;
  const visited = new Set;
  let cursor = postsById.get(post.replyToId);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    if (cursor.author.key !== post.author.key && !recipientKeys.has(cursor.author.key)) {
      recipients.push(cursor.author);
      recipientKeys.add(cursor.author.key);
    }
    cursor = cursor.replyToId ? postsById.get(cursor.replyToId) : undefined;
  }
  if (!recipients.length)
    return null;
  const [primary] = recipients;
  const others = recipients.length - 1;
  return `Replying to @${primary.handle}${others ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""}`;
}
function timeUntil(timestamp) {
  if (!timestamp || timestamp <= Date.now())
    return "due now";
  const minutes = Math.max(1, Math.ceil((timestamp - Date.now()) / 60000));
  if (minutes < 60)
    return `in about ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `in about ${hours}h${remainder ? ` ${remainder}m` : ""}`;
}
function setup(ctx) {
  const readyGate = createReadyGate(ctx);
  let snapshot = null;
  let draft = "";
  let replyToId = null;
  let inviteActorKey = "";
  let chatSource = null;
  let includeCurrentChat = false;
  let busy = false;
  let busyActorName = null;
  let error = "";
  let pendingDraft = null;
  let mentionedActorKeys = [];
  let personaPicker = null;
  let sliderHandles = [];
  let disposeMentionPortal = null;
  let disposeActorPickerPortal = null;
  let disposeReactionTooltip = null;
  let timelineTopMarker = null;
  let timelineManagementMarker = null;
  let newWeavePill = null;
  let followModal = null;
  let followModalSearch = "";
  let knownActorWeaveIds = null;
  let newActorWeaveCount = 0;
  let timelineIsPastTop = false;
  let activeView = "timeline";
  let activeDirectThreadId = null;
  let dmNewThreadOpen = false;
  let unreadDirectMessageCount = 0;
  let selectedDirectActorKey = "";
  let pendingDirectActorKey = null;
  let dmDraft = "";
  let dmGifSearch = "";
  let dmGifQuery = "";
  let dmGifPickerOpen = false;
  let dmBusy = false;
  let dmBusyActorName = null;
  let dmError = "";
  let pendingDirectMessage = null;
  const tab = ctx.ui.registerDrawerTab({
    id: "timeline",
    title: "Lumiverse Timeline",
    shortName: "Weave",
    headerTitle: "Timeline",
    description: "A private social timeline for your personas, Lumia DLC items, Council, and character cards",
    keywords: ["timeline", "weave", "tweet", "social", "lumia", "dlc", "council", "character"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4.01c-.7.35-1.46.58-2.25.69.81-.49 1.43-1.26 1.72-2.18-.76.45-1.6.78-2.5.96A3.9 3.9 0 0 0 12.22 6c0 .31.03.61.1.9A11.08 11.08 0 0 1 3.2 2.3a3.9 3.9 0 0 0 1.21 5.2 3.9 3.9 0 0 1-1.77-.49v.05c0 1.89 1.34 3.46 3.13 3.82a3.84 3.84 0 0 1-1.76.07 3.9 3.9 0 0 0 3.65 2.7A7.83 7.83 0 0 1 2.8 15.3c-.32 0-.63-.02-.94-.05a11.04 11.04 0 0 0 5.97 1.75c7.17 0 11.09-5.94 11.09-11.09 0-.17 0-.34-.01-.5A7.9 7.9 0 0 0 22 4.01Z"/></svg>'
  });
  const root = createElement("div", "xtl-app");
  tab.root.replaceChildren(root);
  const removeStyle = ctx.dom.addStyle(`
    .xtl-app { --xtl-blue: #1d9bf0; --xtl-blue-soft: color-mix(in srgb, var(--xtl-blue) 16%, transparent); --xtl-surface: #0d1014; --xtl-surface-raised: #14181e; --xtl-line: #2f3336; --xtl-muted: #8b98a5; --xtl-keyboard-inset: 0px; color: #f4f7fa; min-height: 100%; max-width: 760px; margin: 0 auto; padding: 0 14px 32px; box-sizing: border-box; }
    .xtl-tab--dms { height: 100%; min-height: 0; overflow: hidden; overscroll-behavior: none; }
    .xtl-app--dms { display: flex; flex-direction: column; height: 100%; min-height: 0; max-height: 100%; overflow: hidden; overscroll-behavior: none; }
    .xtl-app--dms .xtl-header { position: relative; top: auto; flex: 0 0 auto; }
    .xtl-dm-stage { box-sizing: border-box; flex: 1 1 0; min-height: 0; max-height: 100%; overflow: hidden; margin-bottom: var(--xtl-keyboard-inset); }
    .xtl-header { position: sticky; top: 4px; z-index: 1; display: flex; align-items: center; gap: 12px; min-height: 53px; margin: 4px -6px 12px; padding: 0 14px; background: color-mix(in srgb, var(--lumiverse-background, #0a0c10) 92%, transparent); border: 1px solid color-mix(in srgb, var(--xtl-line) 88%, transparent); border-radius: 12px; backdrop-filter: blur(16px); }
    .xtl-header-mark { display: grid; place-items: center; width: 30px; height: 30px; color: #f5f8fa; font-size: 20px; font-weight: 900; line-height: 1; }
    .xtl-title { flex: 1; margin: 0; font-size: 18px; line-height: 1.1; letter-spacing: -.02em; font-weight: 850; }
    .xtl-header-refresh, .xtl-header-jump { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border-color: transparent; font-size: 18px; }
    .xtl-view-nav { display: flex; flex: 1; align-self: stretch; align-items: stretch; gap: 2px; min-width: 0; }
    .xtl-view-nav-button { display: inline-flex; align-items: center; gap: 6px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--xtl-muted); padding: 0 9px; font: inherit; font-size: 13px; font-weight: 760; cursor: pointer; }
    .xtl-view-nav-button:hover { color: #eaf6ff; background: color-mix(in srgb, var(--xtl-blue) 9%, transparent); }
    .xtl-view-nav-button--active { border-bottom-color: var(--xtl-blue); color: #f4f7fa; }
    .xtl-view-nav-badge { display: grid; place-items: center; min-width: 17px; height: 17px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; background: var(--xtl-blue); color: #fff; font-size: 10px; font-weight: 850; }
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
    .xtl-invite-picker { min-width: 0; }
    .xtl-invite-picker-trigger { max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xtl-select { max-width: 210px; min-width: 0; padding: 7px 30px 7px 10px; font-size: 12px; font-weight: 600; }
    .xtl-actor-picker-popover { position: fixed; z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #3a4148; border-radius: 13px; background: #10151c; box-shadow: 0 12px 28px rgb(0 0 0 / 38%); padding: 5px; }
    .xtl-actor-picker-search { width: 100%; box-sizing: border-box; flex: 0 0 auto; border: 1px solid #3a4148; border-radius: 9px; background: #0a0d11; color: #f4f7fa; padding: 8px 10px; font: inherit; font-size: 12px; outline: none; }
    .xtl-actor-picker-search::placeholder { color: #75808c; }
    .xtl-actor-picker-search:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); }
    .xtl-actor-picker-results { min-height: 0; overflow-y: auto; margin-top: 5px; }
    .xtl-actor-picker-option { display: flex; align-items: center; width: 100%; gap: 9px; box-sizing: border-box; border: 0; border-radius: 9px; background: transparent; color: #f4f7fa; padding: 7px; cursor: pointer; font: inherit; text-align: left; }
    .xtl-actor-picker-option:hover, .xtl-actor-picker-option--selected { background: var(--xtl-blue-soft); }
    .xtl-actor-picker-option:focus-visible { outline: 2px solid var(--xtl-blue); outline-offset: -2px; }
    .xtl-actor-picker-copy { min-width: 0; flex: 1; }
    .xtl-actor-picker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-actor-picker-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 11px; margin-top: 1px; }
    .xtl-actor-picker-empty, .xtl-actor-picker-summary { margin: 0; padding: 9px; color: var(--xtl-muted); font-size: 12px; line-height: 1.35; }
    .xtl-actor-picker-summary { padding-top: 5px; }
    .xtl-actor-picker-clear { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; border: 0; border-radius: 9px; background: transparent; color: var(--xtl-muted); padding: 7px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; text-align: left; }
    .xtl-actor-picker-clear:hover, .xtl-actor-picker-clear:focus-visible { background: var(--xtl-blue-soft); color: #eaf6ff; outline: none; }
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
    .xtl-dm-shell { box-sizing: border-box; height: 100%; min-height: 0; margin: 0; overflow: hidden; overscroll-behavior: contain; }
    .xtl-dm-inbox { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; background: #0b0e12; }
    .xtl-dm-inbox-header, .xtl-dm-thread-header { display: flex; align-items: center; gap: 9px; min-height: 58px; box-sizing: border-box; padding: 11px 13px; border-bottom: 1px solid var(--xtl-line); }
    .xtl-dm-inbox-title { flex: 1; margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .xtl-dm-new { display: grid; place-items: center; width: 33px; height: 33px; padding: 0; border-radius: 50%; font-size: 18px; }
    .xtl-dm-list { overflow-y: auto; min-height: 0; flex: 1; overscroll-behavior: contain; }
    .xtl-dm-list-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; width: 100%; gap: 9px; box-sizing: border-box; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--xtl-line) 70%, transparent); background: transparent; color: inherit; padding: 11px 12px; cursor: pointer; font: inherit; text-align: left; }
    .xtl-dm-list-item:hover, .xtl-dm-list-item--active { background: color-mix(in srgb, var(--xtl-blue) 12%, transparent); }
    .xtl-dm-list-item--unread .xtl-dm-list-name, .xtl-dm-list-item--unread .xtl-dm-list-preview { color: #f4f7fa; font-weight: 800; }
    .xtl-dm-list-copy { min-width: 0; }
    .xtl-dm-list-name-row { display: flex; align-items: baseline; min-width: 0; gap: 5px; }
    .xtl-dm-list-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-dm-list-handle, .xtl-dm-list-time { color: var(--xtl-muted); font-size: 11px; white-space: nowrap; }
    .xtl-dm-list-preview { overflow: hidden; color: var(--xtl-muted); text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; font-size: 12px; }
    .xtl-dm-unread { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; background: var(--xtl-blue); color: #fff; font-size: 10px; font-weight: 850; }
    .xtl-dm-empty-inbox { margin: 0; padding: 27px 18px; color: var(--xtl-muted); font-size: 12px; line-height: 1.5; text-align: center; }
    .xtl-dm-main { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; background: var(--xtl-surface); }
    .xtl-dm-thread-header { flex: 0 0 auto; }
    .xtl-dm-thread-title { min-width: 0; flex: 1; }
    .xtl-dm-thread-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 800; }
    .xtl-dm-thread-meta { overflow: hidden; color: var(--xtl-muted); text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; font-size: 11px; }
    .xtl-dm-thread-scroll { display: flex; flex: 1; flex-direction: column; gap: 9px; overflow-y: auto; min-height: 0; padding: 18px 14px; overscroll-behavior: contain; }
    .xtl-dm-message-row { display: flex; align-items: flex-end; gap: 7px; max-width: 88%; }
    .xtl-dm-message-row--outgoing { align-self: flex-end; flex-direction: row-reverse; }
    .xtl-dm-message-row .xtl-avatar { width: 29px; height: 29px; border-width: 1px; font-size: 9px; }
    .xtl-dm-bubble { min-width: 0; border-radius: 18px 18px 18px 5px; background: #27313b; color: #f5f8fa; overflow: hidden; }
    .xtl-dm-message-row--outgoing .xtl-dm-bubble { border-radius: 18px 18px 5px 18px; background: var(--xtl-blue); }
    .xtl-dm-bubble--media { width: min(100%, 340px); }
    .xtl-dm-bubble-copy { padding: 9px 11px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.38; }
    .xtl-dm-media { display: flex; align-items: center; justify-content: center; max-height: 260px; overflow: hidden; background: #0a0d11; border-radius: 0 0 18px 5px; }
    .xtl-dm-message-row--outgoing .xtl-dm-media { border-radius: 0 0 5px 18px; }
    .xtl-dm-bubble--media-only .xtl-dm-media { border-radius: 18px 18px 18px 5px; }
    .xtl-dm-message-row--outgoing .xtl-dm-bubble--media-only .xtl-dm-media { border-radius: 18px 18px 5px 18px; }
    .xtl-dm-gif { display: block; width: auto; max-width: 100%; height: auto; max-height: 260px; object-fit: contain; }
    .xtl-dm-time { color: var(--xtl-muted); margin: 2px 4px 0; font-size: 10px; }
    .xtl-dm-message-row--outgoing .xtl-dm-time { text-align: right; }
    .xtl-dm-composer { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid var(--xtl-line); background: #0b0e12; }
    .xtl-dm-compose-row { display: flex; align-items: flex-end; gap: 7px; }
    .xtl-dm-compose-row .xtl-textarea { min-height: 43px; max-height: 150px; padding: 10px 12px; resize: none; }
    .xtl-dm-gif-toggle { display: grid; place-items: center; min-width: 39px; height: 39px; padding: 0; border-radius: 10px; color: #9ddcff; font-size: 11px; }
    .xtl-dm-send { min-width: 58px; height: 39px; padding: 0 12px; }
    .xtl-dm-gif-search { display: flex; align-items: center; gap: 7px; margin: 8px 0 0 46px; }
    .xtl-dm-gif-search input { min-width: 0; flex: 1; border: 1px solid #3a4148; border-radius: 9px; background: #0a0d11; color: #f4f7fa; padding: 8px 10px; font: inherit; font-size: 12px; outline: none; }
    .xtl-dm-gif-search input:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); }
    .xtl-dm-gif-chip { display: flex; align-items: center; gap: 5px; width: fit-content; max-width: calc(100% - 46px); margin: 8px 0 0 46px; color: #b9e0ff; font-size: 11px; }
    .xtl-dm-gif-chip button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xtl-dm-welcome { display: grid; place-items: center; flex: 1; min-height: 0; padding: 28px; text-align: center; }
    .xtl-dm-welcome-copy { max-width: 360px; color: var(--xtl-muted); font-size: 13px; line-height: 1.55; }
    .xtl-dm-welcome-copy h3 { margin: 10px 0 6px; color: #f4f7fa; font-size: 18px; }
    .xtl-dm-new-thread { display: grid; width: min(380px, 100%); gap: 12px; text-align: left; }
    .xtl-dm-new-thread .xtl-actor-picker-trigger { width: 100%; max-width: none; justify-content: space-between; }
    .xtl-dm-new-thread-label { color: #d9e3ec; font-size: 13px; font-weight: 750; }
    .xtl-dm-thread-notice { margin: 10px 12px 0; }
    .xtl-post-actions { margin: 8px 0 0 49px; gap: 8px; flex-wrap: wrap; }
    .xtl-post-actions .xtl-button { color: var(--xtl-muted); border-color: transparent; padding: 6px 8px; }
    .xtl-post-actions .xtl-button:hover:not(:disabled) { color: var(--xtl-blue); background: var(--xtl-blue-soft); }
    .xtl-reaction { min-width: 40px; }
    .xtl-reaction--active { color: #ff6b9a !important; background: color-mix(in srgb, #ff6b9a 14%, transparent) !important; }
    .xtl-reaction-tooltip { position: fixed; z-index: 2147483647; width: min(260px, calc(100vw - 16px)); box-sizing: border-box; border: 1px solid #3a4148; border-radius: 12px; background: #10151c; box-shadow: 0 12px 28px rgb(0 0 0 / 38%); padding: 9px; }
    .xtl-reaction-tooltip-title { margin: 0 0 7px; color: var(--xtl-muted); font-size: 11px; font-weight: 700; }
    .xtl-reaction-tooltip-list { display: grid; gap: 5px; max-height: 208px; overflow-y: auto; }
    .xtl-reaction-tooltip-actor { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 3px; }
    .xtl-reaction-tooltip-actor .xtl-avatar { width: 26px; height: 26px; border-width: 1px; font-size: 9px; }
    .xtl-reaction-tooltip-copy { min-width: 0; }
    .xtl-reaction-tooltip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f4f7fa; font-size: 12px; font-weight: 750; }
    .xtl-reaction-tooltip-handle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 10px; margin-top: 1px; }
    .xtl-feed-top { scroll-margin-top: 68px; height: 1px; }
    .xtl-feed-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--xtl-line); }
    .xtl-feed-sort-label { color: var(--xtl-muted); font-size: 12px; font-weight: 700; }
    .xtl-feed-toolbar .xtl-select { max-width: none; }
    .xtl-new-weaves-wrap { position: sticky; top: 66px; z-index: 3; display: flex; justify-content: center; width: 100%; height: 1px; pointer-events: none; }
    .xtl-new-weaves { pointer-events: auto; min-height: 32px; box-sizing: border-box; border: 1px solid #68c0ff; background: linear-gradient(180deg, #2aa7f5, #168bd6); box-shadow: 0 7px 19px rgb(0 0 0 / 34%); color: #fff; margin-top: 9px; padding: 8px 14px; font-size: 12px; font-weight: 800; line-height: 1; letter-spacing: .01em; white-space: nowrap; }
    .xtl-new-weaves:hover:not(:disabled) { border-color: #b6e3ff; background: linear-gradient(180deg, #44b4fa, #1a95e5); color: #fff; }
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
    .xtl-roster-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 10px; margin-top: 12px; }
    .xtl-roster-empty, .xtl-roster-access { grid-column: 1 / -1; margin: 2px 0 0; color: var(--xtl-muted); font-size: 12px; line-height: 1.5; }
    .xtl-actor-card[hidden], .xtl-roster-empty[hidden] { display: none !important; }
    .xtl-roster-access { margin-top: 10px; }
    .xtl-actor-card { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px; border: 1px solid #38404a; border-radius: 12px; background: #0c0f13; }
    .xtl-actor-card-info { min-width: 0; flex: 1; }
    .xtl-actor-card-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
    .xtl-actor-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-actor-card-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 11px; margin-top: 2px; }
    .xtl-actor-card .xtl-button { color: #9bd7ff; border-color: color-mix(in srgb, var(--xtl-blue) 46%, #39424d); font-size: 11px; padding: 6px 9px; }
    .xtl-roster-actor-card { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 9px; padding: 11px; }
    .xtl-roster-actor-card .xtl-actor-card-actions { display: grid; grid-column: 1 / -1; grid-template-columns: 1.25fr 1fr 1fr; width: 100%; gap: 6px; margin-left: 0; }
    .xtl-roster-actor-card .xtl-button { width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xtl-management-anchor { height: 1px; scroll-margin-top: 68px; }
    .xtl-follow-modal { display: grid; gap: 12px; min-height: 0; }
    .xtl-follow-modal-copy { margin: 0; color: var(--lumiverse-text-muted, #8b98a5); font-size: 13px; line-height: 1.45; }
    .xtl-follow-modal-list { display: grid; gap: 8px; min-height: 0; max-height: min(440px, calc(100vh - 250px)); overflow-y: auto; }
    .xtl-follow-modal-empty { margin: 2px 0; color: var(--lumiverse-text-muted, #8b98a5); font-size: 13px; line-height: 1.5; text-align: center; }
    .xtl-follow-modal .xtl-actor-card { background: var(--lumiverse-surface, #0c0f13); }
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
    @media (max-width: 680px) { .xtl-dm-message-row { max-width: 93%; } }
    @media (max-width: 520px) { .xtl-app { padding: 0 9px 24px; } .xtl-header { margin-inline: -9px; padding-inline: 13px; } .xtl-subtitle { display: none; } .xtl-post-body, .xtl-post-source, .xtl-post-gif { margin-left: 0 !important; } .xtl-post-gif { width: 100%; } .xtl-post-actions { margin-left: -6px; } .xtl-post--reply { margin-left: 10px; } .xtl-composer-top, .xtl-settings-row { align-items: flex-start; flex-direction: column; } .xtl-select, .xtl-persona-picker { max-width: 100%; width: 100%; } .xtl-roster-list { grid-template-columns: 1fr; } .xtl-actor-card-actions { margin-left: auto; } .xtl-dm-gif-search, .xtl-dm-gif-chip { margin-left: 0; max-width: 100%; } }
  `);
  const selectedPersona = () => {
    if (!snapshot)
      return null;
    const desired = snapshot.state.settings.selectedPersonaId ?? snapshot.activePersonaId;
    return snapshot.personas.find((persona) => persona.sourceId === desired) ?? snapshot.personas[0] ?? null;
  };
  const selectedReplyTarget = () => {
    if (!snapshot || !replyToId)
      return null;
    return snapshot.state.posts.find((post) => post.id === replyToId) ?? null;
  };
  const send = (payload) => ctx.sendToBackend(payload);
  const positionDmComposerForKeyboard = () => {
    requestAnimationFrame(() => {
      if (activeView !== "dms")
        return;
      const thread = root.querySelector(".xtl-dm-thread-scroll");
      if (thread)
        thread.scrollTop = thread.scrollHeight;
    });
  };
  const applyKeyboardPresentation = (keyboard) => {
    const inset = keyboard.visible ? Math.max(0, keyboard.insetBottom) : 0;
    root.style.setProperty("--xtl-keyboard-inset", `${inset}px`);
    if (keyboard.visible)
      positionDmComposerForKeyboard();
  };
  const updateNewWeavePill = () => {
    if (!newWeavePill)
      return;
    const visible = timelineIsPastTop && newActorWeaveCount > 0;
    newWeavePill.hidden = !visible;
    newWeavePill.textContent = `${newActorWeaveCount} new ${newActorWeaveCount === 1 ? "weave" : "weaves"}`;
  };
  const updateTimelineScrollState = () => {
    const wasPastTop = timelineIsPastTop;
    timelineIsPastTop = Boolean(timelineTopMarker?.isConnected && timelineTopMarker.getBoundingClientRect().top < 0);
    if (wasPastTop && !timelineIsPastTop && newActorWeaveCount)
      newActorWeaveCount = 0;
    updateNewWeavePill();
  };
  const scrollToTimelineTop = () => {
    newActorWeaveCount = 0;
    updateNewWeavePill();
    timelineTopMarker?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollToTimelineManagement = () => {
    timelineManagementMarker?.scrollIntoView({ behavior: "auto", block: "start" });
  };
  const trackNewActorWeaves = (state) => {
    const actorWeaveIds = new Set(state.state.posts.filter((post) => post.source === "model").map((post) => post.id));
    if (knownActorWeaveIds) {
      const arrived = [...actorWeaveIds].filter((id) => !knownActorWeaveIds?.has(id)).length;
      if (arrived && timelineIsPastTop)
        newActorWeaveCount += arrived;
    }
    knownActorWeaveIds = actorWeaveIds;
  };
  const focusComposer = () => {
    queueMicrotask(() => root.querySelector(".xtl-textarea")?.focus());
  };
  const renderHeader = () => {
    const header = createElement("header", "xtl-header");
    const mark = createElement("span", "xtl-header-mark", "\uD835\uDD4F");
    mark.setAttribute("aria-hidden", "true");
    const nav = createElement("nav", "xtl-view-nav");
    nav.setAttribute("aria-label", "Timeline views");
    const selectView = (view) => {
      activeView = view;
      if (view === "dms" && activeDirectThreadId)
        send({ type: "read_direct_thread", threadId: activeDirectThreadId });
      render();
      if (view === "dms")
        requestAnimationFrame(() => root.scrollIntoView({ block: "start", behavior: "auto" }));
    };
    const timelineView = button("Timeline", `xtl-view-nav-button${activeView === "timeline" ? " xtl-view-nav-button--active" : ""}`);
    timelineView.setAttribute("aria-current", activeView === "timeline" ? "page" : "false");
    timelineView.addEventListener("click", () => selectView("timeline"));
    const messagesView = button("Messages", `xtl-view-nav-button${activeView === "dms" ? " xtl-view-nav-button--active" : ""}`);
    messagesView.setAttribute("aria-current", activeView === "dms" ? "page" : "false");
    if (unreadDirectMessageCount)
      messagesView.appendChild(createElement("span", "xtl-view-nav-badge", unreadDirectMessageCount > 99 ? "99+" : String(unreadDirectMessageCount)));
    messagesView.addEventListener("click", () => selectView("dms"));
    nav.append(timelineView, messagesView);
    const jumpToManagement = button("↓", "xtl-button xtl-header-jump");
    jumpToManagement.title = "Jump to followed actors and settings";
    jumpToManagement.setAttribute("aria-label", "Jump to followed actors and settings");
    jumpToManagement.addEventListener("click", scrollToTimelineManagement);
    const refresh = button("↻", "xtl-button xtl-header-refresh");
    refresh.title = "Refresh timeline";
    refresh.setAttribute("aria-label", "Refresh timeline");
    refresh.addEventListener("click", () => send({ type: "load_timeline" }));
    header.append(mark, nav);
    if (activeView === "timeline")
      header.appendChild(jumpToManagement);
    header.appendChild(refresh);
    return header;
  };
  const renderError = () => {
    if (!error)
      return null;
    const notice = createElement("div", "xtl-notice xtl-notice--error");
    const copy = createElement("span", undefined, error);
    const dismiss = button("Dismiss", "xtl-button xtl-button--quiet");
    dismiss.addEventListener("click", () => {
      error = "";
      render();
    });
    notice.append(copy, dismiss);
    return notice;
  };
  const renderFollowModal = () => {
    if (!followModal || !snapshot)
      return;
    const modal = followModal;
    const state = snapshot;
    const followedActorKeys = new Set(state.state.rosterActorKeys);
    const content = createElement("div", "xtl-follow-modal");
    content.appendChild(createElement("p", "xtl-follow-modal-copy", followedActorKeys.size ? `${followedActorKeys.size} actor${followedActorKeys.size === 1 ? "" : "s"} followed. Follow more to add them to the randomized timeline rotation.` : "Follow actors to add them to the randomized timeline rotation."));
    const search = document2.createElement("input");
    search.type = "search";
    search.className = "xtl-actor-search";
    search.placeholder = "Search actors by name, handle, role, or definition…";
    search.value = followModalSearch;
    search.setAttribute("aria-label", "Search actors to follow");
    content.appendChild(search);
    const list = createElement("div", "xtl-follow-modal-list");
    const renderResults = () => {
      followModalSearch = search.value;
      const matchingActors = state.replyActors.filter((actor) => actorMatchesSearch(actor, followModalSearch)).map((actor) => ({ actor, rank: actorSearchRank(actor, followModalSearch) })).sort((left, right) => right.rank - left.rank || left.actor.name.localeCompare(right.actor.name));
      const visibleActors = matchingActors.slice(0, MAX_VISIBLE_ACTORS).map(({ actor }) => actor);
      list.replaceChildren();
      if (!visibleActors.length) {
        const message = state.replyActors.length ? "No actors match that search." : !state.permissions.includes("characters") ? "Character-card access is not enabled. Grant the Characters permission in Extensions, then refresh." : "No character cards, Lumia DLC items, or active Council members are available yet.";
        list.appendChild(createElement("p", "xtl-follow-modal-empty", message));
        return;
      }
      for (const actor of visibleActors) {
        const item = createElement("div", "xtl-actor-card");
        const details = createElement("div", "xtl-actor-card-info");
        details.append(createElement("div", "xtl-actor-card-name", actor.name), createElement("div", "xtl-actor-card-meta", `@${actor.handle} · ${actor.role ?? actor.bio}`));
        const isFollowed = followedActorKeys.has(actor.key);
        const follow = button(isFollowed ? "Following" : "Follow", `xtl-button${isFollowed ? " xtl-button--selected" : ""}`);
        follow.disabled = busy;
        follow.setAttribute("aria-pressed", String(isFollowed));
        follow.title = isFollowed ? `Unfollow ${actor.name}` : `Follow ${actor.name}`;
        follow.addEventListener("click", () => send({ type: "toggle_roster_actor", actorKey: actor.key }));
        item.append(actorAvatar(actor, "small"), details, follow);
        list.appendChild(item);
      }
      if (matchingActors.length > MAX_VISIBLE_ACTORS) {
        list.appendChild(createElement("p", "xtl-follow-modal-empty", `Showing the first ${MAX_VISIBLE_ACTORS} of ${matchingActors.length}. Keep typing to narrow the list.`));
      }
    };
    search.addEventListener("input", renderResults);
    search.addEventListener("search", renderResults);
    renderResults();
    content.appendChild(list);
    modal.root.replaceChildren(content);
  };
  const openFollowModal = () => {
    if (!snapshot)
      return;
    if (followModal) {
      renderFollowModal();
      followModal.root.querySelector(".xtl-actor-search")?.focus();
      return;
    }
    const modal = ctx.ui.showModal({ title: "Follow actors", width: 600, maxHeight: 650 });
    const rootStyles = tab.root.ownerDocument.defaultView?.getComputedStyle(root);
    for (const property of ["--xtl-blue", "--xtl-blue-soft", "--xtl-muted"]) {
      const value = rootStyles?.getPropertyValue(property);
      if (value)
        modal.root.style.setProperty(property, value);
    }
    followModal = modal;
    modal.onDismiss(() => {
      if (followModal === modal)
        followModal = null;
    });
    renderFollowModal();
    queueMicrotask(() => modal.root.querySelector(".xtl-actor-search")?.focus());
  };
  const createActorReplyPicker = (state, options) => {
    const picker = createElement("div", "xtl-invite-picker");
    const trigger = button("", "xtl-button xtl-invite-picker-trigger");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-label", "Invite an actor to reply");
    trigger.setAttribute("aria-expanded", "false");
    trigger.disabled = options.disabled;
    picker.appendChild(trigger);
    let value = options.value;
    const selectedActor = () => state.replyActors.find((actor) => actor.key === value) ?? null;
    const updateTrigger = () => {
      const actor = selectedActor();
      trigger.textContent = actor ? `Invite ${actor.name}` : "Invite reply";
      trigger.title = actor ? `Invite ${actor.name} to reply` : "Invite an actor to reply";
    };
    const open = () => {
      disposeActorPickerPortal?.();
      const ownerDocument = tab.root.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      const popover = createElement("div", "xtl-actor-picker-popover");
      popover.setAttribute("role", "dialog");
      popover.setAttribute("aria-label", "Invite an actor to reply");
      const search = document2.createElement("input");
      search.type = "search";
      search.className = "xtl-actor-picker-search";
      search.placeholder = "Search actors…";
      search.setAttribute("aria-label", "Search actors to invite");
      const results = createElement("div", "xtl-actor-picker-results");
      results.setAttribute("role", "listbox");
      popover.append(search, results);
      const positionPopover = () => {
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth;
        const viewportHeight = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight;
        const edge = 8;
        const width = Math.max(240, Math.min(320, viewportWidth - edge * 2));
        const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge));
        const spaceBelow = viewportHeight - rect.bottom - edge;
        const spaceAbove = rect.top - edge;
        const placeAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(140, Math.min(420, placeAbove ? spaceAbove : spaceBelow));
        popover.style.left = `${left}px`;
        popover.style.width = `${width}px`;
        popover.style.maxHeight = `${maxHeight}px`;
        popover.style.top = `${placeAbove ? Math.max(edge, rect.top - maxHeight - 6) : rect.bottom + 6}px`;
      };
      const rootStyles = ownerWindow?.getComputedStyle(root);
      for (const property of ["--xtl-blue", "--xtl-blue-soft", "--xtl-muted"]) {
        const styleValue = rootStyles?.getPropertyValue(property);
        if (styleValue)
          popover.style.setProperty(property, styleValue);
      }
      const close = () => {
        ownerWindow?.removeEventListener("resize", positionPopover);
        ownerDocument.removeEventListener("scroll", positionPopover, true);
        ownerDocument.removeEventListener("pointerdown", closeWhenClickingAway, true);
        ownerDocument.removeEventListener("keydown", closeOnEscape);
        popover.remove();
        trigger.setAttribute("aria-expanded", "false");
        if (disposeActorPickerPortal === close)
          disposeActorPickerPortal = null;
      };
      const closeWhenClickingAway = (event) => {
        const target = event.target;
        if (target instanceof Node && !popover.contains(target) && !trigger.contains(target))
          close();
      };
      const closeOnEscape = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          trigger.focus();
        }
      };
      const chooseActor = (actorKey) => {
        value = actorKey;
        updateTrigger();
        close();
        options.onChange(actorKey);
      };
      const renderResults = () => {
        const matchingActors = state.replyActors.filter((actor) => actorMatchesSearch(actor, search.value)).map((actor) => ({ actor, rank: actorSearchRank(actor, search.value) })).sort((left, right) => right.rank - left.rank || left.actor.name.localeCompare(right.actor.name));
        const visibleActors = matchingActors.slice(0, MAX_VISIBLE_ACTORS).map(({ actor }) => actor);
        results.replaceChildren();
        if (options.clearable && value) {
          const clear = createElement("button", "xtl-actor-picker-clear", "No invited reply");
          clear.type = "button";
          clear.addEventListener("click", () => chooseActor(""));
          results.appendChild(clear);
        }
        if (!visibleActors.length) {
          results.appendChild(createElement("p", "xtl-actor-picker-empty", "No actors match that search."));
          return;
        }
        for (const actor of visibleActors) {
          const option = createElement("button", `xtl-actor-picker-option${actor.key === value ? " xtl-actor-picker-option--selected" : ""}`);
          option.type = "button";
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", String(actor.key === value));
          const copy = createElement("div", "xtl-actor-picker-copy");
          copy.append(createElement("div", "xtl-actor-picker-name", actor.name), createElement("div", "xtl-actor-picker-meta", `@${actor.handle} · ${actor.role ?? actor.bio}`));
          option.append(actorAvatar(actor, "small"), copy);
          option.addEventListener("click", () => chooseActor(actor.key));
          results.appendChild(option);
        }
        if (matchingActors.length > MAX_VISIBLE_ACTORS) {
          results.appendChild(createElement("p", "xtl-actor-picker-summary", `Showing the first ${MAX_VISIBLE_ACTORS} of ${matchingActors.length}. Keep typing to narrow the list.`));
        }
      };
      ownerDocument.body.appendChild(popover);
      trigger.setAttribute("aria-expanded", "true");
      ownerWindow?.addEventListener("resize", positionPopover);
      ownerDocument.addEventListener("scroll", positionPopover, true);
      ownerDocument.addEventListener("pointerdown", closeWhenClickingAway, true);
      ownerDocument.addEventListener("keydown", closeOnEscape);
      search.addEventListener("input", renderResults);
      search.addEventListener("search", renderResults);
      renderResults();
      positionPopover();
      disposeActorPickerPortal = close;
      queueMicrotask(() => search.focus());
    };
    trigger.addEventListener("click", open);
    updateTrigger();
    return picker;
  };
  const reactionActorDetails = (state, actorKeys) => {
    const actorByKey = new Map;
    for (const actor of [...state.state.posts.map((post) => post.author), ...state.personas, ...state.replyActors]) {
      actorByKey.set(actor.key, actor);
    }
    const currentPersona = state.personas.find((persona) => persona.sourceId === (state.state.settings.selectedPersonaId ?? state.activePersonaId)) ?? state.personas[0] ?? null;
    return actorKeys.map((key) => {
      if (key === "timeline_user") {
        return currentPersona ? { key, name: currentPersona.name, handle: currentPersona.handle, avatarUrl: currentPersona.avatarUrl } : { key, name: "You", handle: "you", avatarUrl: null };
      }
      const actor = actorByKey.get(key);
      return actor ? { key, name: actor.name, handle: actor.handle, avatarUrl: actor.avatarUrl } : { key, name: "Unavailable actor", handle: key, avatarUrl: null };
    });
  };
  const showReactionTooltip = (trigger, emoji, actorKeys, state) => {
    if (!actorKeys.length)
      return;
    disposeReactionTooltip?.();
    const ownerDocument = tab.root.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const tooltip = createElement("div", "xtl-reaction-tooltip");
    tooltip.setAttribute("role", "tooltip");
    tooltip.appendChild(createElement("p", "xtl-reaction-tooltip-title", `Reacted with ${emoji}`));
    const list = createElement("div", "xtl-reaction-tooltip-list");
    for (const actor of reactionActorDetails(state, actorKeys)) {
      const item = createElement("div", "xtl-reaction-tooltip-actor");
      const copy = createElement("div", "xtl-reaction-tooltip-copy");
      copy.append(createElement("div", "xtl-reaction-tooltip-name", actor.name), createElement("div", "xtl-reaction-tooltip-handle", `@${actor.handle}`));
      item.append(actorAvatar(actor, "small"), copy);
      list.appendChild(item);
    }
    tooltip.appendChild(list);
    const positionTooltip = () => {
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth;
      const viewportHeight = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight;
      const edge = 8;
      const width = Math.min(260, viewportWidth - edge * 2);
      const left = Math.max(edge, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - edge));
      const tooltipHeight = Math.min(260, tooltip.getBoundingClientRect().height || 100);
      const top = rect.top - edge - tooltipHeight >= edge ? rect.top - edge - tooltipHeight : Math.min(viewportHeight - tooltipHeight - edge, rect.bottom + edge);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(edge, top)}px`;
    };
    const rootStyles = ownerWindow?.getComputedStyle(root);
    for (const property of ["--xtl-blue", "--xtl-blue-soft", "--xtl-muted"]) {
      const styleValue = rootStyles?.getPropertyValue(property);
      if (styleValue)
        tooltip.style.setProperty(property, styleValue);
    }
    const close = () => {
      ownerWindow?.removeEventListener("resize", positionTooltip);
      ownerDocument.removeEventListener("scroll", positionTooltip, true);
      tooltip.remove();
      if (disposeReactionTooltip === close)
        disposeReactionTooltip = null;
    };
    ownerDocument.body.appendChild(tooltip);
    ownerWindow?.addEventListener("resize", positionTooltip);
    ownerDocument.addEventListener("scroll", positionTooltip, true);
    positionTooltip();
    disposeReactionTooltip = close;
  };
  const renderComposer = (state) => {
    const card = createElement("section", "xtl-card xtl-composer");
    const top = createElement("div", "xtl-composer-top");
    const title = createElement("div", "xtl-composer-label", selectedReplyTarget() ? "Reply as" : "Weave as");
    const personaPickerSlot = createElement("div", "xtl-persona-picker");
    top.append(title, personaPickerSlot);
    card.appendChild(top);
    personaPicker = ctx.components.mountSelect(personaPickerSlot, {
      value: selectedPersona()?.sourceId ?? "",
      placeholder: state.personas.length ? "Choose persona…" : "You",
      searchPlaceholder: "Search personas…",
      searchThreshold: 0,
      emptyMessage: "No personas are available.",
      noResultsMessage: "No personas match your search.",
      ariaLabel: "Timeline persona",
      align: "right",
      minWidth: 250,
      options: state.personas.map((persona2) => ({
        value: persona2.sourceId,
        label: `${persona2.name} @${persona2.handle}`,
        sublabel: persona2.bio || "Timeline persona",
        leading: actorLeading(persona2)
      })),
      onChange: (personaId) => send({ type: "update_settings", selectedPersonaId: personaId || null })
    });
    const replyTarget = selectedReplyTarget();
    const replyThreadOwner = replyTarget ? actorWhoOwnsThread(replyTarget, state) : null;
    if (replyTarget) {
      const context = createElement("p", "xtl-compose-context");
      context.append("Replying to ", createElement("strong", undefined, `@${replyTarget.author.handle}`), document2.createTextNode(". "));
      if (replyThreadOwner) {
        context.append(createElement("span", "xtl-chip", `@${replyThreadOwner.handle} will respond`));
      }
      const clear = button("Cancel reply", "xtl-button xtl-button--quiet");
      clear.addEventListener("click", () => {
        replyToId = null;
        render();
      });
      context.appendChild(clear);
      card.appendChild(context);
    }
    if (chatSource) {
      const context = createElement("p", "xtl-compose-context");
      context.append(createElement("span", "xtl-chip", `Sharing ${chatSource.chatName}`));
      if (state.state.settings.includeChatContext) {
        context.append(createElement("span", "xtl-chip", `Last ${state.state.settings.chatContextMessageCount} messages available to replies`));
      }
      const clear = button("Remove chat link", "xtl-button xtl-button--quiet");
      clear.addEventListener("click", () => {
        chatSource = null;
        render();
      });
      context.appendChild(clear);
      card.appendChild(context);
    }
    const textarea = document2.createElement("textarea");
    textarea.className = "xtl-textarea";
    textarea.maxLength = MAX_WEAVE_LENGTH;
    textarea.placeholder = replyTarget ? `Reply to @${replyTarget.author.handle}…` : "What is happening in your Lumiverse?";
    textarea.value = draft;
    textarea.disabled = busy;
    const writingRow = createElement("div", "xtl-composer-writing");
    const mentionPopover = createElement("div", "xtl-mention-popover");
    mentionPopover.hidden = true;
    mentionPopover.setAttribute("role", "listbox");
    mentionPopover.setAttribute("aria-label", "Mention an actor");
    const ownerDocument = tab.root.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const positionMentionPopover = () => {
      const rect = textarea.getBoundingClientRect();
      const viewportWidth = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth;
      const viewportHeight = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight;
      const edge = 8;
      const width = Math.max(200, Math.min(rect.width, viewportWidth - edge * 2));
      const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge));
      const spaceBelow = viewportHeight - rect.bottom - edge;
      const spaceAbove = rect.top - edge;
      const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(72, Math.min(264, placeAbove ? spaceAbove : spaceBelow));
      mentionPopover.style.left = `${left}px`;
      mentionPopover.style.width = `${width}px`;
      mentionPopover.style.maxHeight = `${maxHeight}px`;
      mentionPopover.style.top = `${placeAbove ? Math.max(edge, rect.top - maxHeight - 6) : rect.bottom + 6}px`;
    };
    const rootStyles = ownerWindow?.getComputedStyle(root);
    for (const property of ["--xtl-blue", "--xtl-blue-soft"]) {
      const value = rootStyles?.getPropertyValue(property);
      if (value)
        mentionPopover.style.setProperty(property, value);
    }
    const removeMentionPortal = () => {
      ownerWindow?.removeEventListener("resize", positionMentionPopover);
      ownerDocument.removeEventListener("scroll", positionMentionPopover, true);
      mentionPopover.remove();
      if (disposeMentionPortal === removeMentionPortal)
        disposeMentionPortal = null;
    };
    disposeMentionPortal = removeMentionPortal;
    ownerDocument.body.appendChild(mentionPopover);
    ownerWindow?.addEventListener("resize", positionMentionPopover);
    ownerDocument.addEventListener("scroll", positionMentionPopover, true);
    positionMentionPopover();
    const persona = selectedPersona();
    writingRow.append(persona ? actorAvatar(persona) : createElement("div", "xtl-avatar", "Y"), textarea);
    card.appendChild(writingRow);
    const mentionStack = createElement("div", "xtl-mention-stack");
    mentionStack.hidden = true;
    card.appendChild(mentionStack);
    const controls = createElement("div", "xtl-composer-controls");
    const actions = createElement("div", "xtl-composer-actions");
    if (state.replyActors.length && !replyThreadOwner) {
      const invitePicker = createActorReplyPicker(state, {
        value: inviteActorKey,
        disabled: busy || !state.permissions.includes("generation"),
        clearable: true,
        onChange: (actorKey) => {
          inviteActorKey = actorKey;
          updateWeaveLabel();
        }
      });
      actions.appendChild(invitePicker);
    }
    const weave = button(replyThreadOwner ? `Weave + @${replyThreadOwner.handle} reply` : inviteActorKey ? "Weave + invite" : "Weave", "xtl-button xtl-button--primary");
    const currentChatToggle = button("Current chat", `xtl-button${includeCurrentChat ? " xtl-button--selected" : ""}`);
    currentChatToggle.setAttribute("aria-pressed", String(includeCurrentChat));
    currentChatToggle.title = "Attach the active chat as context and invite its character to reply";
    currentChatToggle.disabled = busy || !state.permissions.includes("chats") || !state.permissions.includes("chat_mutation");
    currentChatToggle.addEventListener("click", () => {
      includeCurrentChat = !includeCurrentChat;
      render();
      focusComposer();
    });
    let activeMentionQuery = null;
    let mentionMatches = [];
    let activeMentionIndex = 0;
    const selectedMentionActors = () => mentionedActorKeys.map((key) => state.replyActors.find((actor) => actor.key === key)).filter((actor) => Boolean(actor));
    const draftStillMentions = (actor, text) => text.toLocaleLowerCase().includes(`@${actor.handle}`.toLocaleLowerCase());
    const updateWeaveLabel = () => {
      const replyActorKeys = new Set([
        ...replyThreadOwner ? [replyThreadOwner.key] : [],
        ...selectedMentionActors().filter((actor) => draftStillMentions(actor, textarea.value)).map((actor) => actor.key),
        ...inviteActorKey ? [inviteActorKey] : []
      ]);
      const replyCount = state.permissions.includes("generation") ? replyActorKeys.size : 0;
      weave.textContent = replyCount ? `Weave + ${replyCount} ${replyCount === 1 ? "reply" : "replies"}${includeCurrentChat ? " + chat" : ""}` : includeCurrentChat ? "Weave + chat" : "Weave";
    };
    const renderMentionStack = () => {
      const actors = selectedMentionActors().filter((actor) => draftStillMentions(actor, textarea.value));
      mentionStack.replaceChildren();
      mentionStack.hidden = actors.length === 0;
      for (const actor of actors) {
        const chip = button(`@${actor.handle} ×`, "xtl-mention-chip");
        chip.title = `Remove @${actor.handle} mention`;
        chip.addEventListener("click", () => {
          const marker = `@${actor.handle}`;
          const index = textarea.value.toLocaleLowerCase().indexOf(marker.toLocaleLowerCase());
          if (index >= 0) {
            textarea.value = `${textarea.value.slice(0, index)}${textarea.value.slice(index + marker.length)}`.replace(/ {2,}/g, " ");
          }
          mentionedActorKeys = mentionedActorKeys.filter((key) => key !== actor.key);
          syncComposerControls();
          textarea.focus();
        });
        mentionStack.appendChild(chip);
      }
    };
    const insertMention = (actor) => {
      if (!activeMentionQuery)
        return;
      const before = textarea.value.slice(0, activeMentionQuery.start);
      const after = textarea.value.slice(activeMentionQuery.end);
      const spacer = after && /^[\s.,!?;:)]/.test(after) ? "" : " ";
      const next = `${before}@${actor.handle}${spacer}${after}`.slice(0, MAX_WEAVE_LENGTH);
      const cursor = Math.min(next.length, before.length + actor.handle.length + 2);
      textarea.value = next;
      if (!mentionedActorKeys.includes(actor.key))
        mentionedActorKeys = [...mentionedActorKeys, actor.key];
      activeMentionQuery = null;
      mentionMatches = [];
      mentionPopover.hidden = true;
      syncComposerControls();
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    };
    const updateMentionPopover = () => {
      activeMentionQuery = mentionQueryAtCursor(textarea.value, textarea.selectionStart ?? textarea.value.length);
      mentionMatches = activeMentionQuery ? state.replyActors.filter((actor) => !mentionedActorKeys.includes(actor.key) && actorMatchesMention(actor, activeMentionQuery?.query ?? "")).map((actor) => ({ actor, rank: actorSearchRank(actor, activeMentionQuery?.query ?? "") })).sort((left, right) => right.rank - left.rank || left.actor.name.localeCompare(right.actor.name)).slice(0, MAX_MENTION_MATCHES).map(({ actor }) => actor) : [];
      activeMentionIndex = Math.min(activeMentionIndex, Math.max(0, mentionMatches.length - 1));
      mentionPopover.replaceChildren();
      if (!activeMentionQuery || busy) {
        mentionPopover.hidden = true;
        return;
      }
      mentionPopover.hidden = false;
      positionMentionPopover();
      if (!mentionMatches.length) {
        mentionPopover.appendChild(createElement("p", "xtl-mention-empty", "No inviteable actors match."));
        return;
      }
      mentionMatches.forEach((actor, index) => {
        const option = document2.createElement("button");
        option.type = "button";
        option.className = `xtl-mention-option${index === activeMentionIndex ? " xtl-mention-option--active" : ""}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === activeMentionIndex));
        const copy = createElement("div", "xtl-mention-option-copy");
        copy.append(createElement("div", "xtl-mention-option-name", actor.name), createElement("div", "xtl-mention-option-meta", `@${actor.handle} · ${actor.role ?? actor.bio}`));
        option.append(actorAvatar(actor, "small"), copy);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => insertMention(actor));
        mentionPopover.appendChild(option);
      });
    };
    weave.disabled = busy || !draft.trim();
    const syncComposerControls = () => {
      draft = textarea.value.slice(0, MAX_WEAVE_LENGTH);
      mentionedActorKeys = selectedMentionActors().filter((actor) => draftStillMentions(actor, draft)).map((actor) => actor.key);
      const counter = root.querySelector(".xtl-counter");
      if (counter)
        counter.textContent = `${draft.length}/${MAX_WEAVE_LENGTH}`;
      weave.disabled = busy || !draft.trim();
      currentChatToggle.disabled = busy || !state.permissions.includes("chats") || !state.permissions.includes("chat_mutation");
      updateWeaveLabel();
      renderMentionStack();
      updateMentionPopover();
    };
    textarea.addEventListener("input", syncComposerControls);
    textarea.addEventListener("click", updateMentionPopover);
    textarea.addEventListener("focus", updateMentionPopover);
    textarea.addEventListener("keyup", (event) => {
      if (event.key !== "Escape")
        updateMentionPopover();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeMentionQuery) {
        event.preventDefault();
        activeMentionQuery = null;
        mentionMatches = [];
        mentionPopover.hidden = true;
        return;
      }
      if (!activeMentionQuery || !mentionMatches.length)
        return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        activeMentionIndex = (activeMentionIndex + direction + mentionMatches.length) % mentionMatches.length;
        updateMentionPopover();
      } else if (event.key === "Enter") {
        event.preventDefault();
        insertMention(mentionMatches[activeMentionIndex]);
      }
    });
    weave.addEventListener("click", () => {
      const persona2 = selectedPersona();
      const invitedActorKey = inviteActorKey;
      const mentionedKeys = [...mentionedActorKeys];
      const withCurrentChat = includeCurrentChat;
      pendingDraft = {
        text: draft,
        replyToId,
        chatSource,
        inviteActorKey: invitedActorKey,
        mentionedActorKeys: mentionedKeys,
        includeCurrentChat: withCurrentChat
      };
      const payload = {
        type: withCurrentChat ? "weave_current_chat" : "create_weave",
        content: draft,
        personaId: persona2?.sourceId ?? null,
        replyToId,
        inviteActorKey: invitedActorKey,
        mentionedActorKeys: mentionedKeys,
        chatId: chatSource?.chatId
      };
      draft = "";
      replyToId = null;
      chatSource = null;
      mentionedActorKeys = [];
      includeCurrentChat = false;
      busy = true;
      busyActorName = withCurrentChat ? "current chat" : invitedActorKey ? "timeline reply" : null;
      render();
      send(payload);
    });
    controls.append(actions, createElement("span", "xtl-counter", `${draft.length}/${MAX_WEAVE_LENGTH}`), currentChatToggle, weave);
    card.appendChild(controls);
    updateWeaveLabel();
    updateMentionPopover();
    return card;
  };
  const renderPost = (post, depth, state) => {
    const article = createElement("article", `xtl-post${depth ? " xtl-post--reply" : ""}`);
    article.style.setProperty("--xtl-depth", String(depth));
    const header = createElement("div", "xtl-post-header");
    const author = createElement("div", "xtl-post-author");
    const nameRow = createElement("div", "xtl-post-name-row");
    nameRow.append(createElement("span", "xtl-post-name", post.author.name), createElement("span", "xtl-post-handle", `@${post.author.handle}`), createElement("span", "xtl-post-time", `· ${relativeTime(post.createdAt)}`));
    author.appendChild(nameRow);
    const context = replyContext(post, state);
    if (context)
      author.appendChild(createElement("div", "xtl-post-reply-context", context));
    header.append(actorAvatar(post.author), author);
    article.appendChild(header);
    article.appendChild(createElement("div", "xtl-post-body", post.content));
    if (post.gifUrl) {
      const img = document2.createElement("img");
      const hq = Boolean(state.state.settings.highQualityGifs);
      img.src = gifDisplayUrl(post.gifUrl, hq);
      img.className = "xtl-post-gif";
      img.alt = "";
      article.appendChild(img);
    }
    if (post.chatSource) {
      const source = createElement("div", "xtl-post-source", post.chatContext ? `Chat context · ${post.chatContext.messageCount} messages` : "From current chat");
      source.title = `${post.chatSource.chatName}${post.chatSource.characterName ? ` · ${post.chatSource.characterName}` : ""}`;
      article.appendChild(source);
    }
    const actions = createElement("div", "xtl-post-actions");
    const currentPersonaKey = selectedPersona()?.key;
    for (const emoji of REACTION_EMOJIS) {
      const reaction = post.reactions.find((entry) => entry.emoji === emoji);
      const active = Boolean(reaction?.actorKeys.some((actorKey) => actorKey === currentPersonaKey || actorKey === "timeline_user"));
      const react = button(`${emoji}${reaction?.actorKeys.length ? ` ${reaction.actorKeys.length}` : ""}`, `xtl-button xtl-reaction${active ? " xtl-reaction--active" : ""}`);
      const reactingActorKeys = reaction?.actorKeys ?? [];
      if (reactingActorKeys.length) {
        const reactingNames = reactionActorDetails(state, reactingActorKeys).map((actor) => actor.name).join(", ");
        react.setAttribute("aria-label", `${emoji} reaction from ${reactingNames}`);
        react.addEventListener("pointerenter", () => showReactionTooltip(react, emoji, reactingActorKeys, state));
        react.addEventListener("pointerleave", () => disposeReactionTooltip?.());
        react.addEventListener("focus", () => showReactionTooltip(react, emoji, reactingActorKeys, state));
        react.addEventListener("blur", () => disposeReactionTooltip?.());
      }
      react.disabled = busy;
      react.addEventListener("click", () => send({ type: "toggle_reaction", postId: post.id, emoji }));
      actions.appendChild(react);
    }
    const reply = button("Reply", "xtl-button xtl-button--quiet");
    reply.disabled = busy;
    reply.addEventListener("click", () => {
      replyToId = post.id;
      inviteActorKey = actorWhoOwnsThread(post, state)?.key ?? "";
      chatSource = null;
      render();
      focusComposer();
    });
    actions.appendChild(reply);
    if (post.author.kind !== "persona") {
      const directMessage = button("Message", "xtl-button xtl-button--quiet");
      directMessage.title = `Continue privately with ${post.author.name}`;
      directMessage.disabled = dmBusy || !state.permissions.includes("generation");
      directMessage.addEventListener("click", () => openDirectConversation(post.author.key));
      actions.appendChild(directMessage);
    }
    if (state.permissions.includes("generation") && state.replyActors.length) {
      const invite = createActorReplyPicker(state, {
        value: "",
        disabled: busy,
        onChange: (actorKey) => {
          replyToId = post.id;
          inviteActorKey = actorKey;
          chatSource = null;
          render();
          focusComposer();
        }
      });
      actions.appendChild(invite);
    }
    article.appendChild(actions);
    return article;
  };
  const unreadDirectMessages = (thread) => thread.messages.filter((message) => message.direction === "incoming" && message.createdAt > thread.lastReadAt).length;
  const directThreads = (state) => [...state.state.directThreads].sort((left, right) => {
    const leftTime = left.messages[left.messages.length - 1]?.createdAt ?? 0;
    const rightTime = right.messages[right.messages.length - 1]?.createdAt ?? 0;
    return rightTime - leftTime;
  });
  const activeDirectThread = () => snapshot && activeDirectThreadId ? snapshot.state.directThreads.find((thread) => thread.id === activeDirectThreadId) ?? null : null;
  const updateDmBadge = (state) => {
    unreadDirectMessageCount = state.state.directThreads.reduce((total, thread) => total + unreadDirectMessages(thread), 0);
  };
  const renderDmError = () => {
    if (!dmError)
      return null;
    const notice = createElement("div", "xtl-notice xtl-notice--error xtl-dm-thread-notice");
    notice.append(document2.createTextNode(dmError));
    const dismiss = button("Dismiss", "xtl-button xtl-button--quiet");
    dismiss.addEventListener("click", () => {
      dmError = "";
      renderDms();
    });
    notice.appendChild(dismiss);
    return notice;
  };
  function selectDirectThread(threadId) {
    activeDirectThreadId = threadId;
    dmNewThreadOpen = false;
    selectedDirectActorKey = "";
    dmGifPickerOpen = false;
    dmGifSearch = "";
    dmGifQuery = "";
    dmError = "";
    renderDms();
    send({ type: "read_direct_thread", threadId });
  }
  function openDirectConversation(actorKey) {
    const existing = snapshot?.state.directThreads.find((thread) => thread.actor.key === actorKey);
    activeView = "dms";
    if (existing) {
      selectDirectThread(existing.id);
      return;
    }
    dmNewThreadOpen = true;
    selectedDirectActorKey = actorKey;
    pendingDirectActorKey = actorKey;
    dmBusy = true;
    dmBusyActorName = snapshot?.replyActors.find((actor) => actor.key === actorKey)?.name ?? null;
    renderDms();
    send({
      type: "start_direct_thread",
      actorKey,
      personaId: selectedPersona()?.sourceId ?? null
    });
  }
  function composeDirectMessage() {
    activeView = "dms";
    activeDirectThreadId = null;
    dmNewThreadOpen = true;
    selectedDirectActorKey = "";
    dmError = "";
    renderDms();
  }
  const renderDirectInbox = (state) => {
    const inbox = createElement("aside", "xtl-dm-inbox");
    const heading = createElement("div", "xtl-dm-inbox-header");
    heading.appendChild(createElement("h2", "xtl-dm-inbox-title", "Messages"));
    const start = button("✎", "xtl-button xtl-dm-new");
    start.title = "New message";
    start.setAttribute("aria-label", "New message");
    start.disabled = dmBusy || !state.permissions.includes("generation") || state.replyActors.length === 0;
    start.addEventListener("click", composeDirectMessage);
    heading.appendChild(start);
    inbox.appendChild(heading);
    const list = createElement("div", "xtl-dm-list");
    const threads = directThreads(state);
    if (!threads.length) {
      list.appendChild(createElement("p", "xtl-dm-empty-inbox", "No direct messages yet. Start one and the actor will send the opening note here."));
      const start2 = button("New message", "xtl-button xtl-button--primary");
      start2.disabled = dmBusy || !state.permissions.includes("generation") || state.replyActors.length === 0;
      start2.addEventListener("click", composeDirectMessage);
      const action = createElement("div");
      action.style.padding = "0 18px 24px";
      action.appendChild(start2);
      list.appendChild(action);
    }
    for (const thread of threads) {
      const lastMessage = thread.messages[thread.messages.length - 1];
      const unread = unreadDirectMessages(thread);
      const item = document2.createElement("button");
      item.type = "button";
      item.className = `xtl-dm-list-item${thread.id === activeDirectThreadId ? " xtl-dm-list-item--active" : ""}${unread ? " xtl-dm-list-item--unread" : ""}`;
      item.setAttribute("aria-label", `${thread.actor.name} direct-message thread${unread ? `, ${unread} unread` : ""}`);
      const copy = createElement("div", "xtl-dm-list-copy");
      const nameRow = createElement("div", "xtl-dm-list-name-row");
      nameRow.append(createElement("span", "xtl-dm-list-name", thread.actor.name), createElement("span", "xtl-dm-list-handle", `@${thread.actor.handle}`));
      if (lastMessage)
        nameRow.appendChild(createElement("span", "xtl-dm-list-time", relativeTime(lastMessage.createdAt)));
      const preview = lastMessage?.content || (lastMessage?.gifUrl ? "GIF" : "Start a conversation");
      copy.append(nameRow, createElement("div", "xtl-dm-list-preview", `${lastMessage?.direction === "outgoing" ? "You: " : ""}${preview}`));
      item.append(actorAvatar(thread.actor, "small"), copy);
      if (unread)
        item.appendChild(createElement("span", "xtl-dm-unread", unread > 99 ? "99+" : String(unread)));
      item.addEventListener("click", () => selectDirectThread(thread.id));
      list.appendChild(item);
    }
    inbox.appendChild(list);
    return inbox;
  };
  const renderDirectMessage = (message, state, options = {}) => {
    const outgoing = message.direction === "outgoing";
    const row = createElement("div", `xtl-dm-message-row${outgoing ? " xtl-dm-message-row--outgoing" : ""}`);
    const bubble = createElement("div", "xtl-dm-bubble");
    if (message.gifUrl)
      bubble.classList.add("xtl-dm-bubble--media");
    if (message.gifUrl && !message.content)
      bubble.classList.add("xtl-dm-bubble--media-only");
    if (message.content) {
      bubble.appendChild(createElement("div", "xtl-dm-bubble-copy", message.content));
    } else if (options.pendingGifQuery) {
      bubble.appendChild(createElement("div", "xtl-dm-bubble-copy", `GIF: ${options.pendingGifQuery}`));
    }
    if (message.gifUrl) {
      const image = document2.createElement("img");
      image.className = "xtl-dm-gif";
      image.src = gifDisplayUrl(message.gifUrl, Boolean(state.state.settings.highQualityGifs));
      image.alt = message.content ? "" : "GIF attachment";
      const media = createElement("div", "xtl-dm-media");
      media.appendChild(image);
      bubble.appendChild(media);
    }
    const time = createElement("div", "xtl-dm-time", relativeTime(message.createdAt));
    const stack = createElement("div");
    stack.append(bubble, time);
    if (!outgoing)
      row.append(actorAvatar(message.author, "small"), stack);
    else
      row.append(stack);
    return row;
  };
  const renderDirectComposer = (thread, state) => {
    const composer = createElement("div", "xtl-dm-composer");
    const row = createElement("div", "xtl-dm-compose-row");
    const gifToggle = button("GIF", `xtl-button xtl-dm-gif-toggle${dmGifPickerOpen || dmGifQuery ? " xtl-button--selected" : ""}`);
    gifToggle.title = "Attach a GIF";
    gifToggle.disabled = dmBusy;
    gifToggle.addEventListener("click", () => {
      dmGifPickerOpen = !dmGifPickerOpen;
      renderDms();
    });
    const textarea = document2.createElement("textarea");
    textarea.className = "xtl-textarea";
    textarea.rows = 1;
    textarea.maxLength = MAX_DIRECT_MESSAGE_LENGTH;
    textarea.placeholder = `Message ${thread.actor.name}`;
    textarea.value = dmDraft;
    textarea.disabled = dmBusy;
    textarea.addEventListener("focus", positionDmComposerForKeyboard);
    textarea.addEventListener("input", () => {
      dmDraft = limitCharacters(textarea.value, MAX_DIRECT_MESSAGE_LENGTH);
      if (textarea.value !== dmDraft)
        textarea.value = dmDraft;
      sendButton.disabled = dmBusy || !dmDraft.trim() && !dmGifQuery;
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !sendButton.disabled) {
        event.preventDefault();
        sendButton.click();
      }
    });
    const sendButton = button("Send", "xtl-button xtl-button--primary xtl-dm-send");
    sendButton.disabled = dmBusy || !dmDraft.trim() && !dmGifQuery;
    sendButton.addEventListener("click", () => {
      const content = dmDraft.trim();
      const gifQuery = dmGifQuery.trim();
      const author = selectedPersona() ?? thread.messages.find((message) => message.direction === "outgoing")?.author ?? {
        key: "persona:timeline_user",
        kind: "persona",
        sourceId: "",
        name: "You",
        handle: "you",
        avatarUrl: null,
        bio: "Timeline persona",
        profile: "The person writing on this private timeline."
      };
      pendingDirectMessage = {
        threadId: thread.id,
        content,
        gifQuery,
        optimisticMessage: {
          id: `optimistic:${crypto.randomUUID()}`,
          author,
          direction: "outgoing",
          content,
          createdAt: Date.now()
        }
      };
      dmDraft = "";
      dmGifQuery = "";
      dmGifSearch = "";
      dmGifPickerOpen = false;
      dmBusy = true;
      dmBusyActorName = thread.actor.name;
      renderDms();
      send({
        type: "send_direct_message",
        threadId: thread.id,
        content,
        gifQuery,
        personaId: selectedPersona()?.sourceId ?? null
      });
    });
    row.append(gifToggle, textarea, sendButton);
    composer.appendChild(row);
    if (dmGifQuery) {
      const attached = createElement("div", "xtl-dm-gif-chip");
      const remove = button(`GIF: ${dmGifQuery} ×`, "xtl-button xtl-button--quiet");
      remove.title = "Remove GIF attachment";
      remove.addEventListener("click", () => {
        dmGifQuery = "";
        renderDms();
      });
      attached.appendChild(remove);
      composer.appendChild(attached);
    } else if (dmGifPickerOpen) {
      const picker = createElement("div", "xtl-dm-gif-search");
      const input = document2.createElement("input");
      input.placeholder = "Search GIFs on Tenor";
      input.value = dmGifSearch;
      input.maxLength = 120;
      input.disabled = dmBusy;
      const attach = button("Attach");
      attach.disabled = dmBusy || !dmGifSearch.trim();
      const commit = () => {
        const query = input.value.replace(/\s+/g, " ").trim().slice(0, 120);
        if (!query)
          return;
        dmGifQuery = query;
        dmGifSearch = "";
        dmGifPickerOpen = false;
        renderDms();
      };
      input.addEventListener("input", () => {
        dmGifSearch = input.value.slice(0, 120);
        attach.disabled = dmBusy || !dmGifSearch.trim();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      });
      attach.addEventListener("click", commit);
      picker.append(input, attach);
      composer.appendChild(picker);
    }
    return composer;
  };
  const renderDirectThread = (thread, state) => {
    const main = createElement("section", "xtl-dm-main");
    const header = createElement("div", "xtl-dm-thread-header");
    const back = button("‹", "xtl-button xtl-button--quiet");
    back.title = "Back to messages";
    back.setAttribute("aria-label", "Back to messages");
    back.addEventListener("click", () => {
      activeDirectThreadId = null;
      dmNewThreadOpen = false;
      renderDms();
    });
    const title = createElement("div", "xtl-dm-thread-title");
    title.append(createElement("div", "xtl-dm-thread-name", thread.actor.name), createElement("div", "xtl-dm-thread-meta", `@${thread.actor.handle} · private conversation`));
    header.append(back, actorAvatar(thread.actor, "small"), title);
    main.appendChild(header);
    const errorNotice = renderDmError();
    if (errorNotice)
      main.appendChild(errorNotice);
    if (dmBusy)
      main.appendChild(createElement("div", "xtl-notice xtl-dm-thread-notice", `${dmBusyActorName ?? thread.actor.name} is replying…`));
    const scroll = createElement("div", "xtl-dm-thread-scroll");
    const optimisticMessage = pendingDirectMessage?.threadId === thread.id ? pendingDirectMessage : null;
    const messages = [...thread.messages];
    if (optimisticMessage && !messages.some((message) => message.direction === "outgoing" && message.content === optimisticMessage.content)) {
      messages.push(optimisticMessage.optimisticMessage);
    }
    if (!messages.length)
      scroll.appendChild(createElement("p", "xtl-dm-empty-inbox", "This conversation has no messages yet."));
    for (const message of messages) {
      scroll.appendChild(renderDirectMessage(message, state, message.id === optimisticMessage?.optimisticMessage.id ? { pendingGifQuery: optimisticMessage.gifQuery } : {}));
    }
    main.appendChild(scroll);
    main.appendChild(renderDirectComposer(thread, state));
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
    });
    return main;
  };
  const renderDirectWelcome = (state) => {
    const main = createElement("section", "xtl-dm-main");
    const header = createElement("div", "xtl-dm-thread-header");
    const back = button("‹", "xtl-button xtl-button--quiet");
    back.title = "Back to messages";
    back.setAttribute("aria-label", "Back to messages");
    back.addEventListener("click", () => {
      activeDirectThreadId = null;
      dmNewThreadOpen = false;
      selectedDirectActorKey = "";
      renderDms();
    });
    header.append(back, createElement("div", "xtl-dm-thread-name", "New message"));
    main.appendChild(header);
    const welcome = createElement("div", "xtl-dm-welcome");
    const newThread = createElement("div", "xtl-dm-new-thread");
    const copy = createElement("div", "xtl-dm-welcome-copy");
    copy.append(createElement("div", "xtl-header-mark", "✉"), createElement("h3", undefined, selectedDirectActorKey ? "Start a private conversation" : "Your messages"), createElement("p", undefined, selectedDirectActorKey ? "The actor will send the first DM, then this private thread stays out of the timeline." : "Choose a conversation from your inbox, or start a new private thread with an actor."));
    newThread.append(copy);
    if (dmError) {
      const errorNotice = renderDmError();
      if (errorNotice)
        newThread.appendChild(errorNotice);
    }
    if (state.replyActors.length) {
      newThread.appendChild(createElement("label", "xtl-dm-new-thread-label", "Message an actor"));
      newThread.appendChild(createActorReplyPicker(state, {
        value: selectedDirectActorKey,
        disabled: dmBusy || !state.permissions.includes("generation"),
        clearable: true,
        onChange: (actorKey) => {
          selectedDirectActorKey = actorKey;
          dmError = "";
          renderDms();
        }
      }));
      const start = button("Start DM", "xtl-button xtl-button--primary");
      start.disabled = dmBusy || !selectedDirectActorKey || !state.permissions.includes("generation");
      start.addEventListener("click", () => openDirectConversation(selectedDirectActorKey));
      newThread.appendChild(start);
    } else {
      newThread.appendChild(createElement("p", "xtl-dm-empty-inbox", "No messageable actors are available yet."));
    }
    if (dmBusy)
      newThread.appendChild(createElement("div", "xtl-notice", `${dmBusyActorName ?? "Actor"} is writing a direct message…`));
    welcome.appendChild(newThread);
    main.appendChild(welcome);
    return main;
  };
  const renderDmsContent = () => {
    if (!snapshot)
      return createElement("div", "xtl-loading", "Loading your messages…");
    const activeThread = activeDirectThread();
    const shell = createElement("div", "xtl-card xtl-dm-shell");
    if (activeThread) {
      shell.appendChild(renderDirectThread(activeThread, snapshot));
    } else if (dmNewThreadOpen) {
      shell.appendChild(renderDirectWelcome(snapshot));
    } else {
      shell.appendChild(renderDirectInbox(snapshot));
    }
    return shell;
  };
  const renderDms = () => {
    if (activeView === "dms")
      render();
  };
  const renderTimeline = (state) => {
    const feed = createElement("section", "xtl-card");
    timelineTopMarker = createElement("div", "xtl-feed-top");
    feed.appendChild(timelineTopMarker);
    if (timelineIsPastTop && newActorWeaveCount) {
      const wrap = createElement("div", "xtl-new-weaves-wrap");
      newWeavePill = button("", "xtl-button xtl-new-weaves");
      newWeavePill.addEventListener("click", scrollToTimelineTop);
      wrap.appendChild(newWeavePill);
      feed.appendChild(wrap);
      updateNewWeavePill();
    }
    const toolbar = createElement("div", "xtl-feed-toolbar");
    const sortLabel = createElement("label", "xtl-feed-sort-label", "Sort timeline");
    const sort = document2.createElement("select");
    sort.className = "xtl-select";
    sort.setAttribute("aria-label", "Timeline sort order");
    sort.id = "xtl-feed-sort";
    sortLabel.htmlFor = sort.id;
    const newest = document2.createElement("option");
    newest.value = "newest";
    newest.textContent = "Newest weaves";
    const activity = document2.createElement("option");
    activity.value = "activity";
    activity.textContent = "Recent activity";
    sort.append(newest, activity);
    sort.value = state.state.settings.feedSort;
    sort.disabled = busy;
    sort.addEventListener("change", () => send({ type: "update_settings", feedSort: sort.value }));
    toolbar.append(sortLabel, sort);
    feed.appendChild(toolbar);
    const posts = orderedPosts(state.state.posts, state.state.settings.feedSort);
    if (!posts.length) {
      feed.appendChild(createElement("div", "xtl-empty", "No weaves yet. Start the feed with a thought from your selected persona, or let a Lumia, Council member, or character card post first."));
      return feed;
    }
    for (const { post, depth } of posts)
      feed.appendChild(renderPost(post, depth, state));
    return feed;
  };
  const renderRoster = (state) => {
    const card = createElement("section", "xtl-card xtl-roster");
    timelineManagementMarker = createElement("div", "xtl-management-anchor");
    card.appendChild(timelineManagementMarker);
    const header = createElement("div", "xtl-roster-header");
    const rosterActors = state.state.rosterActorKeys.map((key) => state.replyActors.find((actor) => actor.key === key)).filter((actor) => Boolean(actor));
    const rosterCount = createElement("span", "xtl-chip", `${rosterActors.length} following`);
    const followActors = button("Follow actors");
    followActors.disabled = busy || state.replyActors.length === 0;
    followActors.addEventListener("click", openFollowModal);
    header.append(createElement("h3", "xtl-section-title", "Actor roster"), rosterCount, followActors);
    card.appendChild(header);
    const interval = `${state.state.settings.minActorWeaveIntervalMinutes}–${state.state.settings.maxActorWeaveIntervalMinutes} min`;
    card.appendChild(createElement("p", "xtl-roster-copy", rosterActors.length ? `Followed actors take turns from a randomized rotation every ${interval}; they may weave, reply, or react. The next turn is ${timeUntil(state.state.nextRosterWeaveAt)}.` : `Follow actors to add them to the randomized timeline rotation every ${interval}.`));
    const rosterList = createElement("div", "xtl-roster-list");
    if (rosterActors.length) {
      for (const actor of rosterActors) {
        const item = createElement("div", "xtl-actor-card xtl-roster-actor-card");
        const details = createElement("div", "xtl-actor-card-info");
        details.append(createElement("div", "xtl-actor-card-name", actor.name), createElement("div", "xtl-actor-card-meta", `@${actor.handle} · ${actor.role ?? actor.bio}`));
        const actions = createElement("div", "xtl-actor-card-actions");
        const weaveNow = button("Weave now", "xtl-button");
        weaveNow.disabled = busy || !state.permissions.includes("generation");
        weaveNow.addEventListener("click", () => {
          busy = true;
          busyActorName = actor.name;
          render();
          send({ type: "create_actor_weave", actorKey: actor.key });
        });
        const dmNow = button("DM now", "xtl-button");
        dmNow.title = `Have ${actor.name} send you a private direct message`;
        dmNow.disabled = dmBusy || !state.permissions.includes("generation");
        dmNow.addEventListener("click", () => openDirectConversation(actor.key));
        const unfollow = button("Unfollow", "xtl-button xtl-button--quiet");
        unfollow.disabled = busy;
        unfollow.addEventListener("click", () => send({ type: "toggle_roster_actor", actorKey: actor.key }));
        actions.append(weaveNow, dmNow, unfollow);
        item.append(actorAvatar(actor, "small"), details, actions);
        rosterList.appendChild(item);
      }
    } else {
      rosterList.appendChild(createElement("p", "xtl-roster-empty", "You are not following anyone on the scheduled timeline yet."));
    }
    card.appendChild(rosterList);
    if (!state.replyActors.length) {
      card.appendChild(createElement("p", "xtl-roster-access", !state.permissions.includes("characters") ? "Character-card access is not enabled for Timeline. Grant the Characters permission in Extensions, then refresh." : "No character cards, Lumia DLC items, or active Council members are available for this account yet. Add one, then refresh this timeline."));
    } else if (!state.permissions.includes("characters")) {
      card.appendChild(createElement("p", "xtl-roster-access", "Character-card access is not enabled, so the follow list omits character cards."));
    }
    return card;
  };
  let settingsExpanded = false;
  const renderSettings = (state) => {
    const card = createElement("section", "xtl-card xtl-settings");
    const details = document2.createElement("details");
    details.open = settingsExpanded;
    details.addEventListener("toggle", () => {
      settingsExpanded = details.open;
    });
    const summary = createElement("summary", undefined, "Timeline settings");
    details.appendChild(summary);
    const copy = createElement("p", "xtl-settings-copy", "Choose a fast connection for background actor weaves. Your saved Timeline choice is used only by this extension.");
    details.appendChild(copy);
    const row = createElement("div", "xtl-settings-row");
    const labels = createElement("div");
    labels.append(createElement("div", "xtl-settings-label", "Timeline sidecar"), createElement("div", "xtl-settings-hint", "Used only for actor weaves, replies, and optional chat summaries."));
    const connectionSelect = document2.createElement("select");
    connectionSelect.className = "xtl-select";
    connectionSelect.setAttribute("aria-label", "Timeline sidecar connection");
    const unset = document2.createElement("option");
    unset.value = "";
    unset.textContent = "Choose connection…";
    connectionSelect.appendChild(unset);
    for (const connection of state.connections) {
      const option = document2.createElement("option");
      option.value = connection.id;
      option.textContent = `${connection.name} · ${connection.model || connection.provider}${connection.hasApiKey ? "" : " (no key)"}`;
      option.disabled = !connection.hasApiKey;
      connectionSelect.appendChild(option);
    }
    connectionSelect.value = state.state.settings.sidecarConnectionId ?? "";
    connectionSelect.disabled = !state.permissions.includes("generation");
    connectionSelect.addEventListener("change", () => send({ type: "update_settings", sidecarConnectionId: connectionSelect.value || null }));
    row.append(labels, connectionSelect);
    details.appendChild(row);
    const intervalRow = createElement("div", "xtl-settings-row");
    const intervalLabels = createElement("div");
    intervalLabels.append(createElement("div", "xtl-settings-label", "Roster cadence"), createElement("div", "xtl-settings-hint", "The backend chooses one followed actor at random after a delay within this range."));
    const intervalInputs = createElement("div", "xtl-interval-inputs");
    const minimum = document2.createElement("input");
    minimum.type = "number";
    minimum.className = "xtl-number-input";
    minimum.min = "1";
    minimum.max = "1440";
    minimum.step = "1";
    minimum.value = String(state.state.settings.minActorWeaveIntervalMinutes);
    minimum.setAttribute("aria-label", "Minimum roster weave interval in minutes");
    const maximum = document2.createElement("input");
    maximum.type = "number";
    maximum.className = "xtl-number-input";
    maximum.min = "1";
    maximum.max = "1440";
    maximum.step = "1";
    maximum.value = String(state.state.settings.maxActorWeaveIntervalMinutes);
    maximum.setAttribute("aria-label", "Maximum roster weave interval in minutes");
    const saveIntervals = (changed) => {
      const minValue = Math.max(1, Math.min(1440, Math.round(Number(minimum.value) || 1)));
      const maxValue = Math.max(1, Math.min(1440, Math.round(Number(maximum.value) || 1)));
      if (changed === "minimum" && minValue > maxValue)
        maximum.value = String(minValue);
      if (changed === "maximum" && maxValue < minValue)
        minimum.value = String(maxValue);
      send({
        type: "update_settings",
        minActorWeaveIntervalMinutes: Number(minimum.value),
        maxActorWeaveIntervalMinutes: Number(maximum.value)
      });
    };
    minimum.addEventListener("change", () => saveIntervals("minimum"));
    maximum.addEventListener("change", () => saveIntervals("maximum"));
    intervalInputs.append(minimum, document2.createTextNode("to"), maximum, document2.createTextNode("min"));
    intervalRow.append(intervalLabels, intervalInputs);
    details.appendChild(intervalRow);
    const gifChanceRow = createElement("div", "xtl-settings-row");
    const gifChanceLabels = createElement("div");
    gifChanceLabels.append(createElement("div", "xtl-settings-label", "GIF Attachment Chance"), createElement("div", "xtl-settings-hint", "How often models attach a GIF to their weaves."));
    const gifChanceInputWrap = createElement("div", "xtl-interval-inputs");
    const gifChanceInput = createElement("input", "xtl-number-input");
    gifChanceInput.type = "number";
    gifChanceInput.min = "0";
    gifChanceInput.max = "100";
    gifChanceInput.value = String(state.state.settings.gifChance ?? 35);
    gifChanceInput.disabled = busy;
    gifChanceInput.addEventListener("change", () => {
      const val = Math.max(0, Math.min(100, Math.round(Number(gifChanceInput.value) || 0)));
      gifChanceInput.value = String(val);
      send({
        type: "update_settings",
        gifChance: val
      });
    });
    gifChanceInputWrap.append(gifChanceInput, document2.createTextNode("%"));
    gifChanceRow.append(gifChanceLabels, gifChanceInputWrap);
    details.appendChild(gifChanceRow);
    const hqGifRow = createElement("div", "xtl-settings-row");
    const hqGifLabels = createElement("div");
    hqGifLabels.append(createElement("div", "xtl-settings-label", "High Quality GIFs"), createElement("div", "xtl-settings-hint", "Download uncompressed media. Uses more data and slows down loading, but removes blurriness."));
    const hqGifInput = document2.createElement("input");
    hqGifInput.type = "checkbox";
    hqGifInput.checked = Boolean(state.state.settings.highQualityGifs);
    hqGifInput.disabled = busy;
    hqGifInput.addEventListener("change", () => {
      send({
        type: "update_settings",
        highQualityGifs: hqGifInput.checked
      });
    });
    hqGifRow.append(hqGifLabels, hqGifInput);
    details.appendChild(hqGifRow);
    const nsfwRow = createElement("div", "xtl-settings-row");
    const nsfwLabels = createElement("div");
    nsfwLabels.append(createElement("div", "xtl-settings-label", "Encourage NSFW Engagement"), createElement("div", "xtl-settings-hint", "Encourage the timeline actors to use NSFW, provocative, or explicit language and topics when fitting their character."));
    const nsfwInput = document2.createElement("input");
    nsfwInput.type = "checkbox";
    nsfwInput.checked = Boolean(state.state.settings.encourageNsfw);
    nsfwInput.disabled = busy;
    nsfwInput.addEventListener("change", () => {
      send({
        type: "update_settings",
        encourageNsfw: nsfwInput.checked
      });
    });
    nsfwRow.append(nsfwLabels, nsfwInput);
    details.appendChild(nsfwRow);
    const chatContextRow = createElement("div", "xtl-settings-row");
    const chatContextLabels = createElement("div");
    chatContextLabels.append(createElement("div", "xtl-settings-label", "Chat reply context"), createElement("div", "xtl-settings-hint", "Each chat weave saves a private snapshot for the active character to discuss or gossip about. The inserted message uses the same message count."));
    const chatContextControls = createElement("div", "xtl-interval-inputs");
    const includeChatContext = document2.createElement("input");
    includeChatContext.type = "checkbox";
    includeChatContext.checked = state.state.settings.includeChatContext;
    includeChatContext.disabled = busy;
    includeChatContext.setAttribute("aria-label", "Include chat context in actor replies");
    const chatContextCount = document2.createElement("input");
    chatContextCount.type = "number";
    chatContextCount.className = "xtl-number-input";
    chatContextCount.min = "1";
    chatContextCount.max = "30";
    chatContextCount.step = "1";
    chatContextCount.value = String(state.state.settings.chatContextMessageCount);
    chatContextCount.disabled = busy || !includeChatContext.checked;
    chatContextCount.setAttribute("aria-label", "Number of recent chat messages for actor replies");
    includeChatContext.addEventListener("change", () => {
      chatContextCount.disabled = busy || !includeChatContext.checked;
      send({ type: "update_settings", includeChatContext: includeChatContext.checked });
    });
    chatContextCount.addEventListener("change", () => {
      const count = Math.max(1, Math.min(30, Math.round(Number(chatContextCount.value) || 1)));
      chatContextCount.value = String(count);
      send({ type: "update_settings", chatContextMessageCount: count });
    });
    chatContextControls.append(includeChatContext, chatContextCount, document2.createTextNode("recent messages"));
    chatContextRow.append(chatContextLabels, chatContextControls);
    details.appendChild(chatContextRow);
    const maxTokensRow = createElement("div", "xtl-settings-row");
    const maxTokensLabels = createElement("div");
    maxTokensLabels.append(createElement("div", "xtl-settings-label", "Maximum generation tokens"), createElement("div", "xtl-settings-hint", "Caps each actor generation, including weaves, replies, and engagement selection. Higher values can use more of your model quota."));
    const maxTokensControls = createElement("div", "xtl-interval-inputs");
    const maxTokens = document2.createElement("input");
    maxTokens.type = "number";
    maxTokens.className = "xtl-number-input";
    maxTokens.min = String(MIN_GENERATION_MAX_TOKENS);
    maxTokens.max = String(MAX_GENERATION_MAX_TOKENS);
    maxTokens.step = "1";
    maxTokens.value = String(state.state.settings.maxTokens ?? DEFAULT_GENERATION_MAX_TOKENS);
    maxTokens.disabled = busy;
    maxTokens.setAttribute("aria-label", "Maximum generation tokens");
    maxTokens.addEventListener("change", () => {
      const value = Math.max(MIN_GENERATION_MAX_TOKENS, Math.min(MAX_GENERATION_MAX_TOKENS, Math.round(Number(maxTokens.value) || DEFAULT_GENERATION_MAX_TOKENS)));
      maxTokens.value = String(value);
      send({ type: "update_settings", maxTokens: value });
    });
    maxTokensControls.append(maxTokens, document2.createTextNode("tokens"));
    maxTokensRow.append(maxTokensLabels, maxTokensControls);
    details.appendChild(maxTokensRow);
    const addSliderRow = (label, hint, min, max, step, value, key) => {
      const row2 = createElement("div", "xtl-settings-row");
      const labels2 = createElement("div");
      labels2.append(createElement("div", "xtl-settings-label", label), createElement("div", "xtl-settings-hint", hint));
      const sliderContainer = createElement("div");
      sliderContainer.style.flex = "1";
      sliderContainer.style.minWidth = "200px";
      sliderContainer.style.marginLeft = "16px";
      row2.append(labels2, sliderContainer);
      details.appendChild(row2);
      const handle = ctx.components.mountRangeSlider(sliderContainer, {
        min,
        max,
        step,
        value,
        disabled: busy,
        label,
        format: { decimals: 2 },
        onCommit: (val) => send({ type: "update_settings", [key]: val })
      });
      sliderHandles.push(handle);
    };
    addSliderRow("Temperature", "Controls randomness: Lowering results in less random completions.", 0, 2, 0.05, state.state.settings.temperature ?? 0.85, "temperature");
    addSliderRow("Top P", "Controls diversity via nucleus sampling: 0.5 means half of all likelihood-weighted options are considered.", 0, 1, 0.01, state.state.settings.topP ?? 1, "topP");
    addSliderRow("Presence Penalty", "How much to penalize new tokens based on whether they appear in the text so far.", 0, 2, 0.05, state.state.settings.presencePenalty ?? 0, "presencePenalty");
    addSliderRow("Frequency Penalty", "How much to penalize new tokens based on their existing frequency in the text so far.", 0, 2, 0.05, state.state.settings.frequencyPenalty ?? 0, "frequencyPenalty");
    const resetRow = createElement("div", "xtl-settings-row");
    const resetLabels = createElement("div");
    resetLabels.append(createElement("div", "xtl-settings-label", "Reset timeline"), createElement("div", "xtl-settings-hint", "Deletes public weaves, reactions, and timeline reply threads. Direct messages, followed actors, their schedule, and saved settings stay in place."));
    const reset = button("Reset timeline", "xtl-button xtl-button--danger");
    reset.disabled = busy;
    reset.addEventListener("click", () => {
      const confirmed = tab.root.ownerDocument.defaultView?.confirm("Reset this timeline? All public weaves, reactions, and timeline reply threads will be deleted. Direct messages, followed actors, and settings will stay in place.");
      if (!confirmed)
        return;
      draft = "";
      replyToId = null;
      inviteActorKey = "";
      mentionedActorKeys = [];
      chatSource = null;
      includeCurrentChat = false;
      pendingDraft = null;
      send({ type: "reset_timeline" });
    });
    resetRow.append(resetLabels, reset);
    details.appendChild(resetRow);
    if (!state.permissions.includes("generation")) {
      details.appendChild(createElement("div", "xtl-notice", "Generation permission is not currently granted, so actor-authored weaves and replies are unavailable."));
    } else if (!state.connections.length) {
      const notice = createElement("div", "xtl-notice");
      notice.append(document2.createTextNode("No LLM connections are available for this account. Add one in Connections, then return here and refresh. "));
      const manageConnections = button("Open Connections", "xtl-button");
      manageConnections.addEventListener("click", () => send({ type: "open_connections" }));
      notice.appendChild(manageConnections);
      details.appendChild(notice);
    } else if (!state.state.settings.sidecarConnectionId) {
      details.appendChild(createElement("div", "xtl-notice", "Select a Timeline sidecar before inviting actor replies or starting the roster. You can still write your own weaves."));
    }
    card.appendChild(details);
    return card;
  };
  const render = () => {
    disposeMentionPortal?.();
    disposeMentionPortal = null;
    disposeActorPickerPortal?.();
    disposeActorPickerPortal = null;
    disposeReactionTooltip?.();
    disposeReactionTooltip = null;
    timelineTopMarker = null;
    timelineManagementMarker = null;
    newWeavePill = null;
    personaPicker?.destroy();
    personaPicker = null;
    sliderHandles.forEach((h) => h.destroy());
    sliderHandles = [];
    const messagesView = activeView === "dms";
    tab.root.classList.toggle("xtl-tab--dms", messagesView);
    root.classList.toggle("xtl-app--dms", messagesView);
    root.replaceChildren(renderHeader());
    if (!snapshot) {
      root.appendChild(createElement("div", "xtl-loading", activeView === "dms" ? "Loading your messages…" : "Loading your timeline…"));
      return;
    }
    if (activeView === "dms") {
      const stage = createElement("div", "xtl-dm-stage");
      stage.appendChild(renderDmsContent());
      root.appendChild(stage);
      return;
    }
    const renderedError = renderError();
    if (renderedError)
      root.appendChild(renderedError);
    if (busy) {
      root.appendChild(createElement("div", "xtl-notice", busyActorName ? `${busyActorName} is weaving…` : "Updating the timeline…"));
    }
    root.append(renderComposer(snapshot), renderTimeline(snapshot), renderRoster(snapshot), renderSettings(snapshot));
    updateTimelineScrollState();
  };
  const unsubscribeMessages = ctx.onBackendMessage((payload) => {
    const message = asMessage(payload);
    if (!message)
      return;
    if (message.type === "timeline_state" && isSnapshot(message.snapshot)) {
      updateTimelineScrollState();
      trackNewActorWeaves(message.snapshot);
      snapshot = message.snapshot;
      updateDmBadge(snapshot);
      if (pendingDraft)
        pendingDraft = null;
      if (pendingDirectMessage) {
        const sent = snapshot.state.directThreads.find((thread) => thread.id === pendingDirectMessage?.threadId)?.messages.some((directMessage) => directMessage.direction === "outgoing" && directMessage.content === pendingDirectMessage?.content);
        if (sent)
          pendingDirectMessage = null;
      }
      if (pendingDirectActorKey) {
        const createdThread = snapshot.state.directThreads.find((thread) => thread.actor.key === pendingDirectActorKey);
        if (createdThread) {
          activeDirectThreadId = createdThread.id;
          selectedDirectActorKey = "";
          pendingDirectActorKey = null;
          send({ type: "read_direct_thread", threadId: createdThread.id });
        }
      }
      if (activeDirectThreadId && !snapshot.state.directThreads.some((thread) => thread.id === activeDirectThreadId)) {
        activeDirectThreadId = null;
      }
      if (inviteActorKey && !snapshot.replyActors.some((actor) => actor.key === inviteActorKey))
        inviteActorKey = "";
      render();
      const openThread = activeDirectThread();
      if (activeView === "dms" && openThread && unreadDirectMessages(openThread)) {
        send({ type: "read_direct_thread", threadId: openThread.id });
      }
      renderFollowModal();
      return;
    }
    if (message.type === "timeline_error") {
      if (message.scope === "dm") {
        dmError = message.message ?? "Direct-message request failed.";
        if (pendingDirectMessage) {
          dmDraft = pendingDirectMessage.content;
          dmGifQuery = pendingDirectMessage.gifQuery;
          activeDirectThreadId = pendingDirectMessage.threadId;
          pendingDirectMessage = null;
        }
        pendingDirectActorKey = null;
        dmBusy = false;
        dmBusyActorName = null;
        renderDms();
        return;
      }
      error = message.message ?? "Timeline request failed.";
      if (pendingDraft) {
        if (!draft)
          draft = pendingDraft.text;
        replyToId = pendingDraft.replyToId;
        chatSource = pendingDraft.chatSource;
        inviteActorKey = pendingDraft.inviteActorKey;
        mentionedActorKeys = pendingDraft.mentionedActorKeys;
        includeCurrentChat = pendingDraft.includeCurrentChat;
        pendingDraft = null;
      }
      busy = false;
      busyActorName = null;
      render();
      renderFollowModal();
      return;
    }
    if (message.type === "timeline_activity") {
      if (message.scope === "dm") {
        dmBusy = Boolean(message.active);
        dmBusyActorName = message.actorName ?? null;
        renderDms();
        return;
      }
      busy = Boolean(message.active);
      busyActorName = message.actorName ?? null;
      render();
      renderFollowModal();
      return;
    }
  });
  const inputAction = ctx.ui.registerInputBarAction({
    id: "weave-current-chat",
    label: "Weave current chat",
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  });
  const unsubscribeInputAction = inputAction.onClick(() => {
    includeCurrentChat = true;
    tab.activate();
    render();
    focusComposer();
  });
  const unsubscribeActivate = tab.onActivate(() => send({ type: "load_timeline" }));
  const document2 = tab.root.ownerDocument;
  const onScroll = (event) => {
    const target = event.target;
    if (target === document2 || target === document2.documentElement || target === document2.body || target === tab.root || target instanceof Node && target.contains(root))
      updateTimelineScrollState();
  };
  document2.addEventListener("scroll", onScroll, { capture: true, passive: true });
  applyKeyboardPresentation(ctx.ui.events.getKeyboardState());
  const unsubscribeKeyboardPresentation = ctx.ui.events.onKeyboardChange(applyKeyboardPresentation);
  render();
  send({ type: "load_timeline" });
  readyGate.release();
  return () => {
    readyGate.dispose();
    disposeMentionPortal?.();
    disposeMentionPortal = null;
    disposeActorPickerPortal?.();
    disposeActorPickerPortal = null;
    disposeReactionTooltip?.();
    disposeReactionTooltip = null;
    followModal?.dismiss();
    followModal = null;
    document2.removeEventListener("scroll", onScroll, true);
    unsubscribeKeyboardPresentation();
    personaPicker?.destroy();
    personaPicker = null;
    sliderHandles.forEach((h) => h.destroy());
    sliderHandles = [];
    unsubscribeMessages();
    unsubscribeInputAction();
    unsubscribeActivate();
    inputAction.destroy();
    tab.root.classList.remove("xtl-tab--dms");
    tab.destroy();
    removeStyle();
    root.replaceChildren();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
