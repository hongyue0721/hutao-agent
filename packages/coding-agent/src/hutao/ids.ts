import { randomBytes } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTimestamp(timestampMs: number): string {
	let value = Math.max(0, Math.floor(timestampMs));
	let encoded = "";
	for (let index = 0; index < 10; index++) {
		encoded = CROCKFORD_ALPHABET[value % 32] + encoded;
		value = Math.floor(value / 32);
	}
	return encoded;
}

function encodeRandomBytes(bytes: Buffer): string {
	let buffer = 0;
	let bits = 0;
	let encoded = "";
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5 && encoded.length < 16) {
			bits -= 5;
			encoded += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
		}
	}
	if (encoded.length < 16 && bits > 0) {
		encoded += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
	}
	return encoded.padEnd(16, "0").slice(0, 16);
}

export type HutaoIdPrefix = "sess" | "fs" | "p" | "r" | "e" | "m" | "cl" | "er" | "nel";

export function createUlid(): string {
	return `${encodeTimestamp(Date.now())}${encodeRandomBytes(randomBytes(10))}`;
}

export function createHutaoId(prefix: HutaoIdPrefix): string {
	return `${prefix}_${createUlid()}`;
}
