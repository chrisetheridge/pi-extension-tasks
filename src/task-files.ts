import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	normalizeTaskOwner,
	normalizeTaskStatus,
	slugifyTaskTitle,
	type TaskItem,
	type TaskOwner,
	type TaskPatch,
	type TaskStatus,
} from "./task-types.ts";

const PROJECT_CONFIG_PATH = ".pi/extensions/tasks/config.json";
const USER_CONFIG_PATH = ".pi/agent/extensions/tasks/config.json";
const DEFAULT_TASK_PATH = ".pi/tasks";
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface TaskConfig {
	tasksDir: string;
	configPath?: string;
	source: "project" | "user" | "default";
	error?: string;
}

export interface TaskLoadResult {
	config: TaskConfig;
	tasks: TaskItem[];
	errors: string[];
}

interface TaskFrontmatter {
	id?: string;
	title?: string;
	status?: TaskStatus;
	owner?: TaskOwner;
	created_at?: string;
	updated_at?: string;
}

interface RawTaskConfig {
	path?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonFile(filePath: string): RawTaskConfig | undefined {
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return isObject(parsed) ? parsed : {};
	} catch {
		return undefined;
	}
}

function resolveConfigPath(cwd: string, configuredPath: unknown): string {
	const rawPath = typeof configuredPath === "string" && configuredPath.trim() ? configuredPath.trim() : DEFAULT_TASK_PATH;
	return path.resolve(cwd, rawPath);
}

export function resolveTaskConfig(cwd: string, homeDir = os.homedir()): TaskConfig {
	const projectConfigPath = path.resolve(cwd, PROJECT_CONFIG_PATH);
	const userConfigPath = path.resolve(homeDir, USER_CONFIG_PATH);
	if (existsSync(projectConfigPath)) {
		const config = parseJsonFile(projectConfigPath);
		if (!config) {
			return {
				tasksDir: path.resolve(cwd, DEFAULT_TASK_PATH),
				configPath: projectConfigPath,
				source: "project",
				error: `Could not read task config ${projectConfigPath}`,
			};
		}
		return {
			tasksDir: resolveConfigPath(cwd, config.path),
			configPath: projectConfigPath,
			source: "project",
		};
	}
	if (existsSync(userConfigPath)) {
		const config = parseJsonFile(userConfigPath);
		if (!config) {
			return {
				tasksDir: path.resolve(cwd, DEFAULT_TASK_PATH),
				configPath: userConfigPath,
				source: "user",
				error: `Could not read task config ${userConfigPath}`,
			};
		}
		return {
			tasksDir: resolveConfigPath(cwd, config.path),
			configPath: userConfigPath,
			source: "user",
		};
	}
	return {
		tasksDir: path.resolve(cwd, DEFAULT_TASK_PATH),
		source: "default",
	};
}

function normalizeTaskId(value: string): string {
	return slugifyTaskTitle(value.replace(/\.md$/i, ""));
}

function getTaskPath(tasksDir: string, id: string): string {
	const normalizedId = normalizeTaskId(id);
	return path.join(tasksDir, `${normalizedId}.md`);
}

function parseDate(value: unknown, fallback: number): number {
	if (typeof value !== "string" || !value.trim()) return fallback;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function toIso(value: number | undefined): string {
	const timestamp = value !== undefined && Number.isFinite(value) ? value : Date.now();
	return new Date(timestamp).toISOString();
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function yamlValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
		try {
			return JSON.parse(trimmed) as string;
		} catch {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function parseFrontmatter(content: string): { frontmatter: TaskFrontmatter; body: string } {
	if (!content.startsWith("---")) {
		return { frontmatter: {}, body: content };
	}
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}
	const frontmatter: TaskFrontmatter = {};
	for (const line of match[1]!.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = yamlValue(line.slice(separator + 1));
		if (key === "id") frontmatter.id = normalizeTaskId(value);
		if (key === "title") frontmatter.title = value;
		if (key === "status") frontmatter.status = normalizeTaskStatus(value);
		if (key === "owner") frontmatter.owner = normalizeTaskOwner(value);
		if (key === "created_at") frontmatter.created_at = value;
		if (key === "updated_at") frontmatter.updated_at = value;
	}
	return {
		frontmatter,
		body: content.slice(match[0].length),
	};
}

export function serializeTaskMarkdown(task: TaskItem): string {
	const createdAt = toIso(task.createdAt ?? task.updatedAt);
	const updatedAt = toIso(task.updatedAt);
	const lines = [
		"---",
		`id: ${yamlString(task.id)}`,
		`title: ${yamlString(task.title || "Untitled task")}`,
		`status: ${task.status}`,
		task.owner ? `owner: ${task.owner}` : undefined,
		`created_at: ${yamlString(createdAt)}`,
		`updated_at: ${yamlString(updatedAt)}`,
		"---",
		"",
	].filter((line): line is string => line !== undefined);
	const body = task.body ?? task.notes ?? "";
	const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
	return `${lines.join("\n")}${trimmedBody ? `${trimmedBody}\n` : ""}`;
}

export function parseTaskMarkdown(content: string, fallbackId: string, order = 0, fallbackNow = Date.now()): TaskItem {
	const { frontmatter, body } = parseFrontmatter(content);
	const id = normalizeTaskId(frontmatter.id || fallbackId);
	const title = frontmatter.title?.trim() || id.replace(/-/g, " ") || "Untitled task";
	const createdAt = parseDate(frontmatter.created_at, fallbackNow);
	const updatedAt = parseDate(frontmatter.updated_at, createdAt);
	return {
		id,
		title,
		status: normalizeTaskStatus(frontmatter.status),
		order,
		source: "markdown",
		owner: frontmatter.owner,
		body: body.trim() || undefined,
		notes: body.trim() || undefined,
		createdAt,
		updatedAt,
	};
}

export async function loadTasks(cwd: string): Promise<TaskLoadResult> {
	const config = resolveTaskConfig(cwd);
	const errors: string[] = [];
	if (config.error) errors.push(config.error);
	let entries: string[] = [];
	try {
		entries = await fs.readdir(config.tasksDir);
	} catch (error) {
		const code = isObject(error) && typeof error.code === "string" ? error.code : undefined;
		if (code !== "ENOENT") errors.push(`Could not read task directory ${config.tasksDir}`);
		return { config, tasks: [], errors };
	}
	const markdownEntries = entries.filter((entry) => entry.endsWith(".md")).sort((a, b) => a.localeCompare(b));
	const tasks: TaskItem[] = [];
	for (const [index, entry] of markdownEntries.entries()) {
		const fallbackId = normalizeTaskId(entry);
		if (!TASK_ID_PATTERN.test(fallbackId)) {
			errors.push(`Skipped invalid task filename ${entry}`);
			continue;
		}
		try {
			const filePath = path.join(config.tasksDir, entry);
			const content = await fs.readFile(filePath, "utf8");
			tasks.push(parseTaskMarkdown(content, fallbackId, index));
		} catch {
			errors.push(`Could not read task file ${entry}`);
		}
	}
	return { config, tasks, errors };
}

async function ensureTaskDir(tasksDir: string): Promise<void> {
	await fs.mkdir(tasksDir, { recursive: true });
}

export function deriveTaskId(title: string, existingIds: Set<string>): string {
	const base = `task-${slugifyTaskTitle(title)}`;
	let candidate = base;
	let suffix = 2;
	while (existingIds.has(candidate)) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	existingIds.add(candidate);
	return candidate;
}

export async function writeTask(tasksDir: string, task: TaskItem): Promise<TaskItem> {
	await ensureTaskDir(tasksDir);
	const normalized = {
		...task,
		id: normalizeTaskId(task.id),
		title: task.title.trim() || "Untitled task",
		status: normalizeTaskStatus(task.status),
		body: task.body?.trim() || task.notes?.trim() || undefined,
		notes: task.notes?.trim() || task.body?.trim() || undefined,
		createdAt: task.createdAt ?? Date.now(),
		updatedAt: task.updatedAt ?? Date.now(),
	};
	if (normalized.status === "complete" || normalized.status === "cancelled") {
		normalized.owner = undefined;
	}
	const filePath = getTaskPath(tasksDir, normalized.id);
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmpPath, serializeTaskMarkdown(normalized), "utf8");
	await fs.rename(tmpPath, filePath);
	return normalized;
}

export async function deleteTask(tasksDir: string, id: string): Promise<void> {
	await fs.unlink(getTaskPath(tasksDir, id));
}

export async function clearTasks(tasksDir: string): Promise<number> {
	let entries: string[] = [];
	try {
		entries = await fs.readdir(tasksDir);
	} catch {
		return 0;
	}
	const markdownEntries = entries.filter((entry) => entry.endsWith(".md"));
	await Promise.all(markdownEntries.map((entry) => fs.unlink(path.join(tasksDir, entry))));
	return markdownEntries.length;
}

export function mergeTaskPatch(task: TaskItem, patch: TaskPatch): TaskItem {
	const updated: TaskItem = {
		...task,
		title: patch.title?.trim() || task.title,
		status: patch.status ? normalizeTaskStatus(patch.status) : task.status,
		owner: "owner" in patch ? patch.owner : task.owner,
		body: patch.body !== undefined ? patch.body : task.body,
		notes: patch.notes !== undefined ? patch.notes : task.notes,
		createdAt: patch.createdAt ?? task.createdAt,
		updatedAt: patch.updatedAt ?? Date.now(),
	};
	if (updated.status === "complete" || updated.status === "cancelled") {
		updated.owner = undefined;
	}
	return updated;
}
