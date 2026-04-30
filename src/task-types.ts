export type TaskStatus = "pending" | "progress" | "blocked" | "complete" | "cancelled";
export type TaskOwner = "user" | "agent";

export interface TaskItem {
	id: string;
	title: string;
	status: TaskStatus;
	order: number;
	source: string;
	sourceRef?: string;
	parentId?: string;
	owner?: TaskOwner;
	notes?: string;
	body?: string;
	createdAt?: number;
	updatedAt: number;
}

export interface TaskPatch {
	title?: string;
	status?: TaskStatus;
	source?: string;
	sourceRef?: string;
	parentId?: string;
	owner?: TaskOwner;
	notes?: string;
	body?: string;
	order?: number;
	createdAt?: number;
	updatedAt?: number;
}

export type TaskEvent =
	| { kind: "replace"; tasks: TaskItem[] }
	| { kind: "merge"; tasks: TaskItem[] }
	| { kind: "patch"; id: string; patch: TaskPatch }
	| { kind: "remove"; id: string }
	| { kind: "activate"; id: string; note?: string };

export function isTaskStatus(value: unknown): value is TaskStatus {
	return (
		value === "pending" || value === "progress" || value === "blocked" || value === "complete" || value === "cancelled"
	);
}

export function isTaskOwner(value: unknown): value is TaskOwner {
	return value === "user" || value === "agent";
}

export function normalizeTaskStatus(value: unknown): TaskStatus {
	if (isTaskStatus(value)) return value;
	if (typeof value === "boolean") return value ? "complete" : "pending";
	if (typeof value === "number") return value > 0 ? "complete" : "pending";
	if (typeof value === "string") {
		const normalized = value
			.trim()
			.toLowerCase()
			.replace(/[\s_-]+/g, "_");
		if (normalized === "open" || normalized === "pending") return "pending";
		if (
			normalized === "doing" ||
			normalized === "doing_now" ||
			normalized === "active" ||
			normalized === "in_progress" ||
			normalized === "progress"
		)
			return "progress";
		if (normalized === "blocked" || normalized === "waiting") return "blocked";
		if (normalized === "done" || normalized === "complete" || normalized === "completed" || normalized === "shipped")
			return "complete";
		if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
	}
	return "pending";
}

export function normalizeTaskOwner(value: unknown): TaskOwner | undefined {
	if (isTaskOwner(value)) return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "user" || normalized === "human" || normalized === "me") return "user";
	if (normalized === "agent" || normalized === "assistant" || normalized === "ai") return "agent";
	return undefined;
}

export function statusSymbol(status: TaskStatus): string {
	switch (status) {
		case "complete":
			return "✓";
		case "progress":
			return "~";
		case "blocked":
			return "!";
		case "cancelled":
			return "×";
		default:
			return " ";
	}
}

export function statusLabel(status: TaskStatus): string {
	switch (status) {
		case "complete":
			return "complete";
		case "progress":
			return "progress";
		case "blocked":
			return "blocked";
		case "cancelled":
			return "cancelled";
		default:
			return "pending";
	}
}

export function slugifyTaskTitle(title: string): string {
	const base = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return base || "task";
}

export function cloneTask(task: TaskItem): TaskItem {
	return {
		...task,
	};
}

export function isTaskItem(value: unknown): value is Partial<TaskItem> {
	return !!value && typeof value === "object";
}
