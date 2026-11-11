
import { generateAndScoreModifications, isTargetDoseForPatient, clonePatient, DISPLAY_FLOORS, classifyPhenotype } from '../services/simulationService';
import { isProjectedSafetyClean } from '../services/engine/selection';
import { getDoseTiers, dailyDose, effectDose, renalCapExceeded, adjacentTiers, kUptitrationBlock, hrContinuationAction } from '../services/engine/regimenUtils';
import { isAcutelyDecompensated } from '../services/clinicalPredicates';
import type { RegimenMed } from '../types';
import { analyzeCurrentRegimen, equivalentSwapTier, formatSwapSummary } from '../services/engine/candidates';
import { simulateModificationEffect, patientChfEffects } from '../services/engine/effects';
import { ELIGIBILITY_RULES, ELIGIBILITY_RULE_IDS } from '../services/engine/eligibility';
import { getDrugPrices, DRUG_PRICES } from '../services/pricingService';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';
import { SCORE_ADJUSTMENTS, WEIGHT_PROFILES, DOMAIN_KEYS, WEIGHT_PROFILE_NAMES, type WeightProfileName } from '../services/engine/scoreModel';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RAAS_CLASSES = new Set(['ARNI', 'ACEi', 'ARB']);
const ASSERTION_TITLE_MARKERS = [
    'John Doe (Wet & Warm)',
    'Dry & Cold',
    'Hyperkalemia',
    'Severe Hypotension',
    'Bradycardia',
    'Angioedema',
    'Severe Asthma',
    'African American (A-HeFT Indication)',
    'Gout & Congestion',
    'Volume Depleted',
    'HFpEF with Resistant Edema',
    'Critical Renal',
    'eGFR 22',
    'Non-Compliant',
    'Severe Dilation',
    'Ideal Candidate',
    'Obese HFpEF',
    'Iron-Deficient',
    'African American NYHA III',
    'Ivabradine Candidate',
    'Ivabradine Fallback',
    // Exact-anchored: the bare 'Budget-Constrained' marker also matched 'ACEi Cough Intolerance
    // Budget-Constrained' and cross-applied the $25-budget Entresto assertion to the intolerance
    // scenario (which has its own dedicated block below).
    'Budget-Constrained ($25)',
    'ACEi-to-ARNI Swap',
    'Euvolemic Asthma',
    'HFimpEF',
    'Pregnant',
    'SBP 82',
    'Pregnant on Existing ACEi',
    'SGLT2i Continuation',
    'SBP 90 Borderline',
    'MRA Boundary',
    'Elderly >80',
    'Vericiguat Eligible',
    'No Recent Worsening',
    'Liver Disease + AFib',
    'NSAID + RAAS DDI',
    'Projected SBP Safety',
    'K+ Trajectory',
    'eGFR 25 SGLT2i Boundary',
    'Pregnant + CKD4',
    'LVEF Recovery Cap',
    'Finerenone in HFpEF',
    'Hepatic BB Selection',
    'Vericiguat LVEF Boundary',
    'GLP-1 Not Offered in HFrEF',
    'Digoxin Renal Dosing',
    'Digoxin Hypokalemia Contraindication',
    'Low Body Weight Carvedilol Boundary',
    'Severe CKD Loop Resistance',
    'Acute Decompensated NYHA IV',
    'Type 1 DM + Prior DKA',
    'AV Block',
    'Non-Formulary DDI Exposures',
    'Invalid BP Inversion',
    'Duplicate Current Medications',
    'GLP-1 Contraindication (MEN2)',
    'Nitrate + PDE5 Exposure',
    'HFimpEF Unknown on Existing Quad',
    'HFmrEF Standalone',
    'HFmrEF Obese',
    'Severe Congestion + Loop',
    'Hypoxia Alert',
    'NYHA III Acute Decompensation',
    'Low Peak Flow Screening',
    'Furoscix Candidate',
    'Furoscix Allergy Guardrail',
    'ARNI Hepatic CI',
    'MRA + DIAMOND Binder',
    'HFpEF Steroidal MRA Eligible',
    'Incomplete Data: Missing Potassium',
    'Incomplete Data: Missing LVEF',
    'Inappropriate Dual RAAS on Arrival',
    'Inappropriate Non-DHP CCB in HFrEF',
    'BB Intolerance Defer New Initiation',
    'Sulfa Allergy Diuretic Caution',
    'Inappropriate Dual MRA on Arrival',
    'Decompensated HFrEF + Contraindicated BB',
    'Implausible Lab Value',
    'Mild Asthma BB Selection',
    'ACEi Cough Intolerance on Current ACEi',
    'Gynecomastia on Current Spironolactone',
    'Dual MRA With Steroidal Intolerance',
    'ACEi Cough Intolerance Budget-Constrained',
    'Gynecomastia From Eplerenone on Spironolactone',
    'Negated Free-Text Intolerance Detail',
    'De-novo HFrEF Male Multi-Pillar Start',
    'De-novo HFrEF Diabetic Multi-Pillar Start',
    'Over-Budget Value Ordering',
    'HFimpEF Categorical Prior EF Excludes Finerenone',
    'Max New Classes Counts Binder Rescue',
    'High Body Weight Carvedilol Target Requires 50 BID',
    'Pregnant Vericiguat + Ivabradine Exclusion',
    'Vericiguat Continuation Carve-Out',
    'GLP-1 Continuation Carve-Out (BMI 28)',
    'Pregnant on GLP-1 (Force Removal)',
    'GLP-1 Boundary LVEF Exactly 40',
    'Warm-Wet Decompensation on Existing BB',
    'Blank Renal Data Stable Spironolactone',
    'Hyperkalemic Emergency K+ 6.2 (Deprescribe Offered)',
    'Hyperkalemic Emergency K+ 6.8 (Alerts Only)',
    'HFpEF Previous LVEF Zero Sentinel',
    'HFpEF LVEF 60 No Fabricated Decline',
    'Dual MRA Unknown History Keeps nsMRA',
    'MRA-Source',
    'RAAS-Source',
    'Rate-Source',
    'Adjunct-Source',
    'Diuretic-Source',
    'Final-Gaps',
    'Lab-Prereq'
];

function classGroupForVisitLimit(drugClass: string): string {
    if (RAAS_CLASSES.has(drugClass)) return 'RAAS Inhibitor';
    if (drugClass === 'nsMRA') return 'MRA';
    return drugClass;
}

function countNewClassGroups(regimen: { med: { drug_class: string } }[], currentRegimen: { med: { drug_class: string } }[]): number {
    const currentGroups = new Set(currentRegimen.map(r => classGroupForVisitLimit(r.med.drug_class)));
    const resultingGroups = new Set(regimen.map(r => classGroupForVisitLimit(r.med.drug_class)));
    let count = 0;
    resultingGroups.forEach(group => {
        if (!currentGroups.has(group)) count += 1;
    });
    return count;
}

async function runVerification() {
    console.log('Starting Clinical Scenario Verification...\n');
    let passed = 0;
    let failed = 0;
    // Score-breakdown reconciliation accumulator (one structural invariant, reported after all scenarios).
    let breakdownChecked = 0;
    const breakdownViolations: string[] = [];
    // Eligibility-rule invariant accumulator (see services/engine/eligibility.ts).
    let exclusionsChecked = 0;
    const exclusionViolations: string[] = [];
    // New-start dose invariant for the RAAS classes (see services/engine/raasStart.ts, HOW_TO_ADD_A_MEDICATION.md).
    let raasStartsChecked = 0;
    const raasStartViolations: string[] = [];
    // Declared-maximum invariant (facts.max_daily_dose): no displayed regimen exceeds a drug's label maximum total daily dose.
    let dailyMaxChecked = 0;
    const dailyMaxViolations: string[] = [];

    const formularyNames = MEDICATION_FORMULARY.map(m => m.name);
    const availableMedNames = new Set(formularyNames);
    const betaBlockerMeds = new Set(['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol']);
    // Scenario titles can remove drugs from the offered formulary (the title is the switch).
    const availableFor = (title: string): Set<string> => {
        let out = new Set(availableMedNames);
        if (title.includes('No BB Available')) out = new Set([...out].filter(n => !betaBlockerMeds.has(n)));
        if (title.includes('No Binder Available')) out = new Set([...out].filter(n => n !== 'Patiromer' && n !== 'Sodium Zirconium Cyclosilicate (Lokelma)'));
        if (title.includes('No ARB Available')) out = new Set([...out].filter(n => !['Valsartan', 'Candesartan', 'Losartan'].includes(n)));
        if (title.includes('No ARNI Available')) out.delete('Sacubitril/Valsartan (Entresto)');
        if (title.includes('No Patiromer Available')) out.delete('Patiromer');
        if (title.includes('No Lokelma Available')) out.delete('Sodium Zirconium Cyclosilicate (Lokelma)');
        return out;
    };

    // GLOBAL STRUCTURAL INVARIANT (pricing completeness): every formulary medication must have
    // an explicit DRUG_PRICES entry. A missing entry silently falls back to generic-level
    // pricing ($150 cash / $50 copay) — Furoscix (~$900/mo specialty) was missing and its core
    // cost trade-off vs oral loops was flattened, corrupting the cost domain for every
    // scenario that surfaced it.
    console.log('Checking structural invariant: formulary pricing completeness...');
    const missingPriceEntries = formularyNames.filter(name => !(name in DRUG_PRICES));
    if (missingPriceEntries.length > 0) {
        console.error(`  [FAIL] Formulary medication(s) missing explicit DRUG_PRICES entries (silent generic fallback): ${missingPriceEntries.join(', ')}`);
        failed++;
    } else {
        console.log('  [PASS] All formulary medications have explicit DRUG_PRICES entries.');
        passed++;
    }
    console.log('---');

    for (const scenario of SCENARIOS) {
        console.log(`Analyzing Scenario: "${scenario.title}"`);

        try {
            const scenarioPrices = await getDrugPrices(formularyNames, scenario.patient.insurance_tier);
            const scenarioAvailableMedNames = availableFor(scenario.title);
            const { scoredRegimens, excludedMedications, clinicalAlerts, monitoringPlan, eligibleAdjuncts, missingDataNotices } = generateAndScoreModifications(scenario.patient, scenarioAvailableMedNames, scenarioPrices);
            const topRegimen = scoredRegimens[0];

            // GLOBAL STRUCTURAL INVARIANT (every exclusion has a known rule): see services/engine/eligibility.ts.
            for (const e of excludedMedications) {
                exclusionsChecked++;
                if (!e.rule_id || !ELIGIBILITY_RULE_IDS.has(e.rule_id)) {
                    exclusionViolations.push(`"${scenario.title}": ${e.name} excluded without a known rule_id (${e.rule_id ?? 'missing'})`);
                }
            }

            // GLOBAL STRUCTURAL INVARIANT (no new start above its starting tier; beta-blockers must declare one): every add or swap-in of an
            // ARNI / ACEi / ARB in any displayed option must be at or below the start dose its entry declares
            // (verified-raas.md S1: "never add at 97/103"; label start doses for the ACEi/ARB).
            for (const r of scoredRegimens) {
                for (const m of r.modification_set?.modifications ?? []) {
                    if (!m.target) continue;
                    const isRaas = RAAS_CLASSES.has(m.target.med.drug_class);
                    // RAAS: adds and swap-ins. Every other drug that declares a start dose (beta-blockers, MRAs,
                    // H/ISDN, GLP-1, ...): new adds only — a within-class swap may carry an equivalent dose across.
                    const checked = isRaas ? (m.action === 'add' || m.action === 'swap') : (m.action === 'add' && (!!m.target.med.start_dose_for || m.target.med.drug_class === 'Beta Blocker'));
                    if (!checked) continue;
                    raasStartsChecked++;
                    const med = m.target.med;
                    if (!med.start_dose_for) { raasStartViolations.push(`${med.name} declares no start_dose_for`); continue; }
                    const order = med.available_doses.map(d => String(d.strength));
                    const startIdx = order.indexOf(String(med.start_dose_for(scenario.patient)));
                    const idx = order.indexOf(String(m.target.dose.strength));
                    if (startIdx < 0 || idx > startIdx) raasStartViolations.push(`"${scenario.title}": ${m.summary} is above the ${med.name} starting tier ${med.start_dose_for(scenario.patient)}`);
                }
            }

            // GLOBAL STRUCTURAL INVARIANT (declared daily maximum): no displayed regimen carries a drug above the maximum TOTAL DAILY dose
            // its entry declares (facts.max_daily_dose: bumetanide 10 mg, torsemide 200 mg, furosemide 600 mg). A med the patient arrived on
            // and the engine leaves unchanged is excluded (the engine does not rewrite an out-of-label current dose it did not touch).
            for (const r of scoredRegimens) {
                for (const m of r.regimen) {
                    const max = m.med.facts?.max_daily_dose;
                    if (max === undefined) continue;
                    const arrived = (scenario.patient.current_regimen ?? []).some(c => c.med.name === m.med.name && c.dose.strength === m.dose.strength && c.selected_frequency === m.selected_frequency);
                    if (arrived) continue;
                    dailyMaxChecked++;
                    if (dailyDose(m) > max) dailyMaxViolations.push(`"${scenario.title}": ${m.med.name} ${m.dose.strength} ${m.selected_frequency} = ${dailyDose(m)}/day exceeds the declared maximum ${max}`);
                }
            }

            // GLOBAL STRUCTURAL INVARIANT (score breakdown reconciles): see services/engine/scoreModel.ts.
            for (const r of scoredRegimens) {
                breakdownChecked++;
                const bd = r.score_breakdown;
                const tag = `"${scenario.title}"`;
                if (!bd) { breakdownViolations.push(`${tag}: missing score_breakdown`); continue; }
                const eps = 1e-9;
                const sumContrib = bd.domains.reduce((a, d) => a + d.contribution, 0);
                if (Math.abs(bd.weighted_subtotal - sumContrib) > eps) breakdownViolations.push(`${tag}: weighted_subtotal != sum(contributions)`);
                for (const d of bd.domains) {
                    if (Math.abs(d.weight * d.score - d.contribution) > eps) breakdownViolations.push(`${tag}: ${d.key} weight x score != contribution`);
                }
                const rawOverrides = (bd.overrides ?? []).filter(o => o.applies_to === 'raw_score').reduce((a, o) => a + (o.after - o.before), 0);
                const target = bd.weighted_subtotal + bd.adjustments.reduce((a, x) => a + x.points, 0) + rawOverrides;
                if (Math.abs(target - bd.raw_score) > eps) breakdownViolations.push(`${tag}: subtotal + adjustments + overrides (${target}) != raw_score (${bd.raw_score})`);
                if (bd.raw_score !== r.raw_score) breakdownViolations.push(`${tag}: breakdown.raw_score != regimen.raw_score`);
                if (bd.overall_score !== r.overall_score) breakdownViolations.push(`${tag}: breakdown.overall_score != regimen.overall_score`);
            }

            if (clinicalAlerts.length > 0) {
                clinicalAlerts.forEach(a => console.log(`  ALERT: ${a.substring(0, 80)}...`));
            }

            if (!topRegimen) {
                // No regimens is valid when clinical alerts block recs (e.g. SBP < 85)
                if (clinicalAlerts.length === 0) {
                    console.error(`  [FAIL] No regimens generated and no clinical alerts.`);
                    failed++;
                    continue;
                }
                console.log(`  No regimens (clinical alerts active).`);
            } else {
                console.log(`  Top Score: ${topRegimen.overall_score}`);
                console.log(`  Regimen: ${topRegimen.regimen.map(r => `${r.med.name} ${r.dose.strength}${r.dose.unit}`).join(' + ')}`);
            }

            // SCENARIO SPECIFIC ASSERTIONS
            const anyRegimenHasClass = (drugClass: string) =>
                scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === drugClass));
            const anyRegimenHasMed = (medName: string) =>
                scoredRegimens.some(r => r.regimen.some(m => m.med.name === medName));
            const topClasses = new Set(topRegimen ? topRegimen.regimen.map(r => r.med.drug_class) : []);
            const anyRegimenHasRaas = () =>
                scoredRegimens.some(r => r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class)));
            const anyRegimenMissingCorePillars = () =>
                scoredRegimens.some(r => {
                    const classesInRegimen = new Set(r.regimen.map(m => m.med.drug_class));
                    const hasRaas = classesInRegimen.has('ARNI') || classesInRegimen.has('ACEi') || classesInRegimen.has('ARB');
                    return !hasRaas || !classesInRegimen.has('Beta Blocker') || !classesInRegimen.has('MRA') || !classesInRegimen.has('SGLT2i');
                });
            const anyRegimenContainsAnyClass = (...drugClasses: string[]) =>
                scoredRegimens.some(r => r.regimen.some(m => drugClasses.includes(m.med.drug_class)));
            const anyRegimenWithClassViolates = (drugClass: string, predicate: (regimen: typeof scoredRegimens[number]) => boolean) =>
                scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === drugClass) && predicate(r)
                );

            let scenarioPassed = true;
            const failures: string[] = [];
            const hasScenarioSpecificCoverage = ASSERTION_TITLE_MARKERS.some(marker => scenario.title.includes(marker));
            const externalMeds = scenario.patient.external_medications || new Set<string>();

            // Global safety invariant (every scenario): an MRA is never STARTED above K+ 5.0 without a K+ binder in the same
            // option (label/guideline start threshold is 5.0; the binder-sequenced pathway is the only exception).
            const mraStartedWithoutBinder = scoredRegimens.some(r =>
                (r.modification_set?.modifications ?? []).some(m => m.action === 'add' && m.target && (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA'))
                && scenario.patient.potassium > 5.0
                && !r.regimen.some(m => m.med.drug_class === 'K+ Binder'));
            if (mraStartedWithoutBinder) {
                failures.push('MRA started above K+ 5.0 without a K+ binder in the same option');
                scenarioPassed = false;
            }
            // Global invariant: Lokelma in any displayed regimen carries the heart-failure sodium/edema warning.
            const lokelmaWithoutWarning = scoredRegimens.some(r =>
                r.regimen.some(m => m.med.name === 'Sodium Zirconium Cyclosilicate (Lokelma)')
                && !(r.warnings ?? []).some(w => w.includes('400 mg of sodium')));
            if (lokelmaWithoutWarning) {
                failures.push('Lokelma recommended without the heart-failure sodium/edema warning');
                scenarioPassed = false;
            }
            // Global invariant: the binder "enables RAAS/MRA" bonus never fires when no RAAS inhibitor or MRA is in the regimen.
            const binderBonusWithoutRaasMra = scoredRegimens.some(r =>
                !r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class) || m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA')
                && (r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.startsWith('Enables RAAS'))));
            if (binderBonusWithoutRaasMra) {
                failures.push('Binder "enables RAAS/MRA" bonus credited with no RAAS inhibitor or MRA in the regimen');
                scenarioPassed = false;
            }

            // Global safety invariant: never allow dual MRA (steroidal + nsMRA) in the same regimen
            const anyDualMRA = scoredRegimens.some(r => {
                const regimenClasses = new Set(r.regimen.map(m => m.med.drug_class));
                return regimenClasses.has('MRA') && regimenClasses.has('nsMRA');
            });
            if (anyDualMRA) {
                failures.push('Dual MRA regimen detected (steroidal MRA + Finerenone)');
                scenarioPassed = false;
            }

            // Global safety invariant: never allow dual RAAS (ACEi/ARB/ARNI combinations)
            const anyDualRAAS = scoredRegimens.some(r =>
                r.regimen.filter(m => RAAS_CLASSES.has(m.med.drug_class)).length > 1
            );
            if (anyDualRAAS) {
                failures.push('Dual RAAS regimen detected (ACEi/ARB/ARNI overlap)');
                scenarioPassed = false;
            }

            // Global score invariant: all scores must stay within 0-100.
            const hasOutOfRangeScore = scoredRegimens.some(r => {
                if (r.overall_score < 0 || r.overall_score > 100) return true;
                return Object.values(r.domain_scores).some(s => s < 0 || s > 100);
            });
            if (hasOutOfRangeScore) {
                failures.push('Score out of range detected (expected all scores within 0-100)');
                scenarioPassed = false;
            }

            // Global cost-effectiveness invariant: no displayed pick may be clinically dominated by
            // a lower-ranked sibling that is BOTH non-inferior on every benefit key (overall score,
            // GDMT completeness, uncapped raw score) AND cheaper. When benefit ties, the cheaper
            // option must rank first — otherwise the engine is recommending needless spend.
            for (let i = 0; i < scoredRegimens.length && scenarioPassed; i++) {
                for (let j = i + 1; j < scoredRegimens.length; j++) {
                    const a = scoredRegimens[i], b = scoredRegimens[j];
                    const bNonInferior = b.overall_score >= a.overall_score
                        && (b.gdmt_completeness ?? 0) >= (a.gdmt_completeness ?? 0)
                        && (b.raw_score ?? 0) >= (a.raw_score ?? 0);
                    if (bNonInferior && b.cost < a.cost) {
                        failures.push(`Cost-inefficient ranking: pick #${j + 1} ($${b.cost}) is clinically >= pick #${i + 1} ($${a.cost}) but ranked below it`);
                        scenarioPassed = false;
                        break;
                    }
                }
            }

            // Global display-safety invariant: every displayed regimen must remain above critical hemodynamic/lab floors.
            if (scoredRegimens.some(r => r.projected_patient.sbp < 85)) {
                failures.push('Displayed regimen projects SBP < 85');
                scenarioPassed = false;
            }
            if (scoredRegimens.some(r => r.projected_patient.potassium > 6.0)) {
                failures.push('Displayed regimen projects K+ > 6.0');
                scenarioPassed = false;
            }
            if (scoredRegimens.some(r => r.projected_patient.pulse < 45)) {
                failures.push('Displayed regimen projects HR < 45 (severe bradycardia)');
                scenarioPassed = false;
            }

            // Global hard-gate invariant: a confirmed PDE5 inhibitor exposure must never co-display
            // with a nitrate (absolute contraindication — fatal hypotension), in ANY scenario.
            const pde5Exposure = externalMeds.has('Sildenafil') || externalMeds.has('Tadalafil');
            if (pde5Exposure && scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'Vasodilator'))) {
                failures.push('Nitrate displayed to a patient with confirmed PDE5 inhibitor exposure');
                scenarioPassed = false;
            }

            // Global structural invariant: no duplicate medications in displayed regimen.
            const hasDuplicateRegimenEntry = scoredRegimens.some(r => {
                const names = r.regimen.map(m => m.med.name);
                return new Set(names).size !== names.length;
            });
            if (hasDuplicateRegimenEntry) {
                failures.push('Displayed regimen contains duplicate medication entries');
                scenarioPassed = false;
            }

            // Global sequencing invariant: displayed regimens must respect the patient-facing
            // max_new_classes_per_visit limit after all automatic rescue co-therapies are applied.
            const maxNewClasses = Math.max(0, Math.round(scenario.patient.max_new_classes_per_visit ?? 2));
            const visitLimitViolations = scoredRegimens.filter(r =>
                countNewClassGroups(r.regimen, scenario.patient.current_regimen || []) > maxNewClasses
            );
            if (visitLimitViolations.length > 0) {
                failures.push(`${visitLimitViolations.length} displayed regimen(s) exceed max_new_classes_per_visit=${maxNewClasses}`);
                scenarioPassed = false;
            }

            // Global context invariant: weight-based target-dose labeling uses the same baseline
            // dry weight the engine used for scoring, not post-treatment projected weight.
            const missingBaselineDryWeight = scoredRegimens.some(r =>
                r.baseline_dry_weight_kg !== scenario.patient.volume_status.dry_weight_kg
            );
            if (missingBaselineDryWeight) {
                failures.push('Displayed regimen missing baseline dry-weight context for weight-based target-dose checks');
                scenarioPassed = false;
            }

            // Global DDI invariant: whenever BB + Ivabradine coexist, explicit chronotropic warning must exist.
            const hasChronotropicComboWithoutWarning = scoredRegimens.some(r => {
                const classesInRegimen = new Set(r.regimen.map(m => m.med.drug_class));
                const hasCombo = classesInRegimen.has('Beta Blocker') && classesInRegimen.has('If Inhibitor');
                const hasWarning = r.warnings.some(w => w.toLowerCase().includes('beta blocker + ivabradine'));
                return hasCombo && !hasWarning;
            });
            if (hasChronotropicComboWithoutWarning) {
                failures.push('Missing explicit DDI warning for Beta Blocker + Ivabradine combination');
                scenarioPassed = false;
            }

            const missingAmiodaroneDigoxinWarning = scoredRegimens.some(r => {
                const hasRiskContext = externalMeds.has('Amiodarone') || scenario.patient.comorbidities.has('On Amiodarone');
                const hasDigoxin = r.regimen.some(m => m.med.name === 'Digoxin');
                const hasWarning = r.warnings.some(w => w.includes('Amiodarone'));
                return hasRiskContext && hasDigoxin && !hasWarning;
            });
            if (missingAmiodaroneDigoxinWarning) {
                failures.push('Missing DDI warning for Digoxin + Amiodarone exposure');
                scenarioPassed = false;
            }

            const missingCcbChronotropeWarning = scoredRegimens.some(r => {
                const hasRiskContext =
                    externalMeds.has('Verapamil') ||
                    externalMeds.has('Diltiazem') ||
                    scenario.patient.comorbidities.has('On Verapamil/Diltiazem');
                const hasBetaOrDigoxin = r.regimen.some(m =>
                    m.med.drug_class === 'Beta Blocker' || m.med.name === 'Digoxin'
                );
                const hasWarning = r.warnings.some(w => w.includes('Verapamil/Diltiazem'));
                return hasRiskContext && hasBetaOrDigoxin && !hasWarning;
            });
            if (missingCcbChronotropeWarning) {
                failures.push('Missing DDI warning for Verapamil/Diltiazem with beta blocker/digoxin');
                scenarioPassed = false;
            }

            const missingLithiumDiureticWarning = scoredRegimens.some(r => {
                const hasRiskContext = externalMeds.has('Lithium') || scenario.patient.comorbidities.has('On Lithium');
                const hasDiuretic = r.regimen.some(m =>
                    m.med.drug_class === 'Loop Diuretic' || m.med.drug_class === 'Thiazide-like Diuretic'
                );
                const hasWarning = r.warnings.some(w => w.toLowerCase().includes('lithium'));
                return hasRiskContext && hasDiuretic && !hasWarning;
            });
            if (missingLithiumDiureticWarning) {
                failures.push('Missing DDI warning for Lithium + diuretic exposure');
                scenarioPassed = false;
            }

            const missingNitratePde5Warning = scoredRegimens.some(r => {
                const hasRiskContext = externalMeds.has('Sildenafil') || externalMeds.has('Tadalafil');
                const hasNitrate = r.regimen.some(m => m.med.drug_class === 'Vasodilator');
                const hasWarning = r.warnings.some(w =>
                    w.includes('PDE5') || w.toLowerCase().includes('sildenafil/tadalafil')
                );
                return hasRiskContext && hasNitrate && !hasWarning;
            });
            if (missingNitratePde5Warning) {
                failures.push('Missing DDI warning for nitrate + PDE5 inhibitor exposure');
                scenarioPassed = false;
            }

            // 1. Hyperkalemia (K+ 5.6) -> Should NOT have MRA
            if (scenario.title.includes('Hyperkalemia')) {
                if (anyRegimenHasClass('MRA')) {
                    failures.push('Contraindicated MRA prescribed despite K+ 5.6');
                    scenarioPassed = false;
                }
            }

            // 2. Severe Hypotension -> SBP < 90 should block all recs
            if (scenario.title.includes('Severe Hypotension')) {
                if (scenario.patient.sbp < 90) {
                    // S2: Should have hemodynamic instability alert and no drug recs
                    if (scoredRegimens.length > 0) {
                        failures.push(`Drug recs generated despite SBP ${scenario.patient.sbp}`);
                        scenarioPassed = false;
                    }
                    if (!clinicalAlerts.some(a => a.includes('HEMODYNAMIC INSTABILITY'))) {
                        failures.push('Missing hemodynamic instability alert');
                        scenarioPassed = false;
                    }
                }
            }

            // 2b. Dry & Cold low-output phenotype -> should trigger low-output alert with capped scores + mandatory warnings
            if (scenario.title.includes('Dry & Cold')) {
                if (!clinicalAlerts.some(a => a.includes('LOW OUTPUT STATE'))) {
                    failures.push('Missing LOW OUTPUT STATE alert');
                    scenarioPassed = false;
                }
                // H2: Low-output now returns recommendations with mandatory stabilization warnings (not empty)
                if (scoredRegimens.length > 0) {
                    // Scores must be capped at the low-output cap
                    if (scoredRegimens.some(r => r.overall_score > SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.max)) {
                        failures.push(`Low-output regimen scores should be capped at ${SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.max}`);
                        scenarioPassed = false;
                    }
                    // Mandatory low-output warning must be present
                    const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                    if (!allWarnings.some(w => w.includes('LOW OUTPUT STATE'))) {
                        failures.push('Missing mandatory LOW OUTPUT STATE warning on recommendations');
                        scenarioPassed = false;
                    }
                }
            }

            // Baseline default patient — the exact d631873 regression surface: warm-and-wet
            // NYHA III on carvedilol 25 BID, missing MRA + SGLT2i. Warm decompensation must
            // CONTINUE the beta-blocker (the forced cut is hypoperfusion/"cold"-gated) and
            // still offer the missing pillars — the pre-fix bug produced "reduce BB, add
            // nothing" for this very patient.
            if (scenario.title.includes('John Doe (Wet & Warm)')) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for the baseline patient');
                    scenarioPassed = false;
                }
                const everyRegimenCutsBB = scoredRegimens.length > 0 && scoredRegimens.every(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Beta Blocker'
                    )
                );
                if (everyRegimenCutsBB) {
                    failures.push('Warm-and-wet baseline: beta-blocker cut forced into EVERY candidate (d631873 regression — reduction is cold/hypoperfusion-gated)');
                    scenarioPassed = false;
                }
                const retainsBbAndAddsPillar = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'Beta Blocker') &&
                    (r.modification_set?.modifications ?? []).some(m =>
                        m.action === 'add' && m.target && ['SGLT2i', 'MRA', 'nsMRA'].includes(m.target.med.drug_class)
                    )
                );
                if (!retainsBbAndAddsPillar) {
                    failures.push('Warm-and-wet baseline: no option retains the beta-blocker while adding a missing pillar (SGLT2i/MRA)');
                    scenarioPassed = false;
                }
            }

            // A-HeFT scenarios (Black + NYHA III HFrEF): H/ISDN is the title-promised behavior —
            // Class I add-on (A-HeFT). Eligibility-based (adjuncts may not rank in top-3 picks).
            if (scenario.title.includes('African American (A-HeFT Indication)') ||
                scenario.title.includes('African American NYHA III')) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for A-HeFT scenario');
                    scenarioPassed = false;
                }
                if (excludedMedications.some(e => e.drug_class === 'Vasodilator')) {
                    failures.push('H/ISDN excluded despite A-HeFT indication (Black, NYHA III, no PDE5i exposure)');
                    scenarioPassed = false;
                }
                const hisdnSurfaced = anyRegimenHasClass('Vasodilator') ||
                    (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('hydralazine'));
                if (!hisdnSurfaced) {
                    failures.push('H/ISDN neither displayed nor surfaced in eligible adjuncts despite A-HeFT criteria');
                    scenarioPassed = false;
                }
            }

            // Gout & Congestion: the title promises BOTH halves — congestion (+5kg, Edema 3+)
            // is treated with a diuretic AND the gout/uric-acid caution is surfaced on
            // diuretic-containing options (loop/thiazide special-feature caution).
            if (scenario.title.includes('Gout & Congestion')) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for gout + congestion scenario');
                    scenarioPassed = false;
                }
                // Eligibility-based (project convention: adjuncts may not rank in the top-3
                // display picks): a loop diuretic must not be excluded and must be surfaced.
                const anyDiureticDisplayed = anyRegimenContainsAnyClass('Loop Diuretic', 'Thiazide-like Diuretic');
                const allLoopsExcluded = !MEDICATION_FORMULARY.some(m =>
                    m.drug_class === 'Loop Diuretic' && !excludedMedications.some(e => e.name === m.name)
                );
                const diureticSurfaced = anyDiureticDisplayed ||
                    (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('loop diuretic'));
                if (allLoopsExcluded) {
                    failures.push('All loop diuretics excluded despite +5kg fluid excess with Edema (3+)');
                    scenarioPassed = false;
                }
                if (!diureticSurfaced) {
                    failures.push('No diuretic displayed or surfaced in eligible adjuncts despite +5kg fluid excess with Edema (3+)');
                    scenarioPassed = false;
                }
                const goutCautionSurfaced = scoredRegimens.some(r =>
                    (r.rationale ?? []).some(x => x.toLowerCase().includes('gout')) ||
                    r.warnings.some(w => w.toLowerCase().includes('gout'))
                ) || clinicalAlerts.some(a => a.toLowerCase().includes('gout'));
                if (anyDiureticDisplayed && !goutCautionSurfaced) {
                    failures.push('Diuretic displayed for a gout patient without any gout / uric-acid caution surfaced');
                    scenarioPassed = false;
                }
            }

            // HFpEF with Resistant Edema: title-promised behavior — SGLT2i (the HFpEF Class I
            // pillar) plus a loop diuretic for the +5kg resistant congestion.
            if (scenario.title.includes('HFpEF with Resistant Edema')) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for HFpEF resistant edema scenario');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('SGLT2i')) {
                    failures.push('HFpEF resistant edema: SGLT2i (Class I HFpEF pillar) missing from all displayed regimens');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('Loop Diuretic')) {
                    failures.push('HFpEF resistant edema: no loop diuretic offered despite +5kg fluid excess');
                    scenarioPassed = false;
                }
            }

            // Severe Dilation (LVEF 20, NYHA IV, +6kg, 3 exam findings): acutely decompensated
            // with NO baseline beta-blocker — BB initiation must be blocked, while
            // disease-modifying pillar therapy (SGLT2i / RAAS) is still offered.
            if (scenario.title.includes('Severe Dilation')) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for severe dilation scenario');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('Severe dilation: beta-blocker INITIATED during NYHA IV acute decompensation');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('SGLT2i') && !anyRegimenHasRaas()) {
                    failures.push('Severe dilation: no disease-modifying pillar (SGLT2i/RAAS) offered');
                    scenarioPassed = false;
                }
            }

            // H1. Acute decompensation with no baseline BB: do not initiate beta blocker.
            if (scenario.title.includes('Acute Decompensated NYHA IV (No BB Initiation)')) {
                const anyBB = scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'Beta Blocker'));
                if (anyBB) {
                    failures.push('Beta blocker initiation detected in acutely decompensated NYHA IV scenario');
                    scenarioPassed = false;
                }
            }

            // H1/3. Cold-and-wet decompensation with existing BB: enforce down-titration on EVERY
            // candidate (not keep at same dose, not abrupt stop)...
            if (scenario.title.includes('Existing BB Requires Down-Titration')) {
                const missingDownTitrate = scoredRegimens.some(r => {
                    const mods = r.modification_set?.modifications || [];
                    const hasBbDownTitrate = mods.some(m =>
                        m.action === 'titrate_down' && m.source?.med.drug_class === 'Beta Blocker'
                    );
                    return !hasBbDownTitrate;
                });
                if (missingDownTitrate) {
                    failures.push('Existing beta blocker was not down-titrated in cold decompensation scenario');
                    scenarioPassed = false;
                }
                // ...AND the forced reduction must NOT suppress safe guideline additions. SGLT2i is
                // beneficial in acute HF (EMPULSE / SOLOIST-WHF) and has near-zero hemodynamic cost —
                // at least one option must add a missing pillar alongside the BB reduction.
                const offersAddition = scoredRegimens.some(r =>
                    (r.modification_set?.modifications || []).some(m =>
                        m.action === 'add' && m.target &&
                        (m.target.med.drug_class === 'SGLT2i' || m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
                    )
                );
                if (!offersAddition) {
                    failures.push('Cold decompensation: forced BB reduction suppressed all guideline additions (expected SGLT2i/MRA add alongside the cut)');
                    scenarioPassed = false;
                }
            }

            // H4. SGLT2i exclusion in Type 1 DM / prior DKA risk context.
            if (scenario.title.includes('Type 1 DM + Prior DKA')) {
                const anySGLT2 = scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'SGLT2i'));
                if (anySGLT2) {
                    failures.push('SGLT2i offered despite Type 1 DM / prior DKA risk');
                    scenarioPassed = false;
                }
            }

            // H5. AV block should contraindicate beta blockers and digoxin unless paced/specialist-directed.
            if (scenario.title.includes('AV Block')) {
                const hasContraChronotrope = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'Beta Blocker' || m.med.name === 'Digoxin')
                );
                if (hasContraChronotrope) {
                    failures.push('Beta blocker or Digoxin offered despite AV block scenario');
                    scenarioPassed = false;
                }
            }

            // H6. Non-formulary DDI exposures should trigger explicit warnings when interacting classes are present.
            if (scenario.title.includes('Non-Formulary DDI Exposures')) {
                const hasAmiodaroneWarning = scoredRegimens.some(r => r.warnings.some(w => w.includes('Amiodarone')));
                const hasCcbWarning = scoredRegimens.some(r => r.warnings.some(w => w.includes('Verapamil/Diltiazem')));
                const hasLithiumWarning = scoredRegimens.some(r => r.warnings.some(w => w.includes('lithium')));
                if (!hasAmiodaroneWarning) {
                    failures.push('Missing Amiodarone-related DDI warning');
                    scenarioPassed = false;
                }
                if (!hasCcbWarning) {
                    failures.push('Missing Verapamil/Diltiazem-related DDI warning');
                    scenarioPassed = false;
                }
                if (!hasLithiumWarning) {
                    failures.push('Missing Lithium-related DDI warning');
                    scenarioPassed = false;
                }
            }

            // ADVERSARIAL: nitrate + PDE5i is an absolute CI (fatal hypotension) — must be a hard
            // gate, not a displayed regimen with a warning attached.
            if (scenario.title.includes('Nitrate + PDE5 Exposure')) {
                const nitrateRegimens = scoredRegimens.filter(r =>
                    r.regimen.some(m => m.med.drug_class === 'Vasodilator')
                );
                if (nitrateRegimens.length > 0) {
                    failures.push('Nitrate-containing regimen DISPLAYED despite PDE5 inhibitor exposure (absolute contraindication)');
                    scenarioPassed = false;
                }
                const nitrateExcluded = excludedMedications.some(e => e.name === 'Hydralazine/Isosorbide Dinitrate');
                if (!nitrateExcluded) {
                    failures.push('H/ISDN not present in excludedMedications despite PDE5 inhibitor exposure');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('INAPPROPRIATE THERAPY') && a.includes('PDE5'))) {
                    failures.push('Missing INAPPROPRIATE THERAPY deprescribe alert for arriving nitrate + PDE5i combination');
                    scenarioPassed = false;
                }
                const nitrateForcedRemoval = scoredRegimens.length > 0 && scoredRegimens.every(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        m.action === 'remove' && m.source?.med.drug_class === 'Vasodilator'
                    )
                );
                if (!nitrateForcedRemoval) {
                    failures.push('Current H/ISDN not force-removed from every candidate regimen');
                    scenarioPassed = false;
                }
            }

            // H11. SBP/DBP inversion should hard-stop recommendation generation.
            if (scenario.title.includes('Invalid BP Inversion')) {
                if (scoredRegimens.length > 0) {
                    failures.push('Regimens generated despite invalid BP inversion input');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('INPUT ERROR'))) {
                    failures.push('Missing explicit INPUT ERROR alert for SBP/DBP inversion');
                    scenarioPassed = false;
                }
            }

            // H12. Duplicate current meds should be deduplicated with alert, not double-counted.
            if (scenario.title.includes('Duplicate Current Medications')) {
                if (!clinicalAlerts.some(a => a.includes('Duplicate current medications removed'))) {
                    failures.push('Missing duplicate-medication deduplication alert');
                    scenarioPassed = false;
                }
            }

            // 3. Bradycardia -> No BB
            if (scenario.title.includes('Bradycardia')) {
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('Beta Blocker prescribed in Bradycardia (HR 48)');
                    scenarioPassed = false;
                }
            }

            // 4. Angioedema -> No ACEi/ARNI, but ARBs allowed with caution (ACC/AHA 2022)
            if (scenario.title.includes('Angioedema')) {
                if (anyRegimenContainsAnyClass('ACEi', 'ARNI')) {
                    failures.push('ACEi/ARNI prescribed despite Angioedema history');
                    scenarioPassed = false;
                }
                // ARBs should be available with monitoring warning
                const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                if (anyRegimenHasClass('ARB') && !allWarnings.some(w => w.includes('ANGIOEDEMA CAUTION'))) {
                    failures.push('ARB prescribed with angioedema history but missing ANGIOEDEMA CAUTION warning');
                    scenarioPassed = false;
                }
            }

            // 5. Asthma -> Selective BB only (Metoprolol or Bisoprolol), No Carvedilol
            // (Carvedilol is the only non-selective BB in the 32-drug formulary — the old
            // Propranolol clause could never fire and was removed as dead code.)
            if (scenario.title.includes('Severe Asthma')) {
                if (anyRegimenHasMed('Carvedilol')) { // Non-selective
                    failures.push('Non-selective Beta Blocker (Carvedilol) prescribed in Asthma');
                    scenarioPassed = false;
                }
                // Should probably have a BB if possible, but selective
            }

            // 6. Critical Renal (eGFR 25) -> No MRA (cutoff usually 30), Caution ACEi
            if (scenario.title.includes('Critical Renal')) {
                if (anyRegimenHasClass('MRA')) {
                    failures.push('MRA prescribed despite eGFR 25');
                    scenarioPassed = false;
                }
            }

            // 6b. Dapagliflozin should not be initiated if eGFR < 25
            if (scenario.title.includes('eGFR 22')) {
                if (anyRegimenHasMed('Dapagliflozin')) {
                    failures.push('Dapagliflozin prescribed despite eGFR 22');
                    scenarioPassed = false;
                }
            }

            // 7. Non-Compliant -> Low Complexity
            if (scenario.title.includes('Non-Compliant')) {
                const excessiveComplexity = scoredRegimens.some(r => r.complexity > 10);
                if (excessiveComplexity) { // Arbitrary threshold
                    failures.push('Complexity too high for tolerance 0 in a displayed regimen');
                    scenarioPassed = false;
                }
            }

            // 8. Ideal Candidate -> Should have all 4 GDMT pillars
            if (scenario.title.includes('Ideal Candidate')) {
                const pillarPresent = {
                    raas: topClasses.has('ARNI') || topClasses.has('ACEi') || topClasses.has('ARB'),
                    bb: topClasses.has('Beta Blocker'),
                    mra: topClasses.has('MRA'),
                    sglt2: topClasses.has('SGLT2i')
                };
                if (!pillarPresent.raas) { failures.push('Missing RAAS pillar'); scenarioPassed = false; }
                if (!pillarPresent.bb) { failures.push('Missing BB pillar'); scenarioPassed = false; }
                if (!pillarPresent.mra) { failures.push('Missing MRA pillar'); scenarioPassed = false; }
                if (!pillarPresent.sglt2) { failures.push('Missing SGLT2i pillar'); scenarioPassed = false; }
            }

            // 9. Obese HFpEF -> No ARNI/BB/MRA; should have SGLT2i
            if (scenario.title.includes('Obese HFpEF')) {
                if (anyRegimenContainsAnyClass('ARNI', 'ACEi', 'ARB')) {
                    failures.push('RAAS prescribed for HFpEF (not indicated)');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('BB prescribed for HFpEF (not indicated)');
                    scenarioPassed = false;
                }
                // Note: Steroidal MRA is now a valid Class IIb adjunct for HFpEF (TOPCAT Americas, ACC/AHA 2022 §7.4)
            }

            // 10. Iron-Deficient -> Should have IV Iron
            if (scenario.title.includes('Iron-Deficient')) {
                if (!anyRegimenHasClass('IV Iron')) {
                    failures.push('IV Iron not prescribed despite ferritin < 100 and TSAT < 20');
                    scenarioPassed = false;
                }
            }

            // 11. Sinus Tachycardia (HR 82, sinus, LVEF 30, target-dose BB) -> Ivabradine
            // eligible + surfaced (SHIFT). Unconditional eligibility check — the old form was
            // conditioned on the top regimen's PROJECTED pulse staying >= 70, so it silently
            // passed whenever any modification projected pulse < 70 even if ivabradine was
            // wrongly withheld.
            if (scenario.title.includes('Ivabradine Candidate')) {
                if (excludedMedications.some(e => e.drug_class === 'If Inhibitor')) {
                    failures.push('Ivabradine excluded despite SHIFT criteria (HR >= 70, sinus, LVEF <= 35, target-dose BB)');
                    scenarioPassed = false;
                }
                const ivabradineSurfaced = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'If Inhibitor')
                ) || (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('ivabradine'));
                if (!ivabradineSurfaced) {
                    failures.push('Ivabradine neither displayed nor surfaced in eligible adjuncts despite SHIFT criteria');
                    scenarioPassed = false;
                }
            }

            // 9b. Volume depletion -> prioritize diuretic de-escalation before RAAS/MRA/SGLT2 intensification
            if (scenario.title.includes('Volume Depleted')) {
                const unsafeVolumeRegimen = scoredRegimens.some(r => {
                    const mods = r.modification_set?.modifications || [];
                    const volumeSensitiveIntensification = mods.some(m => {
                        const targetClass = m.target?.med.drug_class;
                        if (!targetClass) return false;
                        if (!(m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap')) return false;
                        return targetClass === 'ARNI' || targetClass === 'ACEi' || targetClass === 'ARB' || targetClass === 'MRA' || targetClass === 'SGLT2i';
                    });
                    const diureticDeEscalation = mods.some(m => {
                        const sourceClass = m.source?.med.drug_class;
                        if (!sourceClass) return false;
                        if (!(m.action === 'remove' || m.action === 'titrate_down')) return false;
                        return sourceClass === 'Loop Diuretic' || sourceClass === 'Thiazide-like Diuretic';
                    });
                    return volumeSensitiveIntensification && !diureticDeEscalation;
                });
                if (unsafeVolumeRegimen) {
                    failures.push('Volume-depleted scenario intensified RAAS/MRA/SGLT2 without diuretic de-escalation');
                    scenarioPassed = false;
                }
            }

            // 11b. Ivabradine fallback when all BB agents are unavailable
            if (scenario.title.includes('Ivabradine Fallback')) {
                if (!anyRegimenHasClass('If Inhibitor')) {
                    failures.push('Ivabradine fallback missing when beta blockers are unavailable');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('Beta blocker present despite scenario-level formulary exclusion');
                    scenarioPassed = false;
                }
            }

            // 12. Budget-Constrained ($25) -> Should NOT have Entresto (too expensive).
            // Exact-anchored marker: the bare 'Budget-Constrained' also matched 'ACEi Cough
            // Intolerance Budget-Constrained', cross-applying this $25 assertion there.
            if (scenario.title.includes('Budget-Constrained ($25)')) {
                if (anyRegimenHasMed('Sacubitril/Valsartan (Entresto)')) {
                    failures.push('Entresto prescribed despite $25 budget');
                    scenarioPassed = false;
                }
            }

            // 13. ACEi-to-ARNI Swap -> Must have 36-hour washout warning
            if (scenario.title.includes('ACEi-to-ARNI Swap')) {
                // Check across all returned regimens for any that contain the washout warning
                const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                if (!allWarnings.some(w => w.includes('36-hour washout'))) {
                    failures.push('Missing 36-hour washout warning for ACEi->ARNI swap');
                    scenarioPassed = false;
                }

                const allSummaries = scoredRegimens
                    .flatMap(r => r.modification_set?.modifications ?? [])
                    .map(m => m.summary);
                const hasStepwiseSummary = allSummaries.some(s =>
                    s.includes('STOP') && s.includes('WAIT 36 hours') && s.includes('THEN start')
                );
                if (!hasStepwiseSummary) {
                    failures.push('ACEi->ARNI change missing explicit STOP/WAIT/THEN summary');
                    scenarioPassed = false;
                }
            }

            // 14. Euvolemic Asthma -> No Carvedilol, should have Bisoprolol or Metoprolol
            if (scenario.title.includes('Euvolemic Asthma')) {
                if (anyRegimenHasMed('Carvedilol')) {
                    failures.push('Non-selective Carvedilol prescribed in Asthma');
                    scenarioPassed = false;
                }
                const anySafeBB = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name === 'Bisoprolol' || m.med.name === 'Metoprolol Succinate')
                );
                const anyBB = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'Beta Blocker')
                );
                if (anyBB && !anySafeBB) {
                    failures.push('Only non-cardioselective beta blockers were offered in asthma scenario');
                    scenarioPassed = false;
                }
                if (!anyBB) {
                    const anyIvabradine = scoredRegimens.some(r =>
                        r.regimen.some(m => m.med.drug_class === 'If Inhibitor')
                    );
                    if (!anyIvabradine) {
                        failures.push('No beta blocker offered in asthma scenario and Ivabradine fallback also missing');
                        scenarioPassed = false;
                    }
                }
            }

            // 15. HFimpEF -> Should keep all 4 GDMT pillars (not de-escalate)
            if (scenario.title.includes('HFimpEF') && !scenario.title.includes('HFimpEF Categorical Prior EF Excludes Finerenone')) {
                if (scoredRegimens.length > 0 && anyRegimenMissingCorePillars()) {
                    failures.push('HFimpEF: one or more displayed regimens de-escalated core GDMT pillars');
                    scenarioPassed = false;
                }
            }

            if (scenario.title.includes('HFimpEF Unknown on Existing Quad')) {
                if (scoredRegimens.length > 0 && anyRegimenMissingCorePillars()) {
                    failures.push('HFimpEF-unknown continuation scenario dropped core GDMT pillars in displayed regimens');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('Recommendations preserve quad GDMT'))) {
                    failures.push('Missing explicit HFimpEF-unknown preservation alert');
                    scenarioPassed = false;
                }
            }

            // 16. Pregnant -> No RAAS agents (ACEi/ARB/ARNI), no MRA
            if (scenario.title.includes('Pregnant')) {
                if (anyRegimenContainsAnyClass('ARNI', 'ACEi', 'ARB')) {
                    failures.push('RAAS agent prescribed in pregnancy (Category X)');
                    scenarioPassed = false;
                }
                if (anyRegimenContainsAnyClass('MRA', 'nsMRA')) {
                    failures.push('MRA prescribed in pregnancy (Category X)');
                    scenarioPassed = false;
                }
                // Should have pregnancy alert
                if (!clinicalAlerts.some(a => a.includes('PREGNANCY'))) {
                    failures.push('Missing pregnancy clinical alert');
                    scenarioPassed = false;
                }
            }

            // 17. Severe Hypotension (SBP 82) -> No drug recommendations, clinical alert present
            if (scenario.title.includes('SBP 82')) {
                if (scoredRegimens.length > 0) {
                    failures.push(`Drug recommendations generated despite SBP 82 (got ${scoredRegimens.length} regimens)`);
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('HEMODYNAMIC INSTABILITY'))) {
                    failures.push('Missing hemodynamic instability alert for SBP 82');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('ADVANCED HEART FAILURE'))) {
                    failures.push('Missing advanced HF referral alert for LVEF 18 + NYHA IV + BNP 8000');
                    scenarioPassed = false;
                }
            }

            // 19. Pregnant on existing ACEi -> ACEi must NOT be titrated up; should be removed or down-titrated
            if (scenario.title.includes('Pregnant on Existing ACEi')) {
                if (anyRegimenContainsAnyClass('ACEi', 'ARNI', 'ARB')) {
                    failures.push('RAAS agent retained/titrated in pregnancy (should be removed)');
                    scenarioPassed = false;
                }
                if (anyRegimenContainsAnyClass('MRA', 'nsMRA')) {
                    failures.push('MRA prescribed in pregnancy');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('PREGNANCY'))) {
                    failures.push('Missing pregnancy clinical alert');
                    scenarioPassed = false;
                }
                // Should keep BB (Carvedilol is safe in pregnancy)
                if (scoredRegimens.length > 0 && !anyRegimenHasClass('Beta Blocker')) {
                    failures.push('BB removed in pregnancy (should be continued)');
                    scenarioPassed = false;
                }
            }

            // 20. SGLT2i continuation below eGFR threshold
            if (scenario.title.includes('SGLT2i Continuation')) {
                if (scoredRegimens.length > 0 && !anyRegimenHasClass('SGLT2i')) {
                    failures.push('SGLT2i removed despite continuation being allowed below initiation threshold');
                    scenarioPassed = false;
                }
            }

            // 21. SBP 90 Borderline (Allowed With Caution) -> the hemodynamic gate is STRICT
            // SBP < 90, so at exactly 90 recommendations ARE generated. Pin the boundary: the
            // engine must not wrongly hard-block at 90 (the old block only inspected output
            // when present, so it silently passed on empty output and asserted nothing the
            // global invariants didn't already cover — projected SBP < 85 display safety is
            // enforced globally above).
            if (scenario.title.includes('SBP 90 Borderline')) {
                if (scoredRegimens.length === 0) {
                    failures.push('No recommendations at SBP exactly 90 — the gate is strict < 90; the boundary was wrongly blocked');
                    scenarioPassed = false;
                }
            }

            // 22. MRA boundary (eGFR 31, K+ 5.4) -> MRA should come with binder rescue
            if (scenario.title.includes('MRA Boundary')) {
                const missingBinderForMra = anyRegimenWithClassViolates('MRA', r => {
                    const hasBinder = r.regimen.some(m => m.med.drug_class === 'K+ Binder');
                    return !hasBinder;
                });
                if (missingBinderForMra) {
                    failures.push('MRA prescribed at K+ 5.4 without a potassium binder');
                    scenarioPassed = false;
                }
                const excessiveMraDose = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'MRA' && Number(m.dose.strength) > 25)
                );
                if (excessiveMraDose) {
                    failures.push('MRA dose >25mg offered at eGFR 31 (expected renal-adjusted cap in eGFR 30-45)');
                    scenarioPassed = false;
                }
            }

            // 23. Elderly >80 on all 4 pillars -> should show age-related warnings
            if (scenario.title.includes('Elderly >80')) {
                if (topRegimen) {
                    // Should keep all 4 pillars (already on them)
                    const pillarPresent = {
                        raas: topClasses.has('ARNI') || topClasses.has('ACEi') || topClasses.has('ARB'),
                        bb: topClasses.has('Beta Blocker'),
                        mra: topClasses.has('MRA'),
                        sglt2: topClasses.has('SGLT2i')
                    };
                    if (!pillarPresent.raas) { failures.push('Elderly: RAAS dropped'); scenarioPassed = false; }
                    if (!pillarPresent.bb) { failures.push('Elderly: BB dropped'); scenarioPassed = false; }
                    if (!pillarPresent.mra) { failures.push('Elderly: MRA dropped'); scenarioPassed = false; }
                    if (!pillarPresent.sglt2) { failures.push('Elderly: SGLT2i dropped'); scenarioPassed = false; }
                }
            }

            // 24. NYHA II + BNP >= 1600 + LVEF < 45 -> Vericiguat should be available
            if (scenario.title.includes('Vericiguat Eligible')) {
                // Vericiguat should appear in at least one regimen
                const anyVericiguat = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'sGC Stimulator')
                );
                if (!anyVericiguat) {
                    failures.push('Vericiguat not available despite NYHA II + BNP 1800 + LVEF 35 (VICTORIA criteria)');
                    scenarioPassed = false;
                }
            }

            if (scenario.title.includes('No Recent Worsening')) {
                const anyVericiguat = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'sGC Stimulator')
                );
                if (anyVericiguat) {
                    failures.push('Vericiguat offered despite no recent worsening HF event');
                    scenarioPassed = false;
                }
                if (clinicalAlerts.some(a => a.includes('VERICIGUAT ELIGIBILITY WARNING'))) {
                    failures.push('Unexpected Vericiguat eligibility warning when worsening-HF status is explicitly "no"');
                    scenarioPassed = false;
                }
            }

            // 25. Liver Disease + AFib -> No Carvedilol (hepatic CI), should have Digoxin for rate control
            if (scenario.title.includes('Liver Disease + AFib')) {
                if (anyRegimenHasMed('Carvedilol')) {
                    failures.push('Carvedilol prescribed despite Liver Disease (Child-Pugh B/C) contraindication');
                    scenarioPassed = false;
                }
                // The digoxin half of the title promise (AFib rate control, no renal/K+ CI here).
                // Eligibility-based: digoxin is an adjunct and may not rank in the top-3 picks.
                if (excludedMedications.some(e => e.name === 'Digoxin')) {
                    failures.push('Digoxin excluded despite AFib rate-control indication (K+ 4.2, eGFR 55 — no CI)');
                    scenarioPassed = false;
                }
                const digoxinSurfaced = anyRegimenHasMed('Digoxin') ||
                    (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('digoxin'));
                if (!digoxinSurfaced) {
                    failures.push('Digoxin neither displayed nor surfaced in eligible adjuncts for AFib rate control');
                    scenarioPassed = false;
                }
            }

            // 26. NSAID + RAAS DDI -> should have DDI warning
            if (scenario.title.includes('NSAID + RAAS DDI')) {
                if (anyRegimenHasRaas()) {
                    const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                    if (!allWarnings.some(w => w.includes('NSAID'))) {
                        failures.push('Missing DDI warning for RAAS + chronic NSAID use');
                        scenarioPassed = false;
                    }
                }
            }

            // 37. Projected SBP Safety -> Top regimen must not project SBP < 85
            if (scenario.title.includes('Projected SBP Safety')) {
                if (topRegimen) {
                    const projSbp = topRegimen.projected_patient.sbp;
                    if (projSbp < 85) {
                        failures.push(`Top regimen projects dangerous SBP ${projSbp.toFixed(0)} (must stay > 85)`);
                        scenarioPassed = false;
                    }
                }
            }

            // 38. K+ Trajectory -> If MRA added, projected K+ < 5.5 OR Patiromer included
            if (scenario.title.includes('K+ Trajectory')) {
                const unsafeTrajectory = scoredRegimens.some(r => {
                    const hasMra = r.regimen.some(m => m.med.drug_class === 'MRA');
                    if (!hasMra) return false;
                    const hasBinder = r.regimen.some(m => m.med.name === 'Patiromer' || m.med.name === 'Lokelma (SZC)');
                    return r.projected_patient.potassium >= 5.5 && !hasBinder;
                });
                if (unsafeTrajectory) {
                    failures.push('K+ trajectory unsafe in at least one displayed regimen with MRA and no binder rescue');
                    scenarioPassed = false;
                }
            }

            // 39. eGFR 25 SGLT2i Boundary -> Dapagliflozin should still be offered at exactly eGFR 25
            if (scenario.title.includes('eGFR 25 SGLT2i Boundary')) {
                const anySGLT2 = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'SGLT2i')
                );
                if (!anySGLT2) {
                    failures.push('SGLT2i not offered at eGFR 25 (should be allowed at boundary)');
                    scenarioPassed = false;
                }
            }

            // 40. Pregnant + CKD4 -> No RAAS/MRA/SGLT2i, pregnancy alert present
            if (scenario.title.includes('Pregnant + CKD4')) {
                if (anyRegimenContainsAnyClass('ARNI', 'ACEi', 'ARB')) {
                    failures.push('RAAS agent prescribed in pregnant + CKD4 patient');
                    scenarioPassed = false;
                }
                if (anyRegimenContainsAnyClass('MRA', 'nsMRA')) {
                    failures.push('MRA/nsMRA prescribed in pregnant patient');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('SGLT2i')) {
                    failures.push('SGLT2i prescribed in pregnant patient');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('PREGNANCY'))) {
                    failures.push('Missing pregnancy clinical alert');
                    scenarioPassed = false;
                }
            }

            // 41. LVEF Recovery Cap -> Projected LVEF must not exceed 55
            if (scenario.title.includes('LVEF Recovery Cap')) {
                const hasLvefOverflow = scoredRegimens.some(r => r.projected_patient.lvef > 55);
                if (hasLvefOverflow) {
                    failures.push('Projected LVEF exceeds physiological cap of 55% in a displayed regimen');
                    scenarioPassed = false;
                }
            }

            // 42. Finerenone in HFpEF -> nsMRA must be ELIGIBLE and SURFACED. Both finerenone (nsMRA,
            //     FINEARTS-HF) and steroidal MRA (TOPCAT) are Class IIb HFpEF adjuncts per ACC/AHA
            //     2022, so either may lead; the requirement is that finerenone is not excluded and is
            //     offered (in a displayed regimen or the eligible-adjuncts list), not that it strictly
            //     out-ranks the equally guideline-valid steroidal MRA.
            if (scenario.title.includes('Finerenone in HFpEF')) {
                const nsmraExcluded = excludedMedications.some(e => e.drug_class === 'nsMRA');
                if (nsmraExcluded) {
                    failures.push('nsMRA (finerenone) wrongly excluded in HFpEF (LVEF >= 40, FINEARTS-HF eligible)');
                    scenarioPassed = false;
                }
                const nsmraSurfaced = anyRegimenHasClass('nsMRA') ||
                    (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('finerenone'));
                if (!nsmraSurfaced) {
                    failures.push('nsMRA (finerenone) eligible but not surfaced in any regimen or the adjunct list');
                    scenarioPassed = false;
                }
                // SGLT2i is the primary HFpEF pillar — must be present
                const anyRegimenMissingSglt2 = scoredRegimens.some(r =>
                    !r.regimen.some(m => m.med.drug_class === 'SGLT2i')
                );
                if (scoredRegimens.length > 0 && anyRegimenMissingSglt2) {
                    failures.push('SGLT2i missing in at least one displayed regimen for HFpEF');
                    scenarioPassed = false;
                }
            }

            // 43. Hepatic BB Selection -> Carvedilol should be excluded, hepatic warning present
            if (scenario.title.includes('Hepatic BB Selection')) {
                if (anyRegimenHasMed('Carvedilol')) {
                    failures.push('Carvedilol prescribed despite Liver Disease (hepatically metabolized)');
                    scenarioPassed = false;
                }
                if (topRegimen) {
                    const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                    const hasHepaticWarning = allWarnings.some(w => w.includes('Hepatic Impairment'));
                    if (!hasHepaticWarning) {
                        failures.push('Missing hepatic impairment warning for liver disease patient');
                        scenarioPassed = false;
                    }
                }
            }

            // 44. Vericiguat LVEF Boundary (LVEF 46) -> Vericiguat NOT offered (gate < 45)
            if (scenario.title.includes('Vericiguat LVEF Boundary')) {
                const anyVericiguat = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'sGC Stimulator')
                );
                if (anyVericiguat) {
                    failures.push('Vericiguat offered at LVEF 46 (gate requires LVEF < 45)');
                    scenarioPassed = false;
                }
            }

            // 45. GLP-1 Not Offered in HFrEF -> No GLP-1 despite BMI 35 (LVEF 30 = HFrEF)
            if (scenario.title.includes('GLP-1 Not Offered in HFrEF')) {
                const anyGLP1 = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class.includes('GLP'))
                );
                if (anyGLP1) {
                    failures.push('GLP-1 offered in HFrEF (LVEF 30) — requires LVEF >= 40');
                    scenarioPassed = false;
                }
            }

            if (scenario.title.includes('GLP-1 Contraindication (MEN2)')) {
                const anyGLP1 = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class.includes('GLP'))
                );
                if (anyGLP1) {
                    failures.push('GLP-1 therapy offered despite MEN2/MTC contraindication');
                    scenarioPassed = false;
                }
            }

            // 46. Digoxin Renal Dosing (eGFR 25, AFib) -> Digoxin max 62.5mcg
            if (scenario.title.includes('Digoxin Renal Dosing')) {
                const digoxinInAny = scoredRegimens.flatMap(r => r.regimen).filter(m => m.med.name === 'Digoxin');
                if (digoxinInAny.length > 0) {
                    const maxDigoxinDose = Math.max(...digoxinInAny.map(d => Number(d.dose.strength)));
                    if (maxDigoxinDose > 62.5) {
                        failures.push(`Digoxin dose ${maxDigoxinDose}mcg exceeds renal-adjusted max 62.5mcg at eGFR 25`);
                        scenarioPassed = false;
                    }
                }
            }

            if (scenario.title.includes('Digoxin Hypokalemia Contraindication')) {
                const anyDigoxin = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name === 'Digoxin')
                );
                if (anyDigoxin) {
                    failures.push('Digoxin offered despite baseline K+ < 3.5');
                    scenarioPassed = false;
                }
            }

            if (scenario.title.includes('Low Body Weight Carvedilol Boundary')) {
                const carvedilolDoses = scoredRegimens
                    .flatMap(r => r.regimen)
                    .filter(m => m.med.name === 'Carvedilol')
                    .map(m => Number(m.dose.strength));
                if (carvedilolDoses.some(d => d > 25)) {
                    failures.push('Carvedilol >25mg BID offered despite dry weight <= 85kg');
                    scenarioPassed = false;
                }
            }

            if (scenario.title.includes('Severe CKD Loop Resistance')) {
                if (!clinicalAlerts.some(a => a.includes('SEVERE CKD DIURETIC ALERT'))) {
                    failures.push('Missing severe CKD loop-diuretic efficacy alert at eGFR 18');
                    scenarioPassed = false;
                }
                const loopFrequencies = scoredRegimens
                    .flatMap(r => r.regimen)
                    .filter(m => m.med.drug_class === 'Loop Diuretic')
                    .map(m => m.selected_frequency);
                const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                const hasSplitFrequency = loopFrequencies.some(f => f === 'bid' || f === 'tid');
                const hasLoopStrategyWarning = allWarnings.some(w => w.includes('Severe CKD Loop Strategy'));
                if (loopFrequencies.length === 0) {
                    failures.push('No loop diuretic offered in severe congestion/eGFR 18 scenario');
                    scenarioPassed = false;
                } else if (!hasSplitFrequency && !hasLoopStrategyWarning) {
                    failures.push('Neither split loop dosing nor reduced-efficacy warning present at eGFR 18');
                    scenarioPassed = false;
                }
            }

            // 18. Structured monitoring plan should appear when RAAS/MRA/diuretic intensification is recommended
            if (topRegimen?.modification_set) {
                const needsStructuredMonitoring = topRegimen.modification_set.modifications.some(m => {
                    const targetClass = m.target?.med.drug_class;
                    if (!targetClass) return false;
                    if (!(m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap')) return false;
                    return targetClass === 'ARNI' || targetClass === 'ACEi' || targetClass === 'ARB' || targetClass === 'MRA'
                        || targetClass === 'Loop Diuretic' || targetClass === 'Thiazide-like Diuretic';
                });

                if (needsStructuredMonitoring) {
                    if (monitoringPlan.length === 0) {
                        failures.push('Missing structured monitoring plan despite high-risk medication intensification');
                        scenarioPassed = false;
                    } else if (!monitoringPlan.some(item => item.test.includes('BMP'))) {
                        failures.push('Monitoring plan missing BMP guidance for renal/electrolyte safety');
                        scenarioPassed = false;
                    }
                }
            }

            // 59. HFmrEF Standalone -> all 4 GDMT pillars available, BB/MRA scored lower (Class IIb)
            if (scenario.title.includes('HFmrEF Standalone')) {
                if (!topRegimen) {
                    failures.push('HFmrEF: no regimen generated');
                    scenarioPassed = false;
                } else {
                    // HFmrEF gets full quad therapy (RAAS, BB, MRA, SGLT2i) but BB/MRA are Class IIb
                    const hasRaas = topClasses.has('ARNI') || topClasses.has('ACEi') || topClasses.has('ARB');
                    const hasSglt2 = topClasses.has('SGLT2i');
                    if (!hasRaas) { failures.push('HFmrEF: missing RAAS (Class I pillar)'); scenarioPassed = false; }
                    if (!hasSglt2) { failures.push('HFmrEF: missing SGLT2i (Class I pillar)'); scenarioPassed = false; }
                }
                // Device therapy screening: LVEF 45 > 35 → should NOT trigger ICD/CRT alert
                if (clinicalAlerts.some(a => a.includes('DEVICE THERAPY SCREENING'))) {
                    failures.push('HFmrEF LVEF 45: unexpected ICD/CRT screening (requires LVEF ≤ 35)');
                    scenarioPassed = false;
                }
            }

            // 60. HFmrEF + Obese at LVEF 42 -> NO GLP-1 initiation: semaglutide needs LVEF >= 45 (STEP-HFpEF), tirzepatide >= 50 (SUMMIT)
            // (verified-sglt2-glp1-adjuncts.md row 18; this scenario previously asserted eligibility at LVEF >= 40, which the trials contradict).
            if (scenario.title.includes('HFmrEF Obese')) {
                if (!topRegimen) {
                    failures.push('HFmrEF Obese: no regimen generated');
                    scenarioPassed = false;
                }
                // Both GLP-1 agents are excluded at LVEF 42 with the LVEF reason, and neither is offered or surfaced
                for (const n of ['Semaglutide', 'Tirzepatide']) {
                    const ex = excludedMedications.find(e => e.name.includes(n));
                    if (!ex || !(ex.why ?? []).some(w => w.includes('LVEF below'))) {
                        failures.push(`${n} not excluded with the LVEF reason at LVEF 42 (STEP-HFpEF >= 45, SUMMIT >= 50)`);
                        scenarioPassed = false;
                    }
                }
                if (anyRegimenHasClass('GLP-1 RA') || anyRegimenHasClass('GLP-1/GIP RA')) {
                    failures.push('A GLP-1 agent is offered at LVEF 42');
                    scenarioPassed = false;
                }
                // SGLT2i should be present in displayed regimens
                if (!anyRegimenHasClass('SGLT2i')) {
                    failures.push('HFmrEF Obese: missing SGLT2i');
                    scenarioPassed = false;
                }
            }

            // 61. Severe Congestion + Loop -> Thiazide eligible (fluid excess > 4kg + on loop), may not rank top-3
            if (scenario.title.includes('Severe Congestion + Loop')) {
                // Thiazide should NOT be excluded — it's a valid adjunct for resistant congestion
                const thiazideExcluded = excludedMedications.some(e =>
                    e.name.includes('Metolazone') || e.name.includes('Chlorthalidone') || e.name.includes('HCTZ')
                );
                if (thiazideExcluded) {
                    failures.push('Thiazide excluded despite fluid excess > 4kg with existing loop diuretic');
                    scenarioPassed = false;
                }
                // Should still have loop diuretic in output (not replaced)
                const anyLoop = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'Loop Diuretic')
                );
                if (!anyLoop) {
                    failures.push('Loop diuretic removed in severe congestion (should be maintained)');
                    scenarioPassed = false;
                }
                // Should generate recommendations
                if (!topRegimen) {
                    failures.push('No regimen generated for severe congestion scenario');
                    scenarioPassed = false;
                }
            }

            // 62. Hypoxia Alert (SpO2 < 90) -> Hypoxia warning must fire
            if (scenario.title.includes('Hypoxia Alert')) {
                const allWarnings = scoredRegimens.flatMap(r => r.warnings);
                const hasHypoxiaWarning = allWarnings.some(w => w.includes('Hypoxia') || w.includes('SpO2'));
                if (!hasHypoxiaWarning) {
                    failures.push('Missing Hypoxia Alert warning despite SpO2 85%');
                    scenarioPassed = false;
                }
                // Should still generate recommendations (SpO2 < 90 is a warning, not a hard block)
                if (!topRegimen) {
                    failures.push('No regimen generated for hypoxia patient (should warn but still recommend)');
                    scenarioPassed = false;
                }
            }

            // 63. NYHA III Acute Decompensation -> BB initiation blocked (fluid > 2kg + ≥2 exam findings)
            if (scenario.title.includes('NYHA III Acute Decompensation')) {
                const anyBB = scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'Beta Blocker'));
                if (anyBB) {
                    failures.push('Beta blocker initiation in NYHA III acute decompensation (fluid +5kg, ≥2 exam findings)');
                    scenarioPassed = false;
                }
                // Should still have RAAS and/or SGLT2i recommendations
                if (!topRegimen) {
                    failures.push('No regimen generated for NYHA III acute decompensation (should still offer non-BB therapy)');
                    scenarioPassed = false;
                }
            }

            // 64. Low Peak Flow Screening -> screening rationale for COPD/Asthma overlap
            if (scenario.title.includes('Low Peak Flow Screening')) {
                if (!topRegimen) {
                    failures.push('No regimen generated for low peak flow patient');
                    scenarioPassed = false;
                }
                // Peak flow < 350 without COPD/Asthma should trigger screening note
                const allRationale = scoredRegimens.flatMap(r => r.rationale || []);
                const hasScreeningNote = allRationale.some(r =>
                    r.includes('Peak Flow') || r.includes('COPD/Asthma overlap')
                );
                if (!hasScreeningNote) {
                    failures.push('Missing peak flow screening note for PF 280 without COPD/Asthma comorbidity');
                    scenarioPassed = false;
                }
            }

            // 65. Furoscix Candidate -> must be eligible and carry device safety warning when selected
            if (scenario.title.includes('Furoscix Candidate')) {
                const furoscixName = 'Furoscix (SC Furosemide)';
                const furoscixExcluded = excludedMedications.some(e => e.name === furoscixName);
                if (furoscixExcluded) {
                    failures.push('Furoscix incorrectly excluded in persistent-congestion loop-escalation scenario');
                    scenarioPassed = false;
                }
                const regimensWithFuroscix = scoredRegimens.filter(r =>
                    r.regimen.some(m => m.med.name === furoscixName)
                );
                if (regimensWithFuroscix.length > 0) {
                    const missingSafetyWarning = regimensWithFuroscix.some(r =>
                        !r.warnings.some(w => w.includes('FUROSCIX SAFETY'))
                    );
                    if (missingSafetyWarning) {
                        failures.push('Furoscix regimen missing mandatory FUROSCIX SAFETY warning');
                        scenarioPassed = false;
                    }
                }
                if (!anyRegimenHasClass('Loop Diuretic')) {
                    failures.push('No loop strategy generated in persistent-congestion scenario');
                    scenarioPassed = false;
                }
            }

            // 66. Furoscix Allergy Guardrail -> hypersensitivity must block Furoscix while preserving other loops
            if (scenario.title.includes('Furoscix Allergy Guardrail')) {
                const furoscixName = 'Furoscix (SC Furosemide)';
                if (anyRegimenHasMed(furoscixName)) {
                    failures.push('Furoscix offered despite furosemide hypersensitivity allergy');
                    scenarioPassed = false;
                }
                const furoscixExcluded = excludedMedications.some(e => e.name === furoscixName);
                if (!furoscixExcluded) {
                    failures.push('Furoscix not explicitly excluded despite furosemide hypersensitivity allergy');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('Loop Diuretic')) {
                    failures.push('All loop options removed in Furoscix allergy scenario (Torsemide/Bumetanide should remain available)');
                    scenarioPassed = false;
                }
            }

            // 67. ARNI Hepatic CI -> ARNI must NOT appear, ACEi/ARB must be offered
            if (scenario.title.includes('ARNI Hepatic CI')) {
                const anyRegimenHasARNI = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'ARNI')
                );
                if (anyRegimenHasARNI) {
                    failures.push('ARNI should be excluded with Liver Disease (Child-Pugh B/C)');
                    scenarioPassed = false;
                }
                // ACEi or ARB should still be offered (RAAS present)
                const anyRegimenHasRaas = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'ACEi' || m.med.drug_class === 'ARB')
                );
                if (!anyRegimenHasRaas) {
                    failures.push('ACEi/ARB should be offered when ARNI is excluded for liver disease');
                    scenarioPassed = false;
                }
                if (scoredRegimens.length === 0) {
                    failures.push('No regimens generated for ARNI hepatic CI scenario');
                    scenarioPassed = false;
                }
            }

            // 68. MRA + DIAMOND Binder -> Every regimen with MRA must also have K+ binder
            if (scenario.title.includes('MRA + DIAMOND Binder')) {
                const regimensWithMRA = scoredRegimens.filter(r =>
                    r.regimen.some(m => m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA')
                );
                if (regimensWithMRA.length === 0) {
                    failures.push('No regimens with MRA generated for DIAMOND binder scenario');
                    scenarioPassed = false;
                }
                const mraWithoutBinder = regimensWithMRA.filter(r =>
                    !r.regimen.some(m => m.med.drug_class === 'K+ Binder')
                );
                if (mraWithoutBinder.length > 0) {
                    failures.push(`${mraWithoutBinder.length} regimen(s) with MRA missing K+ binder (DIAMOND protocol requires binder at K+ > 5.0)`);
                    scenarioPassed = false;
                }
                // Check for DIAMOND/borderline K+ warning
                const allWarnings = scoredRegimens.flatMap(r => r.warnings || []);
                const hasDiamondWarning = allWarnings.some(w => w.includes('BORDERLINE K+') || w.includes('DIAMOND'));
                if (!hasDiamondWarning) {
                    failures.push('Missing DIAMOND/borderline K+ warning for MRA initiation at K+ 5.1');
                    scenarioPassed = false;
                }
            }

            // 69. HFpEF Steroidal MRA Eligible -> Spironolactone not excluded
            if (scenario.title.includes('HFpEF Steroidal MRA Eligible')) {
                const spiroExcluded = excludedMedications.some(e =>
                    e.name === 'Spironolactone'
                );
                if (spiroExcluded) {
                    failures.push('Spironolactone should be eligible as HFpEF adjunct (TOPCAT Americas)');
                    scenarioPassed = false;
                }
                // SGLT2i should still be in top regimen (primary HFpEF pillar)
                if (topRegimen && !topRegimen.regimen.some(m => m.med.drug_class === 'SGLT2i')) {
                    failures.push('SGLT2i missing in top regimen for HFpEF');
                    scenarioPassed = false;
                }
            }

            // 70. Missing potassium -> data-required alert + RAAS/MRA initiation flagged for pre-init BMP
            if (scenario.title.includes('Incomplete Data: Missing Potassium')) {
                if (!clinicalAlerts.some(a => a.includes('DATA REQUIRED') && a.toLowerCase().includes('potassium'))) {
                    failures.push('Missing potassium: no DATA REQUIRED alert for unentered serum potassium');
                    scenarioPassed = false;
                }
                const raasMraRegimens = scoredRegimens.filter(r =>
                    r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class) || m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA')
                );
                // Since the 2026-11-11 laboratory prerequisite (E16) a blank potassium withholds RAAS/MRA starts entirely
                // (the old "POTASSIUM UNKNOWN" -12 caution was removed as unreachable): none may be displayed.
                if (raasMraRegimens.length > 0) {
                    failures.push('Missing potassium: a RAAS/MRA-containing regimen was displayed (rule E16 should withhold RAAS/MRA starts)');
                    scenarioPassed = false;
                }
                if (!excludedMedications.some(e => e.rule_id === 'E16')) {
                    failures.push('Missing potassium: no E16 (laboratory prerequisite) exclusion');
                    scenarioPassed = false;
                }
            }

            // 71. Missing LVEF -> fail safe (no recs) with phenotype-unknown alert
            if (scenario.title.includes('Incomplete Data: Missing LVEF')) {
                if (scoredRegimens.length > 0) {
                    failures.push('Missing LVEF: regimens generated despite undeterminable phenotype');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('DATA REQUIRED') && a.includes('LVEF'))) {
                    failures.push('Missing LVEF: no DATA REQUIRED alert for unentered LVEF');
                    scenarioPassed = false;
                }
            }

            // 72. Dual RAAS on arrival -> deprescribe alert AND a corrected (single-RAAS) regimen
            if (scenario.title.includes('Inappropriate Dual RAAS on Arrival')) {
                if (!clinicalAlerts.some(a => a.includes('INAPPROPRIATE REGIMEN') && a.includes('dual RAAS'))) {
                    failures.push('Dual RAAS arrival: no INAPPROPRIATE REGIMEN deprescribe alert');
                    scenarioPassed = false;
                }
                // The engine must now synthesize a correction, not just alert: produce regimen(s)
                if (scoredRegimens.length === 0) {
                    failures.push('Dual RAAS arrival: no corrected regimen produced (should deprescribe the redundant agent and recommend)');
                    scenarioPassed = false;
                }
                // The redundant ARB (Valsartan, lower preference than the ACEi) must be removed from every output
                if (scoredRegimens.some(r => r.regimen.some(m => m.med.name === 'Valsartan'))) {
                    failures.push('Dual RAAS arrival: redundant ARB (Valsartan) retained in a recommended regimen');
                    scenarioPassed = false;
                }
                // Every output regimen must keep exactly one RAAS agent (global invariant covers >1; ensure ≥1 present somewhere)
                if (topRegimen && topRegimen.regimen.filter(m => RAAS_CLASSES.has(m.med.drug_class)).length !== 1) {
                    failures.push('Dual RAAS arrival: top regimen does not retain exactly one RAAS agent');
                    scenarioPassed = false;
                }
            }

            // 73. Non-DHP CCB in HFrEF -> harm alert
            if (scenario.title.includes('Inappropriate Non-DHP CCB in HFrEF')) {
                if (!clinicalAlerts.some(a => a.includes('INAPPROPRIATE THERAPY') && a.includes('Non-dihydropyridine'))) {
                    failures.push('Non-DHP CCB in HFrEF: no harm alert generated');
                    scenarioPassed = false;
                }
            }

            // 74. BB intolerance (bradycardia/AV block) -> no NEW beta-blocker offered + alert
            if (scenario.title.includes('BB Intolerance Defer New Initiation')) {
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('BB intolerance: a beta-blocker was offered despite prior bradycardia/AV block');
                    scenarioPassed = false;
                }
                if (!clinicalAlerts.some(a => a.includes('BETA-BLOCKER INTOLERANCE'))) {
                    failures.push('BB intolerance: no BETA-BLOCKER INTOLERANCE alert');
                    scenarioPassed = false;
                }
            }

            // 75. Sulfa allergy -> diuretic cross-reactivity caution alert
            if (scenario.title.includes('Sulfa Allergy Diuretic Caution')) {
                if (!clinicalAlerts.some(a => a.includes('SULFA ALLERGY'))) {
                    failures.push('Sulfa allergy: no diuretic cross-reactivity caution alert');
                    scenarioPassed = false;
                }
            }

            // 76. Dual MRA on arrival -> deprescribe alert + corrected regimen keeping a single MRA (steroidal)
            if (scenario.title.includes('Inappropriate Dual MRA on Arrival')) {
                if (!clinicalAlerts.some(a => a.includes('INAPPROPRIATE REGIMEN') && a.includes('more than one MRA'))) {
                    failures.push('Dual MRA arrival: no INAPPROPRIATE REGIMEN deprescribe alert');
                    scenarioPassed = false;
                }
                if (scoredRegimens.length === 0) {
                    failures.push('Dual MRA arrival: no corrected regimen produced');
                    scenarioPassed = false;
                }
                // nsMRA (Finerenone) must be deprescribed; steroidal MRA retained
                if (scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'nsMRA'))) {
                    failures.push('Dual MRA arrival: nsMRA (Finerenone) retained instead of deprescribed');
                    scenarioPassed = false;
                }
            }

            // 77. RED-TEAM: decompensated HFrEF + contraindicated BB -> still produce a regimen, BB removed + taper guidance
            if (scenario.title.includes('Decompensated HFrEF + Contraindicated BB')) {
                if (scoredRegimens.length === 0) {
                    failures.push('Decompensated + contraindicated BB: zero regimens (silent blank / under-treatment)');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('Decompensated + contraindicated BB: a contraindicated beta-blocker is still in a regimen');
                    scenarioPassed = false;
                }
                const taperWarned = scoredRegimens.some(r => r.warnings.some(w => w.includes('BETA-BLOCKER DISCONTINUATION') || /taper/i.test(w)));
                if (scoredRegimens.length > 0 && !taperWarned) {
                    failures.push('Decompensated + contraindicated BB: removal lacks taper guidance (abrupt withdrawal = Class III harm)');
                    scenarioPassed = false;
                }
                // Coherence: no regimen should both titrate and remove the same beta-blocker
                const incoherent = scoredRegimens.some(r => {
                    const mods = r.modification_set?.modifications ?? [];
                    return mods.some(m => m.action === 'remove' && m.source?.med.drug_class === 'Beta Blocker'
                        && mods.some(n => (n.action === 'titrate_down' || n.action === 'titrate_up') && n.source?.med.name === m.source?.med.name));
                });
                if (incoherent) {
                    failures.push('Decompensated + contraindicated BB: incoherent mod list (same BB titrated AND removed)');
                    scenarioPassed = false;
                }
            }

            // 78. RED-TEAM: physiologically impossible input value -> flagged for verification
            if (scenario.title.includes('Implausible Lab Value')) {
                if (!clinicalAlerts.some(a => a.includes('IMPLAUSIBLE VALUE'))) {
                    failures.push('Implausible value: no IMPLAUSIBLE VALUE verification alert generated');
                    scenarioPassed = false;
                }
                // ADVERSARIAL: impossible inputs must HARD-STOP, not flag-and-recommend —
                // LVEF 99 would otherwise classify as HFpEF and drive recommendations off a typo.
                if (scoredRegimens.length > 0) {
                    failures.push('Implausible value: recommendations generated on physiologically impossible input');
                    scenarioPassed = false;
                }
            }

            // 79. Mild asthma -> carvedilol excluded; β1-selective BB available (not all BBs lost)
            if (scenario.title.includes('Mild Asthma BB Selection')) {
                if (anyRegimenHasMed('Carvedilol')) {
                    failures.push('Mild asthma: non-selective Carvedilol offered (should use β1-selective)');
                    scenarioPassed = false;
                }
                const carvedilolExcluded = excludedMedications.some(e => e.name === 'Carvedilol');
                if (!carvedilolExcluded) {
                    failures.push('Mild asthma: Carvedilol not excluded');
                    scenarioPassed = false;
                }
                // A β1-selective BB must remain available (pillar not lost): offered or eligible
                const selectiveAvailable = anyRegimenHasMed('Bisoprolol') || anyRegimenHasMed('Metoprolol Succinate')
                    || !excludedMedications.some(e => e.name === 'Bisoprolol');
                if (!selectiveAvailable) {
                    failures.push('Mild asthma: all beta-blockers lost — β1-selective should remain available');
                    scenarioPassed = false;
                }
            }

            // 80. INTOLERANCE REGRESSION (audit 072): documented ACEi cough intolerance while
            // arriving on a DIFFERENT ACEi -> no displayed regimen may retain any ACEi, and the
            // RAAS pillar must survive via ARB/ARNI (cough is not a contraindication to either).
            if (scenario.title.includes('ACEi Cough Intolerance on Current ACEi')) {
                if (anyRegimenHasClass('ACEi')) {
                    failures.push('ACEi cough intolerance: an ACEi is still displayed in a regimen');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('ARNI') && !anyRegimenHasClass('ARB')) {
                    failures.push('ACEi cough intolerance: RAAS pillar lost — no ARB/ARNI replacement offered');
                    scenarioPassed = false;
                }
                // The patient ARRIVED on RAAS therapy — no displayed option may silently drop the pillar.
                if (scoredRegimens.some(r => !r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class)))) {
                    failures.push('ACEi cough intolerance: a displayed regimen lost RAAS coverage entirely');
                    scenarioPassed = false;
                }
            }

            // 81. INTOLERANCE REGRESSION (audit 073): gynecomastia on spironolactone while still
            // taking it -> spironolactone removed/swapped in every displayed regimen; eplerenone
            // (agent-specific intolerance, not class-wide) must remain available.
            if (scenario.title.includes('Gynecomastia on Current Spironolactone')) {
                if (anyRegimenHasMed('Spironolactone')) {
                    failures.push('Gynecomastia intolerance: spironolactone retained in a displayed regimen');
                    scenarioPassed = false;
                }
                if (excludedMedications.some(e => e.name === 'Eplerenone')) {
                    failures.push('Gynecomastia intolerance: eplerenone excluded — agent-specific intolerance wrongly applied class-wide');
                    scenarioPassed = false;
                }
            }

            // 82a. INTOLERANCE REGRESSION (review): budget-constrained ACEi-cough patient must
            // never see an empty or RAAS-less regimen — the $0 bare-removal candidate must not
            // out-survive the swap candidates under the affordability filter.
            if (scenario.title.includes('ACEi Cough Intolerance Budget-Constrained')) {
                if (anyRegimenHasClass('ACEi')) {
                    failures.push('Budget ACEi cough: an ACEi is still displayed');
                    scenarioPassed = false;
                }
                const raasLess = scoredRegimens.filter(r => !r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class)));
                if (raasLess.length > 0) {
                    failures.push(`Budget ACEi cough: ${raasLess.length} displayed regimen(s) lost RAAS coverage entirely (incl. possible empty regimen)`);
                    scenarioPassed = false;
                }
            }

            // 82b. INTOLERANCE REGRESSION (review): gynecomastia offender = eplerenone, arriving
            // on spironolactone, HFmrEF -> both offenders avoided, nsMRA (finerenone) must
            // survive as the MRA-pool agent instead of the whole pillar being dropped.
            if (scenario.title.includes('Gynecomastia From Eplerenone on Spironolactone')) {
                if (anyRegimenHasMed('Spironolactone') || anyRegimenHasMed('Eplerenone')) {
                    failures.push('Eplerenone-offender gynecomastia: an avoided MRA agent is still displayed');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('nsMRA')) {
                    failures.push('Eplerenone-offender gynecomastia: MRA pillar dropped — viable finerenone not offered');
                    scenarioPassed = false;
                }
            }

            // 82c. INTOLERANCE REGRESSION (review): negated free-text detail ("no cough",
            // "angioedema ruled out") must not strip the current tolerated ACEi. Forced
            // current-regimen cleanup requires the structured dropdown reason.
            if (scenario.title.includes('Negated Free-Text Intolerance Detail')) {
                if (!anyRegimenHasMed('Ramipril')) {
                    failures.push('Negated free text: current tolerated Ramipril was force-removed/swapped on a negated keyword match');
                    scenarioPassed = false;
                }
            }

            // 82. INTOLERANCE REGRESSION (red-team probe 2): dual MRA on arrival where the
            // steroidal is intolerable but the nsMRA is viable -> the TOLERATED agent must be
            // the keeper. Dropping BOTH MRAs is under-treatment; keeping spironolactone is
            // re-exposure to the intolerance.
            if (scenario.title.includes('Dual MRA With Steroidal Intolerance')) {
                if (anyRegimenHasMed('Spironolactone')) {
                    failures.push('Dual MRA steroidal intolerance: spironolactone retained despite gynecomastia history');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('nsMRA')) {
                    failures.push('Dual MRA steroidal intolerance: both MRAs dropped — viable nsMRA (finerenone) should be the keeper');
                    scenarioPassed = false;
                }
            }

            // 83. COST-EFFECTIVENESS (budget sweep): de-novo HFrEF allowed 2 new classes must
            // receive a multi-pillar GDMT start as the TOP pick — never single-agent monotherapy.
            if (scenario.title.includes('De-novo HFrEF Male Multi-Pillar Start') ||
                scenario.title.includes('De-novo HFrEF Diabetic Multi-Pillar Start')) {
                const pillarClasses = new Set(['ARNI', 'ACEi', 'ARB', 'Beta Blocker', 'MRA', 'SGLT2i']);
                const topPillars = topRegimen ? topRegimen.regimen.filter(m => pillarClasses.has(m.med.drug_class)).length : 0;
                if (topPillars < 2) {
                    failures.push(`De-novo HFrEF: top pick has ${topPillars} GDMT pillar(s) — expected a multi-pillar start (>=2) when 2 new classes are permitted`);
                    scenarioPassed = false;
                }
            }

            // 84. COST-EFFECTIVENESS (budget sweep): over-budget fallback must order the displayed
            // cheapest options by clinical value (highest benefit leads), not by absolute cost.
            if (scenario.title.includes('Over-Budget Value Ordering')) {
                if (!scoredRegimens.some(r => r.warnings.some(w => w.includes('BUDGET EXCEEDED')))) {
                    failures.push('Over-budget value ordering: expected a BUDGET EXCEEDED fallback for sub-generic budget');
                    scenarioPassed = false;
                }
                const topScore = topRegimen ? topRegimen.overall_score : -1;
                if (scoredRegimens.some(r => r.overall_score > topScore)) {
                    failures.push('Over-budget value ordering: a displayed pick out-scores the top pick — fallback not value-ordered');
                    scenarioPassed = false;
                }
            }

            // 85. CLINICAL RULE REGRESSION: categorical HFimpEF prior reduced EF must exclude
            // finerenone and must not allow nsMRA to substitute for the HFrEF/HFimpEF MRA pillar.
            if (scenario.title.includes('HFimpEF Categorical Prior EF Excludes Finerenone')) {
                if (anyRegimenHasClass('nsMRA')) {
                    failures.push('HFimpEF categorical prior EF: finerenone displayed despite HFrEF/HFimpEF management');
                    scenarioPassed = false;
                }
                if (!excludedMedications.some(e => e.name === 'Finerenone (Kerendia)' || e.drug_class === 'nsMRA')) {
                    failures.push('HFimpEF categorical prior EF: finerenone was not explicitly excluded');
                    scenarioPassed = false;
                }
            }

            // 86. WORKFLOW REGRESSION: binder rescue must not bypass the configured new-class cap.
            if (scenario.title.includes('Max New Classes Counts Binder Rescue')) {
                const hasBinderPlusAnotherNewClass = scoredRegimens.some(r => {
                    const newGroups = countNewClassGroups(r.regimen, scenario.patient.current_regimen || []);
                    return newGroups > scenario.patient.max_new_classes_per_visit &&
                        r.regimen.some(m => m.med.drug_class === 'K+ Binder');
                });
                if (hasBinderPlusAnotherNewClass) {
                    failures.push('Max-new-class limit: binder rescue was appended after the limit and displayed');
                    scenarioPassed = false;
                }
            }

            // 87. DOSE TARGET REGRESSION: carvedilol 25 mg BID is not target for patients >85 kg.
            if (scenario.title.includes('High Body Weight Carvedilol Target Requires 50 BID')) {
                const topCarvedilol = topRegimen?.regimen.find(m => m.med.name === 'Carvedilol');
                if (!topCarvedilol || topCarvedilol.dose.strength !== 50) {
                    failures.push('High body weight carvedilol: top regimen did not titrate to 50 mg BID');
                    scenarioPassed = false;
                }
                if (topCarvedilol) {
                    const stringStrengthCarvedilol = {
                        ...topCarvedilol,
                        dose: { ...topCarvedilol.dose, strength: String(topCarvedilol.dose.strength) }
                    };
                    if (!isTargetDoseForPatient(stringStrengthCarvedilol, scenario.patient)) {
                        failures.push('High body weight carvedilol: target-dose check failed when dose strength was string-normalized');
                        scenarioPassed = false;
                    }
                }
                const hasTitration = topRegimen?.modification_set?.modifications.some(m =>
                    m.action === 'titrate_up' &&
                    m.source?.med.name === 'Carvedilol' &&
                    m.target?.dose.strength === 50
                );
                if (!hasTitration) {
                    failures.push('High body weight carvedilol: missing explicit 25->50 mg titration action');
                    scenarioPassed = false;
                }
            }

            // 88. PREGNANCY ADJUNCT GATES (audit fix): Vericiguat (FDA BOXED WARNING) and
            // Ivabradine (fetal harm) are excluded in pregnancy even with VICTORIA/SHIFT
            // criteria fully met; H/ISDN stays available as the pregnancy-appropriate RAAS
            // alternative. (The shared 'Pregnant' block above already pins RAAS/MRA exclusion
            // and the PREGNANCY alert.)
            if (scenario.title.includes('Pregnant Vericiguat + Ivabradine Exclusion')) {
                if (!excludedMedications.some(e => e.drug_class === 'sGC Stimulator')) {
                    failures.push('Vericiguat not in excludedMedications despite pregnancy (FDA boxed warning — embryo-fetal toxicity)');
                    scenarioPassed = false;
                }
                if (!excludedMedications.some(e => e.drug_class === 'If Inhibitor')) {
                    failures.push('Ivabradine not in excludedMedications despite pregnancy (fetal harm)');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('sGC Stimulator')) {
                    failures.push('Vericiguat displayed in a regimen for a pregnant patient');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('If Inhibitor')) {
                    failures.push('Ivabradine displayed in a regimen for a pregnant patient');
                    scenarioPassed = false;
                }
                // H/ISDN is the pregnancy-appropriate vasodilator strategy — it must NOT be excluded.
                if (excludedMedications.some(e => e.drug_class === 'Vasodilator')) {
                    failures.push('H/ISDN wrongly excluded for a pregnant patient (it is the pregnancy-appropriate RAAS alternative)');
                    scenarioPassed = false;
                }
            }

            // 89. VERICIGUAT CONTINUATION CARVE-OUT (audit fix): VICTORIA enrollment criteria
            // are initiation gates only — a patient already ON vericiguat with improved
            // NT-proBNP (900) and no recent worsening must not have it force-removed.
            if (scenario.title.includes('Vericiguat Continuation Carve-Out')) {
                if (excludedMedications.some(e => e.drug_class === 'sGC Stimulator')) {
                    failures.push('Vericiguat excluded for a patient already on it (continuation carve-out regression)');
                    scenarioPassed = false;
                }
                if (scoredRegimens.length === 0) {
                    failures.push('No regimens generated for stable quad + vericiguat continuation scenario');
                    scenarioPassed = false;
                }
                const anyVericiguatRemoval = scoredRegimens.some(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        (m.action === 'remove' || m.action === 'swap') && m.source?.med.drug_class === 'sGC Stimulator'
                    )
                );
                if (anyVericiguatRemoval) {
                    failures.push('Vericiguat removed/swapped in a displayed regimen despite treatment response (BNP 900, no worsening)');
                    scenarioPassed = false;
                }
                const anyRegimenDropsVericiguat = scoredRegimens.some(r =>
                    !r.regimen.some(m => m.med.drug_class === 'sGC Stimulator')
                );
                if (anyRegimenDropsVericiguat) {
                    failures.push('A displayed regimen lost vericiguat despite the continuation carve-out');
                    scenarioPassed = false;
                }
            }

            // 90. GLP-1 CONTINUATION CARVE-OUT (audit fix): BMI >= 30 is an initiation gate
            // only — tirzepatide is retained after successful weight loss to BMI 28.
            if (scenario.title.includes('GLP-1 Continuation Carve-Out (BMI 28)')) {
                if (excludedMedications.some(e => e.name.includes('Tirzepatide'))) {
                    failures.push('Tirzepatide excluded for a patient already on it at BMI 28 (weight-loss success must not force removal)');
                    scenarioPassed = false;
                }
                // FORCE-removal signature: the pre-fix contraindication injected the removal
                // into EVERY candidate. An elective same-class swap (Tirzepatide → Semaglutide)
                // in a lower-ranked pick is legitimate and keeps the therapy class — so 'every',
                // not 'some', is the regression check.
                const everyRegimenDropsGlp1 = scoredRegimens.length > 0 && scoredRegimens.every(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        (m.action === 'remove' || m.action === 'swap') && m.source?.med.name.includes('Tirzepatide')
                    )
                );
                if (everyRegimenDropsGlp1) {
                    failures.push('Tirzepatide removed/swapped from EVERY displayed candidate at BMI 28 (force-removal — continuation carve-out regression)');
                    scenarioPassed = false;
                }
                const glp1Retained = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name.includes('Tirzepatide'))
                );
                if (scoredRegimens.length > 0 && !glp1Retained) {
                    failures.push('No displayed regimen retains tirzepatide despite the continuation carve-out');
                    scenarioPassed = false;
                }
            }

            // 90b. PREGNANCY OVERRIDES THE GLP-1 CARVE-OUT (audit fix): the continuation
            // carve-out must not bypass true safety gates — semaglutide is excluded and
            // force-removed from every candidate in pregnancy.
            if (scenario.title.includes('Pregnant on GLP-1 (Force Removal)')) {
                if (!excludedMedications.some(e => e.name.includes('Semaglutide'))) {
                    failures.push('Semaglutide not in excludedMedications despite pregnancy (safety gate applies to continuation too)');
                    scenarioPassed = false;
                }
                const anyGlp1Displayed = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class.includes('GLP'))
                );
                if (anyGlp1Displayed) {
                    failures.push('GLP-1 retained in a displayed regimen for a pregnant patient');
                    scenarioPassed = false;
                }
                const everyRegimenRemovesGlp1 = scoredRegimens.length > 0 && scoredRegimens.every(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        m.action === 'remove' && m.source?.med.name.includes('Semaglutide')
                    )
                );
                if (scoredRegimens.length > 0 && !everyRegimenRemovesGlp1) {
                    failures.push('Semaglutide not force-removed from every displayed candidate in pregnancy');
                    scenarioPassed = false;
                }
            }

            // 91. GLP-1 ADJUNCT BOUNDARY (audit fix): LVEF exactly 40 is HFrEF — the adjunct
            // gate is strictly LVEF > 40 (STEP-HFpEF/SUMMIT; no HFrEF evidence). GLP-1 is not
            // formulary-excluded here (BMI 33, no safety CI), so the eligibility signal is:
            // never displayed AND absent from the eligible-adjuncts list.
            if (scenario.title.includes('GLP-1 Boundary LVEF Exactly 40')) {
                const anyGlp1Displayed = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name.includes('Semaglutide') || m.med.name.includes('Tirzepatide'))
                );
                if (anyGlp1Displayed) {
                    failures.push('GLP-1 displayed at LVEF exactly 40 (HFrEF — gate requires LVEF > 40)');
                    scenarioPassed = false;
                }
                const anyGlp1Adjunct = (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes('glp-1'));
                if (anyGlp1Adjunct) {
                    failures.push('GLP-1 surfaced in eligible adjuncts at LVEF exactly 40 (HFrEF — gate requires LVEF > 40)');
                    scenarioPassed = false;
                }
            }

            // 92. WARM-WET DECOMPENSATION ON EXISTING BB (d631873 dedicated regression):
            // warm perfusion (no cool extremities, SBP 112, PP 42) means the BB is CONTINUED
            // at its current dose — no up-titration (deferred in any decompensation), no
            // forced cut (cold-gated) — and safe pillar additions (SGLT2i) still surface.
            if (scenario.title.includes('Warm-Wet Decompensation on Existing BB')) {
                if (scoredRegimens.length === 0) {
                    failures.push('No regimens generated for warm-wet decompensation scenario');
                    scenarioPassed = false;
                }
                const anyBbUpTitration = scoredRegimens.some(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        m.action === 'titrate_up' && m.source?.med.drug_class === 'Beta Blocker'
                    )
                );
                if (anyBbUpTitration) {
                    failures.push('Beta-blocker up-titrated during acute decompensation (deferred until euvolemia)');
                    scenarioPassed = false;
                }
                const everyRegimenCutsBB = scoredRegimens.length > 0 && scoredRegimens.every(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Beta Blocker'
                    )
                );
                if (everyRegimenCutsBB) {
                    failures.push('Warm-wet: beta-blocker cut forced into EVERY candidate (reduction is hypoperfusion/cold-gated)');
                    scenarioPassed = false;
                }
                const bbContinuedAtCurrentDose = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name === 'Carvedilol' && Number(m.dose.strength) === 12.5)
                );
                if (!bbContinuedAtCurrentDose) {
                    failures.push('Warm-wet: no displayed option continues carvedilol at its current 12.5mg dose');
                    scenarioPassed = false;
                }
                const sglt2iAddOffered = scoredRegimens.some(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        m.action === 'add' && m.target?.med.drug_class === 'SGLT2i'
                    )
                );
                if (!sglt2iAddOffered) {
                    failures.push('Warm-wet: no SGLT2i addition offered (safe in acute HF — EMPULSE/SOLOIST-WHF; decompensation must not suppress gap closure)');
                    scenarioPassed = false;
                }
            }

            // 93. BLANK RENAL DATA GUARD (audit fix): eGFR/creatinine 0 sentinels must not
            // read as end-stage CKD. Working spironolactone is retained (no forced
            // "contraindicated" removal); new renal-gated starts get the honest actionable
            // reason; the DATA REQUIRED renal alert fires.
            if (scenario.title.includes('Blank Renal Data Stable Spironolactone')) {
                if (!clinicalAlerts.some(a => a.includes('DATA REQUIRED') && a.includes('Renal function'))) {
                    failures.push('Missing DATA REQUIRED renal-function alert for blank eGFR/creatinine');
                    scenarioPassed = false;
                }
                const anySpiroRemoval = scoredRegimens.some(r =>
                    (r.modification_set?.modifications ?? []).some(m =>
                        (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === 'Spironolactone'
                    )
                );
                if (anySpiroRemoval) {
                    failures.push('Working spironolactone force-removed/swapped on BLANK renal data (fabricated end-stage-CKD contraindication)');
                    scenarioPassed = false;
                }
                const spiroRetained = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name === 'Spironolactone')
                );
                if (scoredRegimens.length > 0 && !spiroRetained) {
                    failures.push('No displayed regimen retains the working spironolactone despite blank (not abnormal) renal data');
                    scenarioPassed = false;
                }
                // New starts MAY be withheld — but with the honest data-required reason, never
                // the hard "Clinical Contraindication" label fabricated from a blank field.
                const spiroHardExcluded = excludedMedications.some(e =>
                    e.name === 'Spironolactone' && e.reason === 'Clinical Contraindication'
                );
                if (spiroHardExcluded) {
                    failures.push('Spironolactone excluded as "Clinical Contraindication" on blank renal data (expected the "Renal data required" reason)');
                    scenarioPassed = false;
                }
            }

            // 93b. DUAL MRA + UNKNOWN EF HISTORY (audit fix / red-team probe 2): with gynecomastia
            // barring every steroidal MRA, the unknown-history HFimpEF presumption must NOT
            // force-remove the tolerated finerenone the patient is already on — the presumption
            // gates INITIATION only. The nsMRA survives; the intolerable spironolactone does not;
            // and no displayed regimen carries dual MRA.
            if (scenario.title.includes('Dual MRA Unknown History Keeps nsMRA')) {
                const anyMraRetained = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA')
                );
                if (scoredRegimens.length > 0 && !anyMraRetained) {
                    failures.push('Both MRAs dropped — the tolerated nsMRA (finerenone) must survive when only the steroidal is intolerable (under-treatment)');
                    scenarioPassed = false;
                }
                const spiroRetainedAnywhere = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.name === 'Spironolactone')
                );
                if (spiroRetainedAnywhere) {
                    failures.push('Spironolactone retained despite documented gynecomastia intolerance (antiandrogenic steroidal must be deprescribed)');
                    scenarioPassed = false;
                }
                const dualMraDisplayed = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'MRA') && r.regimen.some(m => m.med.drug_class === 'nsMRA')
                );
                if (dualMraDisplayed) {
                    failures.push('Displayed regimen still contains dual MRA (steroidal + nsMRA)');
                    scenarioPassed = false;
                }
            }

            // 94a. HYPERKALEMIC EMERGENCY 6.0-6.4 (audit fix): alert fires AND deprescribing
            // continues — removing the offending RAAS/MRA is still clinically useful here.
            if (scenario.title.includes('Hyperkalemic Emergency K+ 6.2')) {
                if (!clinicalAlerts.some(a => a.includes('HYPERKALEMIC EMERGENCY'))) {
                    failures.push('Missing HYPERKALEMIC EMERGENCY alert at K+ 6.2');
                    scenarioPassed = false;
                }
                if (scoredRegimens.length === 0) {
                    failures.push('No recommendations at K+ 6.2 — deprescribing the offending agents should still be offered (alerts-only gate is >= 6.5)');
                    scenarioPassed = false;
                }
                // The offending MRA/ACEi are hard-contraindicated (K+ > 5.5 / > 5.4) — no
                // displayed regimen may retain them.
                if (anyRegimenContainsAnyClass('MRA', 'nsMRA')) {
                    failures.push('MRA retained in a displayed regimen at K+ 6.2 (withheld at K+ 6.0 or above)');
                    scenarioPassed = false;
                }
                if (anyRegimenHasRaas()) {
                    failures.push('RAAS agent retained in a displayed regimen at K+ 6.2 (hard CI at K+ > 5.4)');
                    scenarioPassed = false;
                }
            }

            // 94b. HYPERKALEMIC EMERGENCY >= 6.5 (audit fix): alerts only, zero regimens —
            // parallel to the SBP < 90 hemodynamic gate.
            if (scenario.title.includes('Hyperkalemic Emergency K+ 6.8')) {
                if (!clinicalAlerts.some(a => a.includes('HYPERKALEMIC EMERGENCY'))) {
                    failures.push('Missing HYPERKALEMIC EMERGENCY alert at K+ 6.8');
                    scenarioPassed = false;
                }
                if (scoredRegimens.length !== 0) {
                    failures.push(`Drug recommendations generated at K+ 6.8 (expected alerts-only at K+ >= 6.5; got ${scoredRegimens.length})`);
                    scenarioPassed = false;
                }
            }


            // ===== MRA / K+ binder source-verified corrections (verified-mra-binders.md; labels: Inspra, Kerendia, Aldactone, Veltassa, Lokelma) =====
            if (scenario.title.includes('MRA-Source')) {
                const excl = (name: string) => excludedMedications.find(e => e.name === name);
                const whyText = (name: string) => (excl(name)?.why ?? []).join(' | ');
                const regimenHas = (name: string) => anyRegimenHasMed(name);
                const strengthsOf = (name: string) => scoredRegimens.flatMap(r => r.regimen.filter(m => m.med.name === name).map(m => Number(m.dose.strength)));
                const allSummaries = scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).map(m => m.summary));
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;

                if (t.includes('Eplerenone With Strong CYP3A4 Inhibitor')) {
                    if (!excl('Eplerenone') || !/strong CYP3A4/i.test(whyText('Eplerenone'))) fail('Eplerenone not excluded with a strong CYP3A4 inhibitor reason (Inspra label contraindication)');
                    if (regimenHas('Eplerenone')) fail('Eplerenone offered despite clarithromycin (strong CYP3A inhibitor)');
                    if (excl('Spironolactone')) fail('Spironolactone wrongly excluded by the CYP3A rule');
                }
                if (t.includes('Finerenone With Strong CYP3A4 Inhibitor')) {
                    const f = excl('Finerenone (Kerendia)');
                    if (!f || f.rule_id !== 'E13' || !/strong CYP3A4/i.test(whyText('Finerenone (Kerendia)'))) fail('Finerenone not excluded (E13) with a strong CYP3A4 inhibitor reason (Kerendia label contraindication)');
                    if (anyRegimenHasClass('nsMRA')) fail('Finerenone offered despite itraconazole (strong CYP3A4 inhibitor)');
                }
                if (t.includes('Adrenal Insufficiency Excludes')) {
                    for (const n of ['Finerenone (Kerendia)', 'Spironolactone']) {
                        if (!excl(n) || !/Addison/i.test(whyText(n))) fail(`${n} not excluded with the Addison's disease reason (label contraindication)`);
                    }
                    if (regimenHas('Finerenone (Kerendia)') || regimenHas('Spironolactone')) fail("Finerenone or spironolactone offered in adrenal insufficiency");
                    if (excl('Eplerenone')) fail("Eplerenone wrongly excluded for adrenal insufficiency (not on the Inspra contraindication list)");
                }
                if (t.includes('Eplerenone eGFR 30 Boundary')) {
                    if (!excl('Eplerenone')) fail('Eplerenone offered at eGFR 30 (Inspra: contraindicated at CrCl 30 mL/min or less, boundary inclusive)');
                    if (regimenHas('Eplerenone')) fail('Eplerenone in a displayed regimen at eGFR 30');
                }
                if (t.includes('Eplerenone Moderate CYP3A Inhibitor Cap')) {
                    const s = strengthsOf('Eplerenone');
                    if (s.length === 0 || s.some(x => x > 25)) fail(`Eplerenone above 25 mg with a moderate CYP3A inhibitor (found ${s.join(', ')}); label maximum is 25 mg daily`);
                    if (!allSummaries.some(x => /moderate CYP3A inhibitor/.test(x))) fail('Forced eplerenone reduction does not state the moderate CYP3A inhibitor reason');
                }
                if (t.includes('Current MRA K+ 5.6 One-Step Reduction')) {
                    if (scoredRegimens.length === 0) fail('No regimens at K+ 5.6 on spironolactone');
                    if (scoredRegimens.some(r => !r.regimen.some(m => m.med.name === 'Spironolactone' && Number(m.dose.strength) === 12.5))) fail('Spironolactone 25 mg at K+ 5.6 must drop ONE step to 12.5 mg in every option (not be removed, not kept at 25/50)');
                    if (!allSummaries.some(x => x.startsWith('Reduce Spironolactone') && x.includes('potassium 5.6'))) fail('Reduction does not state the potassium and the label rule');
                    if (allSummaries.some(x => x.startsWith('Remove Spironolactone'))) fail('Spironolactone removed at K+ 5.6 (continuation rule is a one-step reduction)');
                }
                if (t.includes('Current MRA K+ 5.7 Lowest Dose Withheld')) {
                    if (regimenHas('Eplerenone')) fail('Eplerenone 25 mg (lowest dose) kept at K+ 5.7 (label: withhold)');
                    if (!allSummaries.some(x => x.startsWith('Remove Eplerenone') && x.includes('potassium 5.7'))) fail('Withhold does not state the potassium rule');
                }
                if (t.includes('Current MRA K+ 6.1 Withheld')) {
                    if (regimenHas('Spironolactone')) fail('Spironolactone kept at K+ 6.1 (withhold at 6.0 or above)');
                    if (!clinicalAlerts.some(a => a.includes('HYPERKALEMIC EMERGENCY'))) fail('Emergency alert missing at K+ 6.1');
                    if (!allSummaries.some(x => x.startsWith('Remove Spironolactone') && x.includes('6.0 or above'))) fail('Withhold at K+ 6.1 does not state the rule');
                }
                if (t.includes('Finerenone eGFR 40 Targets 20 mg')) {
                    const s = strengthsOf('Finerenone (Kerendia)');
                    if (s.some(x => x === 40)) fail('Finerenone 40 mg offered at eGFR 40 (label maximum is 20 mg below eGFR 60)');
                    const onFin = scoredRegimens.flatMap(r => r.regimen.filter(m => m.med.name === 'Finerenone (Kerendia)' && Number(m.dose.strength) === 20));
                    if (onFin.length === 0) fail('Finerenone 20 mg not retained at eGFR 40');
                    if (onFin.some(m => !isTargetDoseForPatient(m, scenario.patient))) fail('Finerenone 20 mg at eGFR 40 not recognized as the target dose');
                }
                if (t.includes('Finerenone eGFR 70 Targets 40 mg')) {
                    if (!strengthsOf('Finerenone (Kerendia)').includes(40)) fail('Finerenone 40 mg (target at eGFR 60 or above) not offered as a titration at eGFR 70');
                    const twenty = scoredRegimens.flatMap(r => r.regimen.filter(m => m.med.name === 'Finerenone (Kerendia)' && Number(m.dose.strength) === 20))[0];
                    if (twenty && isTargetDoseForPatient(twenty, scenario.patient)) fail('Finerenone 20 mg wrongly counted as target at eGFR 70');
                }
                if (t.includes('Finerenone New Start Tier')) {
                    const limit = scenario.patient.egfr >= 60 ? 20 : 10;
                    const s = strengthsOf('Finerenone (Kerendia)');
                    if (s.length === 0) fail('Finerenone not offered as a new start (check is vacuous)');
                    if (s.some(x => x > limit)) fail(`Finerenone new start above the label start dose ${limit} mg at eGFR ${scenario.patient.egfr} (found ${s.join(', ')})`);
                }
                if (t.includes('Spironolactone Start Dose')) {
                    const limit = scenario.patient.egfr > 50 ? 25 : 12.5;
                    const s = strengthsOf('Spironolactone');
                    if (s.length === 0) fail('Spironolactone not offered as a new start (check is vacuous)');
                    if (s.some(x => x > limit)) fail(`Spironolactone new start above ${limit} mg at eGFR ${scenario.patient.egfr} (found ${s.join(', ')})`);
                }
                if (t.includes('MRA Start K+ 5.3 Needs Binder And Sequencing')) {
                    const withMra = scoredRegimens.filter(r => r.regimen.some(m => m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA'));
                    if (withMra.length === 0) fail('No MRA start offered at K+ 5.3 (the binder-sequenced pathway should remain)');
                    if (withMra.some(r => !r.regimen.some(m => m.med.drug_class === 'K+ Binder'))) fail('MRA started above K+ 5.0 without a binder in the same option');
                    if (withMra.some(r => !(r.warnings ?? []).some(w => w.includes('BORDERLINE K+') && w.includes('start the binder first')))) fail('MRA start above K+ 5.0 lacks the sequencing warning (label start threshold 5.0)');
                }
                if (t.includes('MRA Start K+ 5.3 No Binder Available')) {
                    const noBinderExcl = ['Spironolactone', 'Eplerenone'].filter(n => excl(n)?.rule_id === 'E15');
                    if (noBinderExcl.length !== 2) fail('MRA not excluded by E15 when no binder can be offered at K+ 5.3');
                    if (anyRegimenContainsAnyClass('MRA', 'nsMRA', 'K+ Binder')) fail('MRA or binder appears although none may be offered');
                }
                if (t.includes('Lokelma HF Warning')) {
                    const withLok = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === 'Sodium Zirconium Cyclosilicate (Lokelma)'));
                    if (withLok.length === 0) fail('Lokelma not used (check is vacuous)');
                    if (withLok.some(r => !(r.warnings ?? []).some(w => w.includes('400 mg of sodium') && w.includes('edema')))) fail('Lokelma regimen without the heart-failure sodium/edema warning');
                    if (withLok.some(r => !(r.warnings ?? []).some(w => w.includes('2 hours')) || !(r.warnings ?? []).some(w => w.includes('bowel obstruction')))) fail('Lokelma regimen without the 2-hour spacing or bowel-obstruction caution');
                }
                if (t.includes('Patiromer Warnings')) {
                    const withPat = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === 'Patiromer'));
                    if (withPat.length === 0) fail('Patiromer not used (check is vacuous)');
                    if (withPat.some(r => !(r.warnings ?? []).some(w => w.includes('3 hours')) || !(r.warnings ?? []).some(w => w.includes('bowel obstruction')))) fail('Patiromer regimen without the 3-hour spacing or GI caution');
                    if (withPat.some(r => !(r.monitoring_plan ?? []).some(m => m.test.includes('magnesium')))) fail('Patiromer regimen without the magnesium monitoring item');
                }
            }

            // ===== SGLT2i / GLP-1 / vericiguat / IV iron / H-ISDN source-verified corrections (verified-sglt2-glp1-adjuncts.md; labels: Farxiga, Jardiance, Wegovy, Zepbound, Verquvo, Injectafer, BiDil; STEP-HFpEF, SUMMIT, VICTORIA, A-HeFT) =====
            if (scenario.title.includes('Adjunct-Source')) {
                const excl = (name: string) => excludedMedications.find(e => e.name === name);
                const whyText = (name: string) => (excl(name)?.why ?? []).join(' | ');
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const med = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
                const SEMA = 'Semaglutide (Wegovy)', TIRZ = 'Tirzepatide (Zepbound)', VER = 'Vericiguat', FCM = 'Ferric Carboxymaltose', HISDN = 'Hydralazine/Isosorbide Dinitrate';
                const mods = scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).map(m => ({ r, m })));
                const targetsOf = (action: string, name: string) => mods.filter(x => x.m.action === action && x.m.target?.med.name === name).map(x => String(x.m.target!.dose.strength));
                const warnTexts = (name: string) => scoredRegimens.filter(r => r.regimen.some(m => m.med.name === name)).map(r => (r.warnings ?? []).join(' | '));
                const adjunctSurfaced = (frag: string) => (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes(frag));
                const featureFired = (r: typeof scoredRegimens[number], frag: string) => (r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.includes(frag)));
                const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
                const P = scenario.patient;

                // --- GLP-1: placebo-adjusted effects (STEP-HFpEF 7.8, STEP-HFpEF DM 7.3, SUMMIT 6.9) ---
                if (t.includes('GLP-1 KCCQ And Weight Placebo-Adjusted')) {
                    const nonDm = clonePatient(P);
                    if (!near(med(SEMA).chf_effects(2.4).kccq_improvement, 7.8)) fail('Semaglutide 2.4 mg KCCQ must be the placebo-adjusted 7.8 (STEP-HFpEF: +16.6 vs +8.7)');
                    if (!near(med(TIRZ).chf_effects(15).kccq_improvement, 6.9)) fail('Tirzepatide 15 mg KCCQ must be the placebo-adjusted 6.9 (SUMMIT: +19.5 vs +12.7)');
                    if (!near(patientChfEffects(med(SEMA), 2.4, nonDm).kccq_improvement, 7.8)) fail('Modeled semaglutide KCCQ at maintenance (no diabetes) is not 7.8');
                    const dm = clonePatient(P); dm.comorbidities.add('Diabetes Mellitus Type 2');
                    if (!near(patientChfEffects(med(SEMA), 2.4, dm).kccq_improvement, 7.3, 1e-6)) fail('Modeled semaglutide KCCQ with type 2 diabetes is not 7.3 (STEP-HFpEF DM)');
                    if (!near(patientChfEffects(med(TIRZ), 15, nonDm).kccq_improvement, 6.9)) fail('Modeled tirzepatide KCCQ at maintenance is not 6.9');
                    if (med(SEMA).chf_effects(1.0).kccq_improvement >= 7.8 || med(SEMA).chf_effects(0.25).kccq_improvement >= med(SEMA).chf_effects(1.0).kccq_improvement) fail('Semaglutide KCCQ is not scaled down at lower doses');
                    // Weight is a placebo-adjusted percent of THIS patient's weight (100.5 kg here)
                    const wt = patientChfEffects(med(SEMA), 2.4, nonDm).weight_reduction_kg;
                    if (!near(wt, 0.107 * nonDm.volume_status.current_weight_kg, 1e-6)) fail(`Semaglutide weight effect ${wt} is not -10.7% of body weight`);
                    if (!near(patientChfEffects(med(SEMA), 2.4, dm).weight_reduction_kg, 0.064 * dm.volume_status.current_weight_kg, 1e-6)) fail('Semaglutide weight effect with type 2 diabetes is not -6.4% of body weight');
                }
                if (t.includes('GLP-1 New Start Is Lowest Tier')) {
                    const adds = [...targetsOf('add', SEMA).map(x => ['sema', x]), ...targetsOf('add', TIRZ).map(x => ['tirz', x])];
                    if (adds.length === 0) fail('No GLP-1 add was produced (check is vacuous)');
                    if (adds.some(([k, d]) => (k === 'sema' && d !== '0.25') || (k === 'tirz' && d !== '2.5'))) fail(`A GLP-1 new start is above the lowest tier: ${adds.map(a => a.join(' ')).join(', ')}`);
                    if (!adjunctSurfaced('glp-1')) fail('GLP-1 not surfaced in eligible adjuncts');
                }
                // --- GLP-1: one-step titration (label tiers, never a skipped step) ---
                const oneStep = (name: string, from: string, to: string) => {
                    // Direct check of the engine's titration options (the displayed top picks need not include a titration)
                    const formularyNow = MEDICATION_FORMULARY.filter(m => !(m.contraindications?.(P)));
                    const analysis = analyzeCurrentRegimen(P, formularyNow, formularyNow.flatMap(m => getDoseTiers(m, P)));
                    const up = analysis.titratableUp.find(x => x.current.med.name === name);
                    if (!up) fail(`${name} at ${from} has no titration option (check is vacuous)`);
                    else if (up.options.length !== 1 || String(up.options[0].dose.strength) !== to) fail(`${name} titration from ${from} must offer exactly ${to}; offered ${up.options.map(o => o.dose.strength).join(', ')}`);
                    // Anything displayed is also one step
                    const ups = mods.filter(x => x.m.action === 'titrate_up' && x.m.source?.med.name === name);
                    if (ups.some(x => String(x.m.target!.dose.strength) !== to)) fail(`${name} titration from ${from} displayed a jump: ${ups.map(x => x.m.target!.dose.strength).join(', ')}`);
                };
                if (t.includes('Semaglutide Titration One Step 0.25 To 0.5')) oneStep(SEMA, '0.25', '0.5');
                if (t.includes('Semaglutide Titration One Step 1.7 To 2.4')) oneStep(SEMA, '1.7', '2.4');
                if (t.includes('Tirzepatide Titration One Step 2.5 To 5')) oneStep(TIRZ, '2.5', '5');
                if (t.includes('Tirzepatide Titration One Step 10 To 12.5')) oneStep(TIRZ, '10', '12.5');
                if (t.includes('Titration One Step')) {
                    // Tier sets are complete (label steps) for the dose-tier sampler
                    if (getDoseTiers(med(SEMA), P).map(x => x.dose.strength).join(',') !== '0.25,0.5,1,1.7,2.4') fail('Semaglutide tiers are not 0.25/0.5/1.0/1.7/2.4');
                    if (getDoseTiers(med(TIRZ), P).map(x => x.dose.strength).join(',') !== '2.5,5,7.5,10,12.5,15') fail('Tirzepatide tiers are not 2.5/5/7.5/10/12.5/15');
                }
                // --- GLP-1: LVEF initiation gates (semaglutide >= 45, tirzepatide >= 50, BMI >= 30; continuation ungated) ---
                if (t.includes('Semaglutide Not Started At LVEF 43')) {
                    for (const n of [SEMA, TIRZ]) if (excl(n)?.rule_id !== 'E13' || !/LVEF below/.test(whyText(n))) fail(`${n} not excluded with the LVEF reason at LVEF 43`);
                    if (anyRegimenContainsAnyClass('GLP-1 RA', 'GLP-1/GIP RA')) fail('A GLP-1 is offered at LVEF 43');
                }
                if (t.includes('Semaglutide Started At LVEF 46 Tirzepatide Not')) {
                    if (excl(SEMA)) fail('Semaglutide excluded at LVEF 46 (STEP-HFpEF enrolled LVEF >= 45)');
                    if (excl(TIRZ)?.rule_id !== 'E13' || !/LVEF below 50/.test(whyText(TIRZ))) fail('Tirzepatide not excluded at LVEF 46 (SUMMIT enrolled LVEF >= 50)');
                    if (!adjunctSurfaced('glp-1')) fail('Semaglutide not surfaced at LVEF 46');
                    if (anyRegimenHasMed(TIRZ)) fail('Tirzepatide offered at LVEF 46');
                }
                if (t.includes('Tirzepatide Not Started At LVEF 47')) {
                    if (excl(TIRZ)?.rule_id !== 'E13') fail('Tirzepatide not excluded at LVEF 47');
                    if (anyRegimenHasMed(TIRZ)) fail('Tirzepatide offered at LVEF 47');
                    if (excl(SEMA)) fail('Semaglutide excluded at LVEF 47');
                }
                if (t.includes('GLP-1 Continuation Below Initiation Gates')) {
                    if (excl(SEMA)) fail('Semaglutide on board at LVEF 42 / BMI 28 was excluded: the BMI and LVEF gates are initiation-only');
                    if (!scoredRegimens.some(r => r.regimen.some(m => m.med.name === SEMA))) fail('Semaglutide on board was dropped from every option');
                }
                if (t.includes('GLP-1 BMI 28 Not Started')) {
                    for (const n of [SEMA, TIRZ]) if (!/BMI below 30/.test(whyText(n))) fail(`${n} not excluded for BMI 28`);
                }
                if (t.includes('GLP-1 Cautions Pancreatitis')) {
                    const w = warnTexts(SEMA).join(' || ');
                    if (!/pancreatitis/i.test(w) || !/gastroparesis/i.test(w) || !/retinopathy/i.test(w)) fail('Semaglutide regimen lacks the pancreatitis / gastroparesis / retinopathy cautions');
                    if (excl(SEMA)) fail('A caution-level history excluded semaglutide (these are warnings, not contraindications)');
                    if (warnTexts(SEMA).some(x => !x.includes('Drug note'))) fail('GLP-1 caution is not a Drug note');
                }
                if (t.includes('GLP-1 Type 2 Diabetes Reduces Effect')) {
                    const plain = clonePatient(P); plain.comorbidities.delete('Diabetes Mellitus Type 2');
                    if (!(patientChfEffects(med(SEMA), 2.4, P).weight_reduction_percent! < patientChfEffects(med(SEMA), 2.4, plain).weight_reduction_percent!)) fail('Type 2 diabetes does not reduce the semaglutide weight effect');
                    if (!(patientChfEffects(med(TIRZ), 15, P).weight_reduction_percent! < patientChfEffects(med(TIRZ), 15, plain).weight_reduction_percent!)) fail('Type 2 diabetes does not reduce the tirzepatide weight effect');
                }
                if (t.includes('GLP-1 Evidence Bonus Equal No Superior Claim')) {
                    const pts = (n: string) => med(n).special_features!.map(f => f.points);
                    if (pts(SEMA).join() !== pts(TIRZ).join()) fail('Semaglutide and tirzepatide evidence-bonus points differ');
                    if ([SEMA, TIRZ].some(n => med(n).special_features!.some(f => /superior/i.test(f.feature)))) fail('A GLP-1 feature still claims "Superior"');
                }
                if (t.includes('Tirzepatide Dose Map And NT-proBNP')) {
                    const w = (d: number) => med(TIRZ).chf_effects(d).weight_reduction_percent!;
                    const f = (d: number) => w(d) / w(15);
                    if (!(f(5) >= 0.67 && f(5) <= 0.72)) fail(`Tirzepatide 5 mg weight fraction ${f(5)} is outside the SURMOUNT-1 range 0.67-0.72`);
                    if (!(f(10) >= 0.92 && f(10) <= 0.93)) fail(`Tirzepatide 10 mg weight fraction ${f(10)} is outside the SURMOUNT-1 range 0.92-0.93`);
                    const ladder = [2.5, 5, 7.5, 10, 12.5, 15].map(w);
                    if (ladder.some((v, i) => i > 0 && v < ladder[i - 1])) fail('Tirzepatide dose-weight map is not monotone');
                    if (med(TIRZ).chf_effects(15).bnp_reduction_percent > 0.10 + 1e-12) fail('Tirzepatide NT-proBNP reduction exceeds 0.10 (SUMMIT: -10.5%, CI crosses 0)');
                }
                if (t.includes('Tirzepatide Cash Price By Dose')) {
                    const prices = await getDrugPrices(undefined, 'cash');
                    const cost = (strength: number) => simulateModificationEffect(P, { modifications: [], resulting_regimen: [{ med: med(TIRZ), dose: med(TIRZ).available_doses.find(d => d.strength === strength)!, selected_frequency: 'weekly' }] }, prices).cost;
                    if (!near(cost(2.5), 299) || !near(cost(5), 399) || !near(cost(7.5), 499) || !near(cost(15), 699)) fail(`Zepbound cash by dose is not 299 / 399 / 499 / 699 (saw ${cost(2.5)} / ${cost(5)} / ${cost(7.5)} / ${cost(15)})`);
                    const commercial = await getDrugPrices(undefined, 'commercial');
                    const cc = simulateModificationEffect({ ...P, insurance_tier: 'commercial' }, { modifications: [], resulting_regimen: [{ med: med(TIRZ), dose: med(TIRZ).available_doses[0], selected_frequency: 'weekly' }] }, commercial).cost;
                    if (!near(cc, DRUG_PRICES[TIRZ].commercial_copay)) fail('The cash-by-dose price leaked into a non-cash tier');
                    if (DRUG_PRICES[SEMA].medicare_copay !== 50 || DRUG_PRICES[TIRZ].medicare_copay !== 50) fail('Wegovy / Zepbound Medicare copay is not $50 (GLP-1 Bridge)');
                    if (!/PRIOR AUTHORIZATION/i.test(DRUG_PRICES[SEMA].notes ?? '') || !/PRIOR AUTHORIZATION/i.test(DRUG_PRICES[TIRZ].notes ?? '')) fail('GLP-1 Medicare price notes omit the prior-authorization requirement');
                }
                // --- SGLT2i ---
                if (t.includes('Empagliflozin Started At eGFR 22')) {
                    if (excl('Empagliflozin')) fail('Empagliflozin excluded at eGFR 22 (initiation is blocked only below 20)');
                    if (excl('Dapagliflozin')?.rule_id !== 'E13' || !/eGFR below 25/.test(whyText('Dapagliflozin'))) fail('Dapagliflozin not excluded at eGFR 22 (label: initiation not recommended below 25)');
                    if (!anyRegimenHasMed('Empagliflozin')) fail('Empagliflozin not offered at eGFR 22');
                }
                if (t.includes('SGLT2i Not Started At eGFR 18')) {
                    for (const n of ['Empagliflozin', 'Dapagliflozin']) if (excl(n)?.rule_id !== 'E13') fail(`${n} not excluded at eGFR 18`);
                    if (!/eGFR below 20/.test(whyText('Empagliflozin'))) fail('Empagliflozin exclusion at eGFR 18 does not state the eGFR 20 floor');
                }
                if (t.includes('SGLT2i Continuation At eGFR 18')) {
                    if (excl('Dapagliflozin')) fail('Dapagliflozin on board at eGFR 18 was excluded (continuation is allowed below the initiation floor)');
                    if (!scoredRegimens.some(r => r.regimen.some(m => m.med.name === 'Dapagliflozin'))) fail('Dapagliflozin on board was dropped at eGFR 18');
                }
                if (t.includes('SGLT2i KCCQ Placebo-Adjusted And Generic Price')) {
                    if (med('Dapagliflozin').chf_effects(10).kccq_improvement !== 2.5) fail('Dapagliflozin KCCQ must be the placebo-adjusted 2.5');
                    if (med('Empagliflozin').chf_effects(10).kccq_improvement !== 2.0) fail('Empagliflozin KCCQ must be the placebo-adjusted 2.0');
                    if (!('volume_depletion' in med('Empagliflozin').side_effects(10))) fail('Empagliflozin lacks the volume-depletion side-effect entry');
                    if (DRUG_PRICES['Dapagliflozin'].generic_available !== true || DRUG_PRICES['Dapagliflozin'].cash !== 50) fail('Dapagliflozin must be flagged generic with cash about $50');
                    if (!/178\.50/.test(DRUG_PRICES['Dapagliflozin'].notes ?? '') || !/197/.test(DRUG_PRICES['Empagliflozin'].notes ?? '')) fail('Medicare negotiated Farxiga / Jardiance prices are not recorded');
                    if (!/conservative/.test(med('Dapagliflozin').contraindication_checks!.map(c => c.reason).join(' '))) fail('The T1DM / DKA SGLT2i gate is not labeled as an engine-conservative choice');
                }
                // --- Vericiguat ---
                if (t.includes('Vericiguat Offered At NT-proBNP 1200 Sinus')) {
                    if (excl(VER)) fail(`Vericiguat excluded at NT-proBNP 1200 in sinus rhythm (VICTORIA >= 1000): ${whyText(VER)}`);
                    if (!adjunctSurfaced('vericiguat')) fail('Vericiguat not surfaced at NT-proBNP 1200 in sinus rhythm');
                }
                if (t.includes('Vericiguat Not Offered At NT-proBNP 1200 AFib')) {
                    if (excl(VER)?.rule_id !== 'E13' || !/1600/.test(whyText(VER))) fail('Vericiguat not excluded at NT-proBNP 1200 in atrial fibrillation (VICTORIA >= 1600)');
                    if (anyRegimenHasMed(VER)) fail('Vericiguat offered at NT-proBNP 1200 in atrial fibrillation');
                }
                if (t.includes('Vericiguat Offered At NT-proBNP 1700 AFib')) {
                    if (excl(VER)) fail('Vericiguat excluded at NT-proBNP 1700 in atrial fibrillation');
                }
                if (t.includes('Vericiguat Starts At 5 mg')) {
                    const adds = targetsOf('add', VER);
                    if (adds.length === 0) fail('No vericiguat add produced (check is vacuous)');
                    if (adds.some(d => d !== '5')) fail(`Vericiguat new start is not the label default 5 mg: ${adds.join(', ')}`);
                }
                if (t.includes('Vericiguat Starts At 2.5 mg When SBP Low')) {
                    const adds = targetsOf('add', VER);
                    if (adds.length === 0) fail('No vericiguat add produced (check is vacuous)');
                    if (adds.some(d => d !== '2.5')) fail(`Vericiguat start at SBP 104 is not 2.5 mg: ${adds.join(', ')}`);
                }
                if (t.includes('Vericiguat Riociguat Excluded')) {
                    if (excl(VER)?.rule_id !== 'E13' || !/riociguat/i.test(whyText(VER))) fail('Vericiguat not excluded with riociguat (labeled contraindication)');
                    if (anyRegimenHasMed(VER)) fail('Vericiguat offered with riociguat');
                }
                if (t.includes('Vericiguat PDE5 Inhibitor Warned Not Excluded')) {
                    if (excl(VER)) fail('A PDE-5 inhibitor excluded vericiguat (label wording is "not recommended": warning, not a hard exclusion)');
                    const w = warnTexts(VER);
                    if (w.length === 0) fail('Vericiguat not kept (check is vacuous)');
                    if (w.some(x => !/PDE-5 inhibitor/.test(x) || !/not recommended/.test(x))) fail('Vericiguat + PDE-5 inhibitor lacks the "not recommended" warning');
                }
                if (t.includes('Vericiguat With H/ISDN Warned')) {
                    const w = warnTexts(VER);
                    if (w.length === 0) fail('Vericiguat not kept (check is vacuous)');
                    if (w.some(x => !/long-acting nitrates/.test(x) || !/excluded from VICTORIA/.test(x))) fail('Vericiguat + H/ISDN lacks the long-acting-nitrate (VICTORIA exclusion) warning');
                }
                if (t.includes('Vericiguat NT-proBNP Above 8000 Advisory')) {
                    if (excl(VER)) fail('NT-proBNP above 8000 excluded vericiguat (advisory only; the label has no upper limit)');
                    const w = warnTexts(VER);
                    if (w.length === 0) fail('Vericiguat not kept (check is vacuous)');
                    if (w.some(x => !/above 8,000/.test(x))) fail('No NT-proBNP > 8000 advisory on a vericiguat regimen');
                }
                if (t.includes('Vericiguat KCCQ And Side Effects')) {
                    const k = med(VER).chf_effects(10).kccq_improvement;
                    if (k < 0 || k > 1) fail(`Vericiguat KCCQ ${k} is outside 0-1 (VICTORIA: no significant effect)`);
                    const se = med(VER).side_effects(10);
                    if (se.hypotension !== 0.16 || se.anemia !== 0.10) fail('Vericiguat display side effects are not hypotension 16% / anemia 10% (label)');
                }
                // --- H/ISDN ---
                if (t.includes('A-HeFT Offered On RAAS And Beta-Blocker')) {
                    if (!adjunctSurfaced('hydralazine')) fail('H/ISDN not surfaced for a Black NYHA III HFrEF patient on RAAS + beta-blocker');
                }
                if (t.includes('A-HeFT Not Offered Without RAAS And Beta-Blocker')) {
                    if (adjunctSurfaced('hydralazine') || anyRegimenHasClass('Vasodilator')) fail('H/ISDN offered under the Class 1 indication with no RAAS inhibitor and no beta-blocker on board');
                }
                if (t.includes('A-HeFT Bonus Absent Without RAAS And Beta-Blocker')) {
                    const hasBoth = (r: typeof scoredRegimens[number]) => r.regimen.some(m => RAAS_CLASSES.has(m.med.drug_class)) && r.regimen.some(m => m.med.drug_class === 'Beta Blocker');
                    const withH = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === HISDN));
                    if (withH.length === 0) fail('H/ISDN not kept (check is vacuous)');
                    if (withH.some(r => !hasBoth(r) && featureFired(r, 'A-HeFT'))) fail('A-HeFT evidence bonus credited without a RAAS inhibitor and a beta-blocker on board');
                }
                if (t.includes('A-HeFT Bonus Present On RAAS And Beta-Blocker')) {
                    const withH = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === HISDN));
                    if (withH.length === 0) fail('H/ISDN not kept (check is vacuous)');
                    if (withH.some(r => !featureFired(r, 'A-HeFT'))) fail('A-HeFT bonus missing for a Black NYHA III HFrEF patient on RAAS + beta-blocker');
                    const pts = med(HISDN).special_features![0].points;
                    if (pts !== 60) fail(`A-HeFT bonus is ${pts}, expected 60 (top of the scale)`);
                    if (!(pts > med(FCM).special_features![0].points) || !(pts > med(SEMA).special_features![0].points)) fail('A-HeFT mortality bonus is not above the iron and GLP-1 symptom bonuses');
                }
                if (t.includes('H/ISDN Class 2b When RAAS Cannot Be Taken')) {
                    if (!adjunctSurfaced('hydralazine')) fail('H/ISDN not surfaced under the Class 2b path (every RAAS inhibitor excluded by K+ 5.6)');
                }
                if (t.includes('H/ISDN Riociguat And Vardenafil Excluded')) {
                    if (excl(HISDN)?.rule_id !== 'E13') fail('H/ISDN not excluded with riociguat / vardenafil');
                    if (!/riociguat/i.test(whyText(HISDN)) || !/vardenafil/i.test(whyText(HISDN))) fail('H/ISDN exclusion does not name riociguat and the PDE-5 inhibitor');
                    if (anyRegimenHasMed(HISDN)) fail('H/ISDN offered with riociguat / vardenafil');
                }
                if (t.includes('H/ISDN Side Effects Tachycardia Lupus Warning')) {
                    const se = med(HISDN).side_effects('75/40');
                    if (se.headache !== 0.50 || se.dizziness !== 0.32) fail('H/ISDN display headache / dizziness are not 50% / 32% (BiDil label)');
                    if (!(med(HISDN).hemodynamic_effects('75/40').hr_drop < 0)) fail('H/ISDN heart-rate effect is not a rise (reflex tachycardia)');
                    const w = warnTexts(HISDN);
                    if (w.length === 0) fail('H/ISDN not kept (check is vacuous)');
                    if (w.some(x => !/lupus/.test(x) || !/peripheral neuritis/.test(x))) fail('H/ISDN regimen lacks the lupus-like syndrome / peripheral neuritis warning');
                }
                // --- IV iron ---
                const ironWarn = (r: typeof scoredRegimens[number]) => (r.warnings ?? []).filter(x => x.includes('label dosing')).join(' | ');
                const withFcm = () => scoredRegimens.filter(r => r.regimen.some(m => m.med.name === FCM));
                if (t.includes('IV Iron Not Added At LVEF 55')) {
                    if (anyRegimenHasMed(FCM)) fail('IV iron auto-added at LVEF 55 (evidence is LVEF < 50)');
                    if (adjunctSurfaced('iron')) fail('IV iron surfaced as an eligible adjunct at LVEF 55');
                    if (!(missingDataNotices ?? []).some(n => n.includes('not added automatically'))) fail('No notice explaining why IV iron is not added at LVEF 55');
                }
                if (t.includes('IV Iron Added At LVEF 30 Dose 85 kg Hb 12')) {
                    if (withFcm().length === 0) fail('IV iron not added at LVEF 30 with iron deficiency');
                    if (withFcm().some(r => !r.regimen.some(m => m.med.name === FCM && Number(m.dose.strength) === 1000))) fail('Day-1 dose at Hb 12 is not 1000 mg');
                    // label table: 70 kg or more, Hb 10-14 -> 1000 mg day 1, 500 mg week 6
                    if (withFcm().some(r => !/70 kg or more/.test(ironWarn(r)) || !/day 1 1000 mg; week 6 500 mg/.test(ironWarn(r)))) fail(`85 kg / Hb 12 dosing note is not 1000 mg then 500 mg at week 6: ${withFcm().map(ironWarn)[0]}`);
                    if (withFcm().some(r => !/weeks 12, 24 and 36/.test(ironWarn(r)))) fail('Dosing note lacks the 500 mg maintenance schedule');
                    if (withFcm().some(r => !(r.warnings ?? []).some(x => /BOXED WARNING/.test(x) && /hypophosphatemia/.test(x)))) fail('Boxed-warning hypophosphatemia text missing');
                    if (withFcm().some(r => !(r.monitoring_plan ?? []).some(m => /phosphate/i.test(m.test)))) fail('Phosphate monitoring item missing');
                    if (withFcm().some(r => !(r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.includes('Treats iron deficiency in HFrEF'))))) fail('Full-credit iron bonus missing at LVEF 30');
                }
                if (t.includes('IV Iron Dose 65 kg Hb 12')) {
                    if (withFcm().length === 0) fail('IV iron not added (check is vacuous)');
                    if (withFcm().some(r => !/below 70 kg/.test(ironWarn(r)) || !/day 1 1000 mg; week 6 none/.test(ironWarn(r)))) fail(`65 kg / Hb 12 dosing note is not 1000 mg then none: ${withFcm().map(ironWarn)[0]}`);
                }
                if (t.includes('IV Iron Dose 65 kg Hb 9')) {
                    if (withFcm().length === 0) fail('IV iron not added (check is vacuous)');
                    if (withFcm().some(r => !/day 1 1000 mg; week 6 500 mg/.test(ironWarn(r)))) fail(`65 kg / Hb 9 dosing note is not 1000 mg then 500 mg: ${withFcm().map(ironWarn)[0]}`);
                }
                if (t.includes('IV Iron Dose 85 kg Hb 9')) {
                    if (withFcm().length === 0) fail('IV iron not added (check is vacuous)');
                    if (withFcm().some(r => !/day 1 1000 mg; week 6 1000 mg/.test(ironWarn(r)))) fail(`85 kg / Hb 9 dosing note is not 1000 mg then 1000 mg: ${withFcm().map(ironWarn)[0]}`);
                }
                if (t.includes('IV Iron Dose Hb 14.5 Is 500 mg')) {
                    if (withFcm().length === 0) fail('IV iron not added (check is vacuous)');
                    if (withFcm().some(r => !r.regimen.some(m => m.med.name === FCM && Number(m.dose.strength) === 500))) fail('Day-1 dose at Hb 14.5 is not 500 mg');
                    if (withFcm().some(r => !/day 1 500 mg; week 6 none/.test(ironWarn(r)))) fail('Hb 14.5 dosing note is not 500 mg then none');
                }
                if (t.includes('IV Iron Held At Hb 15.5')) {
                    if (excl(FCM)?.rule_id !== 'E13' || !/15 g\/dL/.test(whyText(FCM))) fail('Ferric carboxymaltose not held at Hb 15.5');
                    if (anyRegimenHasMed(FCM)) fail('IV iron offered at Hb 15.5');
                }
                if (t.includes('IV Iron Hemoglobin Not Entered Both Bands')) {
                    if (withFcm().length === 0) fail('IV iron not added (check is vacuous)');
                    if (withFcm().some(r => !/hemoglobin not entered/.test(ironWarn(r)) || !/Hb < 10/.test(ironWarn(r)) || !/Hb 10-14/.test(ironWarn(r)))) fail('Dosing note without hemoglobin does not state both bands');
                    if (!(missingDataNotices ?? []).some(n => n.includes('Hemoglobin not entered'))) fail('No missing-hemoglobin notice');
                }
                if (t.includes('IV Iron Limited Evidence LVEF 45')) {
                    if (withFcm().length === 0) fail('IV iron not added at LVEF 45 (limited-evidence tier still adds it)');
                    if (withFcm().some(r => !(r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.includes('limited evidence') && i.points === 20)))) fail('Limited-evidence iron bonus (20 points) missing at LVEF 45');
                    if (withFcm().some(r => (r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.includes('Treats iron deficiency in HFrEF'))))) fail('Full iron credit given at LVEF 45');
                }
                if (t.includes('IV Iron Price Amortized Per Course')) {
                    const fcm = DRUG_PRICES[FCM];
                    // 1500 mg course x $1.121/mg amortized over 6 months; Medicare 20% coinsurance
                    if (fcm.cash !== Math.round(1500 * 1.121 / 6)) fail(`FCM cash ${fcm.cash} is not the amortized course (1500 mg x $1.121 / 6 = ${Math.round(1500 * 1.121 / 6)})`);
                    if (fcm.medicare_copay !== Math.round(0.2 * 1500 * 1.121 / 6)) fail(`FCM Medicare ${fcm.medicare_copay} is not the amortized 20% coinsurance`);
                    if (!/amortized/i.test(fcm.notes ?? '') || !/6 months/.test(fcm.notes ?? '')) fail('FCM price note does not state the amortization rule');
                    const ft = med(FCM);
                    if (ft.chf_effects(1000).kccq_improvement !== 8) fail('FCM KCCQ changed (NOT VERIFIED in the source file: must stay 8)');
                    if (ft.side_effects(1000).hypophosphatemia !== 0.27) fail('FCM hypophosphatemia rate is not the label 27%');
                }
            }


            // ===== Diuretic source-verified corrections (verified-diuretics.md; labels: furosemide, bumetanide, torsemide, metolazone, chlorthalidone, HCTZ, Furoscix; TRANSFORM-HF, CLOROTIC) =====
            if (scenario.title.includes('Diuretic-Source')) {
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const P = scenario.patient;
                const med = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
                const rmed = (name: string, strength: number | string, freq: string): RegimenMed => {
                    const m = med(name);
                    return { med: m, dose: m.available_doses.find(d => String(d.strength) === String(strength))!, selected_frequency: freq };
                };
                const excl = (name: string) => excludedMedications.find(e => e.name === name);
                const FSX = 'Furoscix (SC Furosemide)';
                const mods = scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).map(m => ({ r, m })));
                const kgLost = (modifications: import('../types').RegimenModification[]) => {
                    const resulting = [...(P.current_regimen ?? [])];
                    modifications.forEach(m => {
                        if (m.action === 'add' && m.target) resulting.push(m.target);
                        if ((m.action === 'titrate_up' || m.action === 'titrate_down') && m.source && m.target) {
                            const i = resulting.findIndex(r => r.med.name === m.source!.med.name);
                            if (i >= 0) resulting[i] = m.target;
                        }
                    });
                    const sim = simulateModificationEffect(P, { modifications, resulting_regimen: resulting }, scenarioPrices);
                    return { kg: P.volume_status.current_weight_kg - sim.projectedPatient.volume_status.current_weight_kg, sim };
                };
                const noSgltSynergy = (x: number) => x; // current regimens carry the SGLT2i already, so the synergy factor is not applied to these deltas

                if (t.includes('Bumetanide eGFR 15 Never Above 10 mg Daily')) {
                    if (med('Bumetanide').available_doses.some(d => Number(d.strength) === 4)) fail('Bumetanide still has a 4 mg tier (tablets are 0.5, 1 and 2 mg)');
                    const tiers = getDoseTiers(med('Bumetanide'), P);
                    if (tiers.length === 0) fail('No bumetanide tiers at eGFR 15 (check is vacuous)');
                    if (tiers.some(x => dailyDose(x) > 10)) fail('A bumetanide tier exceeds 10 mg/day at eGFR 15');
                    if (!tiers.some(x => x.selected_frequency === 'tid')) fail('eGFR < 20 no longer prefers split (tid) loop dosing where the maximum allows it');
                    if (scoredRegimens.some(r => r.regimen.some(m => m.med.name === 'Bumetanide' && dailyDose(m) > 10))) fail('Bumetanide offered above 10 mg/day');
                }
                if (t.includes('Furosemide 80 mg tid High-Dose Alert')) {
                    if (dailyDose(P.current_regimen.find(r => r.med.name === 'Furosemide')!) !== 240) fail('Fixture furosemide 80 tid is not 240 mg/day');
                    if (!clinicalAlerts.some(a => a.startsWith('LOOP DIURETIC OVER-TREATMENT') && a.includes('240'))) fail('Furosemide 80 mg tid (240 mg/day) in a euvolemic patient did not trigger the high-dose loop alert stating the daily dose');
                }
                if (t.includes('Furosemide 40 mg bid Below High-Dose Alert')) {
                    if (clinicalAlerts.some(a => a.startsWith('LOOP DIURETIC OVER-TREATMENT'))) fail('Furosemide 40 mg bid (80 mg/day, below the 120 mg/day policy level) triggered the high-dose alert');
                }
                if (t.includes('Daily Dose Credit')) {
                    const qd = kgLost([{ action: 'titrate_up', source: rmed('Furosemide', 20, 'qd'), target: rmed('Furosemide', 40, 'qd'), summary: 'x' }]).kg;
                    const bid = kgLost([{ action: 'titrate_up', source: rmed('Furosemide', 40, 'qd'), target: rmed('Furosemide', 40, 'bid'), summary: 'x' }]).kg;
                    const eq = kgLost([{ action: 'titrate_up', source: rmed('Furosemide', 40, 'qd'), target: rmed('Furosemide', 80, 'qd'), summary: 'x' }]).kg;
                    if (!(bid > 0.5)) fail(`40 mg bid is not credited more decongestion than 40 mg daily (gain ${bid.toFixed(2)} kg)`);
                    if (Math.abs(bid - eq) > 1e-9) fail(`40 mg bid (${bid.toFixed(3)} kg) is not credited like 80 mg daily (${eq.toFixed(3)} kg): effects must use total daily dose`);
                    if (!(qd > 0)) fail('20 to 40 mg daily credits no decongestion (check is vacuous)');
                    const f = med('Furosemide').chf_effects;
                    if (Math.abs(f(160).weight_reduction_kg - 4.2) > 1e-9 || Math.abs(f(40).weight_reduction_kg - 2.4) > 0.01) fail('Furosemide dose-response curve moved (must stay the calibrated 1.5/2.4/3.3/4.2 kg anchors)');
                    // titration keeps the patient's frequency: from 40 bid the next tier is 80 bid (not 80 daily, which would credit nothing)
                    const bidPatient = { ...P, current_regimen: [rmed('Furosemide', 40, 'bid')] };
                    const up = analyzeCurrentRegimen(bidPatient, MEDICATION_FORMULARY, MEDICATION_FORMULARY.flatMap(m => getDoseTiers(m, bidPatient)));
                    const opts = (up.titratableUp ?? []).find((x: any) => x.current.med.name === 'Furosemide')?.options ?? [];
                    if (opts.length === 0 || opts.some((o: RegimenMed) => o.selected_frequency !== 'bid')) fail('Loop titration from 40 mg bid does not keep the twice-daily frequency');
                }
                if (t.includes('Furoscix Short-Course Add-On Not Swap')) {
                    if (mods.some(x => x.m.action === 'swap' && x.m.target?.med.name === FSX)) fail('Furoscix offered as a SWAP (a standing replacement; the label says not for chronic use)');
                    const withFsx = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === FSX));
                    if (withFsx.length === 0) fail('Furoscix short-course add-on not offered with worsening congestion on an oral loop (check is vacuous)');
                    if (withFsx.some(r => !r.regimen.some(m => m.med.drug_class === 'Loop Diuretic' && m.med.name !== FSX))) fail('Furoscix offered without an oral loop beside it');
                    if (mods.some(x => x.m.target?.med.name === FSX && !/SHORT COURSE/.test(x.m.summary))) fail('Furoscix modification summary does not say short course');
                    if (!monitoringPlan.some(m => /Volume status after the Furoscix course/.test(m.test) && /resume or adjust the oral loop/.test(m.details))) fail('No monitoring item to reassess volume and resume/adjust the oral loop after Furoscix');
                    // credited ABOVE the oral loop: oral 40 mg/day = 2.4 kg, plus Furoscix 80 mg SC (= 160 mg oral) -> furosemide curve at 40 + 160 = 200 mg oral-equivalent, capped at 320
                    const inc = kgLost([{ action: 'add', target: rmed(FSX, 80, 'qd'), summary: 'x' }]).kg;
                    const curve = (e: number) => 1.5 + 0.9 * Math.log2(e / 20);
                    if (Math.abs(inc - (curve(200) - curve(40))) > 1e-6) fail(`Furoscix add-on credit ${inc.toFixed(3)} kg is not the increment above the oral loop (${(curve(200) - curve(40)).toFixed(3)} kg)`);
                    if (!(inc < med(FSX).chf_effects(80).weight_reduction_kg)) fail('Furoscix add-on credit is not below its standalone effect (double counting)');
                    if (!(DRUG_PRICES[FSX].cash >= 4 * 800) || !/4 single-use kits|COURSE of 4/.test(DRUG_PRICES[FSX].notes ?? '')) fail('Furoscix price is not stated per course of kits');
                }
                if (t.includes('Furoscix Not Offered Without Oral Loop')) {
                    if (excl(FSX)?.rule_id !== 'E13' || !/oral loop/.test((excl(FSX)?.why ?? []).join(' '))) fail('Furoscix not withheld (E13, oral-loop reason) without an oral loop on board');
                    if (anyRegimenHasMed(FSX)) fail('Furoscix offered as a standalone loop');
                }
                if (t.includes('Furoscix CKD Allowed Anuria Excluded')) {
                    if (excl(FSX)?.rule_id !== 'E13' || !/Anuria/.test((excl(FSX)?.why ?? []).join(' '))) fail('Furoscix not excluded for anuria');
                    for (const n of ['Hydrochlorothiazide', 'Metolazone']) if (!/Anuria/.test((excl(n)?.why ?? []).join(' '))) fail(`${n} not excluded for anuria`);
                }
                if (t.includes('Furoscix CKD Without Anuria Offered With Caution')) {
                    const why = (excl(FSX)?.why ?? []).join(' ');
                    if (excl(FSX) && /eGFR/.test(why)) fail('Furoscix still excluded by an eGFR rule (CKD is an indication; the label contraindication is anuria)');
                    if (med(FSX).renal_adjustment?.(12, P)?.caution !== true) fail('Furoscix low-eGFR caution lost');
                }
                if (t.includes('Thiazide Add-On Credit And Gout Caution')) {
                    for (const [name, dose] of [['Metolazone', 2.5], ['Chlorthalidone', 25], ['Hydrochlorothiazide', 25]] as const) {
                        const add = rmed(name, dose, 'qd');
                        const { kg, sim } = kgLost([{ action: 'add', target: add, summary: 'x' }]);
                        if (Math.abs(kg - 1.1) > 1e-6) fail(`${name} add-on credit is ${kg.toFixed(3)} kg, not the CLOROTIC 1.1 kg`);
                        const withDrug = { ...P, current_regimen: [...P.current_regimen, add] };
                        const kept = simulateModificationEffect(withDrug, { modifications: withDrug.current_regimen.map(r => ({ action: 'keep' as const, source: r, summary: 'k' })), resulting_regimen: withDrug.current_regimen }, scenarioPrices);
                        if (!kept.specialFeatureItems.some(i => i.med === name && /Gout/.test(i.feature) && i.points === -5)) fail(`${name} carries no gout caution (-5) for a patient with gout`);
                        if (!med(name).facts?.raises_uric_acid) fail(`${name} does not declare facts.raises_uric_acid`);
                        void sim;
                    }
                    for (const n of ['Chlorthalidone', 'Hydrochlorothiazide', 'Metolazone']) {
                        if (!(med(n).side_effects(25).worsening_renal_function > 0.28)) fail(`${n} side effects lack worsening renal function (CLOROTIC 46.5% vs 17.2%)`);
                    }
                    if (!(med('Metolazone').side_effects(5).hyponatremia > 0)) fail('Metolazone side effects lack hyponatremia');
                }
                if (t.includes('HCTZ eGFR 25 Cautioned Not Excluded')) {
                    if (excl('Hydrochlorothiazide')) fail('HCTZ excluded at eGFR 25 (verified-diuretics.md: a caution, not a contraindication)');
                    if (med('Hydrochlorothiazide').renal_adjustment?.(25, P)?.caution !== true) fail('HCTZ at eGFR 25 carries no renal caution');
                    const low = { ...P, egfr: 12 };
                    if (!med('Hydrochlorothiazide').contraindications?.(low)) fail('HCTZ at eGFR 12 not excluded (below the range CLOROTIC studied; engine-conservative)');
                }
                if (t.includes('Metolazone Electrolyte Monitoring')) {
                    if (!monitoringPlan.some(m => /Basic metabolic panel/.test(m.test) && /hyponatremia and\/or hypokalemia/.test(m.details) && /practice-based/.test(m.timing))) fail('Metolazone carries no electrolyte (BMP) monitoring item that labels its day count practice-based');
                    const add = rmed('Metolazone', 2.5, 'qd');
                    const lowK = simulateModificationEffect(P, { modifications: [{ action: 'add', target: add, summary: 'x' }], resulting_regimen: [...P.current_regimen, add] }, scenarioPrices);
                    if (!lowK.warnings.some(w => w.startsWith('HYPOKALEMIA CAUTION'))) fail('Adding metolazone at K+ 3.4 raised no hypokalemia caution');
                    const okK = simulateModificationEffect({ ...P, potassium: 4.3 }, { modifications: [{ action: 'add', target: add, summary: 'x' }], resulting_regimen: [...P.current_regimen, add] }, scenarioPrices);
                    if (okK.warnings.some(w => w.startsWith('HYPOKALEMIA CAUTION'))) fail('Hypokalemia caution fired at K+ 4.3');
                    if (med('Metolazone').contraindications?.({ ...P, potassium: 3.0 })) fail('Metolazone excluded by potassium (the label has no potassium contraindication; this is a penalized caution)');
                }
                if (t.includes('Low eGFR Loop Response Note And Titration')) {
                    if (!monitoringPlan.some(m => /Loop diuretic response in advanced CKD/.test(m.test) && /higher doses are usually needed/.test(m.details))) fail('No low-eGFR higher-dose note for the loop');
                    if (!mods.some(x => x.m.action === 'titrate_up' && x.m.source?.med.drug_class === 'Loop Diuretic')) fail('No loop up-titration candidate at eGFR 24');
                }
                if (t.includes('Formulary Strengths And Badges')) {
                    const strengths = (n: string) => med(n).available_doses.map(d => Number(d.strength));
                    if (JSON.stringify(strengths('Torsemide')) !== JSON.stringify([5, 10, 20, 40, 100])) fail(`Torsemide strengths are ${strengths('Torsemide')} (expected 5/10/20/40/100)`);
                    if (!strengths('Hydrochlorothiazide').includes(12.5)) fail('HCTZ lacks 12.5 mg');
                    if (JSON.stringify(strengths('Metolazone')) !== JSON.stringify([2.5, 5, 10])) fail(`Metolazone strengths are ${strengths('Metolazone')}`);
                    if (!/below the labeled HF range/.test(med('Metolazone').available_doses[0].formulation)) fail('Metolazone 2.5 mg is not labeled below the labeled HF range');
                    if (!/2 x 80/.test(med('Furosemide').available_doses.find(d => d.strength === 160)!.formulation)) fail('Furosemide 160 mg is not shown as 2 x 80 mg tablets');
                    if (med('Torsemide').is_best_in_class) fail('Torsemide still carries the best-in-class badge (TRANSFORM-HF: no mortality difference)');
                    for (const n of ['Carvedilol', 'Metoprolol Succinate', 'Tirzepatide (Zepbound)']) if (med(n).is_best_in_class) fail(`${n} still carries a best-in-class badge no verified source supports`);
                    if (!('renal_worsening' in med('Torsemide').side_effects(20))) fail('Torsemide side effects lack renal worsening');
                    const fsx = med(FSX);
                    if (fsx.facts?.oral_equivalent_multiplier !== 2) fail('Furoscix oral-equivalent multiplier is not 2.0');
                    if (Math.abs(fsx.chf_effects(80).weight_reduction_kg - med('Furosemide').chf_effects(160).weight_reduction_kg) > 1e-9) fail('Furoscix 80 mg SC is not credited as 160 mg oral furosemide');
                    for (const n of ['Furosemide', 'Torsemide', 'Bumetanide']) if (!med(n).facts?.max_daily_dose) fail(`${n} declares no max_daily_dose`);
                    if (med('Furosemide').facts!.max_daily_dose !== 600 || med('Torsemide').facts!.max_daily_dose !== 200 || med('Bumetanide').facts!.max_daily_dose !== 10) fail('Declared maximum daily doses are not furosemide 600 / torsemide 200 / bumetanide 10 mg');
                }
                void noSgltSynergy;
            }

            // ===== Rate control source-verified corrections (verified-rate-control.md; labels: Coreg, metoprolol succinate ER, bisoprolol, Corlanor, Lanoxin; MOCHA, COMET, SHIFT, DIG) =====
            if (scenario.title.includes('Rate-Source')) {
                const excl = (name: string) => excludedMedications.find(e => e.name === name);
                const whyText = (name: string) => (excl(name)?.why ?? []).join(' | ');
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const mods = scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).map(m => ({ r, m })));
                const summaries = mods.map(x => x.m.summary);
                const strengthsOf = (name: string) => scoredRegimens.flatMap(r => r.regimen.filter(m => m.med.name === name).map(m => Number(m.dose.strength)));
                const warningsOf = (name: string) => scoredRegimens.filter(r => r.regimen.some(m => m.med.name === name)).map(r => (r.warnings ?? []).join(' | '));
                const adjunctSurfaced = (frag: string) => (eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes(frag));
                const med = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
                const BETA_BLOCKERS = ['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol'];
                const anyBb = () => scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'Beta Blocker'));
                const bradyAlert = (name: string) => clinicalAlerts.find(a => a.startsWith(`BRADYCARDIA ON ${name}`));

                // --- Beta-blockers: heart rate on established therapy is dose reduction, not removal ---
                const oneStep = (name: string, from: number, to: number, hr: number) => {
                    if (scoredRegimens.length === 0) fail(`No regimens at HR ${hr} on ${name} ${from} (check is vacuous)`);
                    if (scoredRegimens.some(r => !r.regimen.some(m => m.med.name === name && Number(m.dose.strength) === to))) fail(`${name} ${from} at HR ${hr} must drop ONE step to ${to} in every option (not be removed, kept, or cut further)`);
                    if (!summaries.some(x => x.startsWith(`Reduce ${name} ${from}→${to}`) && x.includes(`${hr} bpm`))) fail(`Reduction of ${name} does not state the heart rate ${hr}`);
                    if (summaries.some(x => x.startsWith(`Remove ${name}`))) fail(`${name} removed at HR ${hr} (verified-rate-control.md: bradycardia on established therapy is a dose reduction, not removal)`);
                    const al = bradyAlert(name.toUpperCase());
                    if (!al || !al.includes(`${hr} bpm`)) fail(`No bradycardia alert naming the heart rate ${hr} for ${name}`);
                    if (!scoredRegimens.some(r => r.regimen.some(m => m.med.drug_class === 'Beta Blocker'))) fail('Beta-blocker pillar lost');
                };
                if (t.includes('Carvedilol 25 mg HR 54 One-Step Reduction')) {
                    oneStep('Carvedilol', 25, 12.5, 54);
                    for (const n of ['Metoprolol Succinate', 'Bisoprolol']) {
                        if (excl(n)?.rule_id !== 'E13' || !/START/.test(whyText(n))) fail(`${n} (a NEW start) not blocked at HR 54 with the initiation reason`);
                    }
                }
                if (t.includes('Metoprolol Succinate 100 mg HR 52')) oneStep('Metoprolol Succinate', 100, 50, 52);
                if (t.includes('Bisoprolol 10 mg HR 53')) oneStep('Bisoprolol', 10, 5, 53);
                if (t.includes('Carvedilol 3.125 mg HR 50 Withheld')) {
                    if (strengthsOf('Carvedilol').length > 0) fail('Carvedilol 3.125 mg (lowest dose) kept at HR 50: it must be withheld');
                    if (!summaries.some(x => x.startsWith('Remove Carvedilol') && x.includes('50 bpm') && x.includes('lowest'))) fail('Withhold at the lowest dose does not state the heart rate and the reason');
                    if (!bradyAlert('CARVEDILOL')) fail('No bradycardia alert for the withheld beta-blocker');
                }
                if (t.includes('Third-Degree AV Block Beta-Blocker Removed')) {
                    if (anyBb()) fail('Beta-blocker kept with third-degree AV block and no pacemaker');
                    if (!summaries.some(x => x.startsWith('Remove Carvedilol') && x.includes('contraindicated'))) fail('Carvedilol not removed as contraindicated in third-degree AV block');
                    if (!/Third-degree/.test(whyText('Carvedilol'))) fail('Carvedilol exclusion does not state third-degree AV block');
                    if (bradyAlert('CARVEDILOL')) fail('Bradycardia dose-reduction alert shown for a beta-blocker that is being removed for AV block');
                }
                if (t.includes('Sick Sinus Syndrome Without Pacemaker')) {
                    if (anyBb()) fail('Beta-blocker kept with sick sinus syndrome and no pacemaker (labeled contraindication)');
                    if (!summaries.some(x => x.startsWith('Remove Metoprolol Succinate') && x.includes('contraindicated'))) fail('Metoprolol succinate not removed for sick sinus syndrome');
                    for (const n of BETA_BLOCKERS) if (!/Sick sinus/.test(whyText(n))) fail(`${n} exclusion does not state sick sinus syndrome`);
                }
                if (t.includes('Paced Rhythm HR 52 Beta-Blocker Kept')) {
                    if (scoredRegimens.length === 0) fail('No regimens (check is vacuous)');
                    if (scoredRegimens.some(r => !r.regimen.some(m => m.med.name === 'Carvedilol' && Number(m.dose.strength) === 12.5))) fail('Carvedilol 12.5 not kept in a paced rhythm at HR 52 (a pacemaker sets a floor; the intrinsic-rate rules do not apply)');
                    if (bradyAlert('CARVEDILOL')) fail('Bradycardia alert shown in a paced rhythm');
                    if (excl('Carvedilol')) fail('Carvedilol excluded in a paced rhythm with sick sinus syndrome');
                }
                if (t.includes('No Up-Titration At HR 56')) {
                    if (scoredRegimens.length === 0) fail('No regimens (check is vacuous)');
                    if (summaries.some(x => x.startsWith('Titrate Carvedilol'))) fail('Carvedilol up-titration offered at HR 56 (policy: none below 60)');
                    if (strengthsOf('Carvedilol').some(x => x > 12.5)) fail('A carvedilol dose above the current 12.5 mg appears at HR 56');
                    if (!anyRegimenHasMed('Carvedilol')) fail('Carvedilol not retained at HR 56 (above the 55 reduction threshold)');
                }
                if (t.includes('Up-Titration Offered At HR 66')) {
                    if (!summaries.some(x => x.startsWith('Titrate Carvedilol'))) fail('Carvedilol up-titration not offered at HR 66 (positive control for the HR 56 rule)');
                }
                if (t.includes('New Beta-Blocker Start Blocked At HR 52')) {
                    for (const n of BETA_BLOCKERS) {
                        if (excl(n)?.rule_id !== 'E13' || !/START/.test(whyText(n))) fail(`${n} new start not blocked at HR 52 with the initiation reason`);
                    }
                    if (anyBb()) fail('A beta-blocker START offered at HR 52');
                }
                if (t.includes('Beta-Blocker Dose Effects Equalized')) {
                    const c = med('Carvedilol'), m = med('Metoprolol Succinate'), b = med('Bisoprolol');
                    const eq = (a: number | undefined, x: number | undefined) => Math.abs((a ?? 0) - (x ?? 0)) < 1e-9;
                    const c25 = c.chf_effects(25), c50 = c.chf_effects(50);
                    for (const k of Object.keys(c25) as (keyof typeof c25)[]) {
                        if (!eq(c25[k], c50[k])) fail(`Carvedilol 50 mg modeled ${k} differs from 25 mg (MOCHA tested up to 25 mg BID; no extra efficacy above it)`);
                    }
                    const h25 = c.hemodynamic_effects(25), h50 = c.hemodynamic_effects(50);
                    if (!(h50.sbp_drop > h25.sbp_drop && h50.hr_drop > h25.hr_drop)) fail('Carvedilol 50 mg must still lower BP and heart rate more than 25 mg (dose-related hemodynamics)');
                    const tc = c.chf_effects(25), tm = m.chf_effects(200), tb = b.chf_effects(10);
                    for (const k of Object.keys(tc) as (keyof typeof tc)[]) {
                        if (!eq(tc[k], tm[k]) || !eq(tc[k], tb[k])) fail(`Beta-blockers differ in modeled ${k} at target dose (carvedilol ${tc[k]}, metoprolol ${tm[k]}, bisoprolol ${tb[k]}): no evidence of superiority (COMET used metoprolol tartrate)`);
                    }
                }
                if (t.includes('Carvedilol Child-Pugh B Confirmed Allowed')) {
                    if (excl('Carvedilol')) fail('Carvedilol excluded with Child-Pugh B confirmed (label contraindicates only severe hepatic impairment)');
                    if (warningsOf('Carvedilol').some(w => !w.includes('Hepatic Impairment'))) fail('Carvedilol regimen at Child-Pugh B lacks the hepatic caution warning');
                }
                if (t.includes('Child-Pugh B/C Unspecified Excluded Metoprolol Allowed')) {
                    if (excl('Carvedilol')?.rule_id !== 'E13' || !/Child-Pugh/.test(whyText('Carvedilol'))) fail('Carvedilol not excluded when liver severity is unspecified');
                    if (excl('Metoprolol Succinate')) fail('Metoprolol succinate excluded for liver disease (the label has no hepatic contraindication; caution only)');
                    if (warningsOf('Metoprolol Succinate').some(w => !w.includes('Hepatic Impairment'))) fail('Metoprolol regimen with liver disease lacks the hepatic caution');
                }
                if (t.includes('Bisoprolol US Tiers')) {
                    const d = med('Bisoprolol').available_doses;
                    if (d.some(x => x.strength === 1.25)) fail('Bisoprolol 1.25 mg tier present (not a US single-agent tablet; a quarter tablet is impractical)');
                    if (d.map(x => x.strength).join(',') !== '2.5,5,10') fail('Bisoprolol tiers must be 2.5 (half of a scored 5 mg tablet), 5, 10');
                    if (!d.find(x => x.strength === 2.5)?.formulation.includes('half')) fail('Bisoprolol 2.5 mg not labelled as half of a scored 5 mg tablet');
                    if (!(med('Bisoprolol').facts?.regimen_warnings ?? []).some(w => typeof w.text === 'string' && /off-label/.test(w.text))) fail('Bisoprolol lacks the off-label heart-failure note');
                }

                // --- Ivabradine ---
                if (t.includes('Ivabradine Strong CYP3A4 Inhibitor Excluded') || t.includes('Ivabradine Telithromycin Excluded')) {
                    if (excl('Ivabradine')?.rule_id !== 'E13' || !/strong CYP3A4/i.test(whyText('Ivabradine'))) fail('Ivabradine not excluded (E13) with a strong CYP3A4 inhibitor reason (Corlanor contraindication)');
                    if (anyRegimenHasMed('Ivabradine') || adjunctSurfaced('ivabradine')) fail('Ivabradine offered or surfaced despite a strong CYP3A4 inhibitor');
                }
                if (t.includes('Ivabradine With Diltiazem Warned')) {
                    const w = warningsOf('Ivabradine');
                    if (w.length === 0) fail('No regimen with ivabradine (check is vacuous)');
                    if (w.some(x => !/Ivabradine with verapamil or diltiazem/.test(x))) fail('Ivabradine with diltiazem lacks the "avoid" warning (Corlanor label)');
                }
                if (t.includes('Ivabradine Inducer Warned')) {
                    const w = warningsOf('Ivabradine');
                    if (w.length === 0) fail('No regimen with ivabradine (check is vacuous)');
                    if (w.some(x => !/CYP3A4 inducer/.test(x))) fail('Ivabradine with rifampin lacks the CYP3A4-inducer "avoid" warning');
                }
                if (t.includes('Ivabradine Continuation HR 58 Keeps Drug And Bonus')) {
                    if (scoredRegimens.length === 0) fail('No regimens (check is vacuous)');
                    if (excl('Ivabradine')) fail('Ivabradine excluded at HR 58 although already on it (HR >= 70 gates initiation only)');
                    if (scoredRegimens.some(r => !r.regimen.some(m => m.med.name === 'Ivabradine'))) fail('Ivabradine dropped at HR 58 (the label target is 50-60 bpm)');
                    if (summaries.some(x => x.includes('Ivabradine') && (x.startsWith('Remove') || x.startsWith('Reduce') || x.startsWith('Titrate')))) fail('Ivabradine changed at HR 58 (hold at 50-60 per label)');
                    const bonus = scoredRegimens.filter(r => r.regimen.some(m => m.med.name === 'Ivabradine')).every(r => (r.score_breakdown?.adjustments ?? []).some(a => (a.items ?? []).some(i => i.feature.startsWith('SHIFT'))));
                    if (!bonus) fail('Ivabradine evidence bonus missing for a patient already on it at HR 58');
                }
                if (t.includes('Ivabradine HR 48 On 5 mg Reduced To 2.5 mg')) {
                    if (scoredRegimens.some(r => !r.regimen.some(m => m.med.name === 'Ivabradine' && Number(m.dose.strength) === 2.5))) fail('Ivabradine 5 mg at HR 48 must drop to 2.5 mg in every option (label: reduce by 2.5 mg bid below 50)');
                    if (!summaries.some(x => x.startsWith('Reduce Ivabradine 5→2.5') && x.includes('48 bpm'))) fail('Ivabradine reduction does not state the heart rate');
                    if (!bradyAlert('IVABRADINE')) fail('No bradycardia alert for ivabradine');
                }
                if (t.includes('Ivabradine HR 48 On 2.5 mg Withheld')) {
                    if (anyRegimenHasMed('Ivabradine')) fail('Ivabradine 2.5 mg kept at HR 48 (label: stop if already at 2.5 mg bid)');
                    if (!summaries.some(x => x.startsWith('Remove Ivabradine') && x.includes('lowest'))) fail('Ivabradine withhold does not state the reason');
                }
                if (t.includes('Ivabradine Start Tier 5 mg') || t.includes('Ivabradine Start Tier 2.5 mg')) {
                    const want = t.includes('2.5 mg') ? 2.5 : 5;
                    const starts = mods.filter(x => x.m.action === 'add' && x.m.target?.med.name === 'Ivabradine').map(x => Number(x.m.target!.dose.strength));
                    if (starts.length === 0) fail('Ivabradine not offered as a new start (check is vacuous)');
                    if (starts.some(x => x !== want)) fail(`Ivabradine start must be ${want} mg bid (found ${starts.join(', ')}); label: 2.5 mg bid only for conduction defects / bradycardia risk`);
                }
                if (t.includes('Ivabradine Beta-Blocker Limited By Hypotension')) {
                    if (excl('Ivabradine')) fail('Ivabradine excluded for a patient whose beta-blocker is limited by hypotension');
                    if (!anyRegimenHasMed('Ivabradine') && !adjunctSurfaced('ivabradine')) fail('Ivabradine not offered when the beta-blocker cannot be increased (maximally tolerated, not necessarily target)');
                }
                if (t.includes('Ivabradine Beta-Blocker Not Maximized Not Offered')) {
                    if (anyRegimenHasMed('Ivabradine') || adjunctSurfaced('ivabradine')) fail('Ivabradine offered while the beta-blocker can still be up-titrated (carvedilol 6.25)');
                }
                if (t.includes('Ivabradine Sick Sinus Syndrome Excluded') && !/Sick sinus/.test(whyText('Ivabradine'))) fail('Ivabradine exclusion does not state sick sinus syndrome');
                if (t.includes('Ivabradine Acute Decompensation Excluded') && !/Acute decompensated/.test(whyText('Ivabradine'))) fail('Ivabradine exclusion does not state acute decompensated HF');
                if (t.includes('Ivabradine Hepatic') && !/ivabradine.*Child-Pugh C/.test(whyText('Ivabradine'))) fail('Ivabradine exclusion does not state the hepatic contraindication');
                if (t.includes('Ivabradine Paced Rhythm Excluded') && !/Paced/.test(whyText('Ivabradine'))) fail('Ivabradine exclusion does not state the paced rhythm (pacemaker dependence)');
                if (t.includes('Ivabradine Metadata')) {
                    const iv = med('Ivabradine');
                    if (iv.chf_effects(5).kccq_improvement !== 2) fail('Ivabradine KCCQ must be 2 (SHIFT QoL +1.8 / +2.4)');
                    if (iv.hemodynamic_effects(5).hr_drop !== 10) fail('Ivabradine heart-rate effect must be about 10 bpm (SHIFT placebo-corrected)');
                    if (iv.available_doses.map(d => d.strength).join(',') !== '2.5,5,7.5') fail('Ivabradine tiers must be 2.5, 5, 7.5 mg bid');
                    if (!iv.available_doses.filter(d => d.strength !== 2.5).every(d => d.is_target_dose)) fail('Ivabradine 5 and 7.5 mg bid must both be acceptable maintenance doses (heart-rate guided)');
                    if (DRUG_PRICES['Ivabradine'].generic_available !== true || DRUG_PRICES['Ivabradine'].tier !== 'generic') fail('Ivabradine must be flagged generic (DailyMed lists generic labelers)');
                    if (!(iv.special_features ?? []).every(f => f.feature.includes('2a') && !f.feature.includes('IIb'))) fail('Ivabradine guideline class must read AHA/ACC 2022 Class 2a (not IIb)');
                }

                // --- Digoxin ---
                if (t.includes('Digoxin Sinus Rhythm Not Offered While Pillars Remain Addable')) {
                    if (anyRegimenHasMed('Digoxin') || adjunctSurfaced('digoxin')) fail('Digoxin offered in sinus rhythm while an MRA pillar is still addable (Class 2b only after maximal GDMT)');
                    if (excl('Digoxin')) fail('Digoxin wrongly excluded (it is an indication gate, not a contraindication)');
                }
                if (t.includes('Digoxin Sinus Rhythm Offered After Maximal GDMT') && !adjunctSurfaced('digoxin')) fail('Digoxin not surfaced for symptomatic HFrEF (NYHA III) in sinus rhythm on maximal GDMT (Class 2b)');
                if (t.includes('Digoxin Sinus Rhythm Preserved EF Not Offered') && (anyRegimenHasMed('Digoxin') || adjunctSurfaced('digoxin'))) fail('Digoxin offered at LVEF 58 in sinus rhythm');
                if (t.includes('Digoxin Ventricular Fibrillation Excluded')) {
                    if (excl('Digoxin')?.rule_id !== 'E13' || !/Ventricular fibrillation/.test(whyText('Digoxin'))) fail('Digoxin not excluded for ventricular fibrillation (labeled contraindication)');
                    if (anyRegimenHasMed('Digoxin')) fail('Digoxin offered with ventricular fibrillation');
                }
                if (t.includes('Digoxin WPW Warning')) {
                    const w = warningsOf('Digoxin');
                    if (w.length === 0) fail('No regimen with digoxin (check is vacuous)');
                    if (w.some(x => !/accessory pathway/i.test(x))) fail('Digoxin with Wolff-Parkinson-White lacks the accessory-pathway warning (Lanoxin 5.1)');
                    if (excl('Digoxin')) fail('Digoxin excluded for WPW (the label lists a warning, not a contraindication)');
                }
                if (t.includes('Digoxin Potassium 5.8')) {
                    if (excl('Digoxin')) fail('Digoxin excluded at K+ 5.8 (the label has no potassium contraindication; now a warning)');
                    const w = warningsOf('Digoxin');
                    if (w.length === 0) fail('No regimen with digoxin (check is vacuous)');
                    if (w.some(x => !x.includes('Potassium above 5.5'))) fail('Digoxin at K+ 5.8 lacks the potassium warning');
                }
                if (t.includes('Digoxin eGFR 12')) {
                    if (excl('Digoxin')) fail('Digoxin excluded at eGFR 12 (the label dosing table includes CrCl 10; now a dosing warning)');
                    if (strengthsOf('Digoxin').some(x => x > 62.5)) fail('Digoxin above 62.5 mcg at eGFR 12');
                    const w = warningsOf('Digoxin');
                    if (w.length === 0) fail('No regimen with digoxin (check is vacuous)');
                    if (w.some(x => !x.includes('eGFR below 15'))) fail('Digoxin at eGFR 12 lacks the renal dosing warning');
                }
                if (t.includes('Digoxin Amiodarone Dose Reduction Text')) {
                    const w = warningsOf('Digoxin');
                    if (w.length === 0) fail('No regimen with digoxin (check is vacuous)');
                    if (w.some(x => !x.includes('30-50%'))) fail('Digoxin + amiodarone warning must say to reduce the digoxin dose by about 30-50% (Lanoxin label)');
                }
                if (t.includes('Digoxin Heart-Rate Effect Only In AFib')) {
                    const dig = med('Digoxin');
                    if (dig.chf_effects(125).bnp_reduction_percent !== 0) fail('Digoxin NT-proBNP effect must be 0 (no source)');
                    const target = { med: dig, dose: dig.available_doses[1], selected_frequency: 'qd' };
                    const pulseAfter = (rhythm: 'Sinus' | 'AFib') => {
                        const p = clonePatient(scenario.patient); p.rhythm = rhythm; p.pulse = 90;
                        const ms = { modifications: [{ action: 'add' as const, target, summary: 'Add Digoxin' }], resulting_regimen: [...(p.current_regimen ?? []), target] };
                        return simulateModificationEffect(p, ms, scenarioPrices).projectedPatient.pulse;
                    };
                    if (pulseAfter('Sinus') !== 90) fail('Digoxin lowers heart rate in sinus rhythm in the model (credited only in AFib)');
                    if (!(pulseAfter('AFib') < 90)) fail('Digoxin does not lower heart rate in AFib in the model');
                }
            }

            // ===== Laboratory prerequisite (E16): potassium and renal function required before RAAS/MRA new starts / increases =====
            if (scenario.title.includes('Lab-Prereq')) {
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const P = scenario.patient;
                const isRaasMra = (c: string) => RAAS_CLASSES.has(c) || c === 'MRA' || c === 'nsMRA';
                const labsBlank = t.includes('Blank');
                const e16 = excludedMedications.filter(e => e.rule_id === 'E16');
                const allMods = scoredRegimens.flatMap(r => r.modification_set?.modifications ?? []);
                const hasLabAlert = clinicalAlerts.some(a => a.startsWith('LABS REQUIRED'));
                const classesOffered = new Set(scoredRegimens.flatMap(r => r.regimen.map(x => x.med.drug_class)));
                if (scoredRegimens.length === 0) fail('No regimen displayed');
                if (!labsBlank) {
                    if (e16.length > 0) fail('E16 fired with both labs present');
                    if (hasLabAlert) fail('LABS REQUIRED alert shown with both labs present');
                    if (!allMods.some(m => (m.action === 'titrate_up') && m.target && isRaasMra(m.target.med.drug_class)) &&
                        !allMods.some(m => (m.action === 'add' || m.action === 'swap') && m.target && isRaasMra(m.target.med.drug_class))) {
                        fail('With both labs present the engine offered no RAAS/MRA intensification (expected unchanged behavior)');
                    }
                } else {
                    if (!hasLabAlert) fail('No LABS REQUIRED alert with a blank laboratory prerequisite');
                    if (clinicalAlerts.filter(a => a.startsWith('LABS REQUIRED')).length !== 1) fail('LABS REQUIRED alert must appear exactly once');
                    // No RAAS/MRA add, swap-to or increase in ANY displayed regimen.
                    const bad = allMods.filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target && isRaasMra(m.target.med.drug_class));
                    if (bad.length > 0) fail(`RAAS/MRA intensification displayed with blank labs: ${bad.map(m => m.summary).join('; ')}`);
                    // Every formulary RAAS/MRA drug the patient is not on is withheld, by E16 (or E12/E13/E14 for a more specific reason).
                    const currentNames = new Set((P.current_regimen ?? []).map(r => r.med.name));
                    for (const m of MEDICATION_FORMULARY.filter(x => isRaasMra(x.drug_class) && !currentNames.has(x.name))) {
                        const ex = excludedMedications.find(e => e.name === m.name);
                        if (!ex) fail(`${m.name} (new RAAS/MRA start) was not withheld with blank labs`);
                        else if (!['E12', 'E13', 'E14', 'E16'].includes(ex.rule_id ?? '')) fail(`${m.name} withheld by unexpected rule ${ex.rule_id}`);
                    }
                    if (e16.length === 0) fail('No E16 exclusion with blank labs');
                    for (const e of e16) {
                        if (!(e.why && e.why.length > 0)) fail(`E16 exclusion for ${e.name} has no details line`);
                        const wantK = P.potassium === 0, wantR = P.egfr === 0;
                        if (wantK && !/potassium/.test(e.reason)) fail('E16 reason does not name potassium');
                        if (wantR && !/renal/.test(e.reason)) fail('E16 reason does not name renal function');
                        if (!wantK && /potassium/.test(e.reason)) fail('E16 reason names potassium although it is entered');
                    }
                    // Other classes stay available: a beta-blocker or SGLT2i remains in the displayed plans for naive patients.
                    if (t.includes('Naive')) {
                        if (P.egfr === 0) {
                            // Renal-gated SGLT2i new starts are withheld by the existing E12 (unchanged), never relabeled E16.
                            const sg = excludedMedications.filter(e => e.drug_class === 'SGLT2i');
                            if (sg.some(e => e.rule_id === 'E16')) fail('An SGLT2 inhibitor was withheld by E16 (not in scope)');
                            if (sg.length > 0 && !sg.every(e => e.rule_id === 'E12')) fail('Renal-gated SGLT2i start under blank eGFR no longer reports E12');
                        } else if (!classesOffered.has('SGLT2i')) fail('SGLT2 inhibitor not offered for a treatment-naive patient with blank potassium (only RAAS/MRA should be withheld)');
                        if (!classesOffered.has('Beta Blocker')) fail('Beta-blocker not offered for a treatment-naive patient with blank labs');
                    }
                    if (t.includes('Naive') && classesOffered.size > 0 && [...classesOffered].some(c => isRaasMra(c))) fail('A treatment-naive blank-lab plan contains a RAAS/MRA drug');
                    if (t.includes('Lisinopril')) {
                        // Lisinopril is kept (never removed or swapped out), not up-titrated, and no ARNI swap.
                        if (allMods.some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === 'Lisinopril')) fail('Lisinopril removed/swapped because a lab is blank');
                        if (!scoredRegimens.every(r => r.regimen.some(x => x.med.name === 'Lisinopril' && Number(x.dose.strength) === 10))) fail('Not every displayed regimen keeps lisinopril 10 mg');
                        if (classesOffered.has('ARNI')) fail('ARNI offered with blank labs');
                        if (excludedMedications.some(e => e.name === 'Lisinopril')) fail('Lisinopril (current drug) is listed as excluded');
                    }
                }
            }

            // ===== Final engine gaps: daily-dose target, one-step titration, MRA K+ up-titration gate, equivalent loop swaps =====
            if (scenario.title.includes('Final-Gaps')) {
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const P = scenario.patient;
                const med = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
                const analysis = analyzeCurrentRegimen(P, MEDICATION_FORMULARY, MEDICATION_FORMULARY.flatMap(m => getDoseTiers(m, P)));
                const upOf = (name: string) => (analysis.titratableUp.find(x => x.current.med.name === name)?.options ?? []);
                const rm = (name: string, strength: number | string, freq: string): RegimenMed => ({ med: med(name), dose: med(name).available_doses.find(d => String(d.strength) === String(strength))!, selected_frequency: freq });

                if (t.includes('Ramipril 5 mg bid Counts As Target')) {
                    if (!isTargetDoseForPatient(rm('Ramipril', 5, 'bid'), P)) fail('Ramipril 5 mg twice daily (10 mg/day) is not recognized as the target dose');
                    if (!isTargetDoseForPatient(rm('Ramipril', 10, 'qd'), P)) fail('Ramipril 10 mg once daily is not the target dose');
                    if (isTargetDoseForPatient(rm('Ramipril', 5, 'qd'), P)) fail('Ramipril 5 mg once daily (5 mg/day) wrongly counted as target');
                    if (isTargetDoseForPatient(rm('Ramipril', 2.5, 'bid'), P)) fail('Ramipril 2.5 mg twice daily (5 mg/day) wrongly counted as target');
                    if (upOf('Ramipril').length > 0) fail('Ramipril 5 mg bid (already 10 mg/day) is offered an up-titration that does not raise the daily dose');
                    // Every other formulary entry with more than one frequency option is dosed by total daily dose and is not target-dosed, or declares a daily target.
                    for (const m of MEDICATION_FORMULARY) {
                        const multi = m.available_doses.some(d => d.frequency_options.length > 1);
                        const targeted = m.available_doses.some(d => d.is_target_dose) || !!m.is_target_dose_for;
                        if (multi && targeted && m.facts?.target_daily_dose === undefined) fail(`${m.name} offers more than one frequency and has a target dose but declares no facts.target_daily_dose`);
                    }
                }
                if (t.includes('Ramipril 5 mg bid eGFR 40 Exceeds Renal Cap')) {
                    // The label renal maximum (5 mg/day at eGFR < 45) is a TOTAL DAILY dose: 5 mg twice daily is 10 mg/day.
                    const hit = renalCapExceeded(rm('Ramipril', 5, 'bid'), P);
                    if (!hit || hit.basis !== 'daily' || hit.cap !== 5 || hit.amount !== 10) fail('Ramipril 5 mg bid at eGFR 40 is not flagged against the 5 mg/day renal maximum on a total-daily-dose basis');
                    if (renalCapExceeded(rm('Ramipril', 2.5, 'bid'), P)) fail('Ramipril 2.5 mg bid (5 mg/day) flagged although it is at the cap');
                    if (renalCapExceeded(rm('Ramipril', 5, 'qd'), P)) fail('Ramipril 5 mg qd flagged although it is at the cap');
                    if (renalCapExceeded(rm('Ramipril', 10, 'qd'), P) === null) fail('Ramipril 10 mg qd (above the renal cap) is not flagged');
                    if (effectDose(rm('Ramipril', 5, 'bid')) !== effectDose(rm('Ramipril', 10, 'qd'))) fail('Ramipril 5 mg bid and 10 mg qd (both 10 mg/day) are not evaluated at the same effect dose');
                    // Every displayed regimen reduces ramipril to at most 5 mg/day, never keeps 5 mg bid, and never raises it.
                    if (scoredRegimens.length === 0) fail('No regimen displayed');
                    for (const r of scoredRegimens) {
                        const ram = r.regimen.find(x => x.med.name === 'Ramipril');
                        if (ram && dailyDose(ram) > 5) fail(`A displayed regimen keeps ramipril at ${dailyDose(ram)} mg/day above the 5 mg/day renal maximum (${r.modification_set?.modifications.map(m => m.summary).join(' | ')})`);
                    }
                    if (!scoredRegimens.some(r => r.modification_set?.modifications.some(m => m.action === 'titrate_down' && m.source?.med.name === 'Ramipril' && /renal maximum/.test(m.summary)))) fail('No displayed regimen reduces ramipril with the renal-maximum reason');
                    if (upOf('Ramipril').length > 0) fail('Ramipril is offered an increase while above the renal cap');
                }
                if (t.includes('Ramipril 2.5 mg bid eGFR 40 At Renal Cap')) {
                    if (analysis.forcedReduceNames.has('Ramipril')) fail('Ramipril 2.5 mg bid at eGFR 40 (5 mg/day, at the cap) is force-reduced');
                    if (upOf('Ramipril').some(o => dailyDose(o) > 5)) fail('Ramipril offered an increase above the 5 mg/day renal maximum');
                }
                if (t.includes('Lisinopril 5 mg Offers 10 mg Next')) {
                    if (!upOf('Lisinopril').some(o => Number(o.dose.strength) === 10)) fail('Lisinopril 5 mg is not offered 10 mg as the next titration step');
                    const down = analysis.titratableDown.find(x => x.current.med.name === 'Lisinopril')?.options ?? [];
                    if (!down.some(o => Number(o.dose.strength) === 2.5)) fail('Lisinopril 5 mg is not offered 2.5 mg as the next step down');
                }
                if (t.includes('Spironolactone 25 mg Potassium 5.2 Not Increased')) {
                    if (upOf('Spironolactone').length > 0) fail('Spironolactone up-titration offered at potassium 5.2');
                    const alert = clinicalAlerts.find(a => a.startsWith('POTASSIUM HOLD ON SPIRONOLACTONE'));
                    if (!alert || !alert.includes('5.2') || !/not increased/.test(alert) || !/Engine policy/.test(alert)) fail('No plain potassium-hold alert (with the engine-policy basis) for spironolactone at potassium 5.2');
                    if (scoredRegimens.some(r => r.modification_set?.modifications.some(m => m.action === 'titrate_up' && m.target?.med.name === 'Spironolactone'))) fail('A displayed regimen up-titrates spironolactone at potassium 5.2');
                    if (analysis.forcedReduceNames.has('Spironolactone')) fail('Potassium 5.2 forces an MRA reduction (reduction starts at 5.5)');
                }
                if (t.includes('Finerenone 20 mg Potassium 5.1 Not Increased')) {
                    if (upOf('Finerenone (Kerendia)').length > 0) fail('Finerenone 20 mg is offered an increase at potassium 5.1 (label: increase to 40 mg only if potassium is below 5.0)');
                    if (!clinicalAlerts.some(a => a.startsWith('POTASSIUM HOLD ON FINERENONE') && a.includes('Kerendia label'))) fail('No finerenone potassium-hold alert citing the label');
                }
                if (t.includes('To Bumetanide Equivalent Daily Dose')) {
                    const swaps = analysis.swappable.find(x => x.from.med.name === 'Furosemide');
                    const bum = (swaps?.candidates ?? []).filter(c => c.med.name === 'Bumetanide');
                    if (bum.length !== 1) fail(`Expected exactly one bumetanide swap tier, found ${bum.length}`);
                    else if (dailyDose(bum[0]) !== 4) fail(`Furosemide 80 mg bid (160 mg/day) -> bumetanide must land at 4 mg/day (found ${dailyDose(bum[0])} mg/day: ${bum[0].dose.strength} ${bum[0].selected_frequency})`);
                    // nearest at or above: furosemide 40 mg bid (80/day) -> bumetanide 2 mg/day; 60 mg daily (60) -> 1.5 mg -> 2 mg nearest at or above
                    const from = (strength: number, f: string) => equivalentSwapTier(rm('Furosemide', strength, f), med('Bumetanide'), P, 1);
                    if (!from(40, 'bid') || dailyDose(from(40, 'bid')!) !== 2) fail('Furosemide 40 mg bid -> bumetanide is not 2 mg/day');
                    if (!from(20, 'qd') || dailyDose(from(20, 'qd')!) !== 0.5) fail('Furosemide 20 mg daily -> bumetanide is not 0.5 mg/day');
                    const back = equivalentSwapTier(rm('Bumetanide', 1, 'qd'), med('Furosemide'), P, 40);
                    if (!back || dailyDose(back) < 40 || dailyDose(back) > 40) fail('Bumetanide 1 mg daily -> furosemide is not 40 mg/day');
                    if (bum.length === 1 && !/equivalent total daily dose: 160 mg\/day Furosemide is about 4 mg\/day Bumetanide/.test(formatSwapSummary(rm('Furosemide', 80, 'bid'), bum[0]))) fail('Equivalent loop swap summary does not state the equivalent daily dose');
                }
                if (t.includes('To Torsemide Prescriber Converts')) {
                    const swaps = analysis.swappable.find(x => x.from.med.name === 'Furosemide');
                    const tor = (swaps?.candidates ?? []).filter(c => c.med.name === 'Torsemide');
                    if (tor.length === 0) fail('No torsemide swap offered (check is vacuous)');
                    // Torsemide equivalence is NOT verified (label opened, states none): the conservative lowest tier stays.
                    if (tor.length > 0 && Number(tor[0].dose.strength) !== 5) fail('Unverified torsemide swap no longer offers the lowest tier');
                    if (tor.length > 0 && !/prescriber must convert the dose/.test(formatSwapSummary(rm('Furosemide', 80, 'bid'), tor[0]))) fail('Unverified torsemide swap summary does not tell the prescriber to convert the dose');
                    if (equivalentSwapTier(rm('Furosemide', 80, 'bid'), med('Torsemide'), P, 1) !== null) fail('A torsemide equivalent dose is computed although no verified equivalence is declared');
                    if (med('Torsemide').facts?.verified_furosemide_equivalent_per_mg !== undefined) fail('Torsemide declares a verified equivalence without a recorded source');
                }
            }

            // ===== RAAS (ARNI / ACEi / ARB) source-verified corrections (verified-raas.md; labels: Entresto, Zestril, Vasotec, Cozaar; 2022 Table 14) =====
            if (scenario.title.includes('RAAS-Source')) {
                const ARNI = 'Sacubitril/Valsartan (Entresto)';
                const excl = (name: string) => excludedMedications.find(e => e.name === name);
                const whyText = (name: string) => (excl(name)?.why ?? []).join(' | ');
                const fail = (msg: string) => { failures.push(msg); scenarioPassed = false; };
                const t = scenario.title;
                const mods = scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).map(m => ({ r, m })));
                const startsOf = (name: string) => mods.filter(x => (x.m.action === 'add' || x.m.action === 'swap') && x.m.target?.med.name === name).map(x => String(x.m.target!.dose.strength));
                const allSummaries = mods.map(x => x.m.summary);
                const allWarnings = scoredRegimens.flatMap(r => r.warnings ?? []);

                if (t.includes('ARNI 24/26 Only') || t.includes('ARNI 24/26')) {
                    const s = startsOf(ARNI);
                    if (s.length === 0) fail('ARNI not offered as a new start (check is vacuous)');
                    if (s.some(x => x !== '24/26')) fail(`RAAS-naive ARNI start must be 24/26 only (found ${s.join(', ')}); 49/51 and 97/103 are reached by titration`);
                }
                if (t.includes('Target-Dose ACEi To ARNI Swap 49/51')) {
                    const s = startsOf(ARNI);
                    if (!s.includes('49/51')) fail(`Target-dose ACEi -> ARNI swap not offered at 49/51 (found ${s.join(', ') || 'none'})`);
                    if (s.includes('97/103')) fail('ARNI swap offered at 97/103');
                    if (!allSummaries.some(x => x.includes('WAIT 36 hours'))) fail('ACEi -> ARNI swap lacks the 36-hour washout instruction');
                    if (!allWarnings.some(w => w.includes('36-hour washout'))) fail('ACEi -> ARNI swap lacks the washout warning');
                    if (scoredRegimens.some(r => r.regimen.filter(m => RAAS_CLASSES.has(m.med.drug_class)).length > 1)) fail('A regimen holds ARNI and ACEi together (hard exclusion)');
                }
                if (t.includes('Low-Dose ACEi To ARNI Swap 24/26')) {
                    const s = startsOf(ARNI);
                    if (s.length === 0) fail('ARNI swap not offered (check is vacuous)');
                    if (s.some(x => x !== '24/26')) fail(`Low-dose ACEi -> ARNI swap must start at 24/26 (found ${s.join(', ')})`);
                }
                if (t.includes('ARNI To ACEi Washout')) {
                    const toAcei = mods.filter(x => x.m.action === 'swap' && x.m.source?.med.drug_class === 'ARNI' && x.m.target?.med.drug_class === 'ACEi');
                    if (toAcei.length === 0) fail('No ARNI -> ACEi swap produced (check is vacuous)');
                    if (toAcei.some(x => !x.m.summary.includes('WAIT 36 hours'))) fail('ARNI -> ACEi swap lacks the 36-hour washout instruction (Zestril label: mirror rule)');
                    if (toAcei.some(x => !x.r.warnings.some(w => w.includes('36-hour washout') && w.includes('last ARNI dose')))) fail('ARNI -> ACEi swap lacks the washout warning');
                }
                if (t.includes('Aliskiren With Diabetes')) {
                    for (const n of ['Sacubitril/Valsartan (Entresto)', 'Lisinopril', 'Enalapril', 'Ramipril', 'Captopril', 'Valsartan', 'Candesartan', 'Losartan']) {
                        if (!excl(n) || !/aliskiren/i.test(whyText(n))) fail(`${n} not excluded with the aliskiren + diabetes reason (Entresto / Zestril label section 4)`);
                    }
                    if (anyRegimenContainsAnyClass('ARNI', 'ACEi', 'ARB')) fail('A RAAS inhibitor is offered despite aliskiren in a patient with diabetes');
                }
                if (t.includes('Aliskiren Without Diabetes')) {
                    if (excl(ARNI) && /aliskiren/i.test(whyText(ARNI))) fail('Aliskiren exclusion fired without diabetes (the label contraindication is diabetes-specific)');
                }
                if (t.includes('Losartan 150 Counts As Target')) {
                    const los = MEDICATION_FORMULARY.find(m => m.name === 'Losartan')!;
                    const isT = (strength: number) => isTargetDoseForPatient({ med: los, dose: los.available_doses.find(d => d.strength === strength)!, selected_frequency: 'qd' }, scenario.patient);
                    if (!isT(150)) fail('Losartan 150 mg is not a target dose (2022 Table 14 target range 50-150 mg)');
                    if (!isT(100)) fail('Losartan 100 mg stopped counting as a target dose');
                    if (isT(50)) fail('Losartan 50 mg is flagged target; the verified correction flags only 100 and 150');
                    if (/tablet/.test(los.available_doses.find(d => d.strength === 150)!.formulation) && !/two tablets/.test(los.available_doses.find(d => d.strength === 150)!.formulation)) fail('Losartan 150 mg is not labelled as two tablets');
                    if (mods.some(x => x.m.action === 'titrate_up' && x.m.source?.med.name === 'Losartan')) fail('Losartan 150 mg offered a further up-titration (it is at target)');
                    if (!scoredRegimens.some(r => r.warnings.some(w => w.includes('no FDA-labeled heart-failure indication')))) fail('Losartan regimen lacks the no-HF-label display note');
                }
                if (t.includes('ARNI At SBP 98 Caution')) {
                    const withArni = scoredRegimens.filter(r => r.modification_set?.modifications.some(m => m.target?.med.name === ARNI));
                    if (withArni.length === 0) fail('No ARNI option at SBP 98 (check is vacuous)');
                    if (withArni.some(r => !r.warnings.some(w => w.includes('ARNI AT LOW BASELINE SBP') && w.includes('PARADIGM')))) fail('ARNI start at SBP 98 lacks the PARADIGM-HF caution');
                    if (withArni.some(r => !(r.score_breakdown?.adjustments ?? []).some(a => a.code === 'DANGEROUS_WARNINGS'))) fail('The SBP < 100 ARNI caution is not score-penalized (design: genuine residual-risk warning)');
                    if (startsOf(ARNI).some(x => x !== '24/26')) fail('ARNI started above 24/26 at SBP 98');
                }
                if (t.includes('Lisinopril eGFR 25 Not Capped')) {
                    if (excl('Lisinopril')) fail('Lisinopril excluded at eGFR 25');
                    const lis = MEDICATION_FORMULARY.find(m => m.name === 'Lisinopril')!;
                    const adj = lis.renal_adjustment!(25, scenario.patient);
                    if (adj.max_dose !== undefined) fail(`Lisinopril still has a renal max_dose (${adj.max_dose}) at eGFR 25; label allows titration to 40 mg/day`);
                    const tiers = getDoseTiers(lis, scenario.patient).map(x => Number(x.dose.strength));
                    if (!tiers.includes(20) || !tiers.includes(40)) fail(`Lisinopril 20 and 40 mg are not titration tiers at eGFR 25 (found ${tiers.join(', ')}); label: titrate to 40 mg/day`);
                }
                if (t.includes('Child-Pugh B Confirmed ARNI Reduced Start')) {
                    const s = startsOf(ARNI);
                    if (excl(ARNI)) fail('ARNI excluded in Child-Pugh B (label: reduced start, not a contraindication)');
                    if (s.length === 0) fail('ARNI not offered in Child-Pugh B (check is vacuous)');
                    if (s.some(x => x !== '24/26')) fail(`ARNI start in Child-Pugh B must be 24/26 (found ${s.join(', ')})`);
                    if (!allWarnings.some(w => w.includes('Child-Pugh B') && w.includes('24/26'))) fail('ARNI in Child-Pugh B lacks the hepatic caution');
                }
                if (t.includes('ACEi Add Starts At Lowest Tier')) {
                    const adds = mods.filter(x => x.m.action === 'add' && (x.m.target?.med.drug_class === 'ACEi' || x.m.target?.med.drug_class === 'ARB'));
                    if (adds.length === 0) fail('No ACEi/ARB add produced (check is vacuous)');
                    for (const x of adds) {
                        if (String(x.m.target!.dose.strength) !== String(x.m.target!.med.available_doses[0].strength)) fail(`${x.m.summary} is not the lowest tier`);
                    }
                }
            }

            // 95. PREVIOUS-LVEF BLANK SENTINEL (audit fix): previous_lvef 0 + ever_lvef_le_40
            // 'no' is ordinary HFpEF, NOT HFimpEF — SGLT2i-first, no RAAS/BB pillar therapy.
            if (scenario.title.includes('HFpEF Previous LVEF Zero Sentinel')) {
                if (!topRegimen) {
                    failures.push('No regimen generated for HFpEF previous-LVEF-sentinel scenario');
                    scenarioPassed = false;
                }
                if (anyRegimenContainsAnyClass('ARNI', 'ACEi', 'ARB')) {
                    failures.push('RAAS pillar prescribed — previous_lvef 0 sentinel misread as documented prior EF (HFimpEF flip)');
                    scenarioPassed = false;
                }
                if (anyRegimenHasClass('Beta Blocker')) {
                    failures.push('BB pillar prescribed — previous_lvef 0 sentinel misread as documented prior EF (HFimpEF flip)');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('SGLT2i')) {
                    failures.push('SGLT2i (Class I HFpEF pillar) missing from all displayed regimens');
                    scenarioPassed = false;
                }
            }

            // 96. LVEF > 55 PROJECTION CLAMP (audit fix): for HFpEF baseline LVEF 60, adds
            // must never project a fabricated EF decline — the ceiling holds at baseline for
            // zero/positive deltas (old unconditional Math.min(55, ...) projected 60 → 55).
            if (scenario.title.includes('HFpEF LVEF 60 No Fabricated Decline')) {
                if (!topRegimen) {
                    failures.push('No regimen generated for HFpEF LVEF 60 clamp scenario');
                    scenarioPassed = false;
                }
                const anyFabricatedDecline = scoredRegimens.some(r => r.projected_patient.lvef < 60);
                if (anyFabricatedDecline) {
                    failures.push('A displayed regimen projects LVEF below the 60 baseline (fabricated decline from the old 55 clamp)');
                    scenarioPassed = false;
                }
                if (!anyRegimenHasClass('SGLT2i')) {
                    failures.push('SGLT2i missing — scenario must exercise an additive candidate to pin the clamp');
                    scenarioPassed = false;
                }
            }

            // H9. Orphan assertion detection: every scenario title must match at least one assertion marker.
            if (!hasScenarioSpecificCoverage) {
                failures.push(`No scenario-specific assertions mapped for title "${scenario.title}"`);
                scenarioPassed = false;
            }

            if (scenarioPassed) {
                console.log(`  [PASS] assertions met.`);
                passed++;
            } else {
                console.error(`  [FAIL] ${failures.join(', ')}`);
                failed++;
            }

        } catch (e) {
            console.error(`  [ERROR] Simulation crashed:`, e);
            failed++;
        }
        console.log('---');
    }

    console.log('Checking structural invariant: score breakdown reconciles (subtotal + adjustments + raw overrides == raw_score)...');
    if (breakdownViolations.length > 0) {
        breakdownViolations.slice(0, 20).forEach(m => console.error(`  [FAIL] ${m}`));
        failed++;
    } else {
        console.log(`  [PASS] ${breakdownChecked} scored regimens reconcile.`);
        passed++;
    }

    console.log('Checking structural invariant: patient-selected weight profiles never change safety output...');
    const profileSafetyViolations: string[] = [];
    const profileTops: Record<string, Map<string, { label: string; cost: number; complexity: number; completeness: number }>> = {};
    {
        const nonDefault = WEIGHT_PROFILE_NAMES.filter(n => n !== 'default');
        const regimenLabel = (r: { regimen: { med: { name: string }; dose: { strength: number | string; unit: string } }[] }) =>
            r.regimen.map(m => `${m.med.name} ${m.dose.strength}${m.dose.unit}`).join(' + ');
        let runs = 0;
        for (const profile of WEIGHT_PROFILE_NAMES) profileTops[profile] = new Map();
        for (const scenario of SCENARIOS) {
            const prices = await getDrugPrices(formularyNames, scenario.patient.insurance_tier);
            const avail = availableFor(scenario.title);
            const runWith = (profile: WeightProfileName) => {
                const pt = clonePatient(scenario.patient);
                pt.care_priority = profile;
                return generateAndScoreModifications(pt, avail, prices);
            };
            const byProfile = {} as Record<WeightProfileName, ReturnType<typeof generateAndScoreModifications>>;
            try {
                for (const profile of WEIGHT_PROFILE_NAMES) byProfile[profile] = runWith(profile);
            } catch (err) {
                profileSafetyViolations.push(`"${scenario.title}": threw under a profile: ${(err as Error).message}`);
                continue;
            }
            for (const profile of WEIGHT_PROFILE_NAMES) {
                const top = byProfile[profile].scoredRegimens[0];
                if (top) profileTops[profile].set(scenario.title, { label: regimenLabel(top), cost: top.cost, complexity: top.complexity, completeness: top.gdmt_completeness ?? 0 });
            }
            const base = byProfile.default;
            for (const profile of nonDefault) {
                runs++;
                const out = byProfile[profile];
                const tag = `"${scenario.title}" [${profile}]`;
                const same = (k: 'excludedMedications' | 'clinicalAlerts' | 'gdmtGaps' | 'eligibleAdjuncts' | 'missingDataNotices') =>
                    JSON.stringify(out[k]) === JSON.stringify(base[k]);
                for (const k of ['excludedMedications', 'clinicalAlerts', 'gdmtGaps', 'eligibleAdjuncts', 'missingDataNotices'] as const) {
                    if (!same(k)) profileSafetyViolations.push(`${tag}: ${k} differ from the default-profile run`);
                }
                if (out.scoredRegimens.length === 0 && base.scoredRegimens.length > 0) profileSafetyViolations.push(`${tag}: no regimens although default shows some`);
                if (out.scoredRegimens.length > 0 && base.scoredRegimens.length === 0) profileSafetyViolations.push(`${tag}: regimens shown although default shows none`);
                for (const r of out.scoredRegimens) {
                    const pp = r.projected_patient;
                    if (pp.sbp < DISPLAY_FLOORS.minProjectedSbp || pp.potassium > DISPLAY_FLOORS.maxProjectedPotassium || pp.pulse < DISPLAY_FLOORS.minProjectedPulse) {
                        profileSafetyViolations.push(`${tag}: displayed regimen violates a display floor`);
                    }
                    if (r.regimen.filter(m => RAAS_CLASSES.has(m.med.drug_class)).length > 1) profileSafetyViolations.push(`${tag}: dual RAAS displayed`);
                    const classes = new Set(r.regimen.map(m => m.med.drug_class));
                    if (classes.has('MRA') && classes.has('nsMRA')) profileSafetyViolations.push(`${tag}: dual MRA displayed`);
                    const budget = scenario.patient.max_affordable_cost;
                    if (budget !== undefined && r.cost > budget && !r.warnings.some(w => w.includes('BUDGET EXCEEDED'))) {
                        profileSafetyViolations.push(`${tag}: cost $${r.cost} exceeds budget $${budget} without BUDGET EXCEEDED warning`);
                    }
                    const bd = r.score_breakdown;
                    if (!bd) { profileSafetyViolations.push(`${tag}: missing score_breakdown`); continue; }
                    if (bd.weight_profile !== profile) profileSafetyViolations.push(`${tag}: breakdown.weight_profile ${bd.weight_profile} != ${profile}`);
                    for (const d of bd.domains) {
                        if (d.weight !== WEIGHT_PROFILES[profile][d.key]) profileSafetyViolations.push(`${tag}: ${d.key} weight is not the ${profile} row`);
                    }
                    const eps = 1e-9;
                    const rawOv = (bd.overrides ?? []).filter(o => o.applies_to === 'raw_score').reduce((a, o) => a + (o.after - o.before), 0);
                    const target = bd.domains.reduce((a, d) => a + d.contribution, 0) + bd.adjustments.reduce((a, x) => a + x.points, 0) + rawOv;
                    if (Math.abs(target - bd.raw_score) > eps || Math.abs(bd.weighted_subtotal - bd.domains.reduce((a, d) => a + d.contribution, 0)) > eps) {
                        profileSafetyViolations.push(`${tag}: score_breakdown does not reconcile`);
                    }
                }
            }
        }
        if (profileSafetyViolations.length > 0) {
            profileSafetyViolations.slice(0, 20).forEach(m => console.error(`  [FAIL] ${m}`));
            failed++;
        } else {
            console.log(`  [PASS] ${runs} profile runs (${SCENARIOS.length} scenarios x ${nonDefault.length} profiles): exclusions, alerts, gaps, adjuncts and notices identical; floors, dual-class, budget and breakdown hold.`);
            passed++;
        }
    }

    console.log('Checking structural invariant: weight profiles move the top pick in the stated direction...');
    {
        const paired = (profile: WeightProfileName) => [...profileTops.default.keys()].filter(t => profileTops[profile].has(t));
        const mean = (profile: WeightProfileName, titles: string[], f: 'cost' | 'complexity' | 'completeness') =>
            titles.reduce((a, t) => a + profileTops[profile].get(t)![f], 0) / (titles.length || 1);
        const checks: { profile: WeightProfileName; f: 'cost' | 'complexity' | 'completeness'; dir: 'le' | 'ge'; what: string }[] = [
            { profile: 'cost_first', f: 'cost', dir: 'le', what: 'mean top-pick cost ($/mo)' },
            { profile: 'simplicity_first', f: 'complexity', dir: 'le', what: 'mean top-pick complexity' },
            { profile: 'outcomes_first', f: 'completeness', dir: 'ge', what: 'mean top-pick GDMT completeness' },
        ];
        let dirOk = true;
        for (const c of checks) {
            const titles = paired(c.profile);
            const d = mean('default', titles, c.f), p = mean(c.profile, titles, c.f);
            // Means over ~100 scenarios move by single top-pick flips; allow 1% of the default mean so one
            // near-tie cannot fail the check. A profile that moved clearly the wrong way still fails.
            const tol = Math.abs(d) * 0.01;
            const ok = c.dir === 'le' ? p <= d + tol : p >= d - tol;
            if (!ok) dirOk = false;
            console.log(`  ${c.profile}: ${c.what} ${p.toFixed(4)} vs default ${d.toFixed(4)} over ${titles.length} scenarios (${c.dir === 'le' ? '<=' : '>='} expected) ${ok ? 'ok' : 'VIOLATED'}`);
        }
        for (const profile of WEIGHT_PROFILE_NAMES.filter(n => n !== 'default')) {
            const diff = paired(profile).filter(t => profileTops[profile].get(t)!.label !== profileTops.default.get(t)!.label);
            console.log(`  EFFECT ${profile}: top pick differs from default in ${diff.length}/${paired(profile).length} scenarios`);
            diff.slice(0, 8).forEach(t => console.log(`    ${t} -> default: ${profileTops.default.get(t)!.label} | ${profile}: ${profileTops[profile].get(t)!.label}`));
        }
        if (!dirOk) { console.error('  [FAIL] a profile direction check failed'); failed++; }
        else { console.log('  [PASS] cost_first, simplicity_first and outcomes_first move cost, complexity and completeness the stated way.'); passed++; }
    }

    console.log('Checking structural invariant: the ranking mode changes order only (Balanced default; Prioritize foundational therapy)...');
    {
        const violations: string[] = [];
        const examples: { tag: string; bal: string; fnd: string; balR: ScoredRegimenLike; fndR: ScoredRegimenLike }[] = [];
        type ScoredRegimenLike = { overall_score: number; gdmt_completeness?: number; cost: number };
        const label = (r: { regimen: { med: { name: string }; dose: { strength: number | string; unit: string }; selected_frequency: string }[] }) =>
            r.regimen.map(m => `${m.med.name} ${m.dose.strength}${m.dose.unit} ${m.selected_frequency}`).join(' + ');
        let runs = 0, applicableRuns = 0, leadChanged = 0, lowerCompletenessLeads = 0;
        for (const scenario of SCENARIOS) {
            for (const tier of ['cash', 'commercial', 'medicare'] as const) {
                const pt = clonePatient(scenario.patient);
                pt.insurance_tier = tier;
                const prices = await getDrugPrices(formularyNames, tier);
                const avail = availableFor(scenario.title);
                const tag = `"${scenario.title}" [${tier}]`;
                let def, bal, fnd;
                try {
                    def = generateAndScoreModifications(clonePatient(pt), avail, prices);
                    bal = generateAndScoreModifications({ ...clonePatient(pt), ranking_mode: 'balanced' }, avail, prices);
                    fnd = generateAndScoreModifications({ ...clonePatient(pt), ranking_mode: 'foundational_first' }, avail, prices);
                } catch (err) { violations.push(`${tag}: threw: ${(err as Error).message}`); continue; }
                runs++;
                // ranking_mode is echoed into projected_patient; everything else must be byte-identical.
                const noMode = (_k: string, v: unknown) => (_k === 'ranking_mode' ? undefined : v);
                if (JSON.stringify(def, noMode) !== JSON.stringify(bal, noMode)) violations.push(`${tag}: missing ranking_mode differs from explicit 'balanced'`);
                for (const k of ['excludedMedications', 'clinicalAlerts', 'gdmtGaps', 'eligibleAdjuncts', 'missingDataNotices'] as const) {
                    if (JSON.stringify(bal[k]) !== JSON.stringify(fnd[k])) violations.push(`${tag}: ${k} differ between modes`);
                }
                if (bal.scoredRegimens.length === 0 && fnd.scoredRegimens.length > 0) violations.push(`${tag}: foundational mode shows regimens although Balanced shows none`);
                // Scores never change with the mode: a regimen shown in both runs has identical scores.
                for (const r of fnd.scoredRegimens) {
                    const m = bal.scoredRegimens.find(x => label(x) === label(r));
                    if (m && (m.overall_score !== r.overall_score || m.raw_score !== r.raw_score)) violations.push(`${tag}: ${label(r)} scores differ between modes`);
                }
                // Over-budget fallback wording (owner decision 2026-11-11): never presented as an implementable plan.
                for (const r of [...bal.scoredRegimens, ...fnd.scoredRegimens]) {
                    const w = r.warnings.find(x => x.startsWith('BUDGET EXCEEDED'));
                    if (w && !(w.includes('nothing fits the stated budget') && w.includes('not as a plan the patient can carry out'))) violations.push(`${tag}: BUDGET EXCEEDED warning lacks the not-implementable wording`);
                }
                const phen = classifyPhenotype(pt);
                const rk = fnd.ranking;
                // Hard-stop outputs (alerts only) return before selection and carry no ranking info.
                if (fnd.scoredRegimens.length > 0 && (!rk || rk.mode !== 'foundational_first')) violations.push(`${tag}: ranking info missing/wrong mode`);
                if (bal.ranking && (bal.ranking.mode !== 'balanced' || bal.ranking.applied || bal.ranking.balanced_lead_differs)) violations.push(`${tag}: balanced ranking info wrong`);
                if (phen !== 'HFrEF') {
                    if (JSON.stringify(bal.scoredRegimens, noMode) !== JSON.stringify(fnd.scoredRegimens, noMode)) violations.push(`${tag}: ${phen} picks differ between modes (must be identical)`);
                    if (rk && (rk.applied || !rk.reason_not_applied)) violations.push(`${tag}: non-applicable phenotype must report applied=false with a reason`);
                } else {
                    applicableRuns++;
                    const b0 = bal.scoredRegimens[0], f0 = fnd.scoredRegimens[0];
                    // Both leads clean: the foundational lead can never cover less therapy than the balanced lead. (If the balanced
                    // lead trips a projected-safety adjustment and the foundational lead does not, the safe-first rule legitimately
                    // allows lower completeness - that case is counted and reported below, not failed.)
                    if (b0 && f0 && isProjectedSafetyClean(f0) && isProjectedSafetyClean(b0) && (f0.gdmt_completeness ?? 0) < (b0.gdmt_completeness ?? 0) - 1e-12) {
                        violations.push(`${tag}: foundational lead completeness ${f0.gdmt_completeness} < balanced lead ${b0.gdmt_completeness} although both leads are clean`);
                    }
                    if (b0 && f0 && isProjectedSafetyClean(f0) && !isProjectedSafetyClean(b0) && (f0.gdmt_completeness ?? 0) < (b0.gdmt_completeness ?? 0) - 1e-12) lowerCompletenessLeads++;
                    const differs = !!b0 && !!f0 && label(b0) !== label(f0);
                    if (differs !== !!rk?.balanced_lead_differs) violations.push(`${tag}: balanced_lead_differs=${rk?.balanced_lead_differs} but leads ${differs ? 'differ' : 'match'}`);
                    if (differs && !rk?.balanced_lead_summary) violations.push(`${tag}: balanced_lead_differs without a summary`);
                    if (differs) { leadChanged++; examples.push({ tag, bal: label(b0), fnd: label(f0), balR: b0, fndR: f0 }); }
                }
            }
        }
        // Source guard: only selection.ts (and the facade re-export) may read the mode, so it cannot reach scoring or eligibility.
        for (const f of readdirSync(path.join(process.cwd(), 'services', 'engine')).filter(n => n.endsWith('.ts') && n !== 'selection.ts')) {
            const text = readFileSync(path.join(process.cwd(), 'services', 'engine', f), 'utf8');
            if (/ranking_mode|resolveRankingMode/.test(text)) violations.push(`services/engine/${f} reads the ranking mode (only selection.ts may)`);
        }
        if (violations.length > 0) {
            violations.slice(0, 20).forEach(m => console.error(`  [FAIL] ${m}`));
            failed++;
        } else {
            console.log(`  [PASS] ${runs} scenario x tier runs: default == balanced; exclusions, alerts, gaps, adjuncts, notices and scores identical across modes; non-HFrEF picks identical.`);
            passed++;
        }
        console.log(`  RANKING MODE EFFECT: foundational_first changes the lead pick in ${leadChanged} of ${applicableRuns} HFrEF/HFimpEF runs (${runs} runs total).`);
        console.log(`  Foundational lead covers LESS therapy than the balanced lead (balanced lead trips a projected-safety adjustment, foundational lead does not): ${lowerCompletenessLeads} runs.`);
        const seen = new Set<string>();
        for (const e of examples) {
            const title = e.tag.replace(/ \[[a-z]+\]$/, '');
            if (seen.has(title)) continue;
            seen.add(title);
            if (seen.size > 12) break;
            console.log(`    ${e.tag}\n      Balanced lead:     ${e.bal} [score ${e.balR.overall_score}, completeness ${Math.round((e.balR.gdmt_completeness ?? 0) * 100)}%, $${e.balR.cost}]\n      Foundational lead: ${e.fnd} [score ${e.fndR.overall_score}, completeness ${Math.round((e.fndR.gdmt_completeness ?? 0) * 100)}%, $${e.fndR.cost}]`);
        }
    }

    console.log('Checking structural invariant: every weight profile covers every domain and sums to 100%...');
    const weightViolations: string[] = [];
    for (const [name, row] of Object.entries(WEIGHT_PROFILES)) {
        const keys = Object.keys(row).sort().join(',');
        if (keys !== [...DOMAIN_KEYS].sort().join(',')) weightViolations.push(`profile ${name}: domains ${keys} != DOMAIN_KEYS`);
        const sum = Object.values(row).reduce((a, w) => a + w, 0);
        if (Math.abs(sum - 1) > 1e-9) weightViolations.push(`profile ${name}: weights sum to ${sum}, expected 1`);
    }
    if (weightViolations.length > 0) {
        weightViolations.forEach(m => console.error(`  [FAIL] ${m}`));
        failed++;
    } else {
        console.log(`  [PASS] ${Object.keys(WEIGHT_PROFILES).length} weight profile(s) sum to 100%.`);
        passed++;
    }

    console.log('Checking structural invariant: titration never skips the next step (one-step up and down candidates)...');
    {
        // For every scenario patient and every current drug: the immediately next tier (above / below, as eligible for this patient) is among the
        // titration candidates, unless a rule blocks the move. The blocks are READ from the engine's own analysis (contraindicated / redundant /
        // forced reduction / potassium and heart-rate gates / decompensation), never re-encoded here.
        let checked = 0; const skipViolations: string[] = [];
        for (const sc of SCENARIOS) {
            const P = sc.patient;
            const analysis = analyzeCurrentRegimen(P, MEDICATION_FORMULARY, MEDICATION_FORMULARY.flatMap(m => getDoseTiers(m, P)));
            for (const cur of P.current_regimen ?? []) {
                const name = cur.med.name;
                const adj = adjacentTiers(cur, P);
                const up = analysis.titratableUp.find(x => x.current.med.name === name)?.options ?? [];
                const down = analysis.titratableDown.find(x => x.current.med.name === name)?.options ?? [];
                const single = cur.med.facts?.single_course_dose === true;
                const blockedUp = single || analysis.contraindicatedCurrentMeds.has(name) || analysis.redundantCurrentMeds.has(name) || analysis.forcedReduceNames.has(name)
                    || kUptitrationBlock(cur.med, P) !== null || hrContinuationAction(cur.med, P)?.blockUp === true
                    || (cur.med.drug_class === 'Beta Blocker' && isAcutelyDecompensated(P));
                const raises = (t: RegimenMed | undefined, dir: 1 | -1) => !!t && (Number.isNaN(dailyDose(t)) || Number.isNaN(dailyDose(cur)) || (dir === 1 ? dailyDose(t) > dailyDose(cur) : dailyDose(t) < dailyDose(cur)));
                if (!blockedUp && raises(adj.up, 1)) {
                    checked++;
                    if (!up.some(o => String(o.dose.strength) === String(adj.up!.dose.strength))) skipViolations.push(`${sc.title}: ${name} ${cur.dose.strength} has no one-step up candidate (${adj.up!.dose.strength})`);
                }
                if (!single && raises(adj.down, -1)) {
                    checked++;
                    if (!down.some(o => String(o.dose.strength) === String(adj.down!.dose.strength))) skipViolations.push(`${sc.title}: ${name} ${cur.dose.strength} has no one-step down candidate (${adj.down!.dose.strength})`);
                }
            }
        }
        if (skipViolations.length > 0 || checked === 0) {
            skipViolations.slice(0, 10).forEach(m => console.error(`  [FAIL] ${m}`));
            if (checked === 0) console.error('  [FAIL] no titration step was checked (vacuous)');
            failed++;
        } else {
            console.log(`  [PASS] ${checked} next-step titration checks across all scenarios, none skipped.`);
            passed++;
        }
    }

    console.log('Checking structural invariant: every RAAS new start is at or below its starting tier...');
    if (raasStartViolations.length > 0 || raasStartsChecked === 0) {
        raasStartViolations.slice(0, 10).forEach(m => console.error(`  [FAIL] ${m}`));
        if (raasStartsChecked === 0) console.error('  [FAIL] no RAAS add/swap was checked (vacuous)');
        failed++;
    } else {
        console.log(`  [PASS] ${raasStartsChecked} RAAS add/swap options across all scenarios, none above the declared starting tier.`);
        passed++;
    }

    console.log('Checking structural invariant: no displayed regimen exceeds a declared maximum total daily dose...');
    // Plus every ladder: no strength x frequency of any tier getDoseTiers offers exceeds the declared maximum, for a CKD patient (tid preferred).
    for (const m of MEDICATION_FORMULARY) {
        const max = m.facts?.max_daily_dose;
        if (max === undefined) continue;
        const ckd = { ...SCENARIOS[0].patient, egfr: 15 };
        for (const tier of getDoseTiers(m, ckd)) {
            dailyMaxChecked++;
            if (dailyDose(tier) > max) dailyMaxViolations.push(`${m.name} tier ${tier.dose.strength} ${tier.selected_frequency} = ${dailyDose(tier)}/day exceeds the declared maximum ${max}`);
        }
    }
    if (dailyMaxViolations.length > 0 || dailyMaxChecked === 0) {
        dailyMaxViolations.slice(0, 10).forEach(v => console.error(`  [FAIL] ${v}`));
        if (dailyMaxChecked === 0) console.error('  [FAIL] no daily-maximum check ran (vacuous)');
        failed++;
    } else {
        console.log(`  [PASS] ${dailyMaxChecked} drug x regimen/tier checks, none above a declared maximum daily dose.`);
        passed++;
    }

    console.log('Checking structural invariant: eligibility rule ids are unique/ascending and every exclusion carries one...');
    const ruleIds = ELIGIBILITY_RULES.map(r => r.id);
    const idsOrdered = ruleIds.every((id, i) => i === 0 || id > ruleIds[i - 1]) && new Set(ruleIds).size === ruleIds.length;
    if (!idsOrdered) exclusionViolations.push(`ELIGIBILITY_RULES ids not unique+ascending: ${ruleIds.join(',')}`);
    if (exclusionViolations.length > 0) {
        exclusionViolations.slice(0, 20).forEach(m => console.error(`  [FAIL] ${m}`));
        failed++;
    } else {
        console.log(`  [PASS] ${ruleIds.length} rules ordered; ${exclusionsChecked} exclusions all carry a known rule_id.`);
        passed++;
    }

    console.log('Checking structural invariant: no formulary drug name is a string literal in engine code...');
    {
        // Drug facts belong on the formulary entry (`Medication.facts`, constants.ts). A name that
        // reappears as a whole string literal (or an object key) in engine code is a name-keyed
        // branch. Prose inside longer warning/alert strings is deliberately not matched: only a
        // literal that IS a drug name (or a distinctive fragment of one) fails.
        // Anything that legitimately must stay is listed here with a reason.
        const ALLOWLIST: { file: string; literal: string; why: string }[] = [];
        const GENERIC_WORDS = new Set(['sodium']);
        const fragments = new Set<string>();
        for (const m of MEDICATION_FORMULARY) {
            const paren = m.name.match(/\(([^)]+)\)/);
            const base = m.name.replace(/\s*\([^)]*\)/, '').trim();
            [m.name, base, paren?.[1] ?? '', ...base.split(/[\/\s]+/)]
                .map(x => x.trim().toLowerCase())
                .filter(x => x.length >= 4 && !GENERIC_WORDS.has(x))
                .forEach(x => fragments.add(x));
        }
        const stripComments = (src: string): string => {
            let out = ''; let i = 0; let quote = '';
            while (i < src.length) {
                const c = src[i]; const n = src[i + 1];
                if (quote) {
                    out += c;
                    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
                    if (c === quote) quote = '';
                    i++; continue;
                }
                if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
                if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
                if (c === "'" || c === '"' || c === '`') quote = c;
                out += c; i++;
            }
            return out;
        };
        const engineFiles = ['services/simulationService.ts',
            ...readdirSync(path.join(process.cwd(), 'services/engine')).filter(f => f.endsWith('.ts')).map(f => `services/engine/${f}`)];
        const nameViolations: string[] = [];
        for (const file of engineFiles) {
            const code = stripComments(readFileSync(path.join(process.cwd(), file), 'utf8'));
            const found: string[] = [];
            for (const mt of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
                found.push((mt[1] ?? mt[2] ?? mt[3] ?? '').trim());
            }
            for (const mt of code.matchAll(/\b([A-Za-z][A-Za-z]+)\s*:/g)) found.push(mt[1]);
            for (const lit of found) {
                if (!fragments.has(lit.toLowerCase())) continue;
                if (ALLOWLIST.some(a => a.file === file && a.literal.toLowerCase() === lit.toLowerCase())) continue;
                nameViolations.push(`${file}: drug-name literal '${lit}' — move the fact onto the formulary entry (Medication.facts) or add a justified ALLOWLIST row`);
            }
        }
        if (nameViolations.length > 0) {
            [...new Set(nameViolations)].slice(0, 20).forEach(m => console.error(`  [FAIL] ${m}`));
            failed++;
        } else {
            console.log(`  [PASS] ${engineFiles.length} engine files contain no drug-name literals (${ALLOWLIST.length} allowlisted).`);
            passed++;
        }
    }

    console.log('Checking structural invariant: no engine module imports the simulationService facade...');
    {
        // The facade depends on the engine modules, never the reverse (no circular imports).
        const engineDir = path.join(process.cwd(), 'services/engine');
        const importViolations: string[] = [];
        for (const f of readdirSync(engineDir).filter(n => n.endsWith('.ts'))) {
            const code = readFileSync(path.join(engineDir, f), 'utf8');
            for (const mt of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
                if (/(^|\/)simulationService(\.ts)?$/.test(mt[1])) importViolations.push(`services/engine/${f} imports '${mt[1]}'`);
            }
        }
        if (importViolations.length > 0) {
            importViolations.forEach(m => console.error(`  [FAIL] ${m}`));
            failed++;
        } else {
            console.log('  [PASS] no services/engine file imports simulationService.');
            passed++;
        }
    }

    console.log('Checking structural invariant: contraindication checks are the single source of each drug\'s boolean...');
    {
        const ciViolations: string[] = [];
        const withCi = MEDICATION_FORMULARY.filter(m => m.contraindications);
        for (const m of withCi) {
            const checks = m.contraindication_checks;
            if (!checks || checks.length === 0) { ciViolations.push(`${m.name}: contraindications without contraindication_checks`); continue; }
            const reasons = checks.map(c => c.reason);
            if (reasons.some(r => !r || !r.trim())) ciViolations.push(`${m.name}: empty reason`);
            if (new Set(reasons).size !== reasons.length) ciViolations.push(`${m.name}: duplicate reason within entry`);
            for (const s of SCENARIOS) {
                if (m.contraindications!(s.patient) !== checks.some(c => c.when(s.patient))) {
                    ciViolations.push(`${m.name}: boolean differs from checks for scenario "${s.title}"`);
                }
            }
        }
        if (ciViolations.length > 0) {
            ciViolations.forEach(v => console.error(`  [FAIL] ${v}`));
            failed++;
        } else {
            console.log(`  [PASS] ${withCi.length} entries: checks non-empty, reasons unique, boolean === checks.some over ${SCENARIOS.length} scenarios.`);
            passed++;
        }
    }

    console.log('Checking structural invariant: every E13 exclusion carries at least one why-detail...');
    {
        const e13Missing: string[] = [];
        let e13Count = 0;
        for (const s of SCENARIOS) {
            const prices = await getDrugPrices(formularyNames, s.patient.insurance_tier);
            const { excludedMedications } = generateAndScoreModifications(s.patient, availableMedNames, prices);
            for (const e of excludedMedications) {
                if (e.rule_id !== 'E13') continue;
                e13Count++;
                if (!e.why || e.why.length === 0) e13Missing.push(`${s.title}: ${e.name}`);
            }
        }
        if (e13Missing.length > 0 || e13Count === 0) {
            e13Missing.forEach(v => console.error(`  [FAIL] E13 without details: ${v}`));
            if (e13Count === 0) console.error('  [FAIL] no E13 exclusions found across scenarios (check is vacuous)');
            failed++;
        } else {
            console.log(`  [PASS] all ${e13Count} E13 exclusions across scenarios have details.`);
            passed++;
        }
    }

    console.log('Checking structural invariant: binder "enables RAAS/MRA" bonus requires a RAAS inhibitor or MRA in the regimen...');
    {
        const lok = MEDICATION_FORMULARY.find(m => m.name === 'Sodium Zirconium Cyclosilicate (Lokelma)')!;
        const pat = MEDICATION_FORMULARY.find(m => m.name === 'Patiromer')!;
        const lis = MEDICATION_FORMULARY.find(m => m.name === 'Lisinopril')!;
        const carv = MEDICATION_FORMULARY.find(m => m.name === 'Carvedilol')!;
        const mk = (med: typeof lok): { med: typeof lok; dose: typeof lok.available_doses[number]; selected_frequency: string } => ({ med, dose: med.available_doses[0], selected_frequency: 'qd' });
        const hyperK = { ...SCENARIOS[0].patient, potassium: 5.4 };
        let ok = true;
        for (const binder of [lok, pat]) {
            const f = binder.special_features!.find(x => x.feature.startsWith('Enables RAAS'))!;
            if (f.criteria(hyperK, [mk(binder), mk(carv)])) ok = false;     // binder + beta-blocker only: no credit
            if (!f.criteria(hyperK, [mk(binder), mk(lis)])) ok = false;     // binder + RAAS inhibitor: credit
        }
        if (!ok) { console.error('  [FAIL] binder bonus criterion does not depend on a RAAS inhibitor / MRA in the regimen'); failed++; }
        else { console.log('  [PASS] binder bonus requires RAAS/MRA in the resulting regimen.'); passed++; }
    }

    console.log(`\nVerification Complete.`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

runVerification();
