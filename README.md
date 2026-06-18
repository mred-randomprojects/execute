# execute

A keyboard-first, **inbox-zero** todo app. Local-first desktop (Electron).

The idea: a task you commit to **today** should be finished today. If it isn't,
the app makes you reckon with it the next day — finish it, or **break it into a
smaller piece you can actually complete today**. You can't silently carry work
forward. The smallest version of a task is the one that gets done.

## The loop

1. **Capture** — every line is a checkbox. Type a task and press `Enter` for the
   next one, `Tab` to make it a subtask. Pasting `[] thing`, `- thing`, or
   `[x] done` just works.
2. **Plan** — press `t` to commit a task to today. **Today** shows only what
   you've committed to.
3. **Organize** — create colored project dividers and move tasks through them;
   each task keeps its project when it later appears in Today or Backlog.
4. **Finish** — clear Today to reach **inbox zero**.
5. **The Reckoning** — open the app on a new day with unfinished commitments and
   a gate blocks Today until each leftover is resolved:
   - **`e` done** — it was actually finished
   - **`b` break down** — split it; the small step you'll finish today goes to Today
   - **`s` backlog** — a deliberate "not today"
   - **`d` drop** — delete it

## Keyboard

Press **`?`** anywhere for the full, always-current list (it's generated from the
keymap). Highlights:

| Key | Action |
|-----|--------|
| `j` / `k` · `↑` / `↓` | move cursor (`↑` at the top jumps to the capture bar; `↓` there drops into the list) |
| `⇧ ↑` / `⇧ ↓` | extend multi-selection |
| `⌘ ↑` / `⌘ ↓` | move task(s) up / down, including across project dividers |
| `↵` | edit the **title inline** · `→` opens the details panel (**content**) |
| while editing a title: `↑`/`↓` jump tasks, `↵` new, `tab`/`⇧tab` indent, `⌘↵` done, `esc` save |
| in the panel: `←`/`esc` back to the list (title is read-only here) |
| `space` or `⌘↵` | complete / uncomplete |
| `t` | plan / unplan for today |
| `a` / `n` / `o` | new task below |
| `/` | add a task (capture bar) |
| `m` then `↵`/`⌘↵` | move mode (re-parent) |
| `⌫` | move to trash |
| `1` / `2` / `3` / `4` | Today / Backlog / All / Trash |
| `⌘k` | command palette · `⌘z` undo |
| `?` | keyboard help |

Task **titles** and **notes** render inline **markdown** (`` `code` ``, `**bold**`,
`*italic*`, `~~strike~~`, `[links](url)`). The detail panel shows a read-only,
rendered title and a created timestamp (in your local timezone).

In **the Reckoning** and at completion you can attach an optional **reason**;
these are recorded in an event log (and shown in a task's History panel) so the
data can later be analysed.

## Develop

```bash
pnpm install
pnpm dev      # renderer in the browser at http://localhost:5173 (fast iteration)
pnpm start    # the real Electron desktop app (Vite + Electron)
pnpm test     # vitest (tree ops, keyboard engine, capture, full app flows)
pnpm typecheck
```

In `pnpm dev`/`pnpm start` a **Dev · time travel** panel appears in the sidebar so
you can jump days and exercise the Reckoning without waiting. It's hidden in
packaged builds.

## Package

```bash
pnpm package  # → out/Execute-darwin-*/Execute.app
pnpm make     # → out/make/**/Execute.dmg  (+ .zip)
```

## How it's built

- **Renderer**: React + TypeScript (strict) + Vite + Tailwind. Theme tokens
  (Slate / Ivory / Carbon / Bordeaux) are CSS variables; switching `data-theme`
  re-themes instantly.
- **Shell**: a thin Electron main process — dev loads the Vite server, prod loads
  the built bundle. A `contextBridge` preload is the only path to disk.
- **Persistence**: one local JSON document in the OS app-data dir, written
  atomically (temp file + rename), debounced, schema-versioned. No cloud, no CDN
  (fonts are bundled).
- **Keyboard**: a declarative, Zed-inspired engine — bindings are data, contexts
  decide when they fire, actions decide what they do. The `?` overlay is
  generated from the keymap, so it can never drift.

### Layout

```
electron/        main.cjs (window + persistence IPC) · preload.cjs (bridge)
src/
  types.ts                      core domain types
  store/  tasks.ts (pure tree ops) · dates.ts · capture.ts · persistence.ts · store.ts
  keyboard/  types.ts (engine) · useKeyboard.ts · keymap.ts
  selectors.ts                  view filters + Today/leftover computations
  ui/editor.tsx                 interaction context shared by rows
  components/  TaskRow · CaptureBar · Sidebar · HelpOverlay · CommandPalette · …
  views/  OutlineView · ReckoningView
```
