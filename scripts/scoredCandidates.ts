/**
 * Every SCORED candidate for a patient (displayed or not), by running the engine's own stages up to scoring. For checks about what the engine can offer
 * (a dose rule, an availability rule) as distinct from what ranks in the displayed top three.
 */
import { MEDICATION_FORMULARY } from '../constants';
import { clonePatient } from '../services/simulationService';
import { auditInputs, raiseClinicalAlerts } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { analyzeCurrentRegimen, generateCandidateModifications } from '../services/engine/candidates';
import { getDoseTiers, dedupeCurrentRegimen } from '../services/engine/regimenUtils';
import { buildScoringContext, scoreCandidates } from '../services/engine/scoring';
import type { Patient, ScoredRegimen } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));

export function scoredCandidates(source: Patient, names: Set<string> = NAMES, prices: Record<string, number> = PRICES): ScoredRegimen[] {
    const p = clonePatient(source);
    // The engine resolves a drug entered twice (the more cautious use record is kept) before it reads the use records; this helper does the same (ruling U5).
    p.current_regimen = dedupeCurrentRegimen(p.current_regimen ?? []).regimen;
    p.recorded_medication_exposures = p.current_regimen;   // the engine records every entry (held ones too) before it keeps the active ones
    p.current_regimen = (p.current_regimen ?? []).filter(r => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed');
    const alerts: string[] = [];
    const audit = auditInputs(p, alerts);
    if (audit.stop) return [];
    const flags = raiseClinicalAlerts(p, audit.dataAudit, alerts);
    const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, names, alerts);
    const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
    const analysis = analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded, eligible.allRAASExcluded, eligible.unresolvedFoundationalClass);
    const ctx = buildScoringContext(p, prices, eligible.intolerancePolicy, audit.dataAudit, eligible.formulary, tiers, analysis, flags);
    return scoreCandidates(generateCandidateModifications(analysis, p), ctx);
}
