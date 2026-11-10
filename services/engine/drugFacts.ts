/**
 * Drug facts live on the formulary entry (`Medication.facts`), not in engine branches.
 * The engine asks the entry (`drugFacts(med).beta1_selective`) instead of comparing names, so
 * adding a drug that shares an existing fact is a data change in `constants.ts` only.
 * Structural test in scripts/verifyScenarios.ts fails if a formulary drug name reappears as a
 * string literal in engine code.
 */
import { Medication, MedFacts } from '../../types';

const NO_FACTS: MedFacts = Object.freeze({});

export function drugFacts(med: Medication): MedFacts {
    return med.facts ? med.facts() : NO_FACTS;
}
