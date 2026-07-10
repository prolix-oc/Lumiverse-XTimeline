// src/shared.ts
var MAX_WEAVE_LENGTH = 500;
var REACTION_EMOJIS = ["❤", "✨", "\uD83D\uDD25", "\uD83D\uDE02"];

// src/frontend.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSnapshot(value) {
  return isRecord(value) && isRecord(value.state) && Array.isArray(value.state.posts) && Array.isArray(value.personas) && Array.isArray(value.replyActors) && Array.isArray(value.connections);
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
function orderedPosts(posts) {
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
  roots.sort((left, right) => right.createdAt - left.createdAt);
  for (const replies of byParent.values())
    replies.sort((left, right) => left.createdAt - right.createdAt);
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
function setup(ctx) {
  ctx.deferReady();
  let snapshot = null;
  let draft = "";
  let replyToId = null;
  let inviteActorKey = "";
  let chatSource = null;
  let busy = false;
  let busyActorName = null;
  let error = "";
  let pendingDraft = null;
  const tab = ctx.ui.registerDrawerTab({
    id: "timeline",
    title: "Lumiverse Timeline",
    shortName: "Weave",
    headerTitle: "Timeline",
    description: "A private social timeline for your personas, Council, and character cards",
    keywords: ["timeline", "weave", "tweet", "social", "council", "character"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4.01c-.7.35-1.46.58-2.25.69.81-.49 1.43-1.26 1.72-2.18-.76.45-1.6.78-2.5.96A3.9 3.9 0 0 0 12.22 6c0 .31.03.61.1.9A11.08 11.08 0 0 1 3.2 2.3a3.9 3.9 0 0 0 1.21 5.2 3.9 3.9 0 0 1-1.77-.49v.05c0 1.89 1.34 3.46 3.13 3.82a3.84 3.84 0 0 1-1.76.07 3.9 3.9 0 0 0 3.65 2.7A7.83 7.83 0 0 1 2.8 15.3c-.32 0-.63-.02-.94-.05a11.04 11.04 0 0 0 5.97 1.75c7.17 0 11.09-5.94 11.09-11.09 0-.17 0-.34-.01-.5A7.9 7.9 0 0 0 22 4.01Z"/></svg>'
  });
  const root = createElement("div", "xtl-app");
  tab.root.replaceChildren(root);
  const removeStyle = ctx.dom.addStyle(`
    .xtl-app { color: var(--lumiverse-text, #e9edf4); min-height: 100%; padding: 12px; box-sizing: border-box; }
    .xtl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .xtl-title { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .xtl-subtitle { margin: 3px 0 0; color: var(--lumiverse-text-muted, #98a2b3); font-size: 12px; line-height: 1.4; }
    .xtl-card { background: color-mix(in srgb, var(--lumiverse-fill-subtle, #18202b) 86%, transparent); border: 1px solid var(--lumiverse-border, #334155); border-radius: var(--lumiverse-radius, 12px); margin: 10px 0; overflow: hidden; }
    .xtl-composer { padding: 12px; }
    .xtl-composer-top, .xtl-composer-controls, .xtl-post-header, .xtl-post-actions, .xtl-roster-header, .xtl-settings-row { display: flex; align-items: center; gap: 8px; }
    .xtl-composer-top { justify-content: space-between; margin-bottom: 8px; }
    .xtl-composer-label { font-size: 12px; color: var(--lumiverse-text-muted, #98a2b3); }
    .xtl-compose-context { color: var(--lumiverse-text-muted, #98a2b3); font-size: 12px; margin: 0 0 8px; }
    .xtl-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; background: var(--lumiverse-fill, #202a36); color: var(--lumiverse-text-muted, #98a2b3); font-size: 11px; }
    .xtl-textarea, .xtl-select { background: var(--lumiverse-fill, #202a36); color: var(--lumiverse-text, #e9edf4); border: 1px solid var(--lumiverse-border, #334155); border-radius: calc(var(--lumiverse-radius, 12px) - 3px); box-sizing: border-box; font: inherit; }
    .xtl-textarea { display: block; width: 100%; min-height: 78px; padding: 9px 10px; resize: vertical; line-height: 1.45; }
    .xtl-select { max-width: 180px; min-width: 0; padding: 5px 7px; font-size: 12px; }
    .xtl-composer-controls { justify-content: space-between; margin-top: 9px; flex-wrap: wrap; }
    .xtl-composer-actions { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
    .xtl-counter { font-size: 11px; color: var(--lumiverse-text-muted, #98a2b3); }
    .xtl-button { appearance: none; border: 1px solid var(--lumiverse-border, #334155); border-radius: 8px; background: var(--lumiverse-fill, #202a36); color: var(--lumiverse-text, #e9edf4); padding: 6px 9px; cursor: pointer; font: inherit; font-size: 12px; line-height: 1.15; }
    .xtl-button:hover:not(:disabled) { border-color: var(--lumiverse-accent, #4fd1c5); color: var(--lumiverse-accent, #4fd1c5); }
    .xtl-button:disabled { opacity: .48; cursor: not-allowed; }
    .xtl-button--primary { background: var(--lumiverse-accent, #2fa7a1); border-color: var(--lumiverse-accent, #2fa7a1); color: var(--lumiverse-accent-contrast, #fff); font-weight: 650; }
    .xtl-button--quiet { background: transparent; border-color: transparent; color: var(--lumiverse-text-muted, #98a2b3); padding: 4px 5px; }
    .xtl-notice { padding: 8px 10px; background: color-mix(in srgb, #efb35b 14%, var(--lumiverse-fill-subtle, #18202b)); border: 1px solid color-mix(in srgb, #efb35b 48%, var(--lumiverse-border, #334155)); border-radius: 9px; font-size: 12px; line-height: 1.4; margin: 8px 0; }
    .xtl-notice--error { background: color-mix(in srgb, #e85b75 14%, var(--lumiverse-fill-subtle, #18202b)); border-color: color-mix(in srgb, #e85b75 52%, var(--lumiverse-border, #334155)); }
    .xtl-post { padding: 11px 12px; }
    .xtl-post + .xtl-post { border-top: 1px solid var(--lumiverse-border, #334155); }
    .xtl-post--reply { margin-left: 14px; border-left: 2px solid color-mix(in srgb, var(--lumiverse-accent, #2fa7a1) 42%, transparent); }
    .xtl-post-header { align-items: flex-start; }
    .xtl-post-author { min-width: 0; flex: 1; }
    .xtl-post-name-row { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
    .xtl-post-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
    .xtl-post-handle, .xtl-post-time { color: var(--lumiverse-text-muted, #98a2b3); font-size: 11px; white-space: nowrap; }
    .xtl-post-bio { color: var(--lumiverse-text-muted, #98a2b3); font-size: 11px; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xtl-avatar { flex: 0 0 auto; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; overflow: hidden; background: color-mix(in srgb, var(--lumiverse-accent, #2fa7a1) 28%, var(--lumiverse-fill, #202a36)); color: var(--lumiverse-text, #e9edf4); font-size: 11px; font-weight: 700; }
    .xtl-avatar--small { width: 26px; height: 26px; font-size: 9px; }
    .xtl-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .xtl-post-body { margin: 8px 0 9px 42px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.48; }
    .xtl-post-source { margin: -2px 0 8px 42px; }
    .xtl-post-actions { margin-left: 40px; flex-wrap: wrap; }
    .xtl-reaction { min-width: 36px; padding-inline: 7px; }
    .xtl-reaction--active { color: var(--lumiverse-accent, #4fd1c5); border-color: var(--lumiverse-accent, #4fd1c5); }
    .xtl-empty { padding: 22px 13px; color: var(--lumiverse-text-muted, #98a2b3); text-align: center; font-size: 13px; line-height: 1.5; }
    .xtl-roster { padding: 11px 12px; }
    .xtl-roster-header { justify-content: space-between; }
    .xtl-section-title { margin: 0; font-size: 13px; }
    .xtl-roster-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(144px, 1fr)); gap: 7px; margin-top: 10px; }
    .xtl-actor-card { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 7px; border: 1px solid var(--lumiverse-border, #334155); border-radius: 9px; }
    .xtl-actor-card-info { min-width: 0; flex: 1; }
    .xtl-actor-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
    .xtl-actor-card-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--lumiverse-text-muted, #98a2b3); font-size: 10px; margin-top: 2px; }
    .xtl-actor-card .xtl-button { font-size: 10px; padding: 4px 6px; }
    .xtl-settings { padding: 0 12px 12px; }
    .xtl-settings summary { cursor: pointer; color: var(--lumiverse-text-muted, #98a2b3); font-size: 12px; padding: 10px 0 7px; }
    .xtl-settings-copy { color: var(--lumiverse-text-muted, #98a2b3); font-size: 11px; line-height: 1.45; margin: 0 0 8px; }
    .xtl-settings-row { justify-content: space-between; align-items: flex-start; padding-top: 7px; border-top: 1px solid color-mix(in srgb, var(--lumiverse-border, #334155) 70%, transparent); }
    .xtl-settings-label { font-size: 12px; font-weight: 600; }
    .xtl-settings-hint { color: var(--lumiverse-text-muted, #98a2b3); font-size: 10px; max-width: 195px; line-height: 1.35; margin-top: 2px; }
    .xtl-loading { padding: 22px 10px; color: var(--lumiverse-text-muted, #98a2b3); font-size: 13px; }
    @media (max-width: 420px) { .xtl-app { padding: 9px; } .xtl-post-body, .xtl-post-source { margin-left: 0; } .xtl-post-actions { margin-left: 0; } .xtl-post--reply { margin-left: 7px; } .xtl-composer-top { align-items: flex-start; flex-direction: column; } .xtl-select { max-width: 100%; width: 100%; } }
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
  const focusComposer = () => {
    queueMicrotask(() => root.querySelector(".xtl-textarea")?.focus());
  };
  const renderHeader = () => {
    const header = createElement("header", "xtl-header");
    const copy = createElement("div");
    copy.append(createElement("h2", "xtl-title", "Lumiverse Timeline"));
    copy.append(createElement("p", "xtl-subtitle", "Private weaves from your personas, Council, and character cards."));
    const refresh = button("Refresh", "xtl-button xtl-button--quiet");
    refresh.addEventListener("click", () => send({ type: "load_timeline" }));
    header.append(copy, refresh);
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
  const renderComposer = (state) => {
    const card = createElement("section", "xtl-card xtl-composer");
    const top = createElement("div", "xtl-composer-top");
    const title = createElement("div", "xtl-composer-label", selectedReplyTarget() ? "Reply as" : "Weave as");
    const personaSelect = document.createElement("select");
    personaSelect.className = "xtl-select";
    personaSelect.setAttribute("aria-label", "Timeline persona");
    const fallbackOption = document.createElement("option");
    fallbackOption.value = "";
    fallbackOption.textContent = state.personas.length ? "Choose persona…" : "You";
    personaSelect.appendChild(fallbackOption);
    for (const persona of state.personas) {
      const option = document.createElement("option");
      option.value = persona.sourceId;
      option.textContent = `${persona.name} @${persona.handle}`;
      personaSelect.appendChild(option);
    }
    personaSelect.value = selectedPersona()?.sourceId ?? "";
    personaSelect.addEventListener("change", () => send({ type: "update_settings", selectedPersonaId: personaSelect.value || null }));
    top.append(title, personaSelect);
    card.appendChild(top);
    const replyTarget = selectedReplyTarget();
    if (replyTarget) {
      const context = createElement("p", "xtl-compose-context");
      context.append("Replying to ", createElement("strong", undefined, `@${replyTarget.author.handle}`), document.createTextNode(". "));
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
      const clear = button("Remove chat link", "xtl-button xtl-button--quiet");
      clear.addEventListener("click", () => {
        chatSource = null;
        render();
      });
      context.appendChild(clear);
      card.appendChild(context);
    }
    const textarea = document.createElement("textarea");
    textarea.className = "xtl-textarea";
    textarea.maxLength = MAX_WEAVE_LENGTH;
    textarea.placeholder = replyTarget ? `Reply to @${replyTarget.author.handle}…` : "What is happening in your Lumiverse?";
    textarea.value = draft;
    textarea.disabled = busy;
    textarea.addEventListener("input", () => {
      draft = textarea.value.slice(0, MAX_WEAVE_LENGTH);
      const counter = root.querySelector(".xtl-counter");
      if (counter)
        counter.textContent = `${draft.length}/${MAX_WEAVE_LENGTH}`;
    });
    card.appendChild(textarea);
    const controls = createElement("div", "xtl-composer-controls");
    const actions = createElement("div", "xtl-composer-actions");
    const chatButton = button("Weave current chat");
    chatButton.disabled = busy || !state.permissions.includes("chats") || !state.permissions.includes("chat_mutation");
    chatButton.addEventListener("click", () => {
      busy = true;
      busyActorName = "current chat";
      render();
      send({ type: "prepare_chat_weave" });
    });
    actions.appendChild(chatButton);
    if (state.replyActors.length) {
      const inviteSelect = document.createElement("select");
      inviteSelect.className = "xtl-select";
      inviteSelect.setAttribute("aria-label", "Invite a reply");
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No invited reply";
      inviteSelect.appendChild(none);
      for (const actor of state.replyActors) {
        const option = document.createElement("option");
        option.value = actor.key;
        option.textContent = `Invite ${actor.name}`;
        inviteSelect.appendChild(option);
      }
      inviteSelect.value = inviteActorKey;
      inviteSelect.disabled = busy || !state.permissions.includes("generation");
      inviteSelect.addEventListener("change", () => {
        inviteActorKey = inviteSelect.value;
      });
      actions.appendChild(inviteSelect);
    }
    const weave = button(inviteActorKey ? "Weave + invite" : "Weave", "xtl-button xtl-button--primary");
    weave.disabled = busy || !draft.trim();
    weave.addEventListener("click", () => {
      const persona = selectedPersona();
      pendingDraft = { text: draft, replyToId, chatSource };
      const payload = {
        type: "create_weave",
        content: draft,
        personaId: persona?.sourceId ?? null,
        replyToId,
        inviteActorKey,
        chatId: chatSource?.chatId
      };
      draft = "";
      replyToId = null;
      chatSource = null;
      busy = true;
      busyActorName = inviteActorKey ? "timeline reply" : null;
      render();
      send(payload);
    });
    controls.append(actions, createElement("span", "xtl-counter", `${draft.length}/${MAX_WEAVE_LENGTH}`), weave);
    card.appendChild(controls);
    return card;
  };
  const renderPost = (post, depth, state) => {
    const article = createElement("article", `xtl-post${depth ? " xtl-post--reply" : ""}`);
    article.style.setProperty("--xtl-depth", String(depth));
    const header = createElement("div", "xtl-post-header");
    const author = createElement("div", "xtl-post-author");
    const nameRow = createElement("div", "xtl-post-name-row");
    nameRow.append(createElement("span", "xtl-post-name", post.author.name), createElement("span", "xtl-post-handle", `@${post.author.handle}`), createElement("span", "xtl-post-time", `· ${relativeTime(post.createdAt)}`));
    author.append(nameRow, createElement("div", "xtl-post-bio", post.author.role ?? post.author.bio));
    header.append(actorAvatar(post.author), author);
    article.appendChild(header);
    article.appendChild(createElement("div", "xtl-post-body", post.content));
    if (post.chatSource) {
      article.appendChild(createElement("div", "xtl-post-source", `From ${post.chatSource.chatName}${post.chatSource.characterName ? ` · ${post.chatSource.characterName}` : ""}`));
    }
    const actions = createElement("div", "xtl-post-actions");
    for (const emoji of REACTION_EMOJIS) {
      const reaction = post.reactions.find((entry) => entry.emoji === emoji);
      const active = Boolean(reaction?.actorKeys.includes("timeline_user"));
      const react = button(`${emoji}${reaction?.actorKeys.length ? ` ${reaction.actorKeys.length}` : ""}`, `xtl-button xtl-reaction${active ? " xtl-reaction--active" : ""}`);
      react.disabled = busy;
      react.addEventListener("click", () => send({ type: "toggle_reaction", postId: post.id, emoji }));
      actions.appendChild(react);
    }
    const reply = button("Reply", "xtl-button xtl-button--quiet");
    reply.disabled = busy;
    reply.addEventListener("click", () => {
      replyToId = post.id;
      chatSource = null;
      render();
      focusComposer();
    });
    actions.appendChild(reply);
    if (state.permissions.includes("generation") && state.replyActors.length) {
      const invite = button("Invite reply", "xtl-button xtl-button--quiet");
      invite.disabled = busy;
      invite.addEventListener("click", () => {
        replyToId = post.id;
        inviteActorKey = inviteActorKey || state.replyActors[0].key;
        chatSource = null;
        render();
        focusComposer();
      });
      actions.appendChild(invite);
    }
    article.appendChild(actions);
    return article;
  };
  const renderTimeline = (state) => {
    const feed = createElement("section", "xtl-card");
    const posts = orderedPosts(state.state.posts);
    if (!posts.length) {
      feed.appendChild(createElement("div", "xtl-empty", "No weaves yet. Start the feed with a thought from your selected persona, or let a Council member or character card post first."));
      return feed;
    }
    for (const { post, depth } of posts)
      feed.appendChild(renderPost(post, depth, state));
    return feed;
  };
  const renderRoster = (state) => {
    const card = createElement("section", "xtl-card xtl-roster");
    const header = createElement("div", "xtl-roster-header");
    header.append(createElement("h3", "xtl-section-title", "Invite an actor"), createElement("span", "xtl-chip", `${state.replyActors.length} available`));
    card.appendChild(header);
    const list = createElement("div", "xtl-roster-list");
    for (const actor of state.replyActors.slice(0, 18)) {
      const item = createElement("div", "xtl-actor-card");
      const details = createElement("div", "xtl-actor-card-info");
      details.append(createElement("div", "xtl-actor-card-name", actor.name), createElement("div", "xtl-actor-card-meta", actor.role ?? actor.bio));
      const weave = button("Weave", "xtl-button");
      weave.disabled = busy || !state.permissions.includes("generation");
      weave.addEventListener("click", () => {
        busy = true;
        busyActorName = actor.name;
        render();
        send({ type: "create_actor_weave", actorKey: actor.key });
      });
      item.append(actorAvatar(actor, "small"), details, weave);
      list.appendChild(item);
    }
    if (!state.replyActors.length) {
      list.appendChild(createElement("p", "xtl-subtitle", "Add Council members or character cards to invite them here."));
    }
    card.appendChild(list);
    return card;
  };
  const renderSettings = (state) => {
    const card = createElement("section", "xtl-card xtl-settings");
    const details = document.createElement("details");
    const summary = createElement("summary", undefined, "Timeline settings");
    details.appendChild(summary);
    const copy = createElement("p", "xtl-settings-copy", "Choose a fast, low-cost connection for background character and Council posts. Select the same connection you use for Lumiverse Sidecar LLM if you want one shared model choice.");
    details.appendChild(copy);
    const row = createElement("div", "xtl-settings-row");
    const labels = createElement("div");
    labels.append(createElement("div", "xtl-settings-label", "Timeline sidecar"), createElement("div", "xtl-settings-hint", "Used only for actor weaves, replies, and optional chat summaries."));
    const connectionSelect = document.createElement("select");
    connectionSelect.className = "xtl-select";
    connectionSelect.setAttribute("aria-label", "Timeline sidecar connection");
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "Choose connection…";
    connectionSelect.appendChild(unset);
    for (const connection of state.connections) {
      const option = document.createElement("option");
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
    if (!state.permissions.includes("generation")) {
      details.appendChild(createElement("div", "xtl-notice", "Generation permission is not currently granted, so actor-authored weaves and replies are unavailable."));
    } else if (!state.state.settings.sidecarConnectionId) {
      details.appendChild(createElement("div", "xtl-notice", "Select a Timeline sidecar before inviting actor replies. You can still write your own weaves."));
    }
    card.appendChild(details);
    return card;
  };
  const render = () => {
    root.replaceChildren(renderHeader());
    const renderedError = renderError();
    if (renderedError)
      root.appendChild(renderedError);
    if (!snapshot) {
      root.appendChild(createElement("div", "xtl-loading", "Loading your timeline…"));
      return;
    }
    if (busy) {
      root.appendChild(createElement("div", "xtl-notice", busyActorName ? `${busyActorName} is weaving…` : "Updating the timeline…"));
    }
    root.append(renderComposer(snapshot), renderTimeline(snapshot), renderRoster(snapshot), renderSettings(snapshot));
  };
  const unsubscribeMessages = ctx.onBackendMessage((payload) => {
    const message = asMessage(payload);
    if (!message)
      return;
    if (message.type === "timeline_state" && isSnapshot(message.snapshot)) {
      snapshot = message.snapshot;
      if (pendingDraft)
        pendingDraft = null;
      if (inviteActorKey && !snapshot.replyActors.some((actor) => actor.key === inviteActorKey))
        inviteActorKey = "";
      render();
      return;
    }
    if (message.type === "timeline_error") {
      error = message.message ?? "Timeline request failed.";
      if (pendingDraft) {
        if (!draft)
          draft = pendingDraft.text;
        replyToId = pendingDraft.replyToId;
        chatSource = pendingDraft.chatSource;
        pendingDraft = null;
      }
      busy = false;
      busyActorName = null;
      render();
      return;
    }
    if (message.type === "timeline_activity") {
      busy = Boolean(message.active);
      busyActorName = message.actorName ?? null;
      render();
      return;
    }
    if (message.type === "chat_weave_draft" && typeof message.draft === "string" && message.source) {
      draft = message.draft.slice(0, MAX_WEAVE_LENGTH);
      chatSource = message.source;
      replyToId = null;
      busy = false;
      busyActorName = null;
      render();
      focusComposer();
    }
  });
  const inputAction = ctx.ui.registerInputBarAction({
    id: "weave-current-chat",
    label: "Weave current chat",
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  });
  const unsubscribeInputAction = inputAction.onClick(() => {
    tab.activate();
    busy = true;
    busyActorName = "current chat";
    render();
    send({ type: "prepare_chat_weave" });
  });
  const unsubscribeActivate = tab.onActivate(() => send({ type: "load_timeline" }));
  render();
  send({ type: "load_timeline" });
  ctx.ready();
  return () => {
    unsubscribeMessages();
    unsubscribeInputAction();
    unsubscribeActivate();
    inputAction.destroy();
    tab.destroy();
    removeStyle();
    root.replaceChildren();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
