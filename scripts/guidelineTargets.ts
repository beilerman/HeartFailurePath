/**
 * Guideline TARGETS, separate from the gate. Owner ruling 2026-11-16: the engine ranks on measured models and guidelines are to be REPRODUCED by the model, so a guideline-shaped
 * expectation about which option leads or is displayed is a target to measure, never a rule to enforce. `guidelineTarget` records a result, prints [TARGET MET] or
 * [TARGET MISSED], and never fails the gate. The definitions below are shared by `npm run verify` and `npm run guideline:report` so both list the same misses.
 * Only expectations about WHICH option leads or is displayed belong here. Safety, eligibility, dose rules, alerts and arithmetic stay hard checks.
 */
import type { ScoredRegimen } from '../types';

export interface TargetResult { name: string; ok: boolean; detail: string }
const results: TargetResult[] = [];

export function guidelineTarget(name: string, ok: boolean, detail: string): void {
    results.push({ name, ok, detail });
    console.log(ok ? `  [TARGET MET] ${name}` : `  [TARGET MISSED] ${name}: ${detail}`);
}
export const guidelineTargetResults = (): readonly TargetResult[] => results;
export function guidelineTargetSummary(rs: readonly TargetResult[] = results): string[] {
    const met = rs.filter(r => r.ok).length;
    return [`Guideline targets reproduced: ${met} of ${rs.length}`, ...rs.filter(r => !r.ok).map(r => `  missed: ${r.name}: ${r.detail}`)];
}

export interface TargetDef { id: string; match: (title: string) => boolean; name: string; test: (displayed: ScoredRegimen[]) => boolean; detail: string }
export const TARGET_DEFS: TargetDef[] = [
    { id: 'A', match: t => t.includes('LVEF 45 Reduced-EF Standalone'), name: "'LVEF 45 Reduced-EF Standalone': the lead contains an SGLT2 inhibitor (Class I below LVEF 50)",
      test: d => !!d[0] && d[0].regimen.some(m => m.med.drug_class === 'SGLT2i'),
      detail: 'the lead has no SGLT2 inhibitor; the ESC 2026 guideline gives it the same class as the other pillars and states no order' },
    { id: 'B', match: t => t.includes('Furoscix Short-Course Add-On Not Swap'), name: "'Furoscix Short-Course Add-On Not Swap': the Furoscix short course is offered with worsening congestion on an oral loop",
      test: d => d.some(r => r.regimen.some(m => m.med.name.startsWith('Furoscix'))),
      detail: 'no displayed option carries the Furoscix short course' },
    { id: 'E', match: t => t.includes('LVEF 42 Reduced-EF Obese'), name: 'LVEF 42 obese: lead contains an SGLT2 inhibitor (existing assertion: some displayed option contains one)',
      test: d => d.some(r => r.regimen.some(m => m.med.drug_class === 'SGLT2i')),
      detail: 'no displayed option contains an SGLT2 inhibitor; this patient is congested (hasCongestion), where a loop diuretic is the strongest guideline recommendation' },
    { id: 'F', match: t => t.includes('Finerenone in HFpEF'), name: 'HFpEF: every displayed option contains an SGLT2 inhibitor',
      test: d => d.length === 0 || d.every(r => r.regimen.some(m => m.med.drug_class === 'SGLT2i')),
      detail: 'a displayed option has no SGLT2 inhibitor (SGLT2i is the primary HFpEF pillar)' },
    { id: 'D', match: t => t.includes('LVEF 45 Is HFrEF') || t.includes('LVEF 41 Is HFrEF') || t.includes('LVEF 49 Is HFrEF'), name: 'finerenone is not offered as an extra option in the former HFmrEF range (steroidal MRA per 2026 ESC)',
      test: d => !d.some(r => r.regimen.some(m => m.med.drug_class === 'nsMRA')),
      detail: 'finerenone is displayed at LVEF 41-49. FINEARTS-HF enrolled LVEF 40 and above, so the evidence table supports finerenone there: a guideline-versus-evidence difference for the owner' },
];
