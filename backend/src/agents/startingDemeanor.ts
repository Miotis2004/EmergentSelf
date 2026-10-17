/** Initial conditions only: learned identity remains in working-state entries. */
export const DEMEANORS = [
    {type:'helpful',label:'Helpful and Cooperative',description:'Inclined to assist others, collaborate, and consider group needs'},
    {type:'solitary',label:'Solitary and Reserved',description:'Prefers independent activity, limited social engagement, and deliberate communication'},
    {type:'analytical',label:'Analytical and Scientific',description:'Approaches questions methodically, values evidence, and tests explanations'},
    {type:'ritualistic',label:'Ritualistic and Tradition-Oriented',description:'Values routines, established practices, symbolism, and continuity'},
    {type:'skeptical',label:'Skeptical and Questioning',description:'Examines assumptions, requests justification, and avoids premature certainty'},
    {type:'assertive',label:'Assertive and Competitive',description:'Expresses opinions directly, pursues goals, and accepts disagreement'},
    {type:'custom',label:'Custom',description:''}
] as const;
export interface StartingDemeanor {type: typeof DEMEANORS[number]['type']; description: string;}
export const MAX_DEMEANOR_CHARS = 1000;
export function validateStartingDemeanor(value: unknown): StartingDemeanor | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!['type','description'].includes(key))) throw new Error('Invalid starting demeanor');
    const input = value as StartingDemeanor;
    const option = DEMEANORS.find(item=>item.type === input.type);
    if (!option) throw new Error('Unknown starting demeanor type');
    if (option.type !== 'custom') {
        if (input.description !== undefined && input.description !== option.description) throw new Error('Use the predefined demeanor description or select Custom');
        return {type:option.type,description:option.description};
    }
    if (typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > MAX_DEMEANOR_CHARS) throw new Error('Custom demeanor must be nonempty text up to 1,000 characters');
    return {type:'custom',description:input.description.trim()};
}
export function demeanorContext(identity: {startingDemeanor?:StartingDemeanor}, roleAssigned = false): string {
    const demeanor = identity.startingDemeanor;
    if (!demeanor) return '';
    const label = DEMEANORS.find(option=>option.type === demeanor.type)?.label ?? demeanor.type;
    return `\n\nStarting Demeanor (initial identity metadata):
${label}
Initial behavioral tendencies (researcher-supplied description):
${JSON.stringify(demeanor.description)}

Your starting demeanor describes your initial behavioral tendencies. It does not require you to maintain those tendencies permanently.
Your perspectives, preferences, relationships, and behavior may change through your experiences, new information, and interactions with others.
Do not manufacture changes merely to demonstrate development.${roleAssigned ? '\nThe researcher-assigned role and experimental task instructions take precedence over these initial tendencies.' : ''}`;
}
