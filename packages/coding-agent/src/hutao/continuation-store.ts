import type { ForkMode, ForkSourceType } from "./fork-session-manager.ts";

export type ContinuationSourceType = Extract<ForkSourceType, "prompting" | "edit">;

export interface ArmedHistoricalContinuation {
	repoRoot: string;
	sourceType: ContinuationSourceType;
	sourceId: string;
	mode: ForkMode;
	title?: string;
	armedAt: string;
}

export interface ArmedContinuationStore {
	arm(context: Omit<ArmedHistoricalContinuation, "armedAt"> & { armedAt?: string }): ArmedHistoricalContinuation;
	peek(repoRoot: string): ArmedHistoricalContinuation | undefined;
	consume(repoRoot: string): ArmedHistoricalContinuation | undefined;
	clear(repoRoot: string): void;
	clearAll(): void;
}

export class MemoryArmedContinuationStore implements ArmedContinuationStore {
	private readonly armedByRepo = new Map<string, ArmedHistoricalContinuation>();

	arm(context: Omit<ArmedHistoricalContinuation, "armedAt"> & { armedAt?: string }): ArmedHistoricalContinuation {
		const armed = {
			...context,
			armedAt: context.armedAt ?? new Date().toISOString(),
		};
		this.armedByRepo.set(context.repoRoot, armed);
		return armed;
	}

	peek(repoRoot: string): ArmedHistoricalContinuation | undefined {
		return this.armedByRepo.get(repoRoot);
	}

	consume(repoRoot: string): ArmedHistoricalContinuation | undefined {
		const armed = this.armedByRepo.get(repoRoot);
		this.armedByRepo.delete(repoRoot);
		return armed;
	}

	clear(repoRoot: string): void {
		this.armedByRepo.delete(repoRoot);
	}

	clearAll(): void {
		this.armedByRepo.clear();
	}
}

export const defaultArmedContinuationStore = new MemoryArmedContinuationStore();

export function describeArmedHistoricalContinuation(context: ArmedHistoricalContinuation): string {
	return `${context.sourceType} ${context.sourceId} ${context.mode}${context.title ? ` (${context.title})` : ""}`;
}
