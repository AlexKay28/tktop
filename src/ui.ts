/**
 * TUI layer — a pure projection of Store state using @opentui/core.
 * See docs/ADR-002 for the OpenTUI API subset used here.
 */
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  bg,
  bold,
  dim,
  fg,
  t,
  StyledText,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent,
  type TextChunk,
} from "@opentui/core"
import type { SessionRow } from "./store"
import { Store, TRACK_COLORS, TRACK_MARKERS } from "./store"
import { cell, fit, fmtAgo, fmtCost, fmtRate, fmtTokens, shortDir, sparkline } from "./format"

const TERM = {
  bg: "#11111b",
  surface: "#181825",
  fgText: "#cdd6f4",
  dim: "#6c7086",
  accent: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
  sel: "#313244",
}

type Mode = "normal" | "filter" | "help"

interface Col {
  key: string
  title: string
  width: number
  align: "left" | "right"
  flexible?: boolean
}

interface DisplayItem {
  kind: "group" | "session"
  label?: string
  row?: SessionRow
  selected?: boolean
  /** tree nesting (subagents): 0 = root */
  depth?: number
  /** tree nesting: last child of its parent (for the └─ glyph) */
  isLast?: boolean
}

const COLS: Col[] = [
  { key: "dot", title: "◆", width: 2, align: "left" },
  { key: "harness", title: "HARNESS", width: 10, align: "left" },
  { key: "model", title: "MODEL", width: 20, align: "left" },
  { key: "session", title: "SESSION", width: 0, align: "left", flexible: true },
  { key: "dir", title: "DIR", width: 18, align: "left" },
  { key: "in", title: "IN", width: 9, align: "right" },
  { key: "out", title: "OUT", width: 9, align: "right" },
  { key: "cacheR", title: "CACHE-R", width: 9, align: "right" },
  { key: "rsn", title: "RSN", width: 6, align: "right" },
  { key: "cost", title: "COST", width: 7, align: "right" },
  { key: "burn", title: "TOK/MIN", width: 10, align: "right" },
  { key: "spark", title: "RATE", width: 10, align: "left" },
  { key: "age", title: "AGE", width: 5, align: "right" },
]
const DROP_ORDER = ["spark", "rsn", "cacheR", "dir", "cost", "in", "age", "model", "harness"]

/** table column key -> sort key (columns not listed are not sortable) */
const SORTABLE: Record<string, import("./types").SortKey> = {
  harness: "harness",
  model: "model",
  session: "title",
  dir: "dir",
  in: "in",
  out: "out",
  cacheR: "cacheR",
  rsn: "rsn",
  cost: "cost",
  burn: "burn",
  age: "recent",
}

const GROUP_NEXT: Record<string, "none" | "harness" | "model"> = {
  none: "harness",
  harness: "model",
  model: "none",
}

function rateColor(r: number): string {
  if (r <= 0) return TERM.dim
  if (r < 100) return TERM.green
  if (r < 1000) return TERM.yellow
  if (r < 10000) return TERM.peach
  return TERM.red
}

type PlotRow = { ch: string; color: string }[]

/** The installed typings route EventEmitter through ambient "events" types
 * that don't carry the generic map, so use a minimal structural type. */
interface KeyInputLike {
  on(event: "keypress", handler: (key: KeyEvent) => void): void
}

export class App {
  private mode: Mode = "normal"
  private cursor = 0
  private offset = 0

  private headerTitle!: TextRenderable
  private headerTotals!: TextRenderable
  private headerCols!: TextRenderable
  /** current header column layout (x offsets within the header), for mouse hit-testing */
  private colLayout: { key: string; x: number; w: number }[] = []
  private rowsBox!: BoxRenderable
  private statusLine!: TextRenderable
  private filterBox!: BoxRenderable
  private filterInput!: InputRenderable
  private hotkeys!: TextRenderable
  private helpOverlay!: BoxRenderable

  private pool: TextRenderable[] = []
  private items: DisplayItem[] = []

  // scatter panel
  private plotVisible = true
  private plotBox!: BoxRenderable
  private plotLines: TextRenderable[] = []

  constructor(
    private renderer: CliRenderer,
    private store: Store,
  ) {
    this.build()
    this.bindKeys()
    this.renderer.on("resize", () => this.render())
  }

  // ─── construction ────────────────────────────────────────────────

  private build(): void {
    const r = this.renderer
    const root = new BoxRenderable(r, {
      width: "100%",
      height: "100%",
      backgroundColor: TERM.bg,
      flexDirection: "column",
    })
    r.root.add(root)

    const header = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      backgroundColor: TERM.surface,
      paddingLeft: 1,
      paddingRight: 1,
    })
    this.headerTitle = new TextRenderable(r, { content: " tktop", height: 1, wrapMode: "none" })
    this.headerTotals = new TextRenderable(r, { content: "", height: 1, wrapMode: "none" })
    this.headerCols = new TextRenderable(r, {
      content: "",
      height: 1,
      wrapMode: "none",
      // clickable sort: a press on selectable text would start a selection instead
      selectable: false,
      onMouseDown: (e) => this.onHeaderMouseDown(e),
      onMouseOver: (e) => this.onHeaderMouseOver(e),
      onMouseOut: () => this.renderer.setMousePointer("default"),
    })
    header.add(this.headerTitle)
    header.add(this.headerTotals)
    root.add(header)

    // live scatter: x = in+out tokens (log scale), y = tok/min, trail per session
    this.plotBox = new BoxRenderable(r, {
      width: "100%",
      height: 10,
      border: true,
      borderStyle: "single",
      borderColor: TERM.surface,
      title: " scatter ",
      titleColor: TERM.dim,
      flexDirection: "column",
    })
    root.add(this.plotBox)

    this.rowsBox = new BoxRenderable(r, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "column",
      overflow: "hidden",
      paddingLeft: 1,
      paddingRight: 1,
      // wheel over empty table area pages as well
      onMouseScroll: (e) => this.wheelScroll(e),
    })
    root.add(this.rowsBox)
    // sticky table column header, first child of the rows area
    this.rowsBox.add(this.headerCols)

    const footer = new BoxRenderable(r, {
      width: "100%",
      flexDirection: "column",
      backgroundColor: TERM.surface,
      paddingLeft: 1,
      paddingRight: 1,
    })
    this.statusLine = new TextRenderable(r, { content: "", height: 1, wrapMode: "none" })
    footer.add(this.statusLine)

    this.filterBox = new BoxRenderable(r, {
      width: "100%",
      height: 1,
      flexDirection: "row",
      visible: false,
    })
    const filterLabel = new TextRenderable(r, {
      content: t`${fg(TERM.accent)(bold("filter"))} ${fg(TERM.dim)("›")} `,
      wrapMode: "none",
    })
    this.filterInput = new InputRenderable(r, {
      flexGrow: 1,
      textColor: TERM.fgText,
      cursorColor: TERM.accent,
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      placeholder: "match harness · session · model · dir",
    })
    this.filterBox.add(filterLabel)
    this.filterBox.add(this.filterInput)
    footer.add(this.filterBox)

    this.hotkeys = new TextRenderable(r, { content: "", height: 1, wrapMode: "none" })
    footer.add(this.hotkeys)
    root.add(footer)

    this.filterInput.on(InputRenderableEvents.INPUT, (value: string) => {
      this.store.filter = value
      this.cursor = 0
      this.offset = 0
      this.render()
    })
    this.filterInput.on(InputRenderableEvents.ENTER, () => {
      this.exitFilterMode()
    })

    this.helpOverlay = new BoxRenderable(r, {
      position: "absolute",
      width: 54,
      height: 14,
      top: 4,
      left: 4,
      backgroundColor: TERM.surface,
      borderColor: TERM.accent,
      border: true,
      flexDirection: "column",
      paddingX: 1,
      visible: false,
    })
    this.helpOverlay.add(
      new TextRenderable(r, {
        content: t`  ${fg(TERM.accent)(bold("tktop — keys"))}`,
        height: 1,
        wrapMode: "none",
      }),
    )
    const keyRows: [string, string][] = [
      ["click", "column header: sort by that column (click again: reverse)"],
      ["click", "row: move cursor there · wheel: scroll"],
      ["1..4", "sort: burn · recent · tokens · cost"],
      ["/", "filter (enter confirm · esc cancel)"],
      ["g", "group by: none → harness → model"],
      ["t", "tree view: nest subagent sessions (htop-style)"],
      ["a", "toggle archived sessions"],
      ["j/k or ↑/↓", "move cursor · PgUp/PgDn page"],
      ["Home / End", "jump to first / last"],
      ["p", "toggle live scatterplot"],
      ["r", "force refresh now"],
      ["q", "quit"],
    ]
    for (const [k, d] of keyRows) {
      this.helpOverlay.add(
        new TextRenderable(r, {
          content: t`  ${fg(TERM.accent)(cell(k, 12))} ${fg(TERM.fgText)(d)}`,
          height: 1,
          wrapMode: "none",
        }),
      )
    }
    root.add(this.helpOverlay)
  }

  // ─── keyboard ────────────────────────────────────────────────────

  private bindKeys(): void {
    const keyInput = this.renderer.keyInput as unknown as KeyInputLike
    keyInput.on("keypress", (key) => this.onKey(key))
  }

  private onKey(key: KeyEvent): void {
    if (key.ctrl && key.name === "c") return // exitOnCtrlC handles

    if (this.mode === "filter") {
      if (key.name === "escape") this.exitFilterMode()
      return // everything else is input content
    }

    if (this.mode === "help") {
      if (["escape", "q", "?", "return"].includes(key.name)) {
        this.helpOverlay.visible = false
        this.mode = "normal"
        this.render()
      }
      return
    }

    switch (key.name) {
      case "q":
        this.renderer.destroy()
        return
      case "1":
        this.store.sortKey = "burn"
        this.store.sortDir = "desc"
        break
      case "2":
        this.store.sortKey = "recent"
        this.store.sortDir = "desc"
        break
      case "3":
        this.store.sortKey = "tokens"
        this.store.sortDir = "desc"
        break
      case "4":
        this.store.sortKey = "cost"
        this.store.sortDir = "desc"
        break
      case "/":
        this.enterFilterMode()
        return
      case "g":
        this.store.groupBy = GROUP_NEXT[this.store.groupBy] ?? "harness"
        break
      case "t":
        // htop-style tree: nest subagent sessions under their parent
        this.store.tree = !this.store.tree
        break
      case "G":
        this.cursor = Math.max(0, this.sessionCount() - 1)
        break
      case "a":
        this.store.showArchived = !this.store.showArchived
        this.cursor = 0
        this.offset = 0
        break
      case "p":
        this.plotVisible = !this.plotVisible
        this.plotBox.visible = this.plotVisible
        this.offset = 0
        break
      case "r":
        void this.store.tick().then(() => this.render())
        return
      case "?":
        this.helpOverlay.visible = true
        this.mode = "help"
        this.render()
        return
      case "j":
      case "down":
        this.moveCursor(1)
        break
      case "k":
      case "up":
        this.moveCursor(-1)
        break
      case "pageup":
        this.moveCursor(-Math.max(1, this.viewportRows()))
        break
      case "pagedown":
        this.moveCursor(Math.max(1, this.viewportRows()))
        break
      case "home":
        this.cursor = 0
        this.offset = 0
        break
      case "end":
        this.cursor = Math.max(0, this.sessionCount() - 1)
        break
      default:
        return
    }
    this.render()
  }

  private sessionCount(): number {
    return this.items.reduce((s, i) => s + (i.kind === "session" ? 1 : 0), 0)
  }

  private moveCursor(delta: number): void {
    const n = this.sessionCount()
    if (n === 0) return
    this.cursor = Math.min(n - 1, Math.max(0, this.cursor + delta))
  }

  // ─── filter mode ──────────────────────────────────────────────────

  private enterFilterMode(): void {
    this.mode = "filter"
    this.statusLine.visible = false
    this.filterBox.visible = true
    this.filterInput.focus()
    this.render()
  }

  private exitFilterMode(): void {
    this.mode = "normal"
    this.filterInput.blur()
    this.filterBox.visible = false
    this.statusLine.visible = true
    this.render()
  }

  // ─── rendering ───────────────────────────────────────────────────

  private plotHeight(): number {
    const termH = this.renderer.height ?? 24
    return Math.max(8, Math.min(14, Math.floor(termH * 0.35)))
  }

  private viewportRows(): number {
    const base = Math.max(3, (this.renderer.height ?? 24) - 7)
    return this.plotVisible ? Math.max(3, base - this.plotHeight()) : base
  }

  private columns(width: number): Col[] {
    // rowsBox has paddingLeft/Right = 1, so only width-2 cells are usable per row
    const usable = Math.max(20, width - 2)
    let cols = [...COLS]
    const flexWidth = (cs: Col[]) => usable - cs.reduce((s, c) => s + c.width + 1, 0)
    for (const drop of DROP_ORDER) {
      if (flexWidth(cols.filter((c) => !c.flexible)) >= 14) break
      cols = cols.filter((c) => c.key !== drop)
    }
    const fixed = cols.filter((c) => !c.flexible)
    const flexible = cols.find((c) => c.flexible)
    if (flexible) flexible.width = Math.max(10, usable - fixed.reduce((s, c) => s + c.width + 1, 0))
    return cols
  }

  private rowChunks(cols: Col[], r: SessionRow, sel: boolean, now: number, depth = 0, isLast = true): TextChunk[] {
    const style = (color: string, text: string): TextChunk =>
      sel ? bg(TERM.sel)(fg(color)(text)) : fg(color)(text)
    const sep: TextChunk = sel ? bg(TERM.sel)(" ") : fg(TERM.surface)(" ")
    const chunks: TextChunk[] = []
    const rc = rateColor(r.burnRate)

    cols.forEach((c, i) => {
      const w = c.width
      let text = ""
      let color = TERM.fgText
      switch (c.key) {
        case "dot": {
          const track = this.store.tracks.get(r.key)
          const live = track != null && now - track.lastActive <= 15_000
          if (!track || !live) {
            text = cell("·", w)
            color = sel ? TERM.fgText : TERM.dim
          } else {
            const dying = now - track.lastActive > 5000
            const glyph = TRACK_MARKERS[track.marker % TRACK_MARKERS.length] ?? "●"
            text = cell(glyph, w)
            color = sel
              ? TERM.fgText
              : dying
                ? "#585b70"
                : (TRACK_COLORS[track.color % TRACK_COLORS.length] ?? TERM.accent)
          }
          break
        }
        case "harness":
          text = cell(r.harness, w)
          color = sel ? TERM.fgText : TERM.accent
          break
        case "model":
          text = cell(r.model, w)
          color = sel ? TERM.fgText : TERM.teal
          break
        case "session": {
          // tree nesting (htop-style): indent children with branch glyphs
          const branch =
            depth > 0 ? "  ".repeat(depth - 1) + (isLast ? "└─ " : "├─ ") : ""
          text = cell(branch + r.title, w)
          color = sel ? "#ffffff" : TERM.fgText
          break
        }
        case "dir":
          text = cell(shortDir(r.directory, w), w)
          color = sel ? TERM.fgText : TERM.dim
          break
        case "in":
          text = cell(fmtTokens(r.tokens.input), w, "right")
          color = sel ? TERM.fgText : TERM.fgText
          break
        case "out":
          text = cell(fmtTokens(r.tokens.output), w, "right")
          color = sel ? TERM.fgText : TERM.green
          break
        case "cacheR":
          text = cell(fmtTokens(r.tokens.cacheRead), w, "right")
          color = sel ? TERM.fgText : TERM.dim
          break
        case "rsn":
          text = cell(r.tokens.reasoning > 0 ? fmtTokens(r.tokens.reasoning) : "-", w, "right")
          color = sel ? TERM.fgText : TERM.mauve
          break
        case "cost":
          text = cell(fmtCost(r.cost), w, "right")
          color = sel ? TERM.fgText : TERM.yellow
          break
        case "burn":
          text = cell(fmtRate(r.burnRate), w, "right")
          color = sel ? TERM.fgText : rc
          break
        case "spark":
          text = cell(r.burnRate > 0 ? sparkline(r.history, w) : "", w)
          color = sel ? TERM.fgText : rc
          break
        case "age":
          text = cell(fmtAgo(r.timeUpdated, now), w, "right")
          color = sel ? TERM.fgText : r.active ? TERM.green : TERM.dim
          break
      }
      chunks.push(style(color, text))
      if (i < cols.length - 1) chunks.push(sep)
    })
    return chunks
  }

  /** Recompute items and repaint pooled row nodes. Called after each tick / key. */
  render(): void {
    const rows = this.store.rows()
    const now = Date.now()
    const width = this.renderer.width ?? 80

    // ── display items (group headers inserted when grouping; tree nesting in tree mode)
    this.items = []
    if (this.store.tree) {
      for (const { row, depth, isLast } of this.store.displayList()) {
        this.items.push({ kind: "session", row, selected: false, depth, isLast })
      }
    } else {
      let prev: SessionRow | null = null
      for (const row of rows) {
        const label = this.store.groupLabel(row, prev)
        if (label != null) {
          const groupRows = rows.filter((x) =>
            this.store.groupBy === "harness" ? x.harness === label : x.model === label,
          )
          const subIn = groupRows.reduce((s, x) => s + x.tokens.input, 0)
          const subOut = groupRows.reduce((s, x) => s + x.tokens.output + x.tokens.reasoning, 0)
          const subCost = groupRows.reduce((s, x) => s + x.cost, 0)
          this.items.push({
            kind: "group",
            label: `◆ ${label} — ${groupRows.length} sessions · in ${fmtTokens(subIn)} · out ${fmtTokens(subOut)} · cost ${fmtCost(subCost)}`,
          })
        }
        this.items.push({ kind: "session", row, selected: false })
        prev = row
      }
    }

    // ── cursor over session items
    const sessionPositions = this.items
      .map((it, i) => (it.kind === "session" ? i : -1))
      .filter((i) => i >= 0)
    const n = sessionPositions.length
    this.cursor = Math.min(this.cursor, Math.max(0, n - 1))
    if (n > 0) {
      const item = this.items[sessionPositions[this.cursor] ?? 0]
      if (item) item.selected = true
    }

    // ── scrolling window keeps the selected item visible
    const vp = this.viewportRows()
    if (n > 0) {
      const selIdx = this.items.findIndex((i) => i.selected)
      if (selIdx < this.offset) this.offset = Math.max(0, selIdx)
      else if (selIdx >= this.offset + vp) this.offset = Math.max(0, selIdx - vp + 1)
      if (this.offset + vp > this.items.length) this.offset = Math.max(0, this.items.length - vp)
    }
    const visCount = Math.min(this.items.length, vp)
    const slice = this.items.slice(this.offset, this.offset + visCount)

    // ── row pool
    while (this.pool.length < visCount) {
      const i = this.pool.length // display index stays bound to this pooled node
      const node = new TextRenderable(this.renderer, {
        content: "",
        height: 1,
        wrapMode: "none",
        selectable: false,
        // click row -> move the selection cursor there
        onMouseDown: () => this.cursorAt(this.offset + i),
        // wheel over the table -> cursor paging
        onMouseScroll: (e) => this.wheelScroll(e),
      })
      this.pool.push(node)
      this.rowsBox.add(node)
    }
    this.pool.forEach((node, i) => {
      node.visible = i < visCount
    })

    const cols = this.columns(width)

    // ── header column labels (fitted to the padded rows area; aligned with row cells)
    //    clickable: SORTABLE columns re-sort; the active one carries a ▼/▲ indicator
    let hx = 0
    this.colLayout = cols.map((c) => {
      const entry = { key: c.key, x: hx, w: c.width }
      hx += c.width + 1
      return entry
    })
    const hdrChunks: TextChunk[] = []
    cols.forEach((c, i) => {
      const key = SORTABLE[c.key]
      const active = key != null && this.store.sortKey === key
      const arrow = active ? (this.store.sortDir === "asc" ? " ▲" : " ▼") : ""
      const label = (c.flexible ? "SESSION" : c.title) + arrow
      hdrChunks.push(fg(active ? TERM.accent : TERM.dim)(cell(label, c.width, c.align)))
      if (i < cols.length - 1) hdrChunks.push(fg(TERM.dim)(" "))
    })
    this.headerCols.content = new StyledText(hdrChunks)

    // ── rows
    slice.forEach((item, i) => {
      const node = this.pool[i]
      if (!node) return
      if (item.kind === "group") {
        node.content = t`${bg(TERM.surface)(fg(TERM.mauve)(bold(fit(" " + (item.label ?? ""), width - 2))))}`
        return
      }
      const r = item.row!
      const chunks = this.rowChunks(cols, r, !!item.selected, now, item.depth ?? 0, item.isLast ?? true)
      node.content = new StyledText(chunks)
    })

    this.renderHeader(now)
    this.renderFooter(n, width)
    this.renderPlot()
  }

  // ─── mouse: clickable sorting + row selection ────────────────────

  private headerHit(event: MouseEvent): { key: string; w: number } | null {
    const target = event.currentTarget ?? this.headerCols
    const lx = event.x - target.x
    for (const c of this.colLayout) {
      if (lx >= c.x && lx < c.x + c.w + 1) return c
    }
    return null
  }

  private onHeaderMouseDown(event: MouseEvent): void {
    const hit = this.headerHit(event)
    if (!hit) return
    const key = SORTABLE[hit.key]
    if (!key) return
    this.store.setSort(key)
    this.mode === "normal" && this.render()
  }

  private onHeaderMouseOver(event: MouseEvent): void {
    const hit = this.headerHit(event)
    this.renderer.setMousePointer(hit && SORTABLE[hit.key] ? "pointer" : "default")
  }

  /** move the cursor to the session displayed at display index displayIdx */
  private cursorAt(displayIdx: number): void {
    if (displayIdx < 0) return
    this.cursor = this.items.slice(0, displayIdx).filter((it) => it.kind === "session").length
    this.render()
  }

  private wheelScroll(event: MouseEvent): void {
    const d = event.scroll?.direction === "up" ? -1 : 1
    this.moveCursor(d * Math.max(1, Math.round(this.viewportRows() / 4)))
    this.render()
  }

  // ─── live scatterplot ────────────────────────────────────────────

  /** Round a positive value up to a "nice" 1/2/2.5/5×10^k bound. */
  private static niceCeil(v: number): number {
    if (!(v > 0)) return 1
    const steps = [1, 2, 2.5, 5]
    const p = Math.pow(10, Math.floor(Math.log10(v)))
    for (const s of steps) if (s * p >= v) return s * p
    return 10 * p
  }

  private static decadeLabel(v: number): string {
    if (v >= 1e9) return v / 1e9 + "G"
    if (v >= 1e6) return v / 1e6 + "M"
    if (v >= 1e3) return v / 1e3 + "K"
    return String(v)
  }

  private renderPlot(): void {
    if (!this.plotVisible) {
      this.plotLines.forEach((l) => (l.visible = false))
      return
    }
    const r = this.renderer
    const h = this.plotHeight()
    this.plotBox.height = h
    const innerW = Math.max(10, (r.width ?? 80) - 2)
    const innerH = Math.max(5, h - 2)
    const rows = innerH - 1 // last inner line = decade labels

    while (this.plotLines.length < innerH) {
      const line = new TextRenderable(r, { content: "", height: 1, wrapMode: "none" })
      this.plotLines.push(line)
      this.plotBox.add(line)
    }
    this.plotLines.forEach((line, i) => {
      line.visible = i < innerH
    })
    const axisLine = this.plotLines[innerH - 1]!

    const now = Date.now()
    const tracks = this.store
      .visibleTracks()
      .filter((t) => t.points.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key))

    // ── scales: y linear (nice ceil), x logarithmic (decade bounds)
    let yMax = 100
    let xMin = Infinity
    let xMax = 0
    for (const tr of tracks) {
      for (const p of tr.points) {
        if (p.x > xMax) xMax = p.x
        if (p.x > 0 && p.x < xMin) xMin = p.x
        if (p.y > yMax) yMax = p.y
      }
    }
    yMax = App.niceCeil(yMax)
    const logMin = xMin === Infinity ? Math.log10(10) : Math.floor(Math.log10(Math.max(1, xMin)))
    const logMax = Math.max(logMin + 1, Math.ceil(Math.log10(Math.max(10, xMax))))
    const colOf = (x: number): number => {
      const lx = x <= 1 ? logMin : Math.min(Math.log10(x), logMax)
      const frac = (lx - logMin) / (logMax - logMin)
      return Math.round(frac * (innerW - 1))
    }
    const rowOf = (y: number): number => rows - 1 - Math.round((y / yMax) * (rows - 1))

    // ── canvas
    const blankRow = (): PlotRow => Array.from({ length: innerW }, () => ({ ch: " ", color: TERM.bg }))
    const canvas: PlotRow[] = Array.from({ length: rows }, blankRow)
    const put = (col: number, row: number, ch: string, color: string) => {
      if (row < 0 || row >= rows) return
      const c = Math.max(0, Math.min(innerW - 1, col))
      const cell6 = canvas[row]![c]
      if (cell6) {
        cell6.ch = ch
        cell6.color = color
      }
    }
    const putText = (row: number, col: number, text: string, color: string) => {
      for (let i = 0; i < text.length; i++) put(col + i, row, text[i]!, color)
    }

    // y-range hint top-left (dots drawn later overwrite it)
    putText(0, 0, ` y: 0…${fmtRate(yMax)} tok/min`, TERM.dim)

    // trails first (older points reuse the track color, most recent dominate)
    for (const tr of tracks) {
      const color = TRACK_COLORS[tr.color % TRACK_COLORS.length] ?? TERM.accent
      const glyph = TRACK_MARKERS[tr.marker % TRACK_MARKERS.length] ?? "●"
      const dying = now - tr.lastActive > 5000
      const pts = tr.points
      const keep = Math.min(60, pts.length)
      for (let i = pts.length - keep; i < pts.length - 1; i++) {
        const p = pts[i]!
        put(colOf(p.x), rowOf(p.y), "·", dying ? "#45475a" : color)
      }
      const head = pts[pts.length - 1]!
      put(colOf(head.x), rowOf(head.y), glyph, dying ? "#585b70" : color)
    }

    // ── plot lines from canvas (merge consecutive identical cells)
    for (let ry = 0; ry < rows; ry++) {
      const line = this.plotLines[ry]
      if (!line) continue
      line.content = this.chunksFromCells(canvas[ry]!)
    }

    // ── decade tick labels on the x axis (log scale)
    const axisCells = blankRow()
    for (let d = logMin; d <= logMax; d++) {
      const label = App.decadeLabel(Math.pow(10, d))
      const center = colOf(Math.pow(10, d))
      const start = Math.max(0, Math.round(center - label.length / 2))
      for (let i = 0; i < label.length; i++) {
        const c = start + i
        if (c < 0 || c >= innerW) continue
        const cell9 = axisCells[c]
        if (cell9) {
          cell9.ch = label[i]!
          cell9.color = TERM.dim
        }
      }
    }
    axisLine.content = this.chunksFromCells(axisCells)

    this.plotBox.title = ` scatter · x: tokens(in+out, log) · y: tok/min · ${tracks.length} dot${tracks.length === 1 ? "" : "s"}${
      tracks.length === 0 ? " — waiting for activity" : ""
    } `
  }

  /** StyledText from a row of {ch,color} cells, merging consecutive identical (ch,color). */
  private chunksFromCells(cells: { ch: string; color: string }[]): StyledText {
    const chunks: TextChunk[] = []
    let runCh = ""
    let runColor: string | null = null
    const flush = () => {
      if (!runCh) return
      if (runColor == null || runColor === TERM.bg) chunks.push({ __isChunk: true as const, text: runCh })
      else chunks.push(fg(runColor)(runCh))
      runCh = ""
    }
    for (const c of cells) {
      if (c.color !== runColor) {
        flush()
        runColor = c.color
      }
      runCh += c.ch
    }
    flush()
    return new StyledText(chunks)
  }


  private renderHeader(now: number): void {
    const adapters = this.store.adaptersLive
    const clock = new Date(now).toISOString().slice(11, 19)
    const adapterParts = adapters.map((a) => (a.error ? fg(TERM.red)(a.harness) : fg(TERM.green)(a.harness)))
    let adapterText: StyledText = new StyledText([])
    adapterParts.forEach((p, i) => {
      adapterText =
        i === 0
          ? new StyledText([p])
          : new StyledText([...adapterText.chunks, fg(TERM.dim)(", "), p])
    })
    this.headerTitle.content = new StyledText([
      bg(TERM.accent)(fg("#11111b")(bold(" tktop "))),
      fg(TERM.teal)(" AI token consumption monitor "),
      fg(TERM.dim)("· runtime: "),
      ...adapterText.chunks,
      fg(TERM.dim)(" · " + clock),
    ])

    const totals = this.store.totals(this.store.rows())
    const tk = totals.tokens
    const D = TERM.dim
    const V = (v: string, c: string) => fg(c)(v)
    this.headerTotals.content = new StyledText([
      fg(D)(" sessions "),
      V(String(totals.sessions), TERM.accent),
      fg(D)(" ("),
      V(`${totals.active} active`, TERM.green),
      fg(D)(") · in "),
      V(fmtTokens(tk.input), TERM.accent),
      fg(D)(" out "),
      V(fmtTokens(tk.output), TERM.accent),
      fg(D)(" cache-r "),
      V(fmtTokens(tk.cacheRead), D),
      fg(D)(" rsn "),
      V(fmtTokens(tk.reasoning), TERM.mauve),
      fg(D)(" w "),
      V(fmtTokens(tk.cacheWrite), D),
      fg(D)(" cost "),
      V(fmtCost(totals.cost), TERM.yellow),
      fg(D)(" burn "),
      V(fmtRate(totals.burnRate) + " tok/min", rateColor(totals.burnRate)),
    ])
  }

  private renderFooter(sessionCount: number, width: number): void {
    const errs = this.store.adapterErrors
    if (this.mode !== "filter" && this.mode !== "help") {
      if (errs.length) {
        this.statusLine.content = new StyledText([
          fg(TERM.red)(" ! "),
          fg(TERM.red)(fit(errs.join(" · "), width - 3)),
        ])
      } else {
        this.statusLine.content = new StyledText([
          fg(TERM.dim)(
            ` showing ${sessionCount} sessions${this.store.filter ? ` matching "${this.store.filter}"` : ""}${
              this.store.showArchived ? " (archived included)" : ""
            }`,
          ),
        ])
      }
    }

    const sk = (k: string, label: string) => fg(this.store.sortKey === k ? TERM.accent : TERM.dim)(label)
    this.hotkeys.content = new StyledText([
      fg(TERM.dim)(" sort:"),
      sk("burn", " 1 burn"),
      sk("recent", " · 2 recent"),
      sk("tokens", " · 3 tokens"),
      sk("cost", " · 4 cost"),
      fg(TERM.dim)("  ·  g group: "),
      fg(TERM.accent)(this.store.groupBy),
      fg(TERM.dim)("  ·  a archived:"),
      fg(this.store.showArchived ? TERM.green : TERM.dim)(this.store.showArchived ? "on" : "off"),
      fg(TERM.dim)("  ·  / filter · p scatter · ? help · q quit"),
    ])
  }
}
