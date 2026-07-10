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
    .xtl-app { --xtl-blue: #1d9bf0; --xtl-blue-soft: color-mix(in srgb, var(--xtl-blue) 16%, transparent); --xtl-surface: #0d1014; --xtl-surface-raised: #14181e; --xtl-line: #2f3336; --xtl-muted: #8b98a5; color: #f4f7fa; min-height: 100%; max-width: 760px; margin: 0 auto; padding: 0 14px 32px; box-sizing: border-box; }
    .xtl-header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; margin: 0 -14px 12px; padding: 0 18px; background: color-mix(in srgb, var(--lumiverse-background, #0a0c10) 88%, transparent); border-bottom: 1px solid var(--xtl-line); backdrop-filter: blur(12px); }
    .xtl-title { margin: 0; font-size: 20px; line-height: 1.1; letter-spacing: -.035em; font-weight: 800; }
    .xtl-subtitle { margin: 4px 0 0; color: var(--xtl-muted); font-size: 12px; line-height: 1.35; }
    .xtl-card { background: var(--xtl-surface); border: 1px solid var(--xtl-line); border-radius: 16px; margin: 12px 0; overflow: hidden; box-shadow: 0 10px 26px rgb(0 0 0 / 11%); }
    .xtl-composer { padding: 14px; background: linear-gradient(145deg, color-mix(in srgb, var(--xtl-blue) 10%, var(--xtl-surface)), var(--xtl-surface) 45%); }
    .xtl-composer-top, .xtl-composer-controls, .xtl-post-header, .xtl-post-actions, .xtl-roster-header, .xtl-settings-row { display: flex; align-items: center; gap: 9px; }
    .xtl-composer-top { justify-content: space-between; margin-bottom: 10px; }
    .xtl-composer-writing { display: flex; align-items: flex-start; gap: 11px; }
    .xtl-composer-writing .xtl-textarea { flex: 1; }
    .xtl-composer-label { color: #d9e3ec; font-size: 13px; font-weight: 700; }
    .xtl-compose-context { color: var(--xtl-muted); font-size: 12px; margin: 0 0 9px; }
    .xtl-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px; background: var(--xtl-blue-soft); color: #b9e0ff; font-size: 11px; font-weight: 650; }
    .xtl-textarea, .xtl-select { background: #0a0d11; color: #f4f7fa; border: 1px solid #3a4148; border-radius: 10px; box-sizing: border-box; font: inherit; }
    .xtl-textarea { display: block; width: 100%; min-height: 104px; padding: 12px; resize: vertical; outline: none; font-size: 15px; line-height: 1.45; }
    .xtl-textarea::placeholder { color: #75808c; }
    .xtl-textarea:focus, .xtl-select:focus { border-color: var(--xtl-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--xtl-blue) 20%, transparent); outline: none; }
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
    .xtl-button--quiet { border-color: transparent; color: var(--xtl-muted); padding: 6px 8px; }
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
    .xtl-post-bio { color: var(--xtl-muted); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xtl-avatar { flex: 0 0 auto; display: grid; place-items: center; width: 40px; height: 40px; border: 2px solid color-mix(in srgb, var(--xtl-blue) 44%, #45505c); border-radius: 50%; overflow: hidden; background: linear-gradient(135deg, #1d9bf0, #7856ff); color: #fff; font-size: 12px; font-weight: 800; }
    .xtl-avatar--small { width: 32px; height: 32px; font-size: 10px; }
    .xtl-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .xtl-post-body { margin: 8px 0 11px 50px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; color: #f0f4f7; }
    .xtl-post-source { margin: -3px 0 9px 50px; color: var(--xtl-blue); font-size: 11px; font-weight: 650; }
    .xtl-post-actions { margin-left: 49px; gap: 8px; flex-wrap: wrap; }
    .xtl-post-actions .xtl-button { color: var(--xtl-muted); border-color: transparent; padding: 6px 8px; }
    .xtl-post-actions .xtl-button:hover:not(:disabled) { color: var(--xtl-blue); background: var(--xtl-blue-soft); }
    .xtl-reaction { min-width: 40px; }
    .xtl-reaction--active { color: #ff6b9a !important; background: color-mix(in srgb, #ff6b9a 14%, transparent) !important; }
    .xtl-empty { padding: 42px 28px; color: var(--xtl-muted); text-align: center; font-size: 14px; line-height: 1.55; }
    .xtl-roster { padding: 14px; background: var(--xtl-surface-raised); }
    .xtl-roster-header { justify-content: space-between; }
    .xtl-section-title { margin: 0; font-size: 15px; letter-spacing: -.015em; }
    .xtl-roster-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin-top: 12px; }
    .xtl-roster-empty, .xtl-roster-access { grid-column: 1 / -1; margin: 2px 0 0; color: var(--xtl-muted); font-size: 12px; line-height: 1.5; }
    .xtl-roster-access { margin-top: 10px; }
    .xtl-actor-card { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px; border: 1px solid #38404a; border-radius: 12px; background: #0c0f13; }
    .xtl-actor-card-info { min-width: 0; flex: 1; }
    .xtl-actor-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 750; }
    .xtl-actor-card-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--xtl-muted); font-size: 11px; margin-top: 2px; }
    .xtl-actor-card .xtl-button { color: #9bd7ff; border-color: color-mix(in srgb, var(--xtl-blue) 46%, #39424d); font-size: 11px; padding: 6px 9px; }
    .xtl-settings { padding: 0 14px 14px; background: #0b0e12; }
    .xtl-settings summary { cursor: pointer; color: #b8c4cf; font-size: 12px; font-weight: 700; padding: 13px 0 9px; }
    .xtl-settings-copy { color: var(--xtl-muted); font-size: 12px; line-height: 1.5; margin: 0 0 10px; }
    .xtl-settings-row { justify-content: space-between; align-items: flex-start; padding-top: 10px; border-top: 1px solid var(--xtl-line); }
    .xtl-settings-label { font-size: 13px; font-weight: 750; }
    .xtl-settings-hint { color: var(--xtl-muted); font-size: 11px; max-width: 240px; line-height: 1.4; margin-top: 3px; }
    .xtl-loading { padding: 44px 16px; color: var(--xtl-muted); font-size: 14px; text-align: center; }
    @media (max-width: 520px) { .xtl-app { padding: 0 9px 24px; } .xtl-header { margin-inline: -9px; padding-inline: 13px; } .xtl-subtitle { display: none; } .xtl-post-body, .xtl-post-source { margin-left: 0; } .xtl-post-actions { margin-left: -6px; } .xtl-post--reply { margin-left: 10px; } .xtl-composer-top, .xtl-settings-row { align-items: flex-start; flex-direction: column; } .xtl-select { max-width: 100%; width: 100%; } .xtl-roster-list { grid-template-columns: 1fr; } }
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
    for (const persona2 of state.personas) {
      const option = document.createElement("option");
      option.value = persona2.sourceId;
      option.textContent = `${persona2.name} @${persona2.handle}`;
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
    const writingRow = createElement("div", "xtl-composer-writing");
    const persona = selectedPersona();
    writingRow.append(persona ? actorAvatar(persona) : createElement("div", "xtl-avatar", "Y"), textarea);
    card.appendChild(writingRow);
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
      const persona2 = selectedPersona();
      pendingDraft = { text: draft, replyToId, chatSource };
      const payload = {
        type: "create_weave",
        content: draft,
        personaId: persona2?.sourceId ?? null,
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
    let accessHint = "";
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
      const missingCharacterPermission = !state.permissions.includes("characters");
      list.appendChild(createElement("p", "xtl-roster-empty", missingCharacterPermission ? "Character-card access is not enabled for Timeline. Grant the Characters permission in Extensions, then refresh. Council members will appear here once they are added to your Council." : "No character cards or active Council members are available for this account yet. Add one, then refresh this timeline."));
    } else if (!state.permissions.includes("characters")) {
      accessHint = "Character-card access is not enabled, so this list currently shows Council members only.";
    }
    card.appendChild(list);
    if (accessHint)
      card.appendChild(createElement("p", "xtl-roster-access", accessHint));
    return card;
  };
  const renderSettings = (state) => {
    const card = createElement("section", "xtl-card xtl-settings");
    const details = document.createElement("details");
    const summary = createElement("summary", undefined, "Timeline settings");
    details.appendChild(summary);
    const copy = createElement("p", "xtl-settings-copy", "Choose a fast connection for background character and Council weaves. Your saved Timeline choice is used only by this extension.");
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
    } else if (!state.connections.length) {
      const notice = createElement("div", "xtl-notice");
      notice.append(document.createTextNode("No LLM connections are available for this account. Add one in Connections, then return here and refresh. "));
      const manageConnections = button("Open Connections", "xtl-button");
      manageConnections.addEventListener("click", () => send({ type: "open_connections" }));
      notice.appendChild(manageConnections);
      details.appendChild(notice);
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
