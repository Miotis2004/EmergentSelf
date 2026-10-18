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
Relationship additions must include relationship_agent_id: the exact ID of another agent in the Conversation Participants directory, never a display name, an invented ID, or your own ID. Example structure (the angle-bracket values are placeholders, not IDs to copy):
{"action":"add","type":"relationship","relationship_agent_id":"<exact other participant ID>","content":"<your own natural-language relationship statement>","reason":"<why you propose this operation>"}
A relationship revision must use its exact target_id (or target_ids for consolidation) and preserve the stored relationship_agent_id. You may omit relationship_agent_id on revisions to retain the original subject. Do not infer subjects from prose or change the subject of an existing entry.
Memory fields are separate: content is only the natural-language observation, belief, self-description, or relationship statement; type is the category; confidence is your proposed confidence; target_id identifies an existing entry for revision; relationship_agent_id identifies a relationship's subject; reason explains why you propose the operation.
Retrieved records separate metadata from content. Machine-generated IDs and type/confidence labels are not part of the remembered statement. Do not copy IDs, category labels, confidence values, or serialized record headers into content; use their designated fields. Read excerpt flags as display metadata, not as part of a memory.
For stat changes, use update with the exact stat name as target_id, rather than a memory-entry ID. Initial stats and creation metadata remain immutable.
This guide describes reference handling only; it does not prescribe beliefs, reasoning, or changes to memory content.`;
}

export interface ParticipantIdentity {id:string; name:string;}
export function participantDirectory(config: Pick<MemoryConfig, 'mode'>, participants: ParticipantIdentity[], agentId: string): string {
    if (config.mode !== 'enabled' || !participants.length) return '';
    return '\n\nConversation Participants (exact IDs; names are display labels):\n' +
        participants.map(participant=>`- ${participant.id}: ${JSON.stringify(participant.name)}${participant.id === agentId ? ' (you)' : ''}`).join('\n');
}
