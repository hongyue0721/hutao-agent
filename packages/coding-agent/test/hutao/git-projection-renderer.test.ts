import { describe, expect, it } from "vitest";
import type { HutaoEvent } from "../../src/hutao/event-store.ts";
import { renderGitCommitProjection, renderGitGraphProjection } from "../../src/hutao/git-projection-renderer.ts";

function event(type: HutaoEvent["type"], id: string, fields: Record<string, unknown> = {}): HutaoEvent {
	return { schema_version: "0.1.0", type, id, session_id: "sess_test", ...fields };
}

describe("git projection renderer", () => {
	it("renders commit projection with link evidence and derived relations", () => {
		const events: HutaoEvent[] = [
			event("prompting", "p_1", { text: "fix auth" }),
			event("run_finished", "r_1", { parent_prompting: "p_1", tool: "bash", status: "completed" }),
			event("edit", "e_1", { parent_prompting: "p_1", parent_run: "r_1", files: ["src/auth.ts"] }),
			event("commit_link", "cl_1", {
				commit: "abc123",
				edit_ids: ["e_1"],
				link_method: "patch_match",
			}),
			event("merge", "m_1", {
				source_session: "sess_source",
				target_session: "sess_test",
				mode: "apply_tree",
				status: "conflict",
				conflict_edits: ["e_1"],
				skipped_edits: ["e_1"],
				resolution_edits: [],
			}),
			event("edit_reverted", "er_1", { edit_id: "e_1", revert_edit_id: "e_2" }),
			event("fork_session", "fs_1", {
				session_id: "fs_1",
				parent_session: "sess_test",
				fork_from_type: "edit",
				fork_from_id: "e_1",
				fork_mode: "after",
			}),
		];

		const lines = renderGitCommitProjection({
			events,
			commit: "abc123",
			subject: "fix auth",
			parents: ["parent1"],
			status: "clean",
		});

		expect(lines.join("\n")).toContain("Hutao commit_link events: 1");
		expect(lines.join("\n")).toContain("method=patch_match confidence=medium confirmed=inferred");
		expect(lines.join("\n")).toContain("Promptings: 1");
		expect(lines.join("\n")).toContain("Runs: 1");
		expect(lines.join("\n")).toContain("Edits: 1");
		expect(lines.join("\n")).toContain("Related merges: 1");
		expect(lines.join("\n")).toContain("Related conflicts: 1");
		expect(lines.join("\n")).toContain("Related reverts: 1");
		expect(lines.join("\n")).toContain("Related forks: 1");
		expect(lines.join("\n")).toContain("Apply Final Snapshot / snapshot-diff apply");
	});

	it("renders graph projection summaries with file filtering", () => {
		const events: HutaoEvent[] = [
			event("prompting", "p_1", { text: "fix auth" }),
			event("run_finished", "r_1", { parent_prompting: "p_1" }),
			event("edit", "e_1", { parent_prompting: "p_1", parent_run: "r_1", files: ["src/auth.ts"] }),
			event("commit_link", "cl_1", { commit: "abc123", edit_ids: ["e_1"], link_method: "explicit_command" }),
			event("commit_link", "cl_2", { commit: "def456", edit_ids: ["e_other"], link_method: "manual" }),
		];

		const lines = renderGitGraphProjection({
			events,
			head: "abc123",
			status: "clean",
			range: "--max-count=20",
			fileFilter: "auth.ts",
			graphLines: ["* abc123 commit"],
		});

		const text = lines.join("\n");
		expect(text).toContain("HEAD: abc123");
		expect(text).toContain(
			"Commit abc123 links=1 method=explicit_command confidence=high promptings=1 runs=1 edits=1 merges=0 conflicts=0 reverts=0 forks=0",
		);
		expect(text).not.toContain("Commit def456");
	});
});
