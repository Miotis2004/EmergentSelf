import { MemoryConfig } from './types';

/** Operation mechanics, separate from agent identity, conversation and serialization. */
export function memoryOperationGuide(config: Pick<MemoryConfig, 'mode'>): string {
    if (config.mode !== 'enabled') return '';
    return `\n\nStructured memory operation guide:
Memory operations are optional: use an empty memory_operations array when no changes are proposed.
- add: create a new entry without a target ID. Use this for a newly formulated belief or self-description when no corresponding stored entry exists.
- update: revise an existing active entry of the same category using its exact target_id.
- retire: deactivate an existing active entry of the same category using its exact target_id.
- contradict: record a conflicting replacement for an existing active entry of the same category using its exact target_id; the original remains in history.
- consolidate: combine two or more distinct existing active entries of the same category using their exact target_ids.
Use exact IDs displayed in the active memory context (including extractive excerpts). Never invent target IDs or infer that a stored belief exists merely because a position was expressed in conversation. Changing a conversational position does not automatically imply a corresponding stored belief exists. If no corresponding entry exists, a new belief can be proposed with add; do not use an unreferenced update.
For stat changes, use update with the exact stat name as target_id, rather than a memory-entry ID. Initial stats and creation metadata remain immutable.
This guide describes reference handling only; it does not prescribe beliefs, reasoning, or changes to memory content.`;
}
