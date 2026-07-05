
import { generateAndScoreModifications, isTargetDoseForPatient } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';

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
    'Budget-Constrained',
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
    'High Body Weight Carvedilol Target Requires 50 BID'
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

    const formularyNames = MEDICATION_FORMULARY.map(m => m.name);
    const availableMedNames = new Set(formularyNames);
    const betaBlockerMeds = new Set(['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol']);

    for (const scenario of SCENARIOS) {
        console.log(`Analyzing Scenario: "${scenario.title}"`);

        try {
            const scenarioPrices = await getDrugPrices(formularyNames, scenario.patient.insurance_tier);
            const scenarioAvailableMedNames = scenario.title.includes('No BB Available')
                ? new Set([...availableMedNames].filter(name => !betaBlockerMeds.has(name)))
                : availableMedNames;
            const { scoredRegimens, excludedMedications, clinicalAlerts, monitoringPlan, eligibleAdjuncts } = generateAndScoreModifications(scenario.patient, scenarioAvailableMedNames, scenarioPrices);
            const topRegimen = scoredRegimens[0];

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
                    // Scores must be capped at 35
                    if (scoredRegimens.some(r => r.overall_score > 35)) {
                        failures.push('Low-output regimen scores should be capped at 35');
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

            // Coverage assertions for baseline scenarios to avoid silent orphaning when names change.
            if (
                scenario.title.includes('John Doe (Wet & Warm)') ||
                scenario.title.includes('African American (A-HeFT Indication)') ||
                scenario.title.includes('Gout & Congestion') ||
                scenario.title.includes('HFpEF with Resistant Edema') ||
                scenario.title.includes('Severe Dilation') ||
                scenario.title.includes('African American NYHA III')
            ) {
                if (!topRegimen) {
                    failures.push('Expected at least one regimen for baseline coverage scenario');
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
            if (scenario.title.includes('Severe Asthma')) {
                if (anyRegimenHasMed('Carvedilol') || anyRegimenHasMed('Propranolol')) { // Non-selective
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

            // 11. Sinus Tachycardia -> Should have Ivabradine
            if (scenario.title.includes('Ivabradine Candidate')) {
                const anyIvabradine = scoredRegimens.some(r =>
                    r.regimen.some(m => m.med.drug_class === 'If Inhibitor')
                );
                if (!anyIvabradine && topRegimen && topRegimen.projected_patient.pulse >= 70) {
                    failures.push('Ivabradine not prescribed despite HR >= 70, sinus, LVEF <= 35, on BB');
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

            // 12. Budget-Constrained -> Should NOT have Entresto (too expensive)
            if (scenario.title.includes('Budget-Constrained')) {
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

            // 21. SBP 90 borderline -> should be blocked (SBP < 90 gate)
            if (scenario.title.includes('SBP 90 Borderline')) {
                // SBP exactly 90 is NOT < 90, so should get cautious recs... BUT we check the spirit:
                // At exactly 90, we allow recs (gate is strict < 90). Score may be low due to projected drop.
                // This tests that the system handles the boundary correctly.
                if (scoredRegimens.length > 0) {
                    // If recs are generated at SBP 90, projected SBP should not be < 90 for the top pick
                    // OR the score should be heavily penalized
                    if (topRegimen && topRegimen.overall_score > 50) {
                        // If projected SBP would drop below 90, score should be very low
                        const projSbp = topRegimen.projected_patient.sbp;
                        if (projSbp < 85) {
                            failures.push(`Top regimen at SBP 90 projects dangerous SBP ${projSbp.toFixed(0)} with high score ${topRegimen.overall_score}`);
                            scenarioPassed = false;
                        }
                    }
                }
            }

            // 22. MRA boundary (eGFR 31, K+ 5.4) -> MRA should come with binder rescue
            if (scenario.title.includes('MRA Boundary')) {
                const missingBinderForMra = anyRegimenWithClassViolates('MRA', r => {
                    const hasBinder = r.regimen.some(m => m.med.name === 'Patiromer');
                    return !hasBinder;
                });
                if (missingBinderForMra) {
                    failures.push('MRA prescribed at K+ 5.4 without Patiromer rescue');
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

            // 60. HFmrEF + Obese -> GLP-1 eligible (BMI ≥ 30 + LVEF ≥ 40), may not rank top-3
            if (scenario.title.includes('HFmrEF Obese')) {
                if (!topRegimen) {
                    failures.push('HFmrEF Obese: no regimen generated');
                    scenarioPassed = false;
                }
                // GLP-1 should be eligible (not excluded) — BMI 33 + LVEF 42 + not HFimpEF
                // distinctPicks limits to 3 regimens so GLP-1 may not appear in output
                const glp1Excluded = excludedMedications.some(e =>
                    e.name.includes('Semaglutide') || e.name.includes('Tirzepatide')
                );
                if (glp1Excluded) {
                    failures.push('GLP-1 excluded in HFmrEF with BMI 33 (should be eligible: BMI ≥ 30 + LVEF ≥ 40)');
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
                const newRaasMra = raasMraRegimens.filter(r =>
                    r.warnings.some(w => w.includes('POTASSIUM UNKNOWN'))
                );
                if (raasMraRegimens.length > 0 && newRaasMra.length === 0) {
                    failures.push('Missing potassium: RAAS/MRA-containing regimen lacks POTASSIUM UNKNOWN pre-initiation warning');
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

    console.log(`\nVerification Complete.`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

runVerification();
