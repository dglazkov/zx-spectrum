// nerd's feedback widget: the same in every product (nerd#172). Written out by `nerd telemetry widget`, which a
// project runs again to bring it up to date; edit it in nerd, not here.
//
// Load it first in the page's <head>, so that it hears the console's errors from the start:
//
//   <script src="/nerd-feedback.js"></script>
//
// and then, from the product:
//
//   nerdFeedback.open()                    from the product's own entry: a menu item, a button
//   nerdFeedback.shortcut("Alt+Shift+F")   a key that opens it too
//   nerdFeedback.event("list.opened")      as the product emits each of its events: the last few go with what is sent
//
// The person's words go, with the page, those events and the console's errors, as a POST to /nerd/feedback on the
// product's own server, whose body's own fields it prints as one line: {"nerd":"feedback","words":…,"page":…,
// "events":[…],"errors":[…]} (nerd guide telemetry). nerd reads it from the product's Cloud Logging, and knows the commit from the revision.
(() => {
  if (window.nerdFeedback) return;

  const EVENTS = 10; // the last few events
  const ERRORS = 10; // the console's last errors since the page opened
  const ERROR_UP_TO = 300;
  const WORDS_UP_TO = 4000;
  const PATH = "/nerd/feedback";
  const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/; // an event's name, as nerd keeps it

  const events = [];
  const errors = [];
  const keep = (list, most, item) => {
    list.push(item);
    if (list.length > most) list.splice(0, list.length - most);
  };
  const said = (thing) => {
    if (thing instanceof Error) return String(thing); // "TypeError: x is undefined"
    if (typeof thing === "string") return thing;
    try {
      return JSON.stringify(thing);
    } catch {
      return String(thing);
    }
  };
  const heard = (text) => {
    text = String(text).trim();
    if (!text) return;
    keep(errors, ERRORS, text.length > ERROR_UP_TO ? text.slice(0, ERROR_UP_TO - 1) + "…" : text);
    if (panel && !sent) list();
  };

  const consoleError = console.error;
  console.error = function (...args) {
    heard(args.map(said).join(" "));
    return consoleError.apply(this, args);
  };
  addEventListener("error", (e) => {
    if (e.target && e.target !== window) return; // a resource that failed to load, not the page's own error
    heard(e.error ? said(e.error) : e.message);
  });
  addEventListener("unhandledrejection", (e) => heard("Uncaught (in promise) " + said(e.reason)));

  // Its look, as Dimitri chose on Oct 18 (#172), over a sheet down the side: a small neutral card at the bottom right,
  // across the bottom on a phone, in none of the product's colours, light or dark by the person's own setting.
  const STYLE = `
    :host { all: initial; }
    .panel {
      --bg: #ffffff; --fg: #1f1f1f; --dim: #5f6368; --line: rgba(0, 0, 0, 0.12); --well: #f3f4f6;
      --button: #1f1f1f; --on-button: #ffffff; --ring: #1a73e8; --bad: #b3261e;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
      box-sizing: border-box; padding: 14px 16px 16px; border: 1px solid var(--line); border-radius: 14px;
      background: var(--bg); color: var(--fg); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.1);
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
      .panel {
        --bg: #202124; --fg: #e8eaed; --dim: #9aa0a6; --line: rgba(255, 255, 255, 0.14); --well: #2d2e31;
        --button: #e8eaed; --on-button: #202124; --ring: #8ab4f8; --bad: #f2b8b5; color-scheme: dark;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
      }
    }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 15px; }
    .close { all: unset; cursor: pointer; width: 28px; height: 28px; margin: -6px -8px -6px 0; border-radius: 50%;
      display: grid; place-items: center; color: var(--dim); font-size: 20px; line-height: 1; }
    .close:hover { background: var(--well); color: var(--fg); }
    textarea { box-sizing: border-box; width: 100%; min-height: 96px; resize: vertical; padding: 8px 10px; border-radius: 8px;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg); font: inherit; }
    textarea::placeholder { color: var(--dim); }
    :focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
    textarea:focus-visible { outline-offset: -1px; }
    .with { margin: 10px 0 12px; padding: 8px 10px; border-radius: 8px; background: var(--well); font-size: 12px; color: var(--dim); }
    .with-title { font-weight: 600; margin-bottom: 4px; }
    dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
    dt { color: var(--dim); }
    dd { margin: 0; color: var(--fg); min-width: 0; overflow-wrap: anywhere; }
    dd.none { color: var(--dim); }
    code { font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .error { color: var(--bad); }
    .foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
    .note { flex: 1; font-size: 12px; color: var(--dim); }
    .note.bad { color: var(--bad); }
    .send { all: unset; cursor: pointer; padding: 7px 16px; border-radius: 999px; background: var(--button); color: var(--on-button);
      font-weight: 600; font-size: 13px; }
    .send:disabled { cursor: default; opacity: 0.4; }
    .send:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    .done { padding: 12px 0 4px; text-align: center; }
    .done-title { font-weight: 600; font-size: 16px; margin-bottom: 4px; }
    .done-note { color: var(--dim); font-size: 13px; }
  `;

  let host = null; // the element the panel is drawn in, its styles its own
  let panel = null;
  let sent = false;
  let opener = null;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const page = () => location.pathname || "/";
  const line = (words) => ({ nerd: "feedback", words: words.slice(0, WORDS_UP_TO), page: page(), events: [...events], errors: [...errors] });

  // list is what goes with the words, drawn again as it changes.
  const list = () => {
    const dl = panel.querySelector("dl");
    dl.replaceChildren();
    const row = (term, items, cls) => {
      dl.append(el("dt", null, term));
      if (!items.length) {
        dl.append(el("dd", "none", "none"));
        return;
      }
      const dd = el("dd");
      items.forEach((item, i) => {
        if (i) dd.append(el("br"));
        dd.append(el("code", cls, item));
      });
      dl.append(dd);
    };
    row("Page", [page()]);
    row("Events", events.length ? [events.join(", ")] : []);
    row("Errors", errors, "error");
  };

  const close = () => {
    if (!host) return;
    host.remove();
    host = panel = null;
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  };

  const open = () => {
    if (host) {
      panel.querySelector("textarea, .send")?.focus();
      return;
    }
    opener = document.activeElement;
    sent = false;
    host = el("div");
    host.id = "nerd-feedback";
    const root = host.attachShadow({ mode: "open" });
    // A sheet made in script, which a page's Content-Security-Policy lets be where it would not a <style>.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];

    panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Send feedback");
    const head = el("div", "head");
    const x = el("button", "close", "×");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    head.append(el("div", "title", "Send feedback"), x);

    const words = el("textarea");
    words.placeholder = "What's on your mind? What did you expect, and what happened?";
    words.setAttribute("aria-label", "Your feedback");
    words.maxLength = WORDS_UP_TO;
    const with_ = el("div", "with");
    with_.append(el("div", "with-title", "Sent with it"), el("dl"));
    const foot = el("div", "foot");
    const note = el("div", "note");
    const send = el("button", "send", "Send");
    send.disabled = true;
    foot.append(note, send);
    words.addEventListener("input", () => (send.disabled = !words.value.trim()));

    const submit = async () => {
      if (!words.value.trim() || send.disabled) return;
      send.disabled = true;
      note.className = "note";
      note.textContent = "Sending…";
      let answer;
      try {
        answer = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(line(words.value)) });
      } catch (e) {
        answer = { ok: false, statusText: "the server could not be reached" };
      }
      if (!panel) return;
      if (!answer.ok) {
        note.className = "note bad";
        note.textContent = "Not sent: " + (answer.status ? answer.status + " " : "") + (answer.statusText || "") + ". Try again?";
        send.disabled = false;
        return;
      }
      sent = true;
      const done = el("div", "done");
      done.append(el("div", "done-title", "Got it"), el("div", "done-note", "Thank you."));
      const ok = el("button", "send", "Close");
      ok.addEventListener("click", close);
      const okFoot = el("div", "foot");
      okFoot.append(ok);
      panel.replaceChildren(done, okFoot);
      ok.focus();
    };
    send.addEventListener("click", submit);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });

    panel.append(head, words, with_, foot);
    root.append(panel);
    document.body.append(host);
    list();
    words.focus();
  };

  const event = (name) => {
    if (typeof name !== "string" || !NAME.test(name)) return;
    keep(events, EVENTS, name);
    if (panel && !sent) list();
  };

  // shortcut binds a key that opens the panel, as "Alt+Shift+F" or "Mod+Shift+K" (Mod is ⌘ on a Mac, Ctrl elsewhere).
  const shortcut = (keys) => {
    const parts = String(keys).split("+").map((p) => p.trim().toLowerCase());
    const key = parts.pop();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const want = { alt: parts.includes("alt"), shift: parts.includes("shift"),
      ctrl: parts.includes("ctrl") || (parts.includes("mod") && !mac), meta: parts.includes("meta") || (parts.includes("mod") && mac) };
    addEventListener("keydown", (e) => {
      const pressed = (e.code.startsWith("Key") ? e.code.slice(3) : e.key).toLowerCase();
      if (pressed === key && e.altKey === want.alt && e.shiftKey === want.shift && e.ctrlKey === want.ctrl && e.metaKey === want.meta) {
        e.preventDefault();
        open();
      }
    });
  };

  window.nerdFeedback = { open, close, event, shortcut };
})();
