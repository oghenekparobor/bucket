/**
 * decodeEvents(logs): program log lines → normalized events, via @bucket/sdk's decoder (PascalCase
 * names, snake_case fields as in docs/architecture.md §2.3, u64 as strings, pubkeys base58, enums as
 * variant names). Unknown event names are dropped.
 */
import { decodeEvents } from '@bucket/sdk';
import type { PublicKey } from '@solana/web3.js';
import { type DecodedEvent, isEventName } from './events.js';

export type DecodeEvents = (logs: string[]) => DecodedEvent[];

export function createDecoder(programId: PublicKey): DecodeEvents {
  return (logs) =>
    decodeEvents(logs, programId).flatMap((e) => (isEventName(e.name) ? [{ name: e.name, data: e.data }] : []));
}
