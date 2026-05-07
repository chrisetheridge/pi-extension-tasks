import {
  fuzzyMatch,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";

import { statusLabel, statusSymbol, type TaskItem } from "./task-types.ts";
import { type TaskStore } from "./task-store.ts";

export interface ThemeLike {
  fg(kind: string, text: string): string;
  bold?(text: string): string;
  dim?(text: string): string;
}

export interface TaskPanelActions {
  claim(task: TaskItem): Promise<void> | void;
  refine(task: TaskItem): Promise<void> | void;
  complete(task: TaskItem): Promise<void> | void;
  delete(task: TaskItem): Promise<void> | void;
}

type PanelMode = "list" | "actions" | "detail";
type ActionValue = "view" | "claim" | "refine" | "complete" | "delete";

const ACTIONS: Array<{ value: ActionValue; label: string; description: string }> = [
  { value: "view", label: "view", description: "View task text" },
  { value: "claim", label: "claim", description: "Start as user" },
  { value: "refine", label: "refine", description: "Prefill refinement prompt" },
  { value: "complete", label: "complete", description: "Mark complete" },
  { value: "delete", label: "delete", description: "Delete task file" },
];

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\u007f";
}

function isBackspace(data: string): boolean {
  return matchesKey(data, Key.backspace);
}

function isEnter(data: string): boolean {
  return matchesKey(data, Key.enter);
}

function isEscape(data: string): boolean {
  return matchesKey(data, Key.escape);
}

function isUp(data: string): boolean {
  return matchesKey(data, Key.up);
}

function isDown(data: string): boolean {
  return matchesKey(data, Key.down);
}

function taskSearchText(task: TaskItem): string {
  return [task.id, task.title, task.status, task.owner, task.body, task.notes]
    .filter(Boolean)
    .join(" ");
}

function taskMatches(task: TaskItem, query: string): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = taskSearchText(task);
  return tokens.every((token) => fuzzyMatch(token, text).matches);
}

function taskScore(task: TaskItem, query: string): number {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return task.order;
  return tokens.reduce((score, token) => score + fuzzyMatch(token, taskSearchText(task)).score, 0);
}

export class TaskPanel implements Component {
  private readonly unsubscribe: () => void;
  private mode: PanelMode = "list";
  private search = "";
  private selectedIndex = 0;
  private actionIndex = 0;
  private detailScroll = 0;
  private message: string | undefined;

  constructor(
    private readonly store: TaskStore,
    private readonly theme: ThemeLike,
    private readonly requestRender: () => void,
    private readonly onClose?: () => void,
    private readonly actions?: TaskPanelActions,
    private readonly loadErrors: () => string[] = () => [],
  ) {
    this.unsubscribe = store.subscribe(() => {
      this.requestRender();
    });
  }

  invalidate(): void {
    this.requestRender();
  }

  dispose(): void {
    this.unsubscribe();
  }

  handleInput(data: string): void {
    if (this.mode === "actions") {
      this.handleActionInput(data);
      return;
    }
    if (this.mode === "detail") {
      this.handleDetailInput(data);
      return;
    }
    this.handleListInput(data);
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const innerWidth = Math.max(20, width - 2);
    const content =
      this.mode === "actions"
        ? this.renderActions(innerWidth)
        : this.mode === "detail"
          ? this.renderDetail(innerWidth)
          : this.renderList(innerWidth);
    return this.frame(content, innerWidth);
  }

  private handleListInput(data: string): void {
    const tasks = this.filteredTasks();
    if (isEscape(data) || data === "q") {
      this.onClose?.();
      return;
    }
    if (isUp(data)) {
      if (tasks.length > 0)
        this.selectedIndex = this.selectedIndex === 0 ? tasks.length - 1 : this.selectedIndex - 1;
      this.requestRender();
      return;
    }
    if (isDown(data)) {
      if (tasks.length > 0)
        this.selectedIndex = this.selectedIndex === tasks.length - 1 ? 0 : this.selectedIndex + 1;
      this.requestRender();
      return;
    }
    if (isEnter(data)) {
      if (tasks[this.selectedIndex]) {
        this.mode = "actions";
        this.actionIndex = 0;
        this.message = undefined;
      }
      this.requestRender();
      return;
    }
    if (isBackspace(data)) {
      this.search = this.search.slice(0, -1);
      this.selectedIndex = 0;
      this.requestRender();
      return;
    }
    if (isPrintable(data)) {
      this.search += data;
      this.selectedIndex = 0;
      this.requestRender();
    }
  }

  private handleActionInput(data: string): void {
    if (isEscape(data) || data === "q") {
      this.mode = "list";
      this.requestRender();
      return;
    }
    if (isUp(data)) {
      this.actionIndex = this.actionIndex === 0 ? ACTIONS.length - 1 : this.actionIndex - 1;
      this.requestRender();
      return;
    }
    if (isDown(data)) {
      this.actionIndex = this.actionIndex === ACTIONS.length - 1 ? 0 : this.actionIndex + 1;
      this.requestRender();
      return;
    }
    if (isEnter(data)) {
      void this.runSelectedAction();
    }
  }

  private handleDetailInput(data: string): void {
    if (isEscape(data) || data === "q") {
      this.mode = "actions";
      this.requestRender();
      return;
    }
    if (isUp(data)) {
      this.detailScroll = Math.max(0, this.detailScroll - 1);
      this.requestRender();
      return;
    }
    if (isDown(data)) {
      this.detailScroll += 1;
      this.requestRender();
    }
  }

  private async runSelectedAction(): Promise<void> {
    const task = this.selectedTask();
    const action = ACTIONS[this.actionIndex]?.value;
    if (!task || !action) return;
    if (action === "view") {
      this.mode = "detail";
      this.detailScroll = 0;
      this.requestRender();
      return;
    }
    if (!this.actions) return;
    try {
      await this.actions[action](task);
      this.message = `${action} ${task.title}`;
      this.mode = "list";
    } catch (error) {
      this.message = error instanceof Error ? error.message : `Could not ${action} task`;
    }
    this.requestRender();
  }

  private selectedTask(): TaskItem | undefined {
    return this.filteredTasks()[this.selectedIndex];
  }

  private filteredTasks(): TaskItem[] {
    const query = this.search;
    const tasks = this.store.snapshot();
    const filtered = tasks.filter((task) => taskMatches(task, query));
    if (query.trim()) {
      filtered.sort((a, b) => taskScore(a, query) - taskScore(b, query));
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, filtered.length - 1));
    return filtered;
  }

  private renderList(width: number): string[] {
    const tasks = this.store.snapshot();
    const filtered = this.filteredTasks();
    const progress = tasks.filter((task) => task.status === "progress").length;
    const complete = tasks.filter((task) => task.status === "complete").length;
    const lines = [
      this.styleHeader(
        truncateToWidth(
          `Tasks (${tasks.length} total, ${progress} progress, ${complete} complete)`,
          width,
        ),
      ),
      this.theme.fg("dim", truncateToWidth(`Search: ${this.search || ""}`, width)),
    ];
    for (const error of this.loadErrors()) {
      lines.push(this.theme.fg("warning", truncateToWidth(error, width)));
    }
    if (this.message) lines.push(this.theme.fg("dim", truncateToWidth(this.message, width)));
    if (tasks.length === 0) {
      lines.push("");
      lines.push(
        this.theme.fg(
          "muted",
          truncateToWidth("No tasks yet. Sync tasks to create markdown task files.", width),
        ),
      );
      lines.push(
        this.theme.fg(
          "dim",
          truncateToWidth("Enter text after /tasks or use the tasks tool.", width),
        ),
      );
      return lines;
    }
    if (filtered.length === 0) {
      lines.push("");
      lines.push(this.theme.fg("muted", truncateToWidth("No matching tasks.", width)));
      return lines;
    }
    lines.push("");
    const maxVisible = 10;
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(maxVisible / 2), filtered.length - maxVisible),
    );
    const end = Math.min(filtered.length, start + maxVisible);
    for (let index = start; index < end; index += 1) {
      const task = filtered[index]!;
      const selected = index === this.selectedIndex;
      lines.push(this.renderTaskLine(task, selected, width));
    }
    lines.push("");
    lines.push(
      this.theme.fg(
        "dim",
        truncateToWidth("Type to search - arrows select - Enter actions - Esc close", width),
      ),
    );
    return lines;
  }

  private renderActions(width: number): string[] {
    const task = this.selectedTask();
    const lines = [
      this.styleHeader(truncateToWidth(task ? `Actions: ${task.title}` : "Actions", width)),
      this.theme.fg("dim", truncateToWidth("Enter to confirm - Esc back", width)),
      "",
    ];
    for (const [index, action] of ACTIONS.entries()) {
      const prefix = index === this.actionIndex ? "> " : "  ";
      const text = `${prefix}${action.label.padEnd(9)} ${action.description}`;
      lines.push(
        index === this.actionIndex
          ? this.theme.fg("accent", truncateToWidth(text, width))
          : truncateToWidth(text, width),
      );
    }
    return lines;
  }

  private renderDetail(width: number): string[] {
    const task = this.selectedTask();
    if (!task) return [this.styleHeader("Task"), this.theme.fg("muted", "No task selected.")];
    const title = this.styleHeader(truncateToWidth(task.title, width));
    const meta = this.theme.fg(
      "dim",
      truncateToWidth(
        `${task.id} - ${statusLabel(task.status)}${task.owner ? ` - ${task.owner}` : ""}`,
        width,
      ),
    );
    const body = task.body || task.notes || "_No task text._";
    const wrapped = wrapTextWithAnsi(body, width);
    const visible = wrapped.slice(this.detailScroll, this.detailScroll + 14);
    return [
      title,
      meta,
      "",
      ...visible.map((line) => truncateToWidth(line, width)),
      "",
      this.theme.fg("dim", truncateToWidth("Up/down scroll - Esc back", width)),
    ];
  }

  private renderTaskLine(task: TaskItem, selected: boolean, width: number): string {
    const prefix = selected ? "> " : "  ";
    const owner = task.owner ? ` @${task.owner}` : "";
    const raw = `${prefix}[${statusSymbol(task.status)}] ${task.title} (${statusLabel(task.status)}${owner})`;
    const line = truncateToWidth(raw, width);
    if (selected) return this.theme.fg("accent", line);
    if (task.status === "complete") return this.theme.fg("success", line);
    if (task.status === "blocked") return this.theme.fg("warning", line);
    if (task.status === "progress") return this.theme.fg("accent", line);
    if (task.status === "cancelled") return this.theme.fg("muted", line);
    return line;
  }

  private frame(content: string[], width: number): string[] {
    const border = (text: string) => this.theme.fg("borderMuted", text);
    const top = border(`┌${"─".repeat(width)}┐`);
    const bottom = border(`└${"─".repeat(width)}┘`);
    const rows = content.map((line) => {
      const truncated = truncateToWidth(line, width);
      const padding = Math.max(0, width - visibleWidth(truncated));
      return `${border("│")}${truncated}${" ".repeat(padding)}${border("│")}`;
    });
    return [top, ...rows, bottom];
  }

  private styleHeader(text: string): string {
    if (this.theme.bold) return this.theme.bold(text);
    return this.theme.fg("accent", text);
  }
}
