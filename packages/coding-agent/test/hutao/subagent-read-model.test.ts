import { describe, expect, it } from "vitest";
import type { HutaoEvent } from "../../src/hutao/event-store.ts";
import { findSubagentRecord, getSubagentRecords } from "../../src/hutao/subagent/read-model.ts";

function event(type: HutaoEvent["type"], id: string, fields: Record<string, unknown> = {}): HutaoEvent {
	return { schema_version: "0.1.0", type, id, session_id: "sess_test", ...fields };
}

describe("Hutao subagent read model", () => {
	it("aggregates started and finished lifecycle events into one record", () => {
		const events: HutaoEvent[] = [
			event("subagent_started", "sa_1", {
				parent_prompting: "p_1",
				name: "security-reviewer",
				role: "review",
				task: "check auth flow",
				status: "started",
				created_at: "2026-01-01T00:00:00.000Z",
			}),
			event("subagent_finished", "sa_1", {
				parent_prompting: "p_1",
				name: "security-reviewer",
				summary: "No critical issues found.",
				status: "completed",
				ended_at: "2026-01-01T00:00:10.000Z",
			}),
			event("run_finished", "r_1", { parent_subagent: "sa_1" }),
			event("edit", "e_1", { parent_subagent: "sa_1" }),
		];

		const records = getSubagentRecords(events);

		expect(records).toEqual([
			expect.objectContaining({
				id: "sa_1",
				parentPrompting: "p_1",
				name: "security-reviewer",
				role: "review",
				status: "completed",
				summary: "No critical issues found.",
				runIds: ["r_1"],
				editIds: ["e_1"],
				degraded: false,
			}),
		]);
	});

	it("keeps started-only lifecycle records as incomplete instead of inventing completion", () => {
		const records = getSubagentRecords([
			event("subagent_started", "sa_started", { parent_prompting: "p_1", name: "planner" }),
		]);

		expect(records[0]).toMatchObject({ id: "sa_started", status: "started", degraded: true });
		expect(records[0].summary).toBeUndefined();
	});

	it("keeps finished-only lifecycle records as degraded evidence", () => {
		const records = getSubagentRecords([
			event("subagent_finished", "sa_finished", { parent_prompting: "p_1", summary: "done" }),
		]);

		expect(records[0]).toMatchObject({ id: "sa_finished", status: "completed", degraded: true });
		expect(records[0].summary).toBe("done");
	});

	it("finds records by id prefix and preserves linked message ids", () => {
		const events: HutaoEvent[] = [
			event("subagent", "sa_inline", { name: "inline", message_ids: ["msg_1", "msg_2"] }),
		];

		expect(findSubagentRecord(events, "sa_in")).toMatchObject({
			id: "sa_inline",
			name: "inline",
			messageIds: ["msg_1", "msg_2"],
			degraded: false,
		});
	});
});
