import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import taskOverlayExtension from "../src/index.ts";

function makePi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const handlers = new Map<string, any>();
	const pi = {
		registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
		registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
		registerShortcut: vi.fn((shortcut: string, shortcutDef: any) => shortcuts.set(shortcut, shortcutDef)),
		on: vi.fn((event: string, handler: any) => handlers.set(event, handler)),
		sendMessage: vi.fn(async () => {}),
	};
	return { pi, tools, commands, shortcuts, handlers };
}

async function tempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "pi-extension-tasks-"));
}

function makeCtx(cwd: string) {
	const setStatus = vi.fn();
	const setEditorText = vi.fn();
	const confirm = vi.fn(async () => true);
	const handles: Array<any> = [];
	const ui = {
		setStatus,
		setEditorText,
		confirm,
		custom: vi.fn(async (_factory: any, options: any) => {
			const hidden = { value: false };
			const handle = {
				setHidden: vi.fn((nextHidden: boolean) => {
					hidden.value = nextHidden;
				}),
				hide: vi.fn(),
				focus: vi.fn(),
				unfocus: vi.fn(),
				isHidden: vi.fn(() => hidden.value),
			};
			handles.push({ options, handle, factory: _factory });
			options?.onHandle?.(handle);
			return undefined;
		}),
	};
	return {
		ctx: {
			cwd,
			hasUI: true,
			ui,
			sessionManager: {
				getEntries: () => [],
			},
			model: undefined,
		},
		setStatus,
		setEditorText,
		confirm,
		handles,
	};
}

describe("task overlay extension", () => {
	it("registers the markdown-backed tasks tool, command, and shortcut", () => {
		const { pi, commands } = makePi();
		taskOverlayExtension(pi as never);

		expect(pi.registerTool).toHaveBeenCalled();
		expect(commands.has("tasks")).toBe(true);
		expect(commands.has("clear-tasks")).toBe(false);
		expect(pi.registerShortcut).toHaveBeenCalled();
	});

	it("syncs tasks to markdown files without forcing the overlay open", async () => {
		const { pi, tools, handlers } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const cwd = await tempDir();
		const { ctx, setStatus, handles } = makeCtx(cwd);
		const startHandler = handlers.get("session_start") as ((event: any, ctx: any) => Promise<void>) | undefined;
		await startHandler?.({ type: "session_start", reason: "startup" }, ctx);

		const result = await tool.execute(
			"tool-1",
			{ operation: "sync", input: "- [ ] Draft plan\n- [x] Implement overlay" },
			undefined,
			undefined,
			ctx,
		);

		const files = await fs.readdir(path.join(cwd, ".pi/tasks"));
		expect(files.sort()).toEqual(["task-draft-plan.md", "task-implement-overlay.md"]);
		expect(await fs.readFile(path.join(cwd, ".pi/tasks/task-implement-overlay.md"), "utf8")).toContain(
			"status: complete",
		);
		expect(setStatus).toHaveBeenCalledWith("tasks", expect.stringContaining("2"));
		expect(handles.length).toBe(0);
		expect(result.content).toMatchObject([{ type: "text", text: expect.stringContaining("synced") }]);
	});

	it("honors project extension config for the task path", async () => {
		const { pi, tools } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const cwd = await tempDir();
		await fs.mkdir(path.join(cwd, ".pi/extensions/tasks"), { recursive: true });
		await fs.writeFile(path.join(cwd, ".pi/extensions/tasks/config.json"), JSON.stringify({ path: "work/tasks" }));
		const { ctx } = makeCtx(cwd);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);

		expect(await fs.readdir(path.join(cwd, "work/tasks"))).toEqual(["task-draft-plan.md"]);
	});

	it("updates, activates, completes, removes, and snapshots markdown tasks", async () => {
		const { pi, tools } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const cwd = await tempDir();
		const { ctx } = makeCtx(cwd);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);
		await tool.execute(
			"tool-2",
			{ operation: "upsert", task: { title: "Ship feature", body: "Release notes" } },
			undefined,
			undefined,
			ctx,
		);
		await tool.execute(
			"tool-3",
			{ operation: "activate", taskId: "task-draft-plan", note: "Working now" },
			undefined,
			undefined,
			ctx,
		);
		expect((await tool.execute("tool-4", { operation: "snapshot" }, undefined, undefined, ctx)).content[0].text).toContain(
			"task-draft-plan: Draft plan [progress @agent]",
		);

		await tool.execute("tool-5", { operation: "complete", taskId: "task-draft-plan" }, undefined, undefined, ctx);
		expect((await tool.execute("tool-6", { operation: "snapshot" }, undefined, undefined, ctx)).content[0].text).toContain(
			"task-draft-plan: Draft plan [complete]",
		);

		await tool.execute("tool-7", { operation: "remove", taskId: "task-draft-plan" }, undefined, undefined, ctx);
		expect((await tool.execute("tool-8", { operation: "snapshot" }, undefined, undefined, ctx)).content[0].text).not.toContain(
			"task-draft-plan",
		);
	});

	it("can reopen the centered task overlay after closing it", async () => {
		const { pi, tools } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const cwd = await tempDir();
		const { ctx, handles } = makeCtx(cwd);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);
		await tool.execute("tool-2", { operation: "show" }, undefined, undefined, ctx);
		const handle = handles[0]?.handle;
		expect(handles[0]?.options.overlayOptions).toMatchObject({
			anchor: "center",
			width: "72%",
			maxHeight: "85%",
		});
		const component = handles[0]?.factory(
			{ requestRender: vi.fn() },
			{ fg: (_: string, text: string) => text, bold: (text: string) => text, dim: (text: string) => text },
		);
		component.handleInput("\u001b");
		expect(handle.setHidden).toHaveBeenCalledWith(true);

		await tool.execute("tool-3", { operation: "show" }, undefined, undefined, ctx);
		expect(handle.setHidden).toHaveBeenCalledWith(false);
	});

	it("syncs command text into markdown tasks", async () => {
		const { pi, commands } = makePi();
		taskOverlayExtension(pi as never);
		const tasksCommand = commands.get("tasks") as any;
		const cwd = await tempDir();
		const { ctx } = makeCtx(cwd);

		await tasksCommand.handler("- [ ] Draft plan", ctx);

		expect(await fs.readdir(path.join(cwd, ".pi/tasks"))).toEqual(["task-draft-plan.md"]);
	});
});
