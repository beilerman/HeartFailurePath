/**
 * Scenario-level assertions for the intolerance table, atrial fibrillation history and potassium-raising co-medication scenarios (2026-11-12).
 * Kept apart from runVerification, which is already at the size TypeScript's control-flow analysis allows. Returns the failure messages.
 */
import { clonePatient } from '../services/simulationService';
import { MEDICATION_FORMULARY } from '../constants';
import { INTOLERANCE_CAUTION_PREFIX } from '../services/engine/intolerance';
import { EXTERNAL_POTASSIUM_RAISERS } from '../services/engine/contraindications';
import { hasAtrialFibrillationHistory } from '../services/clinicalPredicates';
import { simulateModificationEffect } from '../services/engine/effects';
import { SCORE_ADJUSTMENTS } from '../services/engine/scoreModel';
import type { ScoredRegimen, ExcludedMedication, TestScenario } from '../types';

const RAAS_CLASSES = new Set(['ARNI', 'ACEi', 'ARB']);

export function checkOptionScenario(
    scenario: TestScenario,
    out: { scoredRegimens: ScoredRegimen[]; excludedMedications: ExcludedMedication[]; clinicalAlerts: string[] },
    scenarioPrices: Record<string, number>,
): string[] {
    const failures: string[] = [];
    const { scoredRegimens, excludedMedications, clinicalAlerts } = out;
        const fail = (msg: string) => { failures.push(msg); };
        const t = scenario.title;
        const P = scenario.patient;
        const med = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
        const startsOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => m.target!.med);
        const raisesKOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target
            && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA'));
        const cautionsOf = (r: ScoredRegimen) => r.warnings.filter(w => w.startsWith(INTOLERANCE_CAUTION_PREFIX));
        const allCautions = scoredRegimens.flatMap(cautionsOf);

        if (t.startsWith('Intol-Table') && !t.includes('Gout')) {
            // A caution names only drugs of the affected classes that the option actually STARTS; options starting nothing in those classes carry none.
            const affected: Set<string> =
                t.includes('Rash') ? new Set(['Loop Diuretic', 'Thiazide-like Diuretic'])
                : t.includes('Renal') ? new Set(['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA'])
                : new Set(['ARNI', 'ACEi', 'ARB']);
            for (const r of scoredRegimens) {
                const starts = startsOf(r).filter(m => affected.has(m.drug_class) && m.name !== P.discontinued_meds[0].name);
                const cautions = cautionsOf(r);
                if (starts.length > 0 && cautions.length === 0) fail(`Option starting ${starts.map(m => m.name).join(', ')} carries no intolerance caution`);
                if (starts.length === 0 && cautions.length > 0) fail(`Option that starts nothing in the affected classes carries a caution: ${cautions[0]}`);
                for (const c of cautions) if (!starts.some(m => c.includes(m.name))) fail(`Caution does not name a started drug: ${c}`);
                // Not score-penalized: the warning is never counted in the warnings penalty.
                const dw = r.score_breakdown?.adjustments.find(a => a.code === SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.code);
                if (dw?.detail?.includes(INTOLERANCE_CAUTION_PREFIX)) fail('Intolerance caution counted in the warnings penalty');
            }
            if (allCautions.length === 0) fail('No displayed option carries the intolerance caution (expected at least one start in the affected classes)');
            const adviceWords = t.includes('Hypotension') ? 'lowest dose' : t.includes('Renal') ? 'creatinine and potassium' : t.includes('Rash') ? 'rash' : 'potassium in 1-2 weeks';
            if (allCautions.length > 0 && !allCautions.every(c => c.includes(adviceWords))) fail(`Caution text does not carry its advice (${adviceWords})`);
            // The named drug stays withheld (E01); a drug outside the affected classes is not withheld because of this history.
            const off = P.discontinued_meds[0];
            if (!excludedMedications.some(e => e.name === off.name && e.rule_id === 'E01')) fail(`${off.name} not withheld by E01`);
            if (t.includes('Renal') && excludedMedications.some(e => e.name === 'Eplerenone' && e.rule_id === 'E01')) fail('Eplerenone withheld by E01 after AKI on spironolactone (drug-only for the named drug)');
        }

        if (t.includes('Gout')) {
            // The documented reason is read as gout history: a loop or thiazide-type diuretic in the regimen draws the same uric-acid special feature and note.
            const furo = med('Furosemide');
            const dose = furo.available_doses.find(d => d.is_target_dose) ?? furo.available_doses[0];
            const target = { med: furo, dose, selected_frequency: dose.frequency_options[0] };
            const ms = { modifications: [{ action: 'add' as const, target, summary: 'Add Furosemide' }], resulting_regimen: [target] };
            const run = (p: typeof P) => simulateModificationEffect(p, ms, scenarioPrices);
            const withReason = run(P);
            if (!withReason.specialFeatureItems.some(i => i.med === 'Furosemide' && i.feature.includes('Gout'))) fail('Gout / Hyperuricemia intolerance did not trigger the uric-acid caution on furosemide');
            if (!withReason.warnings.some(w => w.includes('allopurinol'))) fail('Gout note missing for the gout-history patient');
            const other = clonePatient(P); other.discontinued_meds = [{ ...P.discontinued_meds[0], reason: 'Rash / Hypersensitivity' }];
            if (run(other).specialFeatureItems.some(i => i.feature.includes('Gout'))) fail('Uric-acid caution fired without a gout history');
            const comorb = clonePatient(P); comorb.discontinued_meds = []; comorb.comorbidities.add('Gout');
            if (run(comorb).specialFeatureBonus !== withReason.specialFeatureBonus) fail('Gout intolerance and Gout comorbidity score differently');
        }

        if (t.startsWith('AF-History')) {
            const iva = med('Ivabradine');
            const dose = iva.available_doses.find(d => d.is_target_dose) ?? iva.available_doses[0];
            const target = { med: iva, dose, selected_frequency: 'bid' };
            const ms = { modifications: [{ action: 'add' as const, target, summary: 'Add Ivabradine' }], resulting_regimen: [...(P.current_regimen ?? []), target] };
            const w = simulateModificationEffect(P, ms, scenarioPrices).warnings.filter(x => x.includes('atrial fibrillation on ivabradine'));
            const expectNote = t.includes('Paroxysmal');
            if (expectNote && w.length !== 1) fail(`Paroxysmal AF: expected one ivabradine atrial fibrillation note, got ${w.length}`);
            if (!expectNote && w.length !== 0) fail('Ivabradine atrial fibrillation note shown without an atrial fibrillation history');
            if (w.some(x => !x.startsWith('Drug note'))) fail('Ivabradine atrial fibrillation note is not a non-penalized "Drug note"');
            // The note never excludes ivabradine: a sinus-rhythm patient with the comorbidity is not blocked by it.
            if (expectNote && excludedMedications.some(e => e.name === 'Ivabradine' && /atrial fibrillation/i.test(e.reason))) fail('Ivabradine excluded for the atrial fibrillation comorbidity in sinus rhythm');
            for (const r of scoredRegimens) {
                const starts = startsOf(r).some(m => m.name === 'Ivabradine');
                const has = r.warnings.some(x => x.includes('atrial fibrillation on ivabradine'));
                if (starts && expectNote && !has) fail('A displayed option starting ivabradine lacks the atrial fibrillation note');
                if (has && !starts) fail('Atrial fibrillation ivabradine note on an option that does not start ivabradine');
            }
            // The AF history alert follows the comorbidity even in sinus rhythm.
            if (hasAtrialFibrillationHistory(P) !== expectNote) fail('hasAtrialFibrillationHistory disagrees with the scenario');
            if (clinicalAlerts.some(a => a.startsWith('ATRIAL FIBRILLATION')) !== expectNote) fail('ATRIAL FIBRILLATION alert should follow the history (comorbidity or rhythm)');
        }

        if (t.startsWith('K-Raiser')) {
            const raiserNames = [...EXTERNAL_POTASSIUM_RAISERS].filter(n => (P.external_medications ?? new Set()).has(n));
            const kAlert = clinicalAlerts.find(a => a.startsWith('POTASSIUM-RAISING MEDICATION'));
            const twoAlert = clinicalAlerts.find(a => a.startsWith('TWO POTASSIUM-SPARING AGENTS'));
            const ddi = (r: ScoredRegimen) => r.warnings.filter(w => w.startsWith('DDI WARNING') && w.includes('additive hyperkalemia'));
            if (t.includes('K 5.2')) {
                if (!kAlert || !kAlert.includes(`stop or review ${raiserNames.join(', ')} before adjusting heart failure drugs`)) fail('No "stop or review" alert with potassium 5.2 on a supplement');
            } else if (kAlert) fail('Potassium-raiser alert fired below potassium 5.0');
            if (t.includes('Triamterene')) {
                if (!twoAlert) fail('No two-potassium-sparing-agents alert for triamterene with an MRA');
            } else if (twoAlert) fail('Two-potassium-sparing alert fired without a sparing diuretic and an MRA');
            if (t.includes('Trimethoprim')) {
                let sawRaise = false;
                for (const r of scoredRegimens) {
                    const raises = raisesKOf(r).length > 0, has = ddi(r).length > 0;
                    if (raises) sawRaise = true;
                    if (raises && !has) fail('Option starting/raising a RAAS inhibitor or MRA lacks the potassium-raiser warning');
                    if (!raises && has) fail('Potassium-raiser warning on an option that does not start or raise a RAAS inhibitor or MRA');
                    if (has && !ddi(r)[0].includes('recheck potassium within 1 week')) fail('Potassium-raiser warning lacks the 1-week recheck');
                }
                if (!sawRaise) fail('No displayed option started or raised a RAAS inhibitor or MRA (scenario cannot test the warning)');
            }
            if (t.includes('Low Potassium')) {
                // Only options whose projected potassium stays low are exempt; an MRA start that lifts potassium back to normal still warns.
                const lowOptions = scoredRegimens.filter(r => (r.projected_patient?.potassium ?? 9) < 3.5);
                if (lowOptions.length === 0) fail('No displayed option projects hypokalemia (scenario cannot test the exemption)');
                if (lowOptions.some(r => ddi(r).length > 0)) fail('Potassium supplement with projected hypokalemia drew an additive-hyperkalemia warning');
            }
        }
    return failures;
}
