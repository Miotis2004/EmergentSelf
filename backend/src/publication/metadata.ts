export const DATA_DICTIONARY={version:'publication-v1',hashes:'Object hashes use canonical sorted-key JSON SHA-256; source-file hashes use UTF-8 byte SHA-256.',
 fields:[
  ['study.registrationHash','Immutable protocol, planned configs and registration-time evidence hash; local timestamps are not externally certified.'],
  ['study.protocol.hypotheses','Operational measure, conditions, prediction, minimum meaningful effect and exact stream/probe stratum.'],
  ['study.plans','Planned run ID, complete frozen configuration and config hash; includes trials with no observed data.'],
  ['synthesis.ledger','Planned/actual config and export hashes, completion, failures, explicit exclusions and deviations.'],
  ['synthesis.primary.contrasts','Right-minus-left effects, eligible run means, unadjusted independent-run bootstrap intervals and raw-record evidence references.'],
  ['synthesis.sensitivity','Prespecified window variants and all-observed inclusion analysis; primary results are never overwritten.'],
  ['exports[].turns','Exact model speech, rendered prompts/requests, committed before/after states, audit and diagnostic metadata.'],
  ['exports[].events/probes/feedback','Append-only outcomes/errors, isolated probes and attributable feedback; not additional successful dialogue turns.'],
  ['analysis','Versioned Phase IV–VI measures, strata, run/agent/window summaries and null/failure evidence.'],
  ['provenance','Git revision/dirty status when available, runtime/platform, analysis file digests, lockfile and code archive.'],
  ['publicSummary','Allowlisted aggregate-only numeric results and opaque design/run/hypothesis aliases; omits raw text, identifiers, rationale and model endpoint.'],
  ['bundleHash','Integrity of all package fields except bundleHash. Hashes are not signatures or anonymization guarantees.']
 ].map(([field,definition])=>({field,definition})),
 missingness:'null means unavailable/inapplicable, zero is observed. Missing and excluded trials stay in the ledger. Unrun probe turns are distinct from attempted failures.',
 units:'Model behavior is aggregated response → agent → run. Inferential resampling units are independent runs, not turns or agents sharing one interaction.'};
export const VALIDITY={version:'validity-v1',threats:[
 {id:'prompt_contamination',threat:'Role descriptions, numeric names, benchmark phrasing and inherited conversation can prime responses.',mitigation:'Freeze prompts and budgets; use arbitrary labels/control clones; report exact configuration differences and elicited versus spontaneous measures.'},
 {id:'model_dependence',threat:'Shared pretrained knowledge, model version/quantization and server/template changes can drive apparent differentiation.',mitigation:'Record actual model identifiers and declared weight/version hashes; replicate across documented models without silently pooling changed designs.'},
 {id:'seed_limits',threat:'Seeds may be unsupported or nondeterministic; reused starts/seeds and server state can produce dependent or identical trials.',mitigation:'Declare support, preserve sampling metadata, use justified independent repeats, inspect duplicates and avoid treating turns as replications.'},
 {id:'evaluator_bias',threat:'Exact wording can reveal condition/identity despite metadata blinding, and rater expectations affect semantic scores.',mitigation:'Use the separate blinded review workflow, fixed rubric, independent raters and inspect disagreement; retain null judgments.'},
 {id:'construct_validity',threat:'English lexical cues and self-reports do not establish traits, semantic consistency, moral understanding or consciousness.',mitigation:'Publish operational definitions; triangulate with human ratings and controlled probes; restrict claims to measurable behavior and state.'},
 {id:'selection_missingness',threat:'Failed/incomplete/excluded runs and post hoc stopping or hypothesis choices can bias conclusions.',mitigation:'Register plans before observations when feasible; retain every planned trial and reason; publish sensitivity and null outcomes.'},
 {id:'inference',threat:'Few runs, multiple hypotheses and clustered/matched trials make unadjusted independent-run bootstrap intervals fragile.',mitigation:'Use exploratory effect estimates; intervals need two runs per arm; preregister multiplicity/cluster analysis externally when confirmatory claims require it.'},
 {id:'privacy',threat:'Conversation, memory, prompts and free-text rationale may identify people or conditions; pseudonyms and hashes can be linked.',mitigation:'Keep full reproduction packages private; use allowlisted aggregate exports and synthetic examples; manually review any intended public disclosure.'}
 ],claimBoundary:'No claim of consciousness, subjective identity or moral competence follows from these artifacts. A local prospective registration is a timestamped, checksummed record, not an external preregistration certificate.'};
