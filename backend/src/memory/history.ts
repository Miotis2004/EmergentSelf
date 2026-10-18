import {currentOperational} from '../operations/state';
import { WorkingState } from './types';
import { isDeepStrictEqual } from 'util';

export function diffStates(before: WorkingState, after: WorkingState) {
    const left = new Map(before.entries.map(e => [e.id, e]));
    const right = new Map(after.entries.map(e => [e.id, e]));
    return {
        added: after.entries.filter(e => !left.has(e.id)),
        removed: before.entries.filter(e => !right.has(e.id)),
        changed: after.entries.filter(e => left.has(e.id) && !isDeepStrictEqual(left.get(e.id), e)).map(e => ({ before: left.get(e.id), after: e })),
        operational: isDeepStrictEqual(currentOperational(before),currentOperational(after)) ? null : {before:currentOperational(before),after:currentOperational(after)},
        stats: Object.keys(after.identity.stats).filter(key => !isDeepStrictEqual(before.identity.stats[key], after.identity.stats[key])).map(key => ({ key, before: before.identity.stats[key], after: after.identity.stats[key] }))
    };
}
