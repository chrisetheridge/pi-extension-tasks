import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	clearTasks,
	deleteTask,
	deriveTaskId,
	loadTasks,
	mergeTaskPatch,
	writeTask,
	type TaskConfig,
} from "./task-files.ts";
import { normalizeTaskInput, summarizeTaskList } from "./task-normalize.ts";
import { TaskPanel, type TaskPanelActions, type ThemeLike as PanelThemeLike } from "./task-panel.ts";
import { TaskStore, createTaskStore } from "./task-store.ts";
import { normalizeTaskStatus, type TaskItem, type TaskOwner, type TaskPatch, type TaskStatus } from "./task-types.ts";

const TASK_PANEL_KEY = "tasks";
const TASK_PANEL_SHORTCUT = "ctrl+shift+t";

const TASK_TOOL_PARAMS = Type.Object({
	operation: Type.Union([
		Type.Literal("sync"),
		Type.Literal("upsert"),
		Type.Literal("update"),
		Type.Literal("complete"),
		Type.Literal("block"),
		Type.Literal("remove"),
		Type.Literal("activate"),
		Type.Literal("snapshot"),
		Type.Literal("show"),
		Type.Literal("hide"),
	]),
	input: Type.Optional(Type.Any()),
	task: Type.Optional(Type.Any()),
	tasks: Type.Optional(Type.Any()),
	taskId: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	source: Type.Optional(Type.String()),
	sourceRef: Type.Optional(Type.String()),
	replace: Type.Optional(Type.Boolean()),
	open: Type.Optional(Type.Boolean()),
});

type TaskToolParams = {
	operation: string;
	input?: unknown;
	task?: unknown;
	tasks?: unknown;
	taskId?: string;
	note?: string;
	source?: string;
	sourceRef?: string;
	replace?: boolean;
	open?: boolean;
};

interface RuntimeState {
	store: TaskStore;
	config?: TaskConfig;
	loadErrors: string[];
	panelOpen: boolean;
	panelClose?: () => void;
	panelPromise?: Promise<void>;
}

interface ToolExecutionResult {
	content: Array<{ type: "text"; text: string }>;
	details: { tasks: TaskItem[] };
}

const runtimeBySessionManager = new WeakMap<object, RuntimeState>();

function getRuntime(ctx: ExtensionContext): RuntimeState {
	const key = ctx.sessionManager as unknown as object;
	let runtime = runtimeBySessionManager.get(key);
	if (!runtime) {
		runtime = { store: createTaskStore(), loadErrors: [], panelOpen: false };
		runtimeBySessionManager.set(key, runtime);
	}
	return runtime;
}

function updateFooterStatus(ctx: ExtensionContext, store: TaskStore): void {
	const snapshot = store.snapshot();
	const summary = snapshot.length > 0 ? summarizeTaskList(snapshot) : undefined;
	ctx.ui.setStatus(TASK_PANEL_KEY, summary);
}

async function refreshRuntime(ctx: ExtensionContext, runtime: RuntimeState): Promise<void> {
	const result = await loadTasks(ctx.cwd);
	runtime.config = result.config;
	runtime.loadErrors = result.errors;
	runtime.store.replace(result.tasks);
	updateFooterStatus(ctx, runtime.store);
}

function closePanel(runtime: RuntimeState): void {
	runtime.panelClose?.();
}

async function ensureRuntimeLoaded(ctx: ExtensionContext, runtime: RuntimeState): Promise<TaskConfig> {
	if (!runtime.config) {
		await refreshRuntime(ctx, runtime);
	}
	return runtime.config!;
}

function taskById(store: TaskStore, taskId?: string): TaskItem | undefined {
	if (!taskId) return undefined;
	return store.snapshot().find((task) => task.id === taskId);
}

function taskByInput(store: TaskStore, input: unknown, source: string, sourceRef?: string): TaskItem | undefined {
	const candidate = normalizeTaskInput(input, source, { sourceRef })[0];
	if (!candidate) return undefined;
	return store.snapshot().find((task) => task.id === candidate.id || task.title.toLowerCase() === candidate.title.toLowerCase());
}

function normalizeForWrite(task: TaskItem, order: number, existingIds: Set<string>): TaskItem {
	const id = task.id?.trim() || deriveTaskId(task.title, existingIds);
	existingIds.add(id);
	const now = Date.now();
	return {
		...task,
		id,
		order,
		status: normalizeTaskStatus(task.status),
		body: task.body ?? task.notes,
		notes: task.notes ?? task.body,
		createdAt: task.createdAt ?? now,
		updatedAt: task.updatedAt ?? now,
	};
}

async function writeTaskSet(ctx: ExtensionContext, runtime: RuntimeState, tasks: TaskItem[], replace: boolean): Promise<void> {
	const config = await ensureRuntimeLoaded(ctx, runtime);
	const existing = replace ? [] : runtime.store.snapshot();
	if (replace) {
		await clearTasks(config.tasksDir);
	}
	const existingById = new Map(existing.map((task) => [task.id, task]));
	const existingIds = new Set(existing.map((task) => task.id));
	for (const [index, task] of tasks.entries()) {
		const current = existingById.get(task.id);
		const prepared = normalizeForWrite(
			current
				? {
						...current,
						...task,
						body: task.body ?? task.notes ?? current.body,
						notes: task.notes ?? task.body ?? current.notes,
					}
				: task,
			index,
			existingIds,
		);
		await writeTask(config.tasksDir, prepared);
	}
	await refreshRuntime(ctx, runtime);
}

async function applySync(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): Promise<string> {
	await refreshRuntime(ctx, runtime);
	const source = params.source?.trim() || "planner";
	const tasks = normalizeTaskInput(params.input ?? params.tasks ?? params.task ?? [], source, {
		sourceRef: params.sourceRef,
	});
	await writeTaskSet(ctx, runtime, tasks, params.replace !== false);
	if (params.open) openPanel(ctx, runtime);
	return `synced ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
}

async function applyUpsert(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): Promise<string> {
	await refreshRuntime(ctx, runtime);
	const source = params.source?.trim() || "agent";
	const tasks = normalizeTaskInput(params.input ?? params.tasks ?? params.task ?? [], source, {
		sourceRef: params.sourceRef,
	});
	await writeTaskSet(ctx, runtime, tasks, false);
	if (params.open) openPanel(ctx, runtime);
	return `upserted ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
}

async function applyPatch(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): Promise<string> {
	await refreshRuntime(ctx, runtime);
	const task =
		taskById(runtime.store, params.taskId) ??
		taskByInput(runtime.store, params.task, params.source?.trim() || "agent", params.sourceRef);
	if (!task) return "no matching task";
	const rawTask = params.task && typeof params.task === "object" ? (params.task as Record<string, unknown>) : undefined;
	const patch: TaskPatch = {
		title: typeof rawTask?.title === "string" ? rawTask.title : undefined,
		notes: params.note,
		body: params.note,
	};
	if (params.operation === "complete") patch.status = "complete";
	if (params.operation === "block") patch.status = "blocked";
	if (params.operation === "activate") {
		patch.status = "progress";
		patch.owner = "agent";
	}
	if (rawTask) {
		patch.title = typeof rawTask.title === "string" ? rawTask.title : patch.title;
		patch.status = rawTask.status ? (rawTask.status as TaskStatus) : patch.status;
		patch.owner = rawTask.owner ? (rawTask.owner as TaskOwner) : patch.owner;
		patch.body = typeof rawTask.body === "string" ? rawTask.body : patch.body;
		patch.notes = typeof rawTask.notes === "string" ? rawTask.notes : patch.notes;
	}
	const config = await ensureRuntimeLoaded(ctx, runtime);
	const updated = mergeTaskPatch(task, patch);
	await writeTask(config.tasksDir, updated);
	await refreshRuntime(ctx, runtime);
	if (params.open) openPanel(ctx, runtime);
	const verb =
		params.operation === "block"
			? "blocked"
			: params.operation === "activate"
				? "activated"
				: params.operation === "complete"
					? "completed"
					: "updated";
	return `${verb} ${task.title}`;
}

async function applyRemove(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): Promise<string> {
	await refreshRuntime(ctx, runtime);
	const task =
		taskById(runtime.store, params.taskId) ??
		taskByInput(runtime.store, params.task, params.source?.trim() || "agent", params.sourceRef);
	if (!task) return "no matching task";
	const config = await ensureRuntimeLoaded(ctx, runtime);
	await deleteTask(config.tasksDir, task.id);
	await refreshRuntime(ctx, runtime);
	return `removed ${task.title}`;
}

function applySnapshot(runtime: RuntimeState): string {
	const tasks = runtime.store.snapshot();
	if (tasks.length === 0) return "no tasks";
	return tasks
		.map((task) => `${task.id}: ${task.title} [${task.status}${task.owner ? ` @${task.owner}` : ""}]`)
		.join("\n");
}

function buildRefinePrompt(task: TaskItem): string {
	const body = task.body || task.notes || "";
	return [
		`Let's refine task ${task.id} "${task.title}".`,
		"Ask me for the missing details needed to refine the task together.",
		"Do not rewrite the task file yet and do not make assumptions.",
		body ? `\nCurrent task text:\n${body}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function getPanelActions(ctx: ExtensionContext, runtime: RuntimeState): TaskPanelActions {
	return {
		claim: async (task) => {
			const config = await ensureRuntimeLoaded(ctx, runtime);
			await writeTask(config.tasksDir, mergeTaskPatch(task, { status: "progress", owner: "user" }));
			await refreshRuntime(ctx, runtime);
		},
		refine: (task) => {
			ctx.ui.setEditorText(buildRefinePrompt(task));
			closePanel(runtime);
		},
		complete: async (task) => {
			const config = await ensureRuntimeLoaded(ctx, runtime);
			await writeTask(config.tasksDir, mergeTaskPatch(task, { status: "complete", owner: undefined }));
			await refreshRuntime(ctx, runtime);
		},
		delete: async (task) => {
			const confirmed = await ctx.ui.confirm("Delete task?", `Delete "${task.title}" from disk?`);
			if (!confirmed) return;
			const config = await ensureRuntimeLoaded(ctx, runtime);
			await deleteTask(config.tasksDir, task.id);
			await refreshRuntime(ctx, runtime);
		},
	};
}

function openPanel(ctx: ExtensionContext, runtime: RuntimeState): void {
	if (!ctx.hasUI) return;
	void refreshRuntime(ctx, runtime);
	if (runtime.panelOpen) {
		return;
	}
	runtime.panelOpen = true;
	const promise = ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			runtime.panelClose = () => done();
			return new TaskPanel(
				runtime.store,
				theme as PanelThemeLike,
				() => tui.requestRender(),
				() => closePanel(runtime),
				getPanelActions(ctx, runtime),
				() => runtime.loadErrors,
			);
		},
	);
	runtime.panelPromise = Promise.resolve(promise)
		.catch(() => undefined)
		.finally(() => {
			runtime.panelOpen = false;
			runtime.panelClose = undefined;
		});
}

async function runTaskCommand(ctx: ExtensionContext, args: string): Promise<void> {
	const runtime = getRuntime(ctx);
	const trimmedArgs = args.trim();
	if (!trimmedArgs) {
		if (runtime.panelOpen) {
			closePanel(runtime);
			return;
		}
		openPanel(ctx, runtime);
		return;
	}
	await applySync(runtime, ctx, { operation: "sync", input: args, source: "manual", open: true });
}

async function executeTaskTool(ctx: ExtensionContext, params: TaskToolParams): Promise<string> {
	const runtime = getRuntime(ctx);
	switch (params.operation) {
		case "sync":
			return applySync(runtime, ctx, params);
		case "upsert":
			return applyUpsert(runtime, ctx, params);
		case "update":
		case "complete":
		case "block":
		case "activate":
			return applyPatch(runtime, ctx, params);
		case "remove":
			return applyRemove(runtime, ctx, params);
		case "snapshot":
			await refreshRuntime(ctx, runtime);
			return applySnapshot(runtime);
		case "show":
			await refreshRuntime(ctx, runtime);
			openPanel(ctx, runtime);
			return "task panel shown";
		case "hide":
			closePanel(runtime);
			return "task panel hidden";
		default:
			return "unknown operation";
	}
}

export default function taskOverlayExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "tasks",
		label: "Tasks",
		description: "Sync, update, and inspect markdown-backed task files",
		promptSnippet: "Use the tasks tool to keep markdown-backed task files synchronized with the live task panel.",
		promptGuidelines: [
			"When work changes, use tasks to sync or update the canonical markdown task files.",
			"Accept upstream plans in plain JSON, markdown checklists, or simple text.",
			"Use tasks activate when the agent starts work, and tasks complete when work is finished.",
		],
		parameters: TASK_TOOL_PARAMS,
		executionMode: "sequential",
		renderShell: "default",
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const message = await executeTaskTool(ctx, params as TaskToolParams);
			const result: ToolExecutionResult = {
				content: [{ type: "text", text: message }],
				details: { tasks: getRuntime(ctx).store.snapshot() },
			};
			return result;
		},
	});

	pi.registerCommand("tasks", {
		description: "Open the task panel or sync tasks when text is provided",
		handler: async (args: string, ctx: ExtensionContext) => {
			await runTaskCommand(ctx, args);
		},
	});

	pi.registerShortcut(TASK_PANEL_SHORTCUT, {
		description: "Toggle the task panel",
		handler: async (ctx: ExtensionContext) => {
			const runtime = getRuntime(ctx);
			if (runtime.panelOpen) {
				closePanel(runtime);
				return;
			}
			openPanel(ctx, runtime);
		},
	});

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		const runtime = getRuntime(ctx);
		await refreshRuntime(ctx, runtime);
	});

	pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
		const runtime = getRuntime(ctx);
		closePanel(runtime);
		ctx.ui.setStatus(TASK_PANEL_KEY, undefined);
	});
}
