import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import { EphemeralInquiryFlow } from "../../src/hutao/ephemeral-inquiry/flow.ts";

function fakeContext(selections: string[], inputs: Array<string | undefined>): ExtensionCommandContext {
	return {
		cwd: "/repo",
		ui: {
			select: async (_title: string, options: string[]) => {
				const requested = selections.shift();
				const aliases: Record<string, string[]> = {
					"Promote to forkSession": ["Promote to forkSession", "提升为 forkSession"],
					"Ask a read-only question": ["Ask a read-only question", "提出只读问题"],
				};
				const candidates = requested ? [requested, ...(aliases[requested] ?? [])] : [];
				return options.find((option) => candidates.some((candidate) => option.includes(candidate))) ?? options[0];
			},
			input: async () => inputs.shift(),
			notify: vi.fn(),
		},
		sendMessage: vi.fn(),
	} as unknown as ExtensionCommandContext;
}

describe("EphemeralInquiryFlow", () => {
	it("promotes a prompting inquiry with an explicit follow-up message", async () => {
		const forkPrompting = vi.fn(async () => undefined);
		const forkEdit = vi.fn(async () => undefined);
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx: fakeContext(["Promote to forkSession"], ["Continue by adding tests"]),
			target: { kind: "prompting", id: "p_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(forkPrompting).toHaveBeenCalledWith("p_test", "after", "Continue by adding tests");
		expect(forkEdit).not.toHaveBeenCalled();
	});

	it("promotes an edit inquiry without sending a follow-up when input is empty", async () => {
		const forkPrompting = vi.fn(async () => undefined);
		const forkEdit = vi.fn(async () => undefined);
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx: fakeContext(["Promote to forkSession"], [""]),
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(forkEdit).toHaveBeenCalledWith("e_test", "after", undefined);
		expect(forkPrompting).not.toHaveBeenCalled();
	});
});
