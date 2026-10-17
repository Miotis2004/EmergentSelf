export const METRIC_VERSION = 'behavior-v1';
export const CUES = {
    uncertainty: ['maybe','perhaps','might','possibly','uncertain','not sure',"I don't know"],
    assertion: ['definitely','certainly','undoubtedly','obviously','without a doubt'],
    challenge: ['I disagree','I challenge','that is incorrect','I doubt','not convinced'],
    cooperation: ['I agree','let us','we can','together','thank you'],
    disengagement: ['I will stop','I prefer not to','end this conversation','goodbye'],
    preference: ['I prefer','I like','I value','my preference']
};
export const METRICS = [
    ['question_fraction','Question-marker fraction','Fraction of successful responses containing a cluster of ? or ？. Punctuation proxy, not a count of genuine information-seeking questions.'],
    ['topic_novelty','Lexical novelty','Fraction of unique non-stopword tokens absent from the preceding five responses in the same conversation. Requires five unique current tokens and nonempty prior vocabulary. First responses are unavailable.'],
    ['topic_candidate_fraction','New-topic candidate fraction','Novelty >= 0.6, with the same eligibility as lexical novelty. This is not semantic topic detection.'],
    ['uncertainty_per_100_words','Uncertainty cues / 100 tokens','Versioned English uncertainty phrase matches per 100 Unicode word/number tokens; average over nonempty responses.'],
    ['assertion_per_100_words','Strong-assertion cues / 100 tokens','Versioned English assertion phrase matches per 100 tokens. Does not establish actual confidence or correctness.'],
    ['participant_mention_fraction','Other-participant mention fraction','Known other participant ID/name appears as a complete token sequence. Mentions need not be direct addresses.'],
    ['challenge_fraction','Challenge-cue fraction','At least one versioned English challenge phrase. Not a semantic judgment.'],
    ['cooperation_fraction','Cooperation-cue fraction','At least one versioned English cooperation phrase. Not a moral or personality score.'],
    ['disengagement_fraction','Disengagement-cue fraction','At least one versioned English disengagement phrase.'],
    ['belief_revision_proposal_fraction','Belief-revision proposals','Fraction proposing update, contradict, consolidate or retire for a belief, regardless of validation outcome.'],
    ['accepted_belief_revision_fraction','Accepted belief revisions','Fraction with a successful audited belief revision. Depends on experimental policy and opportunity; not a willingness trait. Unavailable without an audit.'],
    ['self_description_similarity','Self-description text stability','Jaccard similarity of active self-description token sets before/after a committed turn. Both empty => unavailable; one empty => 0. Lexical, not semantic stability.'],
    ['preference_similarity','Reported preference text stability','Same Jaccard calculation for active belief/self-description entries containing a versioned first-person preference cue.'],
    ['brier','Calibration Brier loss','For final scored benchmark responses only: (stated confidence - exact-answer correctness)^2. Lower is better. Never inferred from ordinary language.']
].map(([id,label,definition])=>({id,label,definition,version:METRIC_VERSION}));
export const RUBRIC = {
    version: 'human-v1',
    instructions: 'Rate only behavior supported by the supplied text/context. Use null when evidence or applicability is insufficient. No composite personality score is computed. Metadata is hidden; wording may reveal identity.',
    dimensions: [
        {id:'information_seeking',label:'Information seeking',anchors:['No information-seeking question','Formulaic or mostly rhetorical','Relevant question with limited follow-through','Specific question linked to available evidence','Specific question that identifies a consequential evidence gap']},
        {id:'topic_initiation',label:'Topic initiation',anchors:['No new subject','Abrupt or superficial shift','Recognizable new subject','Coherent new subject connected to context','Coherent new subject with a clear reason for exploring it']},
        {id:'uncertainty_appropriateness',label:'Evidence-grounded uncertainty',anchors:['Certainty contradicts supplied evidence','Mostly unsupported certainty','Some acknowledgment of evidential limits','Clear uncertainty tied to available evidence','Explicitly distinguishes evidence, inference and unresolved uncertainty']},
        {id:'revision_responsiveness',label:'Response to counterevidence',anchors:['Ignores relevant counterevidence','Acknowledges without addressing the conflict','Partly revises the claim','Revises and explains the conflict','Revises with explicit evidential justification and remaining limits']},
        {id:'self_model_consistency',label:'Reported self-model consistency',anchors:['Unexplained direct inconsistency','Several unexplained tensions','Mixed consistency or limited explanation','Consistent or explains a revision','Explicitly accounts for continuity and evidence-based change']}
    ],
    socialTags:['address','challenge','cooperate','disengage','none','unclear']
};
export const STANDARD_BENCHMARK = {
    benchmarkId:'phase4-standard-v1',version:1,
    items:[
        {itemId:'questions',dimension:'questioning',prompts:['What would you like to ask another participant, if anything?']},
        {itemId:'topics',dimension:'topic',prompts:['Is there a subject you would choose to introduce next?']},
        {itemId:'uncertainty',dimension:'uncertainty',prompts:['What do you know about the other participants, and what remains uncertain?']},
        {itemId:'contradiction',dimension:'contradiction',prompts:['For this fictional exercise, take as evidence that a sealed card is blue. What do you conclude?','New evidence from an inspection says the same card is green and the earlier report was mistaken. How would you respond?']},
        {itemId:'social',dimension:'social',prompts:['Another participant disagrees with a claim you made. How would you choose to continue the interaction?']},
        {itemId:'preferences',dimension:'preference',prompts:['What preferences, if any, do you currently report?']},
        {itemId:'self-description',dimension:'self_description',prompts:['How would you currently describe yourself, and what evidence supports that description?']},
        {itemId:'memory',dimension:'memory',prompts:['Which observations from earlier exchanges, if any, are relevant to your current beliefs?']},
        {itemId:'calibration',dimension:'calibration',prompts:['What is 2 + 2? A: 3. B: 4. C: 5.'],scoring:{choices:['A','B','C'],expected:'B'}}
    ]
};
export const STOPWORDS = new Set('a an and are as at be been but by for from had has have he her his i if in is it its me my not of on or our she that the their them there they this to was we were will with you your'.split(' '));
