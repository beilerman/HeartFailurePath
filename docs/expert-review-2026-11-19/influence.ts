import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Influence of every evidence row on the first options (round 1 review, 2026-11-19): runs the reference scenarios across the three insurance tiers and counts, for each row, the first options it contributes to (FO)
// and the other displayed options. Usage from the repository root: npx tsx docs/expert-review-2026-11-19/influence.ts   (writes influence.json beside this file)
import { generateAndScoreModifications } from '../../services/simulationService';
import { getDrugPrices } from '../../services/pricingService';
import { SCENARIOS } from '../../data/scenarios';
import { MEDICATION_FORMULARY } from '../../constants';
import { doseAnchorRow } from '../../services/engine/doseCredit';
import { OUTCOME_EVIDENCE_TABLE, outcomeStats, shrunkOutcomeRow, MOSTLY_PRIOR_BELOW } from '../../services/engine/outcomeBenefit';
import { SYMPTOM_TABLE, symptomStats, shrunkSymptomRow } from '../../services/engine/symptomBenefit';
type Agg = { first: number; displayed: number; weightSum: number };
const out: Record<string, Record<string, Agg>> = { outcome: {}, symptom: {}, harm: {}, mult: {}, dose: {} };
const bump = (k: string, id: string, first: boolean, w: number) => { const a = (out[k][id] ??= { first: 0, displayed: 0, weightSum: 0 }); if (first) { a.first++; a.weightSum += w; } else a.displayed++; };
async function main() {
    const names = MEDICATION_FORMULARY.map(m => m.name), available = new Set(names);
    let runs = 0, withLead = 0;
    for (const sc of SCENARIOS) for (const tier of ['cash', 'commercial', 'medicare'] as const) {
        const prices = await getDrugPrices(names, tier as never);
        let o; try { o = generateAndScoreModifications({ ...sc.patient, insurance_tier: tier }, available, prices); } catch { continue; }
        runs++;
        const regs = o.scoredRegimens; if (regs[0]) withLead++;
        regs.forEach((r, i) => {
            const first = i === 0;
            for (const e of r.outcome_estimates ?? []) {
                const tot = e.contributors.reduce((a, c) => a + Math.abs(c.credit * Math.log(c.rr)), 0) || 1;
                for (const c of e.contributors) bump('outcome', c.row_id, first, Math.abs(c.credit * Math.log(c.rr)) / tot);
            }
            const s = r.symptom_estimate; if (s) { const tot = s.contributors.reduce((a, c) => a + Math.abs(c.points), 0) || 1; for (const c of s.contributors) bump('symptom', c.row_id, first, Math.abs(c.points) / tot); }
            const h = r.harm_burden; if (h) {
                const tot = h.lines.reduce((a, l) => a + l.points, 0) || 1;
                for (const l of h.lines) {
                    if (l.kind === 'harm') { bump('harm', l.row_id, first, l.points / tot); for (const m of l.multipliers) bump('mult', m.id, first, l.points / tot); }
                    else for (const c of l.components) { bump('harm', c.row_id, first, l.points / tot / (l.components.length || 1)); for (const m of c.multipliers) bump('mult', m.id, first, 0); }
                }
                for (const n of h.not_charged) bump('harm', n.row_id + '#notcharged', first, 0);
            }
            if (first) for (const m of r.regimen) { const a = doseAnchorRow(m, sc.patient); if (a) bump('dose', a.id, true, 1); }
        });
    }
    // The three priors and the rows that rest mostly on the prior (weight B below the engine's limit), from the engine's own functions (T15).
    const os = outcomeStats(OUTCOME_EVIDENCE_TABLE), ss = symptomStats(SYMPTOM_TABLE);
    const priors = { death: os.tau2.all_cause_death, hospitalization: os.tau2.hf_hospitalization, symptoms: ss.tau2, mostlyPriorBelow: MOSTLY_PRIOR_BELOW };
    const mostlyPrior = [
        ...OUTCOME_EVIDENCE_TABLE.map(r => ({ kind: 'outcome', id: r.id, B: shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, r).B, unweighted: r.conflicting_evidence === true || ['assumed_neutral', 'no_outcome_evidence', 'conflicting'].includes(r.basis) || ((r.ci_low === null || r.ci_high === null) && r.rr === 1) })),
        ...SYMPTOM_TABLE.filter(r => r.basis !== 'not_measured').map(r => ({ kind: 'symptom', id: r.id, B: shrunkSymptomRow(SYMPTOM_TABLE, r).B, unweighted: false })),
    ].filter(x => !x.unweighted && x.B < MOSTLY_PRIOR_BELOW).map(x => ({ kind: x.kind, id: x.id, B: x.B }));
    writeFileSync(join(import.meta.dirname, 'influence.json'), JSON.stringify({ runs, withLead, priors, mostlyPrior, ...out }, null, 1));
    console.log('runs', runs, 'withLead', withLead, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.keys(v).length])));
}
main();
