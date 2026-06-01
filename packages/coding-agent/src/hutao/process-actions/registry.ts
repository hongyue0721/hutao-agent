import type {
	HutaoProcessAction,
	HutaoProcessActionRegistration,
	HutaoProcessActionRegistryContext,
} from "./types.ts";
import type { TranslationKey } from "../i18n.ts";
import type { HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "../process-tree/types.ts";

export class HutaoProcessActionRegistry {
	private readonly registrations = new Map<HutaoProcessTreeNodeKind, HutaoProcessActionRegistration>();

	constructor(registrations: HutaoProcessActionRegistration[] = []) {
		for (const registration of registrations) this.register(registration);
	}

	register(registration: HutaoProcessActionRegistration): void {
		this.registrations.set(registration.kind, registration);
	}

	getTitleKey(node: HutaoProcessTreeNode): TranslationKey | undefined {
		return this.registrations.get(node.kind)?.titleKey;
	}

	getActions(node: HutaoProcessTreeNode, context: HutaoProcessActionRegistryContext): HutaoProcessAction[] {
		const actions = this.registrations.get(node.kind)?.getActions(node, context) ?? [];
		return [...actions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	hasActions(kind: HutaoProcessTreeNodeKind): boolean {
		return this.registrations.has(kind);
	}
}
