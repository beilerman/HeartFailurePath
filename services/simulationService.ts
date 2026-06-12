
import { Patient, Medication, ScoredRegimen, RegimenMed, ExcludedMedication, ModificationAction, RegimenModification, ModificationSet, MonitoringPlanItem, SimulationOutput, QualitativeProjection, TradeOffLabel, TradeOffTone, DomainScores } from '../types';
import { MEDICATION_FORMULARY } from '../constants';

// =====================================================================================
// DRUG-CLASS REGISTRY — single source of truth for class behavior.
//
// Every fact the engine needs about a drug class lives here, instead of being re-encoded
// across ~80 inline `drug_class === '...'` branches and several parallel Set literals.
// Adding a new class (or therapy of a new class) means adding ONE row here plus the
// formulary entry — not grep-and-patching the engine. A missing membership becomes a
// missing row (one place to check), not a silent clinical error scattered across files.
//
// `flags`:
//   raas                          → counts as RAAS-inhibitor blockade (dual-RAAS prevention, etc.)
//   mra                           → mineralocorticoid blockade (dual-MRA prevention, grouping)
//   diuretic                      → loop / thiazide volume management
//   disease-modifying             → GDMT/adjunct that alters disease course (STRONG-HF follow-up trigger)
//   volume-sensitive-intensifier  → initiation deferred while a patient is volume-depleted on diuretics
// `group`: the class-GROUP used for "one-per-group" logic (RAAS pool, MRA pool, GLP-1 pool).
// `dbpRatio`: drug-class-specific SBP→DBP coupling (see evidence block near getDbpRatio).
// =====================================================================================
type ClassFlag = 'raas' | 'mra' | 'diuretic' | 'disease-modifying' | 'volume-sensitive-intensifier';
interface ClassMeta { group: string; dbpRatio: number; flags: ClassFlag[]; }

const DRUG_CLASS_REGISTRY: Record<string, ClassMeta> = {
    'ARNI':                   { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'ACEi':                   { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'ARB':                    { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'Beta Blocker':           { group: 'Beta Blocker', dbpRatio: 0.70, flags: ['disease-modifying'] },
    'MRA':                    { group: 'MRA', dbpRatio: 0.60, flags: ['mra', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'nsMRA':                  { group: 'MRA', dbpRatio: 0.50, flags: ['mra', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'SGLT2i':                 { group: 'SGLT2i', dbpRatio: 0.40, flags: ['disease-modifying', 'volume-sensitive-intensifier'] },
    'Loop Diuretic':          { group: 'Loop Diuretic', dbpRatio: 0.50, flags: ['diuretic'] },
    'Thiazide-like Diuretic': { group: 'Thiazide-like Diuretic', dbpRatio: 0.50, flags: ['diuretic'] },
    'Vasodilator':            { group: 'Vasodilator', dbpRatio: 0.50, flags: [] },
    'sGC Stimulator':         { group: 'sGC Stimulator', dbpRatio: 0.55, flags: ['disease-modifying'] },
    'If Inhibitor':           { group: 'If Inhibitor', dbpRatio: 0.60, flags: [] },
    'Inotrope':               { group: 'Inotrope', dbpRatio: 0.60, flags: [] },
    'GLP-1 RA':               { group: 'GLP-1 Therapy', dbpRatio: 0.60, flags: [] },
    'GLP-1/GIP RA':           { group: 'GLP-1 Therapy', dbpRatio: 0.60, flags: [] },
    'IV Iron':                { group: 'IV Iron', dbpRatio: 0.60, flags: [] },
    'K+ Binder':              { group: 'K+ Binder', dbpRatio: 0.60, flags: [] },
};

function classesWithFlag(flag: ClassFlag): Set<string> {
    return new Set(Object.entries(DRUG_CLASS_REGISTRY).filter(([, v]) => v.flags.includes(flag)).map(([k]) => k));
}

// --- Helper Functions ---
function pickPreferredFrequency(med: Medication, options: string[], patient: Patient): string {
    if (options.length === 0) return 'qd';

    // Severe CKD reduces loop delivery to the nephron. Prefer split dosing at low eGFR.
    if (med.drug_class === 'Loop Diuretic' && patient.egfr < 20) {
        if (options.includes('tid')) return 'tid';
        if (options.includes('bid')) return 'bid';
    }

    return options[0];
}

function getDoseTiers(med: Medication, patient: Patient): RegimenMed[] {
    const adjustment = med.renal_adjustment ? med.renal_adjustment(patient.egfr, patient) : {};
    const validDoses = med.available_doses.filter(dose => {
        if (typeof dose.strength === 'number') {
            return !(adjustment.max_dose && dose.strength > adjustment.max_dose);
        }
        return true;
    });

    if (validDoses.length === 0) return [];

    // P3: Age-adjusted dosing — elderly patients (>80) limited to lower dose tiers
    let dosesForTiering = validDoses;
    if (patient.age > 80 && validDoses.length > 2) {
        // Limit to bottom half of dose range (start low, go slow)
        dosesForTiering = validDoses.slice(0, Math.max(2, Math.ceil(validDoses.length / 2)));
    }

    // Return lowest, middle, and highest dose for simulation efficiency
    let tiers = [dosesForTiering[0]];
    if (dosesForTiering.length > 1) tiers.push(dosesForTiering[dosesForTiering.length - 1]);
    if (dosesForTiering.length > 2) tiers.push(dosesForTiering[Math.floor(dosesForTiering.length / 2)]);

    // Always include the guideline TARGET dose as a tier (when not age-restricted away). Without
    // it, titration could only land on the sampled lowest/middle/highest — e.g. carvedilol would
    // offer →12.5 or →50 but never its target 25 — so "titrate to target" was never a candidate
    // and the engine defaulted to "keep" for a sub-target regimen.
    const targetDose = dosesForTiering.find(d => d.is_target_dose);
    if (targetDose) tiers.push(targetDose);

    // Unique only
    tiers = [...new Set(tiers)];

    return tiers.map(dose => ({
        med,
        dose,
        selected_frequency: pickPreferredFrequency(med, dose.frequency_options, patient)
    }));
}

function getMedicationClassGroup(drugClass: string): string {
    return DRUG_CLASS_REGISTRY[drugClass]?.group ?? drugClass;
}

function hasHistoricalHFrEF(patient: Patient): boolean {
    if (patient.previous_lvef !== undefined) return patient.previous_lvef <= 40;
    return patient.ever_lvef_le_40 === 'yes';
}

function hasUnknownHistoricalHFrEF(patient: Patient): boolean {
    return patient.previous_lvef === undefined && (patient.ever_lvef_le_40 ?? 'unknown') === 'unknown';
}

function shouldPreserveQuadForUnknownHistory(patient: Patient): boolean {
    if (patient.lvef <= 40 || !hasUnknownHistoricalHFrEF(patient)) return false;
    const current = patient.current_regimen || [];
    return current.some(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        return group === 'RAAS Inhibitor' || group === 'Beta Blocker' || group === 'MRA';
    });
}

function hasRecentWorseningHF(patient: Patient): boolean {
    return patient.recent_hf_worsening_within_6mo === 'yes';
}

// When a patient arrives on duplicate same-class-GROUP therapy (dual RAAS, dual MRA, two
// beta-blockers, two SGLT2i, two loop diuretics — never appropriate), pick the agent to KEEP
// and return the names of the others to deprescribe. Generalized across ALL class groups so any
// same-group duplicate is corrected, not just RAAS/MRA. (Loop + thiazide is two DIFFERENT groups
// — legitimate sequential nephron blockade — and is intentionally not flagged.)
// Keep rules: RAAS → ARNI > ACEi > ARB; MRA → steroidal over nsMRA (dual steroidal + nsMRA
// blockade markedly raises hyperkalemia risk); all other groups → keep the higher (more titrated)
// dose, which is closest to an established target.
const RAAS_KEEP_PREFERENCE: Record<string, number> = { ARNI: 3, ACEi: 2, ARB: 1 };

function computeRedundantCurrentMeds(currentRegimen: RegimenMed[]): Set<string> {
    const redundant = new Set<string>();

    const byGroup = new Map<string, RegimenMed[]>();
    currentRegimen.forEach(r => {
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(r);
    });

    byGroup.forEach((meds, group) => {
        if (meds.length <= 1) return;
        let keeper: RegimenMed;
        if (group === 'RAAS Inhibitor') {
            keeper = meds.reduce((best, cur) =>
                (RAAS_KEEP_PREFERENCE[cur.med.drug_class] ?? 0) > (RAAS_KEEP_PREFERENCE[best.med.drug_class] ?? 0) ? cur : best
            );
        } else if (group === 'MRA') {
            keeper = meds.find(r => r.med.drug_class === 'MRA') ?? meds[0];
        } else {
            keeper = meds.reduce((best, cur) => {
                const cs = Number(cur.dose.strength), bs = Number(best.dose.strength);
                if (Number.isNaN(cs)) return best;
                if (Number.isNaN(bs)) return cur;
                return cs > bs ? cur : best;
            });
        }
        meds.forEach(r => { if (r.med.name !== keeper.med.name) redundant.add(r.med.name); });
    });

    return redundant;
}

// Iron deficiency in HF — ESC 2021, IRONMAN, AFFIRM-AHF, FAIR-HF/CONFIRM-HF criteria:
//   - Absolute deficiency:   ferritin < 100 ng/mL (regardless of TSAT)
//   - Functional deficiency: ferritin 100-300 ng/mL AND TSAT < 20%
// TSAT < 20% with ferritin > 300 (or with ferritin unknown) is NOT, by itself, a
// treatment indication — ferritin context is required to classify. The prior logic
// (ferritin < 100 OR tsat < 20) over-flagged functional/inflammatory states.
function isIronDeficient(patient: Patient): boolean {
    const { ferritin, tsat } = patient;
    if (ferritin === undefined) return false;                              // cannot classify without ferritin
    if (ferritin < 100) return true;                                       // absolute
    if (ferritin <= 300 && tsat !== undefined && tsat < 20) return true;   // functional
    return false;
}

// H2 fix: Require ≥2 of 3 hypoperfusion markers to avoid false positives from a single
// nonspecific finding (e.g., BUN/Cr > 20 alone from dehydration, not true low output).
// Markers: (1) cool extremities, (2) narrow pulse pressure ≤ 25, (3) prerenal azotemia BUN/Cr > 20.
function isLowOutputState(patient: Patient): boolean {
    // Invalid BP input can create false pulse-pressure triggers. Treat as not-assessable here.
    if (patient.sbp <= patient.dbp) return false;
    if (patient.lvef >= 20) return false;

    const hasCoolExtremities = patient.volume_status.exam_findings.has('Cool Extremities');
    const pulsePressure = patient.sbp - patient.dbp;
    const hasNarrowPulsePressure = pulsePressure <= 25;
    const bunCrRatio = patient.creatinine > 0 ? patient.bun / patient.creatinine : 0;
    const hasPrerenalAzotemia = bunCrRatio > 20;

    const markerCount = [hasCoolExtremities, hasNarrowPulsePressure, hasPrerenalAzotemia].filter(Boolean).length;
    return markerCount >= 2;
}

function dedupeCurrentRegimen(regimen: RegimenMed[]): { regimen: RegimenMed[]; duplicateNames: string[] } {
    const seen = new Set<string>();
    const duplicateNames = new Set<string>();
    const deduped: RegimenMed[] = [];

    regimen.forEach(item => {
        const key = item.med.name;
        if (seen.has(key)) {
            duplicateNames.add(item.med.name);
            return;
        }
        seen.add(key);
        deduped.push(item);
    });

    return { regimen: deduped, duplicateNames: Array.from(duplicateNames) };
}

function countNewClassGroups(candidate: RegimenMed[], current: RegimenMed[]): number {
    const currentGroups = new Set(current.map(r => getMedicationClassGroup(r.med.drug_class)));
    const candidateGroups = new Set(candidate.map(r => getMedicationClassGroup(r.med.drug_class)));

    let added = 0;
    candidateGroups.forEach(group => {
        if (!currentGroups.has(group)) added += 1;
    });
    return added;
}

export function clonePatient(p: Patient): Patient {
    return {
        ...p,
        volume_status: {
            ...p.volume_status,
            exam_findings: new Set(p.volume_status.exam_findings)
        },
        comorbidities: new Set(p.comorbidities),
        external_medications: new Set(p.external_medications || []),
        allergies: new Set(p.allergies),
        discontinued_meds: p.discontinued_meds.map(m => ({ ...m })),
        current_regimen: p.current_regimen ? p.current_regimen.map(r => ({ ...r })) : []
    };
}

// --- Delta-from-Current Analysis ---

interface RegimenAnalysis {
    currentClassMap: Map<string, RegimenMed>;  // class group → current med+dose
    missingPillars: string[];                   // GDMT pillars not in current regimen
    titratableUp: { current: RegimenMed, options: RegimenMed[] }[];
    titratableDown: { current: RegimenMed, options: RegimenMed[] }[];
    swappable: { from: RegimenMed, candidates: RegimenMed[] }[];
    removable: RegimenMed[];
    addableAdjuncts: RegimenMed[];
    addablePillars: Map<string, RegimenMed[]>;  // missing pillar class group → candidate meds+doses
    contraindicatedCurrentMeds: Set<string>;     // names of current meds now contraindicated
    forcedBbDownTitrateNames: Set<string>;       // existing BBs that must be down-titrated in acute decomp
    redundantCurrentMeds: Set<string>;           // names of duplicate-class agents to deprescribe (dual RAAS/MRA)
}

// Derived from DRUG_CLASS_REGISTRY — single source of truth (see top of file).
const RAAS_CLASSES = classesWithFlag('raas');
const DIURETIC_CLASSES = classesWithFlag('diuretic');
const VOLUME_SENSITIVE_INTENSIFICATION_CLASSES = classesWithFlag('volume-sensitive-intensifier');

function isDiureticClass(drugClass: string): boolean {
    return DIURETIC_CLASSES.has(drugClass);
}

function hasRelevantIntensification(
    modificationSet: ModificationSet,
    targetClasses: Set<string>
): boolean {
    return modificationSet.modifications.some(mod => {
        if (!mod.target) return false;
        if (!(mod.action === 'add' || mod.action === 'titrate_up' || mod.action === 'swap')) return false;
        return targetClasses.has(mod.target.med.drug_class);
    });
}

function hasDiureticDeEscalation(modificationSet: ModificationSet): boolean {
    return modificationSet.modifications.some(mod => {
        if (!mod.source) return false;
        if (!(mod.action === 'remove' || mod.action === 'titrate_down')) return false;
        return isDiureticClass(mod.source.med.drug_class);
    });
}

function buildMonitoringPlan(
    currentPatient: Patient,
    projectedPatient: Patient,
    modificationSet: ModificationSet
): MonitoringPlanItem[] {
    const plan: MonitoringPlanItem[] = [];
    const hasRaasOrMraIntensification = hasRelevantIntensification(
        modificationSet,
        new Set([...RAAS_CLASSES, 'MRA', 'nsMRA'])
    );
    const hasDiureticIntensification = hasRelevantIntensification(modificationSet, DIURETIC_CLASSES);
    const higherRiskElectrolytes = currentPatient.egfr < 45 || currentPatient.potassium >= 5.0 || projectedPatient.potassium > 5.0;

    if (hasRaasOrMraIntensification) {
        plan.push({
            test: 'BMP (potassium, creatinine, eGFR)',
            timing: '3-7 days after RAAS/MRA change',
            details: 'Assess for early hyperkalemia or renal decline after initiation, swap, or up-titration.'
        });
        plan.push({
            test: 'BMP repeat before next titration',
            timing: '10-14 days after change',
            details: 'Hold/reduce and reassess if potassium >= 5.5 or creatinine rises >30% from baseline.'
        });
        if (higherRiskElectrolytes) {
            plan.push({
                test: 'Early potassium check',
                timing: '48-72 hours',
                details: 'Required due to CKD and/or borderline potassium at baseline.'
            });
        }
    }

    const hasSglt2iIntensification = hasRelevantIntensification(modificationSet, new Set(['SGLT2i']));
    if (hasSglt2iIntensification) {
        plan.push({
            test: 'BMP (creatinine, eGFR)',
            timing: '2-4 weeks after SGLT2i initiation',
            details: 'SGLT2i causes an expected hemodynamic eGFR dip of 5-10% (tubuloglomerular feedback). This is reversible and NOT a reason to discontinue. Recheck to confirm stabilization.'
        });
        if (currentPatient.egfr < 45) {
            plan.push({
                test: 'Urinalysis + volume status assessment',
                timing: '1-2 weeks after SGLT2i initiation',
                details: 'CKD patients: monitor for volume depletion from osmotic diuresis. Adjust concurrent loop diuretic dose if needed.'
            });
        }
    }

    if (hasDiureticIntensification) {
        plan.push({
            test: 'Daily weight, BP, orthostasis, dizziness',
            timing: 'Daily for 7 days',
            details: 'Flag over-diuresis if weight loss >1 kg/day, symptomatic hypotension, or presyncope.'
        });
        plan.push({
            test: 'BMP (electrolytes, creatinine)',
            timing: '3-7 days after diuretic increase',
            details: 'Screen for pre-renal AKI, hypokalemia, and hyponatremia after dose escalation.'
        });
    }

    return plan;
}

// --- Clinician-facing qualitative / categorical builders ------------------------------
// These are the deterministic, guideline-anchored outputs the tool can defend. They are
// independent of the composite score and of the false-precision projected biomarker values.

const PILLAR_LABELS: Record<string, string> = {
    'RAAS Inhibitor': 'RAAS inhibitor (ARNI preferred for HFrEF)',
    'Beta Blocker': 'Evidence-based beta-blocker (carvedilol / metoprolol succinate / bisoprolol)',
    'MRA': 'Mineralocorticoid receptor antagonist (MRA)',
    'SGLT2i': 'SGLT2 inhibitor'
};

function computePhenotypePillars(patient: Patient): string[] {
    const preserveQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    const isHFimpEF = patient.lvef > 40 && (hasHistoricalHFrEF(patient) || preserveQuadForUnknownHistory);
    const isHFpEF = patient.lvef >= 50 && !isHFimpEF;
    return isHFpEF
        ? ['SGLT2i']
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];
}

// Indicated-but-missing GDMT classes relative to the CURRENT regimen.
function computeGdmtGaps(patient: Patient): string[] {
    const currentGroups = new Set((patient.current_regimen || []).map(r => getMedicationClassGroup(r.med.drug_class)));
    return computePhenotypePillars(patient)
        .filter(p => !currentGroups.has(p))
        .map(p => PILLAR_LABELS[p] || p);
}

function buildMissingDataNotices(patient: Patient): string[] {
    const notices: string[] = [];
    if (patient.lvedd === undefined && patient.lavi === undefined) {
        notices.push('No LVEDD or LAVI entered — chamber remodeling is not assessed. Structural inference is limited to LVEF alone.');
    }
    if (patient.ferritin === undefined && patient.tsat === undefined) {
        notices.push('No iron studies (ferritin / TSAT) entered — iron-deficiency therapy (IV iron) cannot be evaluated. Check iron studies in symptomatic HF.');
    } else if (patient.ferritin !== undefined && patient.ferritin >= 100 && patient.ferritin <= 300 && patient.tsat === undefined) {
        notices.push('Ferritin 100-300 with TSAT not entered — functional iron deficiency cannot be confirmed or excluded. Obtain TSAT.');
    }
    if (patient.daily_step_count === undefined) {
        notices.push('No activity / step data entered — functional status is based on NYHA and KCCQ only.');
    }
    if (patient.lvef > 40 && hasUnknownHistoricalHFrEF(patient)) {
        notices.push('Prior LVEF (ever ≤ 40%?) is undocumented — HFimpEF vs HFpEF classification is uncertain. Clarify prior echocardiograms before de-escalating.');
    }
    return notices;
}

// STRONG-HF high-intensity follow-up schedule. Triggered when a disease-modifying class
// is initiated/up-titrated — safe practice is rapid sequencing with structured early
// reassessment, not a single cross-sectional decision.
const DISEASE_MODIFYING_CLASSES = classesWithFlag('disease-modifying');

function buildFollowUpCalendar(modSet: ModificationSet | undefined): MonitoringPlanItem[] {
    if (!modSet) return [];
    const initiatesOrTitrates = modSet.modifications.some(m =>
        (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
        m.target && DISEASE_MODIFYING_CLASSES.has(m.target.med.drug_class)
    );
    if (!initiatesOrTitrates) return [];
    return [
        { test: 'Clinical review + BMP (K+, creatinine, eGFR) + BP/HR', timing: 'Day 7 (±2)', details: 'STRONG-HF model: assess tolerance and labs within ~1 week of any GDMT initiation or up-titration. Hold/reduce if K+ ≥ 5.5 or creatinine rises > 30% from baseline.' },
        { test: 'BMP + BP/HR + congestion check; up-titrate if tolerated', timing: 'Week 2', details: 'Advance toward target doses if BP, HR, renal function and K+ permit. Reinforce daily-weight self-monitoring and adherence.' },
        { test: 'BMP + BP/HR; continue stepwise titration', timing: 'Week 4', details: 'Continue up-titration of each pillar toward guideline target / maximally tolerated dose.' },
        { test: 'NT-proBNP + clinical assessment; confirm target doses', timing: 'Week 6', details: 'Confirm quadruple therapy at target/maximally tolerated doses. Document residual gaps and any device/referral needs.' }
    ];
}

function buildQualitativeProjections(baseline: Patient, projected: Patient, hasMraInRegimen: boolean): QualitativeProjection[] {
    const out: QualitativeProjection[] = [];

    const lvefDelta = projected.lvef - baseline.lvef;
    if (lvefDelta >= 3) out.push({ label: 'Reverse remodeling', direction: 'improve', detail: 'Meaningful EF improvement likely over months with disease-modifying therapy.' });
    else if (lvefDelta >= 1) out.push({ label: 'Reverse remodeling', direction: 'improve', detail: 'Modest EF improvement possible.' });
    else if (lvefDelta <= -2) out.push({ label: 'Reverse remodeling', direction: 'caution', detail: 'EF may decline if disease-modifying therapy is reduced or removed.' });
    else out.push({ label: 'Reverse remodeling', direction: 'stable', detail: 'EF expected to remain broadly stable.' });

    const baseExcess = baseline.volume_status.current_weight_kg - baseline.volume_status.dry_weight_kg;
    const projExcess = projected.volume_status.current_weight_kg - projected.volume_status.dry_weight_kg;
    if (projExcess < baseExcess - 1) out.push({ label: 'Congestion', direction: 'improve', detail: 'Decongestion expected; monitor for over-diuresis.' });
    else if (baseExcess > 1.5) out.push({ label: 'Congestion', direction: 'caution', detail: 'Residual volume overload — diuretic strategy may need adjustment.' });
    else out.push({ label: 'Congestion', direction: 'stable', detail: 'Near-euvolemic / stable volume status.' });

    if (projected.nt_pro_bnp < baseline.nt_pro_bnp * 0.85) out.push({ label: 'Neurohormonal stress', direction: 'improve', detail: 'Natriuretic-peptide burden expected to fall.' });
    else if (projected.nt_pro_bnp > baseline.nt_pro_bnp * 1.1) out.push({ label: 'Neurohormonal stress', direction: 'caution', detail: 'Natriuretic-peptide burden may rise — reassess.' });
    else out.push({ label: 'Neurohormonal stress', direction: 'stable', detail: 'Little change in natriuretic-peptide burden expected.' });

    // Conservative projected SBP (post safety change — compensation excluded from this value)
    if (projected.sbp < 95) out.push({ label: 'Blood pressure', direction: 'caution', detail: 'Hypotension risk — monitor BP and symptoms closely; consider staggered initiation.' });
    else if (projected.sbp < 105) out.push({ label: 'Blood pressure', direction: 'stable', detail: 'Mild BP reduction expected; generally tolerated.' });
    else out.push({ label: 'Blood pressure', direction: 'stable', detail: 'Minimal BP impact expected.' });

    if (projected.potassium > 5.5) out.push({ label: 'Potassium', direction: 'worsen', detail: 'Hyperkalemia risk — binder and close monitoring required.' });
    else if (projected.potassium > 5.0) out.push({ label: 'Potassium', direction: 'caution', detail: 'Borderline potassium — recheck BMP within ~1 week.' });
    else if (projected.potassium < 3.5) out.push({ label: 'Potassium', direction: 'caution', detail: 'Hypokalemia risk — replete and monitor (esp. with diuretics / digoxin).' });
    else if (hasMraInRegimen) out.push({ label: 'Potassium', direction: 'stable', detail: 'Potassium expected acceptable; routine MRA monitoring applies.' });
    else out.push({ label: 'Potassium', direction: 'stable', detail: 'Potassium expected stable.' });

    return out;
}

// Human label + evidence for a criteria-met adjunct, so guideline-indicated add-ons are surfaced
// even when they do not rank inside the top display picks (e.g. A-HeFT H/ISDN, SHIFT ivabradine).
function describeAdjunct(m: Medication): string {
    switch (m.drug_class) {
        case 'Vasodilator': return 'Hydralazine + isosorbide dinitrate (H/ISDN) — A-HeFT: Class I add-on for Black patients NYHA III–IV on GDMT, or an option when RAAS is not tolerated.';
        case 'If Inhibitor': return 'Ivabradine — SHIFT: sinus rhythm with HR ≥ 70 on maximally-tolerated beta-blocker.';
        case 'sGC Stimulator': return 'Vericiguat — VICTORIA: worsening HFrEF (recent hospitalization / IV diuretics), NT-proBNP ≥ 1600.';
        case 'Inotrope': return 'Digoxin — rate control in AF and/or symptom reduction in HFrEF (narrow therapeutic index — monitor levels).';
        case 'GLP-1 RA':
        case 'GLP-1/GIP RA': return 'GLP-1 / GIP receptor agonist — obesity with HFpEF/HFmrEF (STEP-HFpEF, SUMMIT).';
        case 'IV Iron': return 'IV iron — iron deficiency in symptomatic HF (AFFIRM-AHF / IRONMAN): improves symptoms and reduces hospitalization.';
        case 'nsMRA': return 'Finerenone (nsMRA) — FINEARTS-HF: HFmrEF / HFpEF (LVEF ≥ 40).';
        case 'MRA': return 'Mineralocorticoid receptor antagonist — adjunct per phenotype (TOPCAT in HFpEF).';
        case 'Loop Diuretic': return 'Loop diuretic — symptomatic volume management; titrate to daily weights.';
        case 'Thiazide-like Diuretic': return 'Thiazide add-on — sequential nephron blockade for diuretic resistance.';
        default: return m.name;
    }
}

function buildEligibleAdjuncts(addableAdjuncts: RegimenMed[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    addableAdjuncts.forEach(r => {
        const label = describeAdjunct(r.med);
        if (!seen.has(label)) { seen.add(label); out.push(label); }
    });
    return out;
}

function buildTradeOffLabels(domain: DomainScores): TradeOffLabel[] {
    const band = (s: number, good: string, mid: string, bad: string): { label: string; tone: TradeOffTone } =>
        s >= 80 ? { label: good, tone: 'good' } : s >= 50 ? { label: mid, tone: 'neutral' } : { label: bad, tone: 'bad' };
    const cost = band(domain.cost, 'Low cost', 'Moderate cost', 'High cost / financial-toxicity risk');
    const burden = band(domain.adherence, 'Low pill burden', 'Moderate complexity', 'High complexity / adherence risk');
    const evidence = band(domain.guideline, 'Strong guideline concordance', 'Partial concordance', 'Limited concordance');
    return [
        { dimension: 'Cost', label: cost.label, tone: cost.tone },
        { dimension: 'Pill burden', label: burden.label, tone: burden.tone },
        { dimension: 'Evidence', label: evidence.label, tone: evidence.tone }
    ];
}

// --- Real-world robustness: incomplete data & inappropriate regimens -----------------

// Physiologically-impossible zero (or undefined / NaN) is treated as "not entered" for
// safety-critical fields. A potassium of 0 is not a measured value — it is a blank field,
// and must NOT be allowed to read as "safe" (e.g. clearing a hyperkalemia gate).
function valueUnknown(v: number | undefined): boolean {
    return v === undefined || Number.isNaN(v) || v <= 0;
}

interface CriticalDataAudit {
    alerts: string[];
    unknownPotassium: boolean;
    unknownRenal: boolean;
    unknownBnp: boolean;
    unknownLvef: boolean;
}

function auditCriticalData(patient: Patient): CriticalDataAudit {
    const alerts: string[] = [];
    const unknownLvef = valueUnknown(patient.lvef);
    const unknownPotassium = valueUnknown(patient.potassium);
    const unknownRenal = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    const unknownBnp = valueUnknown(patient.nt_pro_bnp);

    if (unknownLvef) alerts.push('DATA REQUIRED: LVEF not entered. HF phenotype (HFrEF / HFmrEF / HFpEF) cannot be determined and a GDMT pathway cannot be selected. Obtain an echocardiogram before relying on recommendations.');
    if (unknownPotassium) alerts.push('DATA REQUIRED: Serum potassium not entered. Obtain a BMP before initiating or up-titrating a RAAS inhibitor or MRA — hyperkalemia risk cannot be assessed and must not be assumed absent.');
    if (unknownRenal) alerts.push('DATA REQUIRED: Renal function (eGFR / creatinine) not entered. Required for renal dose adjustment and RAAS / MRA / SGLT2i safety. Obtain a BMP.');
    if (unknownBnp) alerts.push('DATA NOTE: NT-proBNP not entered. Neurohormonal status is not assessed and is excluded from scoring (not scored as normal).');

    return { alerts, unknownPotassium, unknownRenal, unknownBnp, unknownLvef };
}

// Catches data-entry errors (unit confusion, transcription slips) — values outside the range
// physiology allows. These are flagged for verification rather than silently consumed, because a
// typo like LVEF 250 or K+ 50 (mg instead of mEq/L) would otherwise drive confident output.
function validatePhysiologicBounds(patient: Patient): string[] {
    const alerts: string[] = [];
    const flag = (cond: boolean, msg: string) => { if (cond) alerts.push('IMPLAUSIBLE VALUE: ' + msg); };

    flag(patient.lvef > 80, `LVEF ${patient.lvef}% exceeds the physiologic maximum (~80%). Verify entry.`);
    flag(patient.potassium > 8.0, `Serum potassium ${patient.potassium} mEq/L is extreme — confirm units (mEq/L, not mg) and rule out a transcription error. If accurate, this is a hyperkalemic emergency.`);
    flag(patient.potassium > 0 && patient.potassium < 2.0, `Serum potassium ${patient.potassium} mEq/L is below survivable range — verify entry.`);
    flag(patient.sbp > 260 || patient.dbp > 200, `Blood pressure ${patient.sbp}/${patient.dbp} mmHg is outside the recordable range — verify entry.`);
    flag(patient.egfr > 150, `eGFR ${patient.egfr} mL/min/1.73m² exceeds the physiologic maximum (~120). Verify entry.`);
    flag(patient.pulse > 250 || (patient.pulse > 0 && patient.pulse < 20), `Heart rate ${patient.pulse} bpm is outside the physiologic range — verify entry.`);
    flag(patient.creatinine > 20, `Creatinine ${patient.creatinine} mg/dL is extreme — confirm units and entry.`);
    flag(patient.bmi > 80 || (patient.bmi > 0 && patient.bmi < 10), `BMI ${patient.bmi} is outside the physiologic range — verify height/weight entry.`);

    return alerts;
}

// Flags regimens the patient ARRIVES on that are themselves unsafe/inappropriate — the
// engine should actively prompt deprescribing, not silently filter these out of output.
function detectInappropriateRegimen(patient: Patient): string[] {
    const alerts: string[] = [];
    const current = patient.current_regimen || [];

    const raasInCurrent = current.filter(r => RAAS_CLASSES.has(r.med.drug_class));
    if (raasInCurrent.length > 1) {
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on dual RAAS blockade (${raasInCurrent.map(r => r.med.name).join(' + ')}). Deprescribe one agent — the combination raises hyperkalemia, AKI, and hypotension risk without survival benefit (ACC/AHA 2022; ONTARGET).`);
    }

    const allMra = current.filter(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');
    if (allMra.length > 1) {
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one MRA (${allMra.map(r => r.med.name).join(' + ')}). Use a single MRA — combination markedly increases severe hyperkalemia risk with no added benefit.`);
    }

    // Other duplicate same-class-group therapy (two beta-blockers, two SGLT2i, two loop diuretics,
    // etc.) — never appropriate; deprescribe to a single agent. RAAS and MRA are reported above.
    const groupCounts = new Map<string, RegimenMed[]>();
    current.forEach(r => {
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!groupCounts.has(g)) groupCounts.set(g, []);
        groupCounts.get(g)!.push(r);
    });
    groupCounts.forEach((meds, group) => {
        if (meds.length <= 1 || group === 'RAAS Inhibitor' || group === 'MRA') return;
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one ${group} (${meds.map(r => r.med.name).join(' + ')}). Use a single agent in this class — duplicate same-class therapy adds toxicity without added benefit.`);
    });

    const ext = patient.external_medications || new Set<string>();
    const onNonDhpCcb = ext.has('Verapamil') || ext.has('Diltiazem') || patient.comorbidities.has('On Verapamil/Diltiazem');
    if (onNonDhpCcb && patient.lvef > 0 && patient.lvef <= 40) {
        alerts.push('INAPPROPRIATE THERAPY: Non-dihydropyridine calcium-channel blocker (verapamil / diltiazem) in HFrEF is potentially harmful — it is a negative inotrope and can worsen heart failure (ACC/AHA 2022, Class III). Deprescribe; if rate control is needed, use a beta-blocker ± digoxin.');
    }

    if (patient.comorbidities.has('Chronic NSAID Use')) {
        alerts.push('AVOID: Chronic NSAID use is discouraged in heart failure — sodium / fluid retention, blunted diuretic response, and AKI risk (amplified with RAAS / MRA). Deprescribe or substitute acetaminophen / topical analgesia where feasible.');
    }

    const onPde5i = ext.has('Sildenafil') || ext.has('Tadalafil');
    const onNitrate = current.some(r => r.med.drug_class === 'Vasodilator');
    if (onPde5i && onNitrate) {
        alerts.push('INAPPROPRIATE THERAPY: Nitrate (Isosorbide Dinitrate) with a PDE5 inhibitor (sildenafil/tadalafil) is an absolute contraindication — risk of profound or fatal hypotension (FDA label). The nitrate has been removed from all recommendations; deprescribe one agent immediately.');
    }

    // Over-diuresis: euvolemic patient maintained on a high-dose loop diuretic. The loop should be
    // down-titrated to the lowest effective dose to avoid hypovolemia and prerenal AKI — especially
    // when an SGLT2i is being added (additive diuresis). (Volume DEPLETION below dry weight is
    // handled separately by the volume-depletion alert.)
    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const euvolemic = Math.abs(fluidExcess) <= 1.0;
    const highDoseLoopThreshold: Record<string, number> = { Furosemide: 120, 'Furoscix (SC Furosemide)': 80, Torsemide: 50, Bumetanide: 2 };
    const highDoseLoop = current.find(r => {
        const t = highDoseLoopThreshold[r.med.name];
        return r.med.drug_class === 'Loop Diuretic' && t !== undefined && Number(r.dose.strength) >= t;
    });
    if (euvolemic && highDoseLoop) {
        alerts.push(`LOOP DIURETIC OVER-TREATMENT: Patient appears euvolemic on a high-dose loop diuretic (${highDoseLoop.med.name} ${highDoseLoop.dose.strength}${highDoseLoop.dose.unit}). Down-titrate to the lowest effective dose to avoid over-diuresis, hypovolemia, and prerenal AKI — particularly when initiating an SGLT2i (additive natriuresis).`);
    }

    return alerts;
}

function analyzeCurrentRegimen(
    patient: Patient,
    formulary: Medication[],
    medTiers: RegimenMed[],
    allBBExcluded?: boolean
): RegimenAnalysis {
    const currentRegimen = patient.current_regimen || [];

    // Map current meds to class groups
    const currentClassMap = new Map<string, RegimenMed>();
    currentRegimen.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        currentClassMap.set(group, r);
    });

    // Determine which GDMT pillars apply based on HF phenotype
    // HFimpEF (ACC/AHA 2022): If LVEF was ≤40% and has improved, continue all 4 pillars
    const preserveQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    const isHFimpEF = patient.lvef > 40 && (hasHistoricalHFrEF(patient) || preserveQuadForUnknownHistory);
    const isHFpEF = patient.lvef >= 50 && !isHFimpEF;
    const applicablePillars = isHFpEF
        ? ['SGLT2i']                                    // HFpEF: only SGLT2i is Class I
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];  // HFrEF/HFmrEF/HFimpEF: full quad

    let missingPillars = applicablePillars.filter(p => !currentClassMap.has(p));

    // Acute decompensation gating: do NOT initiate BB (Class III harm — ACC/AHA 2022)
    // NYHA IV, or NYHA III with significant volume overload = acutely decompensated
    const acuteFluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const isAcutelyDecompensated = patient.nyha_class === 'IV' ||
        (patient.nyha_class === 'III' && acuteFluidExcess > 2.0 && patient.volume_status.exam_findings.size >= 2);
    if (isAcutelyDecompensated && !currentClassMap.has('Beta Blocker')) {
        missingPillars = missingPillars.filter(p => p !== 'Beta Blocker');
    }

    // H5: Force dose reduction of an existing beta-blocker ONLY when decompensation is accompanied
    // by hypoperfusion / low output ("cold-and-wet"). ACC/AHA 2022: in WARM-and-wet decompensation
    // (adequate perfusion) the beta-blocker is CONTINUED and the patient is diuresed — reducing it
    // is not indicated and worsens outcomes. Previously any NYHA III/IV congestion forced a BB cut,
    // which both de-escalated warm patients inappropriately AND (via the candidate filter below)
    // suppressed every safe guideline ADDITION (e.g. SGLT2i, which is beneficial in acute HF —
    // EMPULSE / SOLOIST-WHF). Abrupt discontinuation remains Class III harm — this is a dose
    // REDUCTION with taper guidance, never an abrupt stop.
    const pulsePressure = patient.sbp - patient.dbp;
    const hasHypoperfusion =
        patient.volume_status.exam_findings.has('Cool Extremities') ||
        patient.sbp < 90 ||
        pulsePressure <= 25;
    const forceDownBB = isAcutelyDecompensated && currentClassMap.has('Beta Blocker') && hasHypoperfusion;

    // Build a map of all available meds by class group for lookup
    const tiersByGroup = new Map<string, RegimenMed[]>();
    medTiers.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        if (!tiersByGroup.has(group)) tiersByGroup.set(group, []);
        tiersByGroup.get(group)!.push(r);
    });

    // Safety check: identify current meds that are now contraindicated
    // These must NOT be titrated up or kept — only down-titration or removal
    const contraindicatedCurrentMeds = new Set<string>();
    currentRegimen.forEach(r => {
        if (r.med.contraindications && r.med.contraindications(patient)) {
            contraindicatedCurrentMeds.add(r.med.name);
        }
    });

    // Redundant same-class therapy the patient arrived on (dual RAAS / dual MRA). These must be
    // deprescribed — the engine synthesizes their removal into every candidate (below) so a
    // corrected regimen is produced rather than the whole regimen being filtered out.
    const redundantCurrentMeds = computeRedundantCurrentMeds(currentRegimen);

    // Titration analysis: for each current med, find higher/lower dose tiers
    const titratableUp: RegimenAnalysis['titratableUp'] = [];
    const titratableDown: RegimenAnalysis['titratableDown'] = [];
    const forcedBbDownTitrateNames = new Set<string>();

    currentRegimen.forEach(current => {
        // Block titration UP and swaps for contraindicated OR redundant meds — they are being removed
        const isContraindicated = contraindicatedCurrentMeds.has(current.med.name) || redundantCurrentMeds.has(current.med.name);
        // Block BB titration UP when acutely decompensated (reduce dose instead)
        const isBBBlockedUp = forceDownBB && current.med.drug_class === 'Beta Blocker';

        const allTiers = getDoseTiers(current.med, patient);
        // Compare by dose-ORDER INDEX (available_doses are listed low→high), not Number(strength).
        // Combination products use string strengths like "24/26" or "37.5/20" where Number() is NaN,
        // which silently made every up/down comparison false — so ARNI and H/ISDN could never be
        // titrated. Index comparison handles both numeric and combination strengths.
        const doseOrder = current.med.available_doses;
        const currentIdx = doseOrder.findIndex(d => d.strength === current.dose.strength);
        const tierIdx = (t: RegimenMed) => doseOrder.findIndex(d => d.strength === t.dose.strength);

        if (!isContraindicated && !isBBBlockedUp) {
            const higherDoses = allTiers.filter(t => tierIdx(t) > currentIdx);
            if (higherDoses.length > 0) {
                titratableUp.push({ current, options: higherDoses });
            }
        }

        const lowerDoses = allTiers.filter(t => tierIdx(t) < currentIdx);
        if (lowerDoses.length > 0) {
            titratableDown.push({ current, options: lowerDoses });
            if (isBBBlockedUp) {
                forcedBbDownTitrateNames.add(current.med.name);
            }
        }
    });

    // Swap analysis: for each current med, find other meds in same class group.
    // Contraindicated current meds CAN be swapped to a non-contraindicated alternative
    // (preserves drug class coverage vs outright removal). Swap candidates that are
    // themselves contraindicated are filtered out.
    const swappable: RegimenAnalysis['swappable'] = [];
    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    currentRegimen.forEach(current => {
        // A REDUNDANT duplicate (e.g. the second beta-blocker / loop diuretic) must be REMOVED, not
        // swapped to another agent in the same group — swapping would preserve the duplication. The
        // keeper covers the class; the duplicate is force-removed downstream.
        if (redundantCurrentMeds.has(current.med.name)) return;
        const group = getMedicationClassGroup(current.med.drug_class);
        // For beta-blockers, MRAs, and SGLT2i, a lateral swap to a DIFFERENT agent in the same
        // class is not how therapy is escalated — you up-titrate the existing agent. Offer such a
        // swap ONLY when the current agent is contraindicated (then it must be replaced). Otherwise
        // skip the swap so dose escalation happens via titrate_up of the current agent. (RAAS keeps
        // swaps for the ACEi/ARB→ARNI guideline upgrade; loop diuretics keep swaps for diuretic
        // resistance / Furoscix.)
        const TITRATE_NOT_SWAP_GROUPS = new Set(['Beta Blocker', 'MRA', 'SGLT2i']);
        if (TITRATE_NOT_SWAP_GROUPS.has(group) && !contraindicatedCurrentMeds.has(current.med.name)) return;
        const sourceContraindicated = contraindicatedCurrentMeds.has(current.med.name);
        const groupTiers = tiersByGroup.get(group) || [];
        let candidates = groupTiers.filter(t =>
            t.med.name !== current.med.name &&
            !contraindicatedCurrentMeds.has(t.med.name) // Don't swap TO a contraindicated med
        );
        // Within the RAAS group, a non-forced swap may only UPGRADE (ACEi/ARB → ARNI, the
        // guideline-preferred agent — PARADIGM-HF). Never recommend the reverse downgrade
        // (ARNI → ACEi/ARB) purely to reach a target dose — that loses the ARNI benefit; the ARNI
        // should be up-titrated instead. (A contraindicated source can still swap to any non-CI
        // alternative.)
        if (group === 'RAAS Inhibitor' && !sourceContraindicated) {
            candidates = candidates.filter(t => t.med.drug_class === 'ARNI' && current.med.drug_class !== 'ARNI');
        }
        if (candidates.length > 0) {
            let prioritizedCandidates = candidates;
            // Ensure FUROSCIX is considered in worsening-congestion loop swaps instead of being truncated by safeSlice.
            if (current.med.drug_class === 'Loop Diuretic' && fluidExcess >= 2.0) {
                const furoscix = candidates.find(t => t.med.name === 'Furoscix (SC Furosemide)');
                if (furoscix) {
                    prioritizedCandidates = [furoscix, ...candidates.filter(t => t !== furoscix)];
                }
            }
            swappable.push({ from: current, candidates: prioritizedCandidates });
        }
    });

    // Removable: diuretics when euvolemic, OR any contraindicated/redundant current med
    const removable: RegimenMed[] = [];
    currentRegimen.forEach(r => {
        // Contraindicated or redundant (dual RAAS/MRA) current meds MUST be flagged for removal
        if (contraindicatedCurrentMeds.has(r.med.name) || redundantCurrentMeds.has(r.med.name)) {
            removable.push(r);
            return;
        }
        if (r.med.drug_class === 'Loop Diuretic' && fluidExcess < 0.5) {
            removable.push(r);
        }
        if (r.med.drug_class === 'Thiazide-like Diuretic' && fluidExcess < 0.5) {
            removable.push(r);
        }
    });

    // Addable pillars: meds for missing GDMT pillars
    const addablePillars = new Map<string, RegimenMed[]>();
    missingPillars.forEach(pillar => {
        const candidates = tiersByGroup.get(pillar) || [];
        if (candidates.length > 0) {
            addablePillars.set(pillar, safeSlice(candidates, 4));
        }
    });

    // Addable adjuncts: criteria-gated
    const addableAdjuncts: RegimenMed[] = [];
    const currentClasses = new Set(currentRegimen.map(r => r.med.drug_class));
    const isBlack = patient.race === 'Black' || patient.race === 'African American';
    const isNyhaIIIorIV = patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    const isSinusRhythm = patient.rhythm === 'Sinus';
    const hasRAASInCurrent = currentClasses.has('ARNI') || currentClasses.has('ACEi') || currentClasses.has('ARB');

    // H/ISDN: A-HeFT evidence is HFrEF-only — offer ONLY in reduced-EF phenotypes, never HFpEF.
    // Within reduced EF: Black + NYHA III-IV (A-HeFT Class I), or as a RAAS alternative when the
    // patient is not on a RAAS inhibitor. (Previously the "no RAAS" branch fired for de-novo HFpEF
    // patients too, since RAAS is not an HFpEF pillar — wrongly surfacing H/ISDN and crowding out
    // genuinely indicated HFpEF adjuncts such as GLP-1.)
    if (!isHFpEF && ((isBlack && isNyhaIIIorIV) || !hasRAASInCurrent)) {
        const hidralazineTiers = medTiers.filter(r => r.med.drug_class === 'Vasodilator');
        if (hidralazineTiers.length > 0 && !currentClasses.has('Vasodilator')) {
            addableAdjuncts.push(hidralazineTiers[0]);
        }
    }

    // Ivabradine: Sinus + HR >= 70 + LVEF <= 35 on a MAXIMALLY-TOLERATED beta-blocker (SHIFT;
    // ESC 2021 Class IIb). The "max tolerated" criterion matters: ivabradine is added only after
    // the beta-blocker is optimized — offering it to a patient on a starting BB dose (e.g.
    // carvedilol 3.125) is wrong and crowds out the indicated BB up-titration. Proxy for
    // "maximally tolerated": BB at its target dose, OR beta-blockers cannot be used at all
    // (allBBExcluded — the SHIFT-eligible "BB-intolerant" fallback).
    const bbAtTarget = currentRegimen.some(r =>
        r.med.drug_class === 'Beta Blocker' &&
        !!r.med.available_doses.find(d => d.strength === r.dose.strength)?.is_target_dose
    );
    const ivabradineEligible = isSinusRhythm && patient.pulse >= 70 && patient.lvef <= 35 &&
        (bbAtTarget || allBBExcluded === true);
    if (ivabradineEligible) {
        const ivabTiers = medTiers.filter(r => r.med.drug_class === 'If Inhibitor');
        if (ivabTiers.length > 0 && !currentClasses.has('If Inhibitor')) {
            addableAdjuncts.push(ivabTiers[0]);
        }
    }

    // Vericiguat: NYHA II-IV + NT-proBNP >= 1600 + LVEF < 45 (VICTORIA trial enrolled NYHA II-IV)
    const isNyhaIIorHigher = patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    const hasWorseningHf = hasRecentWorseningHF(patient);
    if (isNyhaIIorHigher && patient.nt_pro_bnp >= 1600 && patient.lvef < 45 && hasWorseningHf) {
        const verTiers = medTiers.filter(r => r.med.drug_class === 'sGC Stimulator');
        if (verTiers.length > 0 && !currentClasses.has('sGC Stimulator')) {
            addableAdjuncts.push(verTiers[0]);
        }
    }

    // Digoxin: AFib rate control (with or without BB) OR HFrEF symptom reduction (DIG trial)
    const digoxinIndicated =
        patient.rhythm === 'AFib' ||  // Rate control adjunct
        (patient.lvef <= 45 && isNyhaIIIorIV);  // DIG trial: symptomatic HFrEF
    if (digoxinIndicated) {
        const digTiers = medTiers.filter(r => r.med.drug_class === 'Inotrope');
        if (digTiers.length > 0 && !currentClasses.has('Inotrope')) {
            addableAdjuncts.push(digTiers[0]);
        }
    }

    // Diuretics if congested and not already on one
    if (fluidExcess > 1.0 && !currentClasses.has('Loop Diuretic')) {
        const loopTiers = medTiers.filter(r => r.med.drug_class === 'Loop Diuretic');
        if (loopTiers.length > 0) {
            let prioritizedLoopTiers = loopTiers;
            if (fluidExcess >= 3.0) {
                const furoscix = loopTiers.find(r => r.med.name === 'Furoscix (SC Furosemide)');
                if (furoscix) {
                    prioritizedLoopTiers = [furoscix, ...loopTiers.filter(r => r !== furoscix)];
                }
            }
            addableAdjuncts.push(...safeSlice(prioritizedLoopTiers, 2));
        }
    }

    // Thiazide if severe congestion + already on loop
    if (fluidExcess > 4.0 && currentClasses.has('Loop Diuretic')) {
        const thiazTiers = medTiers.filter(r => r.med.drug_class === 'Thiazide-like Diuretic');
        if (thiazTiers.length > 0 && !currentClasses.has('Thiazide-like Diuretic')) {
            addableAdjuncts.push(thiazTiers[0]);
        }
    }

    // Iron if iron-deficient (ESC 2021 / IRONMAN / AFFIRM-AHF — see isIronDeficient)
    const needsIron = isIronDeficient(patient);
    if (needsIron && !currentClasses.has('IV Iron')) {
        const ironTiers = medTiers.filter(r => r.med.drug_class === 'IV Iron');
        if (ironTiers.length > 0) {
            addableAdjuncts.push(ironTiers[0]);
        }
    }

    // nsMRA (Finerenone) for HFpEF as adjunct — FINEARTS-HF, LVEF ≥ 40, FDA approved
    // In HFmrEF, nsMRA is already offered as a pillar option (grouped with MRA)
    // In HFpEF, MRA is NOT a pillar, so nsMRA must be added as adjunct
    if (isHFpEF && patient.lvef >= 40 && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const nsmraTiers = medTiers.filter(r => r.med.drug_class === 'nsMRA');
        if (nsmraTiers.length > 0) {
            addableAdjuncts.push(nsmraTiers[0]);
        }
    }

    // Steroidal MRA for HFpEF — TOPCAT Americas, Class IIb (ACC/AHA 2022 §7.4)
    // Cost-effective alternative to Finerenone; offered alongside nsMRA as separate candidate
    // getMedicationClassGroup groups nsMRA→MRA, preventing dual MRA in same regimen
    if (isHFpEF && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const steroidalMraTiers = medTiers.filter(r => r.med.drug_class === 'MRA');
        if (steroidalMraTiers.length > 0) {
            addableAdjuncts.push(steroidalMraTiers[0]);
        }
    }

    // GLP-1 if obese + HFpEF/HFmrEF (STEP-HFpEF, SUMMIT trials — no evidence for HFrEF or HFimpEF)
    // HFimpEF is managed as HFrEF — GLP-1 not appropriate despite LVEF >= 40
    if (patient.bmi >= 30 && patient.lvef >= 40 && !isHFimpEF && !currentClasses.has('GLP-1 RA') && !currentClasses.has('GLP-1/GIP RA')) {
        const glpTiers = medTiers.filter(r => r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA');
        if (glpTiers.length > 0) {
            // Pick best GLP-1 by KCCQ improvement
            const sorted = glpTiers.sort((a, b) => b.med.chf_effects(0).kccq_improvement - a.med.chf_effects(0).kccq_improvement);
            addableAdjuncts.push(sorted[0]);
        }
    }

    return {
        currentClassMap,
        missingPillars,
        titratableUp,
        titratableDown,
        swappable,
        removable,
        addableAdjuncts,
        addablePillars,
        contraindicatedCurrentMeds,
        forcedBbDownTitrateNames,
        redundantCurrentMeds
    };
}

const safeSlice = (arr: RegimenMed[], n = 2) => arr.slice(0, n);

function buildResultingRegimen(
    currentRegimen: RegimenMed[],
    modifications: RegimenModification[]
): RegimenMed[] {
    const result: RegimenMed[] = [];
    const modifiedSources = new Set<string>();

    modifications.forEach(mod => {
        if (mod.action === 'remove' && mod.source) {
            modifiedSources.add(mod.source.med.name);
        }
        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down' || mod.action === 'swap') && mod.source) {
            modifiedSources.add(mod.source.med.name);
        }
        if (mod.action === 'add' && mod.target) {
            result.push(mod.target);
        }
        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down') && mod.target) {
            result.push(mod.target);
        }
        if (mod.action === 'swap' && mod.target) {
            result.push(mod.target);
        }
    });

    // Keep all current meds that weren't touched by a modification
    currentRegimen.forEach(r => {
        if (!modifiedSources.has(r.med.name)) {
            result.push(r);
        }
    });

    return result;
}

function formatDose(r: RegimenMed): string {
    return `${r.dose.strength}${r.dose.unit} ${r.selected_frequency}`;
}

function formatSwapSummary(from: RegimenMed, to: RegimenMed): string {
    if (from.med.drug_class === 'ACEi' && to.med.drug_class === 'ARNI') {
        return `STOP ${from.med.name}. WAIT 36 hours. THEN start ${to.med.name} ${formatDose(to)}`;
    }
    return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)}`;
}

function generateCandidateModifications(
    analysis: RegimenAnalysis,
    patient: Patient,
    binders: RegimenMed[]
): ModificationSet[] {
    const currentRegimen = patient.current_regimen || [];
    const candidates: ModificationSet[] = [];

    // --- a) Single modifications ---

    // Add missing pillar meds
    analysis.addablePillars.forEach((meds, _pillar) => {
        meds.forEach(med => {
            const mods: RegimenModification[] = [{
                action: 'add',
                target: med,
                summary: `Add ${med.med.name} ${formatDose(med)}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Titrate up
    analysis.titratableUp.forEach(({ current, options }) => {
        options.forEach(higher => {
            const mods: RegimenModification[] = [{
                action: 'titrate_up',
                source: current,
                target: higher,
                summary: `Titrate ${current.med.name} ${current.dose.strength}→${higher.dose.strength}${higher.dose.unit} ${higher.selected_frequency}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Titrate down
    analysis.titratableDown.forEach(({ current, options }) => {
        options.forEach(lower => {
            const mods: RegimenModification[] = [{
                action: 'titrate_down',
                source: current,
                target: lower,
                summary: `Reduce ${current.med.name} ${current.dose.strength}→${lower.dose.strength}${lower.dose.unit} ${lower.selected_frequency}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Swaps
    analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
        safeSlice(swapCandidates, 3).forEach(to => {
            const mods: RegimenModification[] = [{
                action: 'swap',
                source: from,
                target: to,
                summary: formatSwapSummary(from, to)
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Removals
    analysis.removable.forEach(med => {
        const mods: RegimenModification[] = [{
            action: 'remove',
            source: med,
            summary: `Remove ${med.med.name} ${formatDose(med)}`
        }];
        candidates.push({
            modifications: mods,
            resulting_regimen: buildResultingRegimen(currentRegimen, mods)
        });
    });

    // Add adjuncts
    analysis.addableAdjuncts.forEach(adj => {
        const mods: RegimenModification[] = [{
            action: 'add',
            target: adj,
            summary: `Add ${adj.med.name} ${formatDose(adj)}`
        }];
        candidates.push({
            modifications: mods,
            resulting_regimen: buildResultingRegimen(currentRegimen, mods)
        });
    });

    // --- b) Compound modifications (2-3 changes) ---
    const maxNewPerVisit = Math.max(0, Math.round(patient.max_new_classes_per_visit ?? 2));

    // Pair missing-pillar additions
    const pillarEntries = Array.from(analysis.addablePillars.entries());
    if (pillarEntries.length >= 2 && maxNewPerVisit >= 2) {
        for (let i = 0; i < pillarEntries.length; i++) {
            for (let j = i + 1; j < pillarEntries.length; j++) {
                // Pick best candidate from each pillar (first one)
                const med1 = pillarEntries[i][1][0];
                const med2 = pillarEntries[j][1][0];
                if (med1 && med2) {
                    const mods: RegimenModification[] = [
                        { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                        { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            }
        }

        // Triple pillar additions
        if (pillarEntries.length >= 3 && maxNewPerVisit >= 3) {
            for (let i = 0; i < pillarEntries.length; i++) {
                for (let j = i + 1; j < pillarEntries.length; j++) {
                    for (let k = j + 1; k < pillarEntries.length; k++) {
                        const med1 = pillarEntries[i][1][0];
                        const med2 = pillarEntries[j][1][0];
                        const med3 = pillarEntries[k][1][0];
                        if (med1 && med2 && med3) {
                            const mods: RegimenModification[] = [
                                { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                                { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` },
                                { action: 'add', target: med3, summary: `Add ${med3.med.name} ${formatDose(med3)}` }
                            ];
                            candidates.push({
                                modifications: mods,
                                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                            });
                        }
                    }
                }
            }
        }

        // Quad pillar additions
        if (pillarEntries.length >= 4 && maxNewPerVisit >= 4) {
            const med1 = pillarEntries[0][1][0];
            const med2 = pillarEntries[1][1][0];
            const med3 = pillarEntries[2][1][0];
            const med4 = pillarEntries[3][1][0];
            if (med1 && med2 && med3 && med4) {
                const mods: RegimenModification[] = [
                    { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                    { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` },
                    { action: 'add', target: med3, summary: `Add ${med3.med.name} ${formatDose(med3)}` },
                    { action: 'add', target: med4, summary: `Add ${med4.med.name} ${formatDose(med4)}` }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            }
        }
    }

    // Combine addition + titration
    if (pillarEntries.length > 0 && analysis.titratableUp.length > 0 && maxNewPerVisit >= 1) {
        const topPillarMed = pillarEntries[0][1][0];
        if (topPillarMed) {
            analysis.titratableUp.forEach(({ current, options }) => {
                const bestHigher = options[options.length - 1]; // highest dose option
                if (bestHigher) {
                    const mods: RegimenModification[] = [
                        { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` },
                        { action: 'titrate_up', source: current, target: bestHigher, summary: `Titrate ${current.med.name} ${current.dose.strength}→${bestHigher.dose.strength}${bestHigher.dose.unit}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        }
    }

    // Combine swap + addition
    if (analysis.swappable.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 1) {
        const topPillarMed = pillarEntries[0][1][0];
        if (topPillarMed) {
            analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
                const bestSwap = swapCandidates[0];
                if (bestSwap) {
                    const mods: RegimenModification[] = [
                        { action: 'swap', source: from, target: bestSwap, summary: formatSwapSummary(from, bestSwap) },
                        { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        }
    }

    // Combine adjunct + pillar addition or adjunct + titration
    if (analysis.addableAdjuncts.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 2) {
        analysis.addableAdjuncts.forEach(adj => {
            const topPillarMed = pillarEntries[0][1][0];
            if (topPillarMed) {
                const mods: RegimenModification[] = [
                    { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` },
                    { action: 'add', target: adj, summary: `Add ${adj.med.name} ${formatDose(adj)}` }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            }
        });
    }

    // Combine adjunct + swap
    if (analysis.addableAdjuncts.length > 0 && analysis.swappable.length > 0) {
        analysis.addableAdjuncts.forEach(adj => {
            analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
                const bestSwap = swapCandidates[0];
                if (bestSwap) {
                    const mods: RegimenModification[] = [
                        { action: 'swap', source: from, target: bestSwap, summary: formatSwapSummary(from, bestSwap) },
                        { action: 'add', target: adj, summary: `Add ${adj.med.name} ${formatDose(adj)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        });
    }

    // --- c) "No change" baseline for comparison when current regimen exists ---
    if (currentRegimen.length > 0 && analysis.forcedBbDownTitrateNames.size === 0) {
        candidates.push({
            modifications: currentRegimen.map(r => ({
                action: 'keep' as ModificationAction,
                source: r,
                summary: `Keep ${r.med.name} ${formatDose(r)}`
            })),
            resulting_regimen: [...currentRegimen]
        });
    }

    // --- d) Binder rescue: for candidates projecting K+ > 5.3 ---
    // This will be handled during simulation, not at generation time

    // --- e) Force-remove contraindicated AND redundant current meds from ALL candidates ---
    // Contraindicated: e.g. a patient on ACEi who becomes pregnant must not retain ACEi anywhere.
    // Redundant: a patient on dual RAAS / dual MRA must have the duplicate deprescribed in every
    // candidate — otherwise all candidates retain the duplicate and get filtered out (empty output).
    const contraindicated = analysis.contraindicatedCurrentMeds;
    const redundant = analysis.redundantCurrentMeds;
    if (contraindicated.size > 0 || redundant.size > 0) {
        const forcedRemovals: RegimenModification[] = [];
        currentRegimen.forEach(r => {
            // Contraindication takes precedence in the displayed reason.
            if (contraindicated.has(r.med.name)) {
                forcedRemovals.push({ action: 'remove', source: r, summary: `Remove ${r.med.name} (contraindicated)` });
            } else if (redundant.has(r.med.name)) {
                forcedRemovals.push({ action: 'remove', source: r, summary: `Remove ${r.med.name} (redundant — deprescribe duplicate ${getMedicationClassGroup(r.med.drug_class)} therapy)` });
            }
        });

        candidates.forEach(c => {
            forcedRemovals.forEach(forced => {
                const alreadyRemoved = c.modifications.some(m =>
                    m.action === 'remove' && m.source?.med.name === forced.source!.med.name
                );
                const alreadySwapped = c.modifications.some(m =>
                    m.action === 'swap' && m.source?.med.name === forced.source!.med.name
                );
                if (!alreadyRemoved && !alreadySwapped) {
                    // Coherence: a med that is being force-removed must not also carry a
                    // titrate/keep modification in the same candidate (would render as the
                    // incoherent "down-titrate AND remove the same drug" in one visit).
                    c.modifications = c.modifications.filter(m =>
                        !((m.action === 'titrate_up' || m.action === 'titrate_down' || m.action === 'keep')
                            && m.source?.med.name === forced.source!.med.name)
                    );
                    c.modifications.push(forced);
                    c.resulting_regimen = c.resulting_regimen.filter(
                        r => r.med.name !== forced.source!.med.name
                    );
                }
            });
        });
    }

    // --- f) Force-inject the acute-decompensation BB dose REDUCTION into every candidate that
    // doesn't already reduce/remove/swap that beta-blocker. Without this, the only candidate that
    // satisfied the forced-reduction filter (below) was the bare "reduce BB" set — every guideline
    // ADDITION (add SGLT2i, add MRA) kept the BB at full dose and was filtered out, leaving a
    // cold-and-wet HFrEF patient with "reduce your beta-blocker and add nothing." Injecting the
    // reduction lets safe additions (esp. SGLT2i, beneficial in acute HF) survive alongside it.
    if (analysis.forcedBbDownTitrateNames.size > 0) {
        analysis.forcedBbDownTitrateNames.forEach(bbName => {
            const td = analysis.titratableDown.find(t => t.current.med.name === bbName);
            if (!td || td.options.length === 0) return;
            const lower = td.options.reduce((a, b) =>
                Number(b.dose.strength) < Number(a.dose.strength) ? b : a
            );
            candidates.forEach(c => {
                const alreadyHandled = c.modifications.some(m =>
                    (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap')
                    && m.source?.med.name === bbName
                );
                if (alreadyHandled) return;
                // Drop any incoherent up-titration / keep of the same BB before injecting the cut.
                c.modifications = c.modifications.filter(m =>
                    !((m.action === 'titrate_up' || m.action === 'keep') && m.source?.med.name === bbName)
                );
                c.modifications.push({
                    action: 'titrate_down',
                    source: td.current,
                    target: lower,
                    summary: `Reduce ${bbName} ${td.current.dose.strength}→${lower.dose.strength}${lower.dose.unit} ${lower.selected_frequency} (acute decompensation with hypoperfusion)`
                });
                c.resulting_regimen = c.resulting_regimen.map(r => (r.med.name === bbName ? lower : r));
            });
        });
    }

    // Filter by max_new_classes_per_visit
    return candidates.filter(c => {
        // A forced BB dose-reduction (acute decompensation) is satisfied by EITHER a down-titration
        // OR a removal. Removal is the stronger reduction and is the correct action when the BB is
        // also contraindicated (e.g. decompensated HF + new bronchospasm). Without the `remove`
        // branch, such a patient would have every candidate filtered out → zero recommendations.
        const satisfiesForcedBbDownTitration =
            analysis.forcedBbDownTitrateNames.size === 0 ||
            Array.from(analysis.forcedBbDownTitrateNames).every(bbName =>
                c.modifications.some(m =>
                    (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.name === bbName
                )
            );
        const newClassCount = countNewClassGroups(c.resulting_regimen, currentRegimen);
        const hasSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'MRA');
        const hasNonSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'nsMRA');
        const hasDualMRA = hasSteroidalMRA && hasNonSteroidalMRA;
        // M4: Structural block for dual RAAS (ACEi+ARB, ACEi+ARNI, etc.) — not just warning
        const raasInRegimen = c.resulting_regimen.filter(r => RAAS_CLASSES.has(r.med.drug_class));
        const hasDualRAAS = raasInRegimen.length > 1;
        return satisfiesForcedBbDownTitration && newClassCount <= maxNewPerVisit && !hasDualMRA && !hasDualRAAS;
    });
}

// --- 1. Scoring Logic (The 6 Domains) ---

/**
 * Domain 1: Neurohormonal (NT-proBNP)
 * Target < 125 (100pts). Critical >= 4000 (0pts).
 */
function calculateNeurohormonalScore(bnp: number): number {
    if (bnp <= 125) return 100;
    if (bnp >= 4000) return 0;
    // Linear interpolation
    return 100 - ((bnp - 125) / (4000 - 125) * 100);
}

/**
 * Domain 2: Functional Status (NYHA + KCCQ + Steps)
 * NYHA: I(100), II(75), III(40), IV(10).
 * KCCQ: 0-100 direct.
 * Steps: <2000 (Low), >5000 (High).
 */
function calculateFunctionalScore(nyha: string, kccq: number, steps?: number): number {
    const nyhaMap: Record<string, number> = { "I": 100, "II": 75, "III": 40, "IV": 10 };
    const nyhaScore = nyhaMap[nyha] || 0;

    let totalScore = nyhaScore + kccq;
    let divisor = 2;

    if (steps !== undefined) {
        // Map steps: 0 steps = 0 pts, 7000 steps = 100 pts.
        const stepScore = Math.min(100, (steps / 7000) * 100);
        totalScore += stepScore;
        divisor += 1;
    }

    return totalScore / divisor;
}

/**
 * Domain 3: Volume Status
 * Base 100. Penalty for weight gain (>1kg), exam findings, and low SpO2.
 */
function calculateVolumeScore(dryWeight: number, currentWeight: number, findings: Set<string>, spo2?: number): number {
    let score = 100;
    const diff = currentWeight - dryWeight;

    // Weight Penalty: -15 pts per kg above 1kg buffer
    if (diff > 1.0) {
        score -= (diff - 1.0) * 15;
    }

    // Findings Penalty: -10 pts per finding
    score -= (findings.size * 10);

    // SpO2 Penalty (Surrogate for Pulmonary Congestion)
    if (spo2 !== undefined) {
        if (spo2 < 90) score -= 20; // Severe/Hypoxia
        else if (spo2 < 94) score -= 10; // Mild-Mod
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * LVEF severity category (Aimo et al. 2021, ESC HF)
 * Used for reverse remodeling bonus — crossing categories is strongly prognostic.
 */
function getLvefCategory(lvef: number): number {
    if (lvef <= 30) return 0; // Severe
    if (lvef <= 40) return 1; // Moderate
    if (lvef <= 55) return 2; // Mild
    return 3; // Normal
}

/**
 * Domain 4: Structure (Cardiac Remodeling & Recovery)
 * Blended: 40% absolute state + 40% improvement trajectory + 20% chamber geometry.
 * A score of 0 = severe untreated cardiomyopathy with no treatment response.
 *
 * Absolute (40%): Piecewise-linear LVEF (ACC/AHA 2022, ceiling 55%).
 *   15→0, 25→15, 35→40, 45→70, 55→100. Gives more resolution in HFrEF range.
 *
 * Improvement (40%): Sqrt-scaled LVEF delta / achievable gap (Aimo 2021, Kan 2023).
 *   Near-normal baselines get a normality floor so HFpEF isn't penalized for
 *   having little room to improve. Category crossing adds +10.
 *
 * Chamber (20%): Projected LVEDD/LAVI severity (ASE/EACVI) + direction-of-change.
 *   Improving >5% → +20, worsening >5% → −20. Neutral 50 when echo data unavailable.
 */
function calculateStructureScore(
    lvef: number, lvedd: number | undefined, lavi: number | undefined,
    baselineLvef: number, baselineLvedd?: number, baselineLavi?: number
): number {
    // --- Component 1: Absolute State (0-100) ---
    // Piecewise-linear: gives clinical resolution at each severity tier
    let absoluteScore: number;
    if (lvef >= 55) absoluteScore = 100;
    else if (lvef >= 45) absoluteScore = 70 + ((lvef - 45) / 10) * 30;  // Near-normal
    else if (lvef >= 35) absoluteScore = 40 + ((lvef - 35) / 10) * 30;  // HFmrEF / mild
    else if (lvef >= 25) absoluteScore = 15 + ((lvef - 25) / 10) * 25;  // Moderate HFrEF
    else if (lvef >= 15) absoluteScore = ((lvef - 15) / 10) * 15;       // Severe HFrEF
    else absoluteScore = 0;                                               // Incompatible w/ life

    // --- Component 2: Improvement Trajectory (0-100) ---
    const achievableGap = Math.max(5, 55 - baselineLvef); // floor avoids /0
    const lvefDelta = Math.max(0, lvef - baselineLvef);
    const ratio = Math.min(1, lvefDelta / achievableGap);
    let improvementScore = Math.sqrt(ratio) * 100; // concave: partial gains rewarded

    // Category crossing bonus (Aimo 2021) — crossing severe→moderate→mild→normal is prognostic
    if (getLvefCategory(lvef) > getLvefCategory(baselineLvef)) {
        improvementScore = Math.min(100, improvementScore + 10);
    }

    // Normality floor: near-normal baselines shouldn't be penalized for limited room to improve
    // LVEF 55 → floor 80; LVEF 20 → floor 0; linear ramp
    const gapToNormal = Math.max(0, 55 - baselineLvef);
    const normalityFloor = Math.max(0, (1 - gapToNormal / 35) * 80);
    improvementScore = Math.max(normalityFloor, improvementScore);

    // --- Component 3: Chamber Geometry (0-100) ---
    const chamberScores: number[] = [];

    if (lvedd && lvedd > 0) {
        // LVEDD severity base (ASE/EACVI grading)
        let lveddScore: number;
        if (lvedd <= 52) lveddScore = 100;       // Normal
        else if (lvedd <= 56) lveddScore = 75;   // Borderline
        else if (lvedd <= 62) lveddScore = 50;   // Mild dilation
        else if (lvedd <= 68) lveddScore = 25;   // Moderate dilation
        else lveddScore = 0;                      // Severe dilation

        // Direction modifier: reward shrinkage, penalize growth
        if (baselineLvedd && baselineLvedd > 0) {
            const pctReduction = (baselineLvedd - lvedd) / baselineLvedd;
            if (pctReduction > 0.05) lveddScore += 20;
            else if (pctReduction > 0.01) lveddScore += 10;
            else if (pctReduction < -0.05) lveddScore -= 20;
            else if (pctReduction < -0.01) lveddScore -= 10;
        }
        chamberScores.push(Math.max(0, Math.min(100, lveddScore)));
    }

    if (lavi && lavi > 0) {
        // LAVI severity base
        let laviScore: number;
        if (lavi <= 28) laviScore = 100;         // Normal
        else if (lavi <= 34) laviScore = 75;     // Mild
        else if (lavi <= 40) laviScore = 50;     // Moderate
        else if (lavi <= 48) laviScore = 25;     // Moderate-severe
        else laviScore = 0;                       // Severe

        // Direction modifier
        if (baselineLavi && baselineLavi > 0) {
            const pctReduction = (baselineLavi - lavi) / baselineLavi;
            if (pctReduction > 0.05) laviScore += 20;
            else if (pctReduction > 0.01) laviScore += 10;
            else if (pctReduction < -0.05) laviScore -= 20;
            else if (pctReduction < -0.01) laviScore -= 10;
        }
        chamberScores.push(Math.max(0, Math.min(100, laviScore)));
    }

    const chamberScore = chamberScores.length > 0
        ? chamberScores.reduce((a, b) => a + b, 0) / chamberScores.length
        : 50; // Neutral when no echo data available

    // --- Blend: 40% absolute + 40% improvement + 20% chamber ---
    const blended = absoluteScore * 0.40 + improvementScore * 0.40 + chamberScore * 0.20;
    return Math.max(0, Math.min(100, blended));
}

/**
 * Domain 5: Cost (Financial Toxicity)
 * 100 = Free/Under Budget. 
 * Updated Logic: Apply 'sensitivity' (sting) penalty even when under budget.
 * Sensitivity 0 = Spend freely (Score stays 100).
 * Sensitivity 10 = Frugal (Score drops as utilization approaches 100%).
 * Zero-budget mode: only $0 regimens score as fully affordable.
 */
function calculateCostScore(cost: number, budget: number, sensitivity: number): number {
    const normalizedSensitivity = Math.max(0, Math.min(10, sensitivity)) / 10;

    if (budget <= 0) {
        // Zero-budget mode: only no-cost regimens are financially viable.
        return cost <= 0 ? 100 : Math.max(0, 100 - (cost * (5 + (normalizedSensitivity * 5))));
    }

    const effectiveBudget = budget;

    // Over Budget Logic: sensitivity-aware penalty for smooth transition at boundary
    if (cost > effectiveBudget) {
        const baseOverBudgetScore = (effectiveBudget / cost) * 100;
        const sensitivityPenalty = normalizedSensitivity * 30;
        return Math.max(0, Math.min(100, baseOverBudgetScore - sensitivityPenalty));
    }

    // Under/At Budget Logic:
    // Utilization ratio (0.0 to 1.0)
    const utilization = cost / effectiveBudget;

    // Penalty factor (0.0 to 1.0) based on sensitivity
    const penaltyFactor = normalizedSensitivity;

    // Max penalty at 100% utilization with Max Sensitivity is 25 points.
    // e.g., spending $100 of $100 budget with Sens 10 -> Score 75 (affordable, just felt).
    // spending $100 of $100 budget with Sens 0 -> Score 100 (no concern).
    // spending $50 of $100 budget with Sens 10 -> Score 87.5 (comfortable).
    const score = 100 - (utilization * penaltyFactor * 25);

    return Math.max(0, Math.min(100, score));
}

/**
 * Domain 6: Adherence (Complexity vs Tolerance)
 * 100 = Complexity well below tolerance. 
 * Formula: 100 * (ToleranceThreshold / Complexity)
 */
function calculateAdherenceScore(complexity: number, toleranceInput: number): number {
    // Convert 0-10 tolerance scale to a complexity threshold
    // Tolerance 0 -> Threshold 2 (Can handle ~1 drug BID)
    // Tolerance 5 -> Threshold 11 (Can handle Quad therapy)
    // Tolerance 10 -> Threshold 20 (Unlimited)
    const threshold = 2 + (toleranceInput * 1.8);

    const effectiveComplexity = Math.max(1, complexity);

    if (effectiveComplexity <= threshold) return 100;

    // Decay: If complexity is double the tolerance, score is 50.
    return Math.max(0, Math.min(100, (threshold / effectiveComplexity) * 100));
}

/**
 * Domain 7: Guideline Concordance (2022 AHA/ACC/HFSA)
 * Scores alignment with evidence-based GDMT recommendations — 3-tier phenotype.
 *
 * HFrEF (LVEF ≤ 40): All 4 pillars Class I — 20 pts each (max 80) + 5 pts/pillar at target (max 20) = 100.
 * HFmrEF (LVEF 41-49): RAAS+SGLT2i Class I (22 pts each), BB+MRA Class IIb (13 pts each) = 70 max
 *   + 5 pts/pillar at target (max 20) + volume management (10) = 100.
 * HFpEF (LVEF ≥ 50): SGLT2i (70) + target dose (15) + volume management (15) = 100.
 */
// =====================================================================================
// GUIDELINE-CONCORDANCE EVIDENCE TABLE — evidence as data, not magic numbers.
//
// Each phenotype declares, per GDMT pillar: the recommendation class + landmark trials
// (the WHY) and the points that class is worth in this phenotype (calibrated to evidence
// strength: Class I = 20-22, IIa ≈ 22, IIb = 8-13). The scorer below is a single generic
// pass over this table — the three former hardcoded phenotype branches are gone. Adding a
// pillar/phenotype, or restating evidence as trials mature, is now a data edit here.
// =====================================================================================
type PillarKey = 'RAAS' | 'BB' | 'MRA' | 'SGLT2i';
type RecClass = 'I' | 'IIa' | 'IIb' | 'III';
interface PillarConcordance { base: number; targetBonus: number; recClass: RecClass; trials: string; }
type Phenotype = 'HFrEF' | 'HFmrEF' | 'HFpEF';
interface PhenoConcordance {
    pillars: Partial<Record<PillarKey, PillarConcordance>>;
    targetBonusCap: number;   // cap on summed at-target bonuses
    volumeBonus: number;      // awarded when euvolemic or on a diuretic
}

const CONCORDANCE_TABLE: Record<Phenotype, PhenoConcordance> = {
    HFrEF: {
        pillars: {
            RAAS:   { base: 20, targetBonus: 5, recClass: 'I', trials: 'PARADIGM-HF / SOLVD' },
            BB:     { base: 20, targetBonus: 5, recClass: 'I', trials: 'MERIT-HF / COPERNICUS / CIBIS-II' },
            MRA:    { base: 20, targetBonus: 5, recClass: 'I', trials: 'RALES / EMPHASIS-HF' },
            SGLT2i: { base: 20, targetBonus: 5, recClass: 'I', trials: 'DAPA-HF / EMPEROR-Reduced' },
        },
        targetBonusCap: Infinity,
        volumeBonus: 0,
    },
    HFmrEF: {
        pillars: {
            RAAS:   { base: 22, targetBonus: 5, recClass: 'IIb', trials: 'ACC/AHA 2022 §7.3.2 (CHARM subgroup)' },
            SGLT2i: { base: 22, targetBonus: 5, recClass: 'IIa', trials: 'DELIVER / EMPEROR-Preserved (LVEF 41-49)' },
            BB:     { base: 13, targetBonus: 5, recClass: 'IIb', trials: 'subgroup / observational' },
            MRA:    { base: 13, targetBonus: 5, recClass: 'IIb', trials: 'TOPCAT (LVEF 45-49)' },
        },
        targetBonusCap: 20,
        volumeBonus: 10,
    },
    HFpEF: {
        pillars: {
            SGLT2i: { base: 70, targetBonus: 15, recClass: 'I', trials: 'EMPEROR-Preserved / DELIVER' },
            MRA:    { base: 8, targetBonus: 0, recClass: 'IIb', trials: 'TOPCAT Americas / FINEARTS-HF' },
        },
        targetBonusCap: Infinity,
        volumeBonus: 15,
    },
};

function pillarKeyOf(drugClass: string): PillarKey | null {
    if (RAAS_CLASSES.has(drugClass)) return 'RAAS';
    if (drugClass === 'Beta Blocker') return 'BB';
    if (drugClass === 'MRA' || drugClass === 'nsMRA') return 'MRA';
    if (drugClass === 'SGLT2i') return 'SGLT2i';
    return null;
}

function classifyPhenotype(patient: Patient): Phenotype {
    const preserveQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    const isHFimpEF = patient.lvef > 40 && (hasHistoricalHFrEF(patient) || preserveQuadForUnknownHistory);
    if (isHFimpEF) return 'HFrEF';            // HFimpEF continues full HFrEF pillar expectations
    if (patient.lvef >= 50) return 'HFpEF';
    if (patient.lvef >= 41) return 'HFmrEF';
    return 'HFrEF';
}

// Returns, per pillar present in the regimen, whether it is at target dose.
function pillarsPresentAtTarget(regimen: RegimenMed[]): Map<PillarKey, boolean> {
    const present = new Map<PillarKey, boolean>();
    regimen.forEach(r => {
        const key = pillarKeyOf(r.med.drug_class);
        if (!key) return;
        const atTarget = !!r.med.available_doses.find(d => d.strength === r.dose.strength)?.is_target_dose;
        present.set(key, (present.get(key) ?? false) || atTarget);
    });
    return present;
}

function calculateGuidelineConcordanceScore(resultingRegimen: RegimenMed[], patient: Patient): number {
    const table = CONCORDANCE_TABLE[classifyPhenotype(patient)];
    const present = pillarsPresentAtTarget(resultingRegimen);

    let score = 0;
    let targetBonusSum = 0;
    (Object.entries(table.pillars) as [PillarKey, PillarConcordance][]).forEach(([key, ev]) => {
        if (!present.has(key)) return;
        score += ev.base;
        if (present.get(key)) targetBonusSum += ev.targetBonus;
    });
    score += Math.min(table.targetBonusCap, targetBonusSum);

    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const hasDiuretic = resultingRegimen.some(r => DIURETIC_CLASSES.has(r.med.drug_class));
    if (fluidExcess <= 1.0 || hasDiuretic) score += table.volumeBonus;

    return Math.min(100, score);
}

// Surfaceable evidence for the pillars actually present — the "why" behind the concordance score.
function describeConcordance(resultingRegimen: RegimenMed[], patient: Patient): string[] {
    const table = CONCORDANCE_TABLE[classifyPhenotype(patient)];
    const present = pillarsPresentAtTarget(resultingRegimen);
    const labels: Record<PillarKey, string> = { RAAS: 'RAAS inhibitor', BB: 'Beta-blocker', MRA: 'MRA', SGLT2i: 'SGLT2i' };
    const out: string[] = [];
    (Object.keys(table.pillars) as PillarKey[]).forEach(key => {
        if (!present.has(key)) return;
        const ev = table.pillars[key]!;
        out.push(`Guideline: ${labels[key]} — Class ${ev.recClass} (${ev.trials})`);
    });
    return out;
}

// --- DBP Coupling: Drug-class-specific SBP→DBP ratios ---
// Vasodilators widen pulse pressure (DBP drops less); BB drops DBP proportionally.
//
// Evidence basis for each ratio:
//   RAAS (0.50): PARADIGM-HF — sacubitril/valsartan reduced SBP ~3.2 mmHg vs enalapril
//     with proportionally smaller DBP effect due to arterial vasodilation (pulse pressure widening).
//   BB (0.70): COPERNICUS, MERIT-HF — beta-blockers reduce cardiac output symmetrically,
//     dropping SBP and DBP in roughly proportional fashion. 0.70 accounts for mild reflex.
//   Diuretics (0.50): Volume unloading reduces preload more than afterload.
//   SGLT2i (0.40): DAPA-HF, EMPA-REG — osmotic/natriuretic mechanism lowers SBP ~2-4 mmHg
//     with minimal DBP effect (primarily preload, not arterial tone).
//   H/ISDN (0.50): A-HeFT — direct arteriolar/venous vasodilation widens pulse pressure.
//   sGC Stimulator (0.55): VICTORIA — vericiguat has modest balanced vasodilation.
//   nsMRA (0.50): FINEARTS-HF — anti-fibrotic with mild natriuretic (preload-dominant).
function getDbpRatio(drugClass: string): number {
    return DRUG_CLASS_REGISTRY[drugClass]?.dbpRatio ?? 0.60;
}

// --- 3. Modification-Based Simulation (Delta Engine) ---

function simulateModificationEffect(
    currentPatient: Patient,
    modificationSet: ModificationSet,
    prices: Record<string, number>
): {
    projectedPatient: Patient;
    cost: number;
    complexity: number;
    warnings: string[];
    rationale: string[];
    specialFeatureBonus: number;
} {
    const proj = clonePatient(currentPatient);
    const resultingRegimen = modificationSet.resulting_regimen;

    let totalCost = 0;
    let complexityScore = 0;
    const warnings: string[] = [];
    const rationale: string[] = [];

    // Accumulators for MARGINAL deltas (only from changed meds)
    let lvefDelta = 0;
    let bnpFactor = 1.0; // Multiplicative factor applied to current BNP
    let weightDelta = 0;
    let kccqDelta = 0;
    let laviFactorTotal = 1.0; // Multiplicative for percentage-based
    let lveddFactorTotal = 1.0;

    let sbpDelta = 0;
    let dbpDelta = 0; // Drug-class-specific DBP tracking (Finding 12)
    let hrDelta = 0;
    let kDelta = 0;
    let specialFeatureBonus = 0;

    // Track drug types from RESULTING regimen for interaction checks
    let hasDiuretic = false;
    let hasSGLT2 = false;
    let hasRAAS = false;
    let hasMRA = false;
    let hasBeta = false;
    let hasIvabradine = false;
    let hasGLP1 = false;
    let raasCount = 0;
    let diureticEffectStrength = 0;

    // Renal risk factor for K+ retention
    // When initiating/up-titrating RAAS or MRA, expect ~15% acute eGFR decline (hemodynamically mediated)
    // Use projected eGFR for risk stratification rather than baseline
    const isAddingRAASorMRA = modificationSet.modifications.some(mod =>
        (mod.action === 'add' || mod.action === 'titrate_up' || mod.action === 'swap') &&
        mod.target && (['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA'].includes(mod.target.med.drug_class))
    );
    const effectiveEgfr = isAddingRAASorMRA
        ? currentPatient.egfr * 0.85  // Expected 15% decline post-RAAS/MRA initiation
        : currentPatient.egfr;

    let renalRiskFactor = 1.0;
    if (effectiveEgfr < 60) renalRiskFactor = 1.2;
    if (effectiveEgfr < 45) renalRiskFactor = 1.5;
    if (effectiveEgfr < 30) renalRiskFactor = 2.0;

    // Track drug types from resulting regimen (for synergy/safety checks)
    resultingRegimen.forEach(r => {
        const cls = r.med.drug_class;
        const dose = r.dose.strength;
        if (cls === 'Loop Diuretic') { hasDiuretic = true; diureticEffectStrength += r.med.chf_effects(dose).weight_reduction_kg; }
        if (cls === 'SGLT2i') hasSGLT2 = true;
        if (cls === 'MRA' || cls === 'nsMRA') hasMRA = true;
        if (cls === 'Beta Blocker') hasBeta = true;
        if (cls === 'If Inhibitor') hasIvabradine = true;
        if (cls === 'GLP-1 RA' || cls === 'GLP-1/GIP RA') hasGLP1 = true;
        if (['ARNI', 'ACEi', 'ARB'].includes(cls)) { hasRAAS = true; raasCount++; }

        // Cost and complexity for FULL resulting regimen
        totalCost += prices[r.med.name] ?? 20;
        let medComplexity = 1;
        if (r.dose.formulation.includes('SQ') || r.dose.formulation.includes('Weekly')) medComplexity = 2;
        else if (r.selected_frequency === 'bid') medComplexity = 2;
        else if (r.selected_frequency === 'tid') medComplexity = 4;
        complexityScore += medComplexity;
    });

    // Process each modification for marginal deltas
    modificationSet.modifications.forEach(mod => {
        const BNP_CAP = 0.8; // Cap BNP reduction at 80% to prevent division-by-near-zero

        if (mod.action === 'keep') {
            // No delta — effects already baked into observed state
            return;
        }

        if (mod.action === 'add' && mod.target) {
            const dose = mod.target.dose.strength;
            const chf = mod.target.med.chf_effects(dose);
            const hemo = mod.target.med.hemodynamic_effects(dose);

            // Starting dose hemodynamic attenuation for RAAS/BB (factor = 0.35):
            // Clinical trials show acute SBP drops at initiating doses are ~30-40% of the
            // chronic steady-state effect due to neurohormonal counter-regulation and
            // incomplete drug accumulation:
            //   - PIONEER-HF: In-hospital sacubitril/valsartan initiation at SBP ≥ 100 showed
            //     first-dose SBP drop of ~2-4 mmHg (vs modeled chronic ~8-12 mmHg; ratio ~0.3-0.35).
            //   - COPERNICUS: Carvedilol 3.125mg initiated in severe HFrEF (SBP ≥ 85); acute
            //     SBP effect was ~1-2 mmHg at starting dose (vs chronic 25mg bid effect ~5-8; ratio ~0.25-0.35).
            //   - SOLVD: Enalapril acute-phase data show initial hypotension risk peaks at
            //     first dose then attenuates over days as counter-regulation engages.
            // Applied only to titrated drug classes (RAAS, BB) at their lowest dose —
            // fixed-dose drugs (SGLT2i, GLP-1) use full hemodynamic projections.
            const isStartingDose = String(dose) === String(mod.target.med.available_doses[0].strength);
            const isAttenuatedClass = ['ARNI', 'ACEi', 'ARB', 'Beta Blocker'].includes(mod.target.med.drug_class);
            const hemoFactor = (isStartingDose && isAttenuatedClass) ? 0.35 : 1.0;

            lvefDelta += chf.lvef_improvement_absolute;
            bnpFactor *= (1 - chf.bnp_reduction_percent);
            weightDelta += chf.weight_reduction_kg;
            kccqDelta += chf.kccq_improvement;
            if (chf.lavi_reduction_percent > 0) laviFactorTotal *= (1 - chf.lavi_reduction_percent);
            if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent > 0) lveddFactorTotal *= (1 - chf.lvedd_reduction_percent);

            sbpDelta += hemo.sbp_drop * hemoFactor;
            dbpDelta += hemo.sbp_drop * hemoFactor * getDbpRatio(mod.target.med.drug_class);
            hrDelta += hemo.hr_drop;
            if (hemo.potassium_change > 0) {
                kDelta += (hemo.potassium_change * renalRiskFactor);
            } else {
                kDelta += hemo.potassium_change;
            }

            rationale.push(`+ ${mod.target.med.name}: ${mod.summary}`);
        }

        if (mod.action === 'remove' && mod.source) {
            const dose = mod.source.dose.strength;
            const chf = mod.source.med.chf_effects(dose);
            const hemo = mod.source.med.hemodynamic_effects(dose);

            // Reverse the removed drug's effects
            lvefDelta -= chf.lvef_improvement_absolute;
            const cappedReduction = Math.min(BNP_CAP, chf.bnp_reduction_percent);
            bnpFactor /= (1 - cappedReduction);
            weightDelta -= chf.weight_reduction_kg;
            kccqDelta -= chf.kccq_improvement;
            if (chf.lavi_reduction_percent > 0) laviFactorTotal /= (1 - Math.min(0.5, chf.lavi_reduction_percent));
            if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent > 0) lveddFactorTotal /= (1 - Math.min(0.3, chf.lvedd_reduction_percent));

            sbpDelta -= hemo.sbp_drop;
            dbpDelta -= hemo.sbp_drop * getDbpRatio(mod.source.med.drug_class);
            hrDelta -= hemo.hr_drop;
            if (hemo.potassium_change > 0) {
                kDelta -= (hemo.potassium_change * renalRiskFactor);
            } else {
                kDelta -= hemo.potassium_change;
            }

            rationale.push(`- ${mod.source.med.name}: ${mod.summary}`);

            // Abrupt beta-blocker withdrawal is Class III harm (rebound tachycardia, ischemia,
            // arrhythmia). Whenever a BB is discontinued, attach explicit taper guidance — the
            // acute-decompensation path already tapers via dose reduction; the contraindication
            // removal path previously dropped the BB with no instruction.
            if (mod.source.med.drug_class === 'Beta Blocker') {
                warnings.push('BETA-BLOCKER DISCONTINUATION: Do NOT stop abruptly — taper over ~1-2 weeks with HR/symptom monitoring (abrupt withdrawal risks rebound tachycardia, ischemia, and arrhythmia). If the reason is bronchospasm and asthma is not severe, a low-dose β1-selective agent (bisoprolol/metoprolol succinate) may be tolerated.');
            }
        }

        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down') && mod.source && mod.target) {
            const oldDose = mod.source.dose.strength;
            const newDose = mod.target.dose.strength;
            const oldChf = mod.source.med.chf_effects(oldDose);
            const newChf = mod.target.med.chf_effects(newDose);
            const oldHemo = mod.source.med.hemodynamic_effects(oldDose);
            const newHemo = mod.target.med.hemodynamic_effects(newDose);

            lvefDelta += (newChf.lvef_improvement_absolute - oldChf.lvef_improvement_absolute);

            const oldCapped = Math.min(BNP_CAP, oldChf.bnp_reduction_percent);
            const newCapped = Math.min(BNP_CAP, newChf.bnp_reduction_percent);
            bnpFactor *= (1 - newCapped) / (1 - oldCapped);

            weightDelta += (newChf.weight_reduction_kg - oldChf.weight_reduction_kg);
            kccqDelta += (newChf.kccq_improvement - oldChf.kccq_improvement);

            if (newChf.lavi_reduction_percent > 0 || oldChf.lavi_reduction_percent > 0) {
                const oldLavi = Math.min(0.5, oldChf.lavi_reduction_percent);
                const newLavi = Math.min(0.5, newChf.lavi_reduction_percent);
                laviFactorTotal *= (1 - newLavi) / (1 - oldLavi);
            }
            if ((newChf.lvedd_reduction_percent && newChf.lvedd_reduction_percent > 0) || (oldChf.lvedd_reduction_percent && oldChf.lvedd_reduction_percent > 0)) {
                const oldLvedd = Math.min(0.3, oldChf.lvedd_reduction_percent ?? 0);
                const newLvedd = Math.min(0.3, newChf.lvedd_reduction_percent ?? 0);
                lveddFactorTotal *= (1 - newLvedd) / (1 - oldLvedd);
            }

            sbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop);
            dbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop) * getDbpRatio(mod.target.med.drug_class);
            hrDelta += (newHemo.hr_drop - oldHemo.hr_drop);

            const oldK = oldHemo.potassium_change > 0 ? oldHemo.potassium_change * renalRiskFactor : oldHemo.potassium_change;
            const newK = newHemo.potassium_change > 0 ? newHemo.potassium_change * renalRiskFactor : newHemo.potassium_change;
            kDelta += (newK - oldK);

            const arrow = mod.action === 'titrate_up' ? '↑' : '↓';
            rationale.push(`${arrow} ${mod.target.med.name}: ${mod.summary}`);
        }

        if (mod.action === 'swap' && mod.source && mod.target) {
            // Mandatory swap bonus: swapping FROM a contraindicated med preserves drug class
            // coverage (better than outright removal which loses the class entirely)
            const isContraindicatedSwap = mod.source.med.contraindications?.(currentPatient) === true;
            if (isContraindicatedSwap) {
                specialFeatureBonus += 15;
                rationale.push(`+ SAFETY: Mandatory swap from contraindicated ${mod.source.med.name} preserves ${getMedicationClassGroup(mod.source.med.drug_class)} coverage`);
            }

            // S1: ACEi → ARNI mandatory 36-hour washout (angioedema risk — PARADIGM-HF protocol, FDA black-box)
            if (mod.source.med.drug_class === 'ACEi' && mod.target.med.drug_class === 'ARNI') {
                warnings.push('MANDATORY: 36-hour washout required between last ACEi dose and first ARNI dose (life-threatening angioedema risk).');
            }

            const oldDose = mod.source.dose.strength;
            const newDose = mod.target.dose.strength;
            const oldChf = mod.source.med.chf_effects(oldDose);
            const newChf = mod.target.med.chf_effects(newDose);
            const oldHemo = mod.source.med.hemodynamic_effects(oldDose);
            const newHemo = mod.target.med.hemodynamic_effects(newDose);

            lvefDelta += (newChf.lvef_improvement_absolute - oldChf.lvef_improvement_absolute);

            const oldCapped = Math.min(BNP_CAP, oldChf.bnp_reduction_percent);
            const newCapped = Math.min(BNP_CAP, newChf.bnp_reduction_percent);
            bnpFactor *= (1 - newCapped) / (1 - oldCapped);

            weightDelta += (newChf.weight_reduction_kg - oldChf.weight_reduction_kg);
            kccqDelta += (newChf.kccq_improvement - oldChf.kccq_improvement);

            if (newChf.lavi_reduction_percent > 0 || oldChf.lavi_reduction_percent > 0) {
                const oldLavi = Math.min(0.5, oldChf.lavi_reduction_percent);
                const newLavi = Math.min(0.5, newChf.lavi_reduction_percent);
                laviFactorTotal *= (1 - newLavi) / (1 - oldLavi);
            }
            if ((newChf.lvedd_reduction_percent && newChf.lvedd_reduction_percent > 0) || (oldChf.lvedd_reduction_percent && oldChf.lvedd_reduction_percent > 0)) {
                const oldLvedd = Math.min(0.3, oldChf.lvedd_reduction_percent ?? 0);
                const newLvedd = Math.min(0.3, newChf.lvedd_reduction_percent ?? 0);
                lveddFactorTotal *= (1 - newLvedd) / (1 - oldLvedd);
            }

            // Swap DBP: remove old drug's contribution, add new drug's
            dbpDelta -= oldHemo.sbp_drop * getDbpRatio(mod.source.med.drug_class);
            dbpDelta += newHemo.sbp_drop * getDbpRatio(mod.target.med.drug_class);
            sbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop);
            hrDelta += (newHemo.hr_drop - oldHemo.hr_drop);

            const oldK = oldHemo.potassium_change > 0 ? oldHemo.potassium_change * renalRiskFactor : oldHemo.potassium_change;
            const newK = newHemo.potassium_change > 0 ? newHemo.potassium_change * renalRiskFactor : newHemo.potassium_change;
            kDelta += (newK - oldK);

            rationale.push(`↔ ${mod.source.med.name} → ${mod.target.med.name}: ${mod.summary}`);
        }
    });

    // --- Synergy: only apply when modification CREATES the synergy condition ---
    // Check if current regimen already had these synergies
    const currentClasses = new Set((currentPatient.current_regimen || []).map(r => r.med.drug_class));
    const currentHasQuad = (currentClasses.has('ARNI') || currentClasses.has('ACEi') || currentClasses.has('ARB'))
        && currentClasses.has('Beta Blocker') && (currentClasses.has('MRA') || currentClasses.has('nsMRA')) && currentClasses.has('SGLT2i');
    const currentHasDiureticSGLT2 = (currentClasses.has('Loop Diuretic') || currentClasses.has('Thiazide-like Diuretic')) && currentClasses.has('SGLT2i');

    if (hasSGLT2 && hasDiuretic && !currentHasDiureticSGLT2) {
        weightDelta *= 1.2;
        rationale.push("Synergy: SGLT2i enhances Loop Diuretic efficiency");
    }

    if (hasRAAS && hasBeta && hasMRA && hasSGLT2 && !currentHasQuad) {
        lvefDelta += 3;
        kccqDelta += 5;
        rationale.push("QUADRUPLE THERAPY (The 4 Pillars): Maximal survival benefit");
    }

    // Special features from resulting regimen
    resultingRegimen.forEach(r => {
        if (r.med.special_features) {
            r.med.special_features.forEach(sf => {
                if (sf.criteria(currentPatient)) {
                    rationale.push(`+ ${r.med.name}: ${sf.feature}`);
                    specialFeatureBonus += sf.points;
                }
            });
        }

        // Rationale for target dose and clinical effects
        const chf = r.med.chf_effects(r.dose.strength);
        const isTarget = r.med.available_doses.find(d => d.strength === r.dose.strength)?.is_target_dose;
        if (isTarget) rationale.push(`+ ${r.med.name}: Achieves GDMT Target Dose`);
        if (chf.lvef_improvement_absolute >= 3) rationale.push(`+ ${r.med.name}: Significant Reverse Remodeling`);
        if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent >= 0.05) {
            rationale.push(`+ ${r.med.name}: LV Size Reduction (LVEDD -${(chf.lvedd_reduction_percent * 100).toFixed(0)}%)`);
        }
        if (r.med.drug_class.includes('GLP')) rationale.push(`+ ${r.med.name}: Metabolic/Adiposity Reduction`);
        else if (chf.weight_reduction_kg >= 1.0) rationale.push(`+ ${r.med.name}: Volume Unloading`);
    });

    // Deduplicate rationale
    const uniqueRationale = [...new Set(rationale)];

    // --- Apply Deltas to Projected Patient ---

    // Structure — LVEF attenuation: diminishing returns prevent unrealistic stacking
    // Quad therapy raw deltas (e.g. +27%) are compressed via exponential saturation.
    // Max recovery = gap to normal (55%); can't project above physiological ceiling.
    //
    // The 0.7 scaling factor calibrates the exponential curve against aggregate LVEF
    // recovery data from landmark trials:
    //   - PROVE-HF (sacubitril/valsartan): mean LVEF improvement +5.2% at 12 months
    //   - DAPA-HF (dapagliflozin): mean LVEF improvement +2.4% vs placebo
    //   - EMPHASIS-HF (eplerenone): mean LVEF improvement ~+2% vs placebo
    //   Stacking all 4 pillars suggests ~10-15% raw improvement in severe HFrEF, but
    //   observed LVEF recoveries beyond 15% absolute are rare outside HFimpEF.
    //   At 0.7, the model yields ~65% capture of raw delta at half-maxRecovery,
    //   preventing quad therapy on LVEF 20 from projecting above ~40%.
    const maxLvefRecovery = Math.max(5, 55 - currentPatient.lvef);
    const attenuatedLvefDelta = lvefDelta > 0
        ? maxLvefRecovery * (1 - Math.exp(-lvefDelta / (maxLvefRecovery * 0.7)))
        : lvefDelta; // Negative deltas (removal) pass through unattenuated
    proj.lvef = Math.min(55, currentPatient.lvef + attenuatedLvefDelta);

    // Cardiac output compensation for HFrEF:
    // In severely reduced LVEF, afterload reduction from GDMT improves forward flow
    // (Frank-Starling mechanism), partially offsetting the vasodilatory BP drop.
    // This is why GDMT can be safely initiated at SBP 90-100 in HFrEF.
    //
    // Constants (0.35 SBP offset, 0.4 LVEF scaling):
    //   - 0.35: Up to 35% of the SBP drop is recaptured through improved cardiac output.
    //     Frank-Starling: reduced afterload in a dilated, failing ventricle moves the
    //     operating point up the curve, increasing stroke volume. Net BP drop is less
    //     than the direct vasodilatory effect.
    //   - 0.4: The compensation is also capped at 40% of the LVEF improvement (in mmHg
    //     equivalent), preventing over-correction in scenarios with large projected LVEF
    //     gains but modest SBP drops.
    //   - COPERNICUS: Enrolled patients with SBP ≥ 85; carvedilol was safe and beneficial
    //     despite very low baseline LVEF, demonstrating CO compensation in practice.
    //   - PIONEER-HF: Enrolled SBP ≥ 100 in-hospital; sacubitril/valsartan showed less
    //     hypotension than expected from its vasodilatory potency, consistent with CO offset.
    // M7: Extended to LVEF < 50 (HFmrEF) with attenuated factor — Frank-Starling applies across
    // the reduced EF spectrum, but effect diminishes as LVEF approaches normal.
    //
    // SAFETY CHANGE: Forward-flow (Frank-Starling) compensation is real physiology in the
    // aggregate, but it is an UNCALIBRATED estimate for any individual. Previously this term
    // was subtracted from sbpDelta, raising the projected SBP — which could lift a fragile
    // patient's projected SBP across the display/penalty floors and manufacture apparent
    // safety from a constant. We now keep the projected SBP CONSERVATIVE (pre-compensation)
    // for every safety gate and display, and surface the compensation as an informational
    // note only. The note never feeds a threshold decision.
    if (currentPatient.lvef < 50 && attenuatedLvefDelta > 0 && sbpDelta > 0) {
        // Full 0.35 offset for LVEF < 40; linearly attenuated to 0.15 at LVEF 50
        const coFactor = currentPatient.lvef < 40
            ? 0.35
            : 0.35 - (currentPatient.lvef - 40) / 10 * 0.20; // 40→0.35, 45→0.25, 50→0.15
        const coCompensation = Math.min(sbpDelta * coFactor, attenuatedLvefDelta * 0.4);
        if (coCompensation >= 1) {
            uniqueRationale.push(
                `Physiology note: improved forward flow (Frank-Starling) may offset roughly ${coCompensation.toFixed(0)} mmHg of the projected BP drop in a recovering ventricle. This is NOT applied to safety thresholds — the projected BP shown is the conservative (pre-compensation) estimate.`
            );
        }
    }

    if (currentPatient.lavi) {
        proj.lavi = Math.max(15, currentPatient.lavi * laviFactorTotal);
    }
    if (currentPatient.lvedd) {
        proj.lvedd = Math.max(35, currentPatient.lvedd * lveddFactorTotal);
    }

    // Neurohormonal (multiplicative factor applied to current BNP)
    const effectiveBnpFactor = Math.max(0.15, bnpFactor);
    proj.nt_pro_bnp = Math.max(50, currentPatient.nt_pro_bnp * effectiveBnpFactor);

    // Functional
    proj.kccq_score = Math.min(100, currentPatient.kccq_score + kccqDelta);
    if (kccqDelta > 20 && proj.nyha_class === 'IV') proj.nyha_class = 'III';
    else if (kccqDelta > 20 && proj.nyha_class === 'III') proj.nyha_class = 'II';
    else if (kccqDelta > 20 && proj.nyha_class === 'II') proj.nyha_class = 'I';

    // Volume & Hemodynamics
    let dryWeightAdjusted = currentPatient.volume_status.dry_weight_kg;
    if (hasGLP1) {
        const tissueLoss = weightDelta * 0.5;
        dryWeightAdjusted -= tissueLoss;
    }
    const projectedWeight = currentPatient.volume_status.current_weight_kg - weightDelta;

    const finalSbp = currentPatient.sbp - sbpDelta;
    const finalDbp = currentPatient.dbp - dbpDelta; // Drug-class-specific ratio (Finding 12)
    const map = (finalSbp + (2 * finalDbp)) / 3;

    const currentFluidExcess = currentPatient.volume_status.current_weight_kg - currentPatient.volume_status.dry_weight_kg;
    const isCongested = currentFluidExcess > 1.0;

    if (isCongested && weightDelta > 1.0) {
        uniqueRationale.push("Renal Benefit: Decongestion improves renal venous outflow");
    }

    if (map < 65) {
        warnings.push(`Low Perfusion Pressure (MAP ${map.toFixed(0)} mmHg) - Risk of AKI`);
        if (lvefDelta < 5) {
            proj.nt_pro_bnp = proj.nt_pro_bnp * 1.2;
        } else {
            uniqueRationale.push("Physiology Note: Forward flow improvement offsets low MAP risk");
        }
    }

    const safetyFloor = dryWeightAdjusted - 2.0;
    if (projectedWeight < safetyFloor) {
        warnings.push(`Caution: Rapid Weight Loss (${Math.abs(currentPatient.volume_status.current_weight_kg - projectedWeight).toFixed(1)}kg) - Monitor hydration`);
        proj.nt_pro_bnp = proj.nt_pro_bnp * 1.3;
        if (map < 70) {
            warnings.push("Hypovolemic Hypotension Risk: Reduce diuretic dose");
        }
    }

    proj.volume_status.current_weight_kg = Math.max(dryWeightAdjusted - 2, projectedWeight);
    proj.volume_status.dry_weight_kg = dryWeightAdjusted;

    if (proj.volume_status.current_weight_kg <= dryWeightAdjusted + 0.5) {
        proj.volume_status.exam_findings.clear();
    }

    // M6: Physiologic floor — prevent model artifacts (negative/zero) from misleading NPs
    proj.sbp = Math.max(60, finalSbp);
    proj.dbp = Math.max(30, finalDbp);
    proj.pulse = Math.max(30, currentPatient.pulse - hrDelta);
    proj.potassium = currentPatient.potassium + kDelta;

    // --- Titration Timeline Warning ---
    const newAdds = modificationSet.modifications.filter(m => m.action === 'add');
    const titrations = modificationSet.modifications.filter(m => m.action === 'titrate_up');
    if (newAdds.length >= 2) {
        const targetAdds = newAdds.filter(m => m.target?.dose.is_target_dose);
        if (targetAdds.length >= 2) {
            warnings.push('Multiple new medications at target dose. In practice, initiate at low dose and titrate each q2-4 weeks.');
        }
    }
    // D9: Single-agent titration interval guidance
    if (titrations.length > 0 && newAdds.length === 0) {
        warnings.push('Titration Interval: Allow 2-4 weeks between dose increases. Recheck BP, HR, and labs (BMP) before each uptitration step.');
    }

    // --- P3: Age-adjusted warnings ---
    if (currentPatient.age > 75 && newAdds.length > 0) {
        warnings.push('Elderly patient (>75): Start low, go slow. Titrate new agents q4-6 weeks with orthostatic BP checks.');
    }
    if (currentPatient.age > 80 && currentPatient.egfr < 45 && newAdds.length > 0) {
        warnings.push('Frail elderly with CKD: Monitor renal function and electrolytes weekly during titration.');
    }

    // --- Safety Checks ---
    if (proj.sbp < 90) warnings.push('Risk of Hypotension (SBP < 90)');
    if (proj.pulse < 50) warnings.push('Risk of Bradycardia (HR < 50)');

    if (proj.potassium > 6.0) {
        warnings.push('CRITICAL: Severe Hyperkalemia Risk (K+ > 6.0)');
    } else if (proj.potassium > 5.5) {
        warnings.push('DANGER: High Hyperkalemia Risk (K+ > 5.5)');
    } else if (proj.potassium > 5.2) {
        warnings.push('Caution: Elevated Potassium (K+ > 5.2). Monitor closely.');
    } else if (proj.potassium > 5.0 && hasMRA) {
        warnings.push('Monitor: K+ > 5.0 with MRA. Check potassium within 1 week; consider Patiromer if rising.');
    } else if (proj.potassium < 3.5) {
        warnings.push('Risk of Hypokalemia (K+ < 3.5)');
    }

    // D2: MRA initiation with borderline K+ — ACC/AHA recommends initiating MRA when K+ ≤ 5.0.
    // K+ 5.0-5.5 is allowed here with binder rescue (DIAMOND), but requires explicit warning.
    const isMraInitiation = modificationSet.modifications.some(m =>
        m.action === 'add' && m.target && (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
    );
    if (isMraInitiation && currentPatient.potassium >= 5.0 && currentPatient.potassium <= 5.5) {
        const hasBinder = resultingRegimen.some(r => r.med.drug_class === 'K+ Binder');
        if (hasBinder) {
            warnings.push(
                'MRA INITIATION AT BORDERLINE K+: Baseline potassium is ' + currentPatient.potassium.toFixed(1) +
                ' mEq/L. Concurrent K+ binder included per DIAMOND trial protocol. ' +
                'Check BMP in 48-72 hours. Discontinue MRA if K+ rises above 5.5 despite binder therapy.'
            );
        } else {
            warnings.push(
                'MRA INITIATION AT BORDERLINE K+: Baseline potassium is ' + currentPatient.potassium.toFixed(1) +
                ' mEq/L. Consider concurrent K+ binder per DIAMOND protocol. ' +
                'Check BMP in 48-72 hours. Discontinue MRA if K+ rises above 5.5.'
            );
        }
    }

    if (raasCount > 1) {
        warnings.push("CONTRAINDICATION: Dual RAAS blockade (ACEi + ARB/ARNI) increases renal risk without benefit.");
    }

    // H1: ARB + angioedema history → mandatory monitoring warning (ACC/AHA: "use with caution")
    const hasARBinRegimen = resultingRegimen.some(r => r.med.drug_class === 'ARB');
    const angioedemaRiskPresent = currentPatient.comorbidities.has("History of Angioedema") ||
        currentPatient.discontinued_meds.some(dm => {
            const text = `${dm.reason} ${dm.reason_detail ?? ''}`.toLowerCase();
            return text.includes('angioedema') && RAAS_CLASSES.has(dm.drug_class);
        });
    if (hasARBinRegimen && angioedemaRiskPresent) {
        warnings.push(
            'ANGIOEDEMA CAUTION: ARB prescribed with prior angioedema history. Cross-reactivity risk is low (~2-8%) but not zero. ' +
            'Initiate in a monitored setting. Ensure patient has epinephrine auto-injector. Educate on angioedema signs (lip/tongue swelling). ' +
            'If angioedema recurs on ARB, discontinue and use H/ISDN as RAAS alternative.'
        );
    }

    const hasSteroidalMRA = resultingRegimen.some(r => r.med.drug_class === 'MRA');
    const hasNonSteroidalMRA = resultingRegimen.some(r => r.med.drug_class === 'nsMRA');
    if (hasSteroidalMRA && hasNonSteroidalMRA) {
        warnings.push('CONTRAINDICATION: Dual MRA blockade (steroidal MRA + Finerenone) increases severe hyperkalemia risk and is not evidence-based.');
    }

    if (currentPatient.oxygen_saturation && currentPatient.oxygen_saturation < 90) {
        warnings.push("Hypoxia Alert: SpO2 < 90%. Evaluate for Pulmonary Edema.");
    }

    // β1-selective beta-blocker in mild/moderate asthma: acceptable but not risk-free.
    // (Severe asthma is an absolute CI for all BBs and is handled by exclusion upstream.)
    if (currentPatient.comorbidities.has('Asthma (Mild/Moderate)')) {
        const selectiveBB = resultingRegimen.find(r =>
            r.med.name === 'Bisoprolol' || r.med.name === 'Metoprolol Succinate'
        );
        if (selectiveBB) {
            const preferredNote = selectiveBB.med.name === 'Bisoprolol'
                ? ''
                : ' Bisoprolol is the most cardioselective option if bronchospasm emerges.';
            warnings.push(`ASTHMA + BETA-BLOCKER: ${selectiveBB.med.name} (β1-selective) is acceptable in mild/moderate asthma but cardioselectivity decreases at higher doses. Start low, monitor for wheeze/PEF drop, and ensure a rescue inhaler is available.${preferredNote} Non-selective carvedilol is avoided.`);
        }
    }

    // Liver disease safety warnings
    if (currentPatient.comorbidities.has('Liver Disease (Child-Pugh B/C)')) {
        const hasMRAInRegimen = resultingRegimen.some(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');
        if (hasMRAInRegimen) {
            const mraName = resultingRegimen.find(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA')?.med.name;
            warnings.push(`Hepatic Impairment: ${mraName} accumulates in cirrhosis. Monitor K+ and renal function closely. Consider dose reduction.`);
        }
        // BB: Carvedilol and Metoprolol are extensively hepatically metabolized
        const hepaticBBs = resultingRegimen.filter(r =>
            r.med.drug_class === 'Beta Blocker' && (r.med.name === 'Carvedilol' || r.med.name === 'Metoprolol Succinate')
        );
        if (hepaticBBs.length > 0) {
            warnings.push(`Hepatic Impairment: ${hepaticBBs[0].med.name} is hepatically metabolized — increased exposure in cirrhosis. Consider Bisoprolol (renally cleared) as alternative.`);
        }
        // Finerenone: CYP3A4 substrate with reduced clearance in cirrhosis
        const hasFinerenone = resultingRegimen.some(r => r.med.name === 'Finerenone (Kerendia)');
        if (hasFinerenone) {
            warnings.push('Hepatic Impairment: Finerenone is a CYP3A4 substrate with reduced clearance in cirrhosis. Avoid in Child-Pugh C; use with caution in Child-Pugh B.');
        }
        // ARNI: sacubitril AUC increases in hepatic impairment (Entresto PI)
        const hasARNI = resultingRegimen.some(r => r.med.drug_class === 'ARNI');
        if (hasARNI) {
            warnings.push('Hepatic Impairment: Sacubitril/Valsartan — sacubitril AUC increases ~1.5-2x in Child-Pugh B/C (Entresto PI). Avoid; switch to ACEi/ARB.');
        }
        // Loop diuretics: cirrhosis with ascites may need higher doses
        const hasLoop = resultingRegimen.some(r => r.med.drug_class === 'Loop Diuretic');
        if (hasLoop) {
            warnings.push('Hepatic Impairment: Cirrhosis + ascites may require higher loop diuretic doses due to reduced renal blood flow. Monitor Na+ closely (risk of hyponatremia).');
        }
    }

    // Digoxin narrow therapeutic index monitoring (DIG trial: target 0.5-0.9 ng/mL)
    const hasDigoxin = resultingRegimen.some(r => r.med.drug_class === 'Inotrope');
    if (hasDigoxin) {
        const renalNote = currentPatient.egfr < 45 ? ' Renal impairment increases toxicity risk — recheck level after any eGFR change.' : '';
        const kNote = (hasDiuretic && !hasMRA) ? ' Concurrent diuretic without MRA increases hypokalemia-mediated toxicity risk.' : '';
        warnings.push(`Digoxin Monitoring: Check serum digoxin level in 5-7 days (target 0.5-0.9 ng/mL). Monitor for toxicity (nausea, visual changes, arrhythmia).${renalNote}${kNote}`);
        if (proj.potassium >= 3.5 && proj.potassium < 4.0) {
            warnings.push('Digoxin Safety: Potassium 3.5-4.0 increases toxicity risk. Monitor K+ closely with concurrent diuretic therapy and replete to >4.0 when feasible.');
        }
    }

    if (currentPatient.peak_flow_lpm && currentPatient.peak_flow_lpm < 350) {
        if (!currentPatient.comorbidities.has('Severe Asthma / Bronchospasm') && !currentPatient.comorbidities.has('COPD')) {
            uniqueRationale.push("Screening: Low Peak Flow suggests possible COPD/Asthma overlap.");
        }
    }

    const bunCrRatio = currentPatient.creatinine > 0 ? currentPatient.bun / currentPatient.creatinine : 0;
    if (bunCrRatio > 20 && hasDiuretic && !hasGLP1) {
        if (map < 70) {
            warnings.push('Prerenal Azotemia: Diuresis likely to worsen Creatinine due to low perfusion');
        } else {
            uniqueRationale.push("Monitoring: BUN/Cr elevated but MAP > 70 suggests tolerance");
        }
    }

    if (currentPatient.egfr < 20 && hasDiuretic) {
        warnings.push('Severe CKD Loop Strategy: eGFR < 20 may blunt loop response. Consider split dosing (BID/TID), torsemide/bumetanide conversion, and close urine output + daily weight tracking.');
    }

    const hasFuroscix = resultingRegimen.some(r => r.med.name === 'Furoscix (SC Furosemide)');
    if (hasFuroscix) {
        warnings.push('FUROSCIX SAFETY: On-body SQ infusor delivers 80mg over ~5 hours. Keep device dry and minimize vigorous activity during infusion to reduce incomplete dosing risk.');
        if (currentPatient.egfr < 30) {
            warnings.push('FUROSCIX CKD CAUTION: eGFR < 30 may reduce natriuretic response. Track urine output and daily weight; escalate to IV diuresis if congestion persists.');
        }
        if (currentPatient.oxygen_saturation !== undefined && currentPatient.oxygen_saturation < 90) {
            warnings.push('FUROSCIX TRIAGE: Hypoxemia (SpO2 < 90%) may indicate acute pulmonary edema. Prioritize urgent in-person evaluation and IV diuresis pathway.');
        }
    }

    // --- Drug-Drug Interaction (DDI) Warnings ---
    const hasNitrate = resultingRegimen.some(r => r.med.drug_class === 'Vasodilator'); // H/ISDN
    const hasRAASDrug = resultingRegimen.some(r => ['ARNI', 'ACEi', 'ARB'].includes(r.med.drug_class));
    const externalMeds = currentPatient.external_medications || new Set<string>();
    const hasExternalMedication = (...names: string[]) => names.some(name => externalMeds.has(name));
    // Backward compatibility for older saved patients that used comorbidity flags for these meds.
    const onAmiodarone = hasExternalMedication('Amiodarone') || currentPatient.comorbidities.has('On Amiodarone');
    const onVerapamilOrDiltiazem =
        hasExternalMedication('Verapamil', 'Diltiazem') ||
        currentPatient.comorbidities.has('On Verapamil/Diltiazem');
    const onLithium = hasExternalMedication('Lithium') || currentPatient.comorbidities.has('On Lithium');
    const onPde5Inhibitor = hasExternalMedication('Sildenafil', 'Tadalafil');

    // DDI-1: Nitrate (H/ISDN) + PDE5 inhibitor → fatal hypotension
    if (hasNitrate && onPde5Inhibitor) {
        warnings.push('DDI WARNING: Nitrate (Isosorbide Dinitrate) is CONTRAINDICATED with PDE5 inhibitors (sildenafil/tadalafil). Risk of profound or fatal hypotension. Avoid co-administration.');
    } else if (hasNitrate && currentPatient.comorbidities.has('Pulmonary Hypertension')) {
        warnings.push('DDI CAUTION: Pulmonary hypertension may imply PDE5 inhibitor use. Confirm sildenafil/tadalafil exposure before initiating nitrate therapy.');
    }

    // DDI-2: RAAS + chronic NSAID use → AKI risk (extremely common outpatient DDI)
    if (hasRAASDrug && currentPatient.comorbidities.has('Chronic NSAID Use')) {
        warnings.push('DDI WARNING: RAAS inhibitor + chronic NSAID use significantly increases AKI risk. Discontinue NSAIDs if possible. If unavoidable, monitor creatinine and potassium weekly.');
    }

    // DDI-3: Digoxin + loop diuretic without K+ protection → toxicity
    // (Already partially covered by kNote above, but reinforce with formal DDI language)
    if (hasDigoxin && hasDiuretic && !hasMRA && proj.potassium < 4.0) {
        warnings.push('DDI WARNING: Digoxin + loop diuretic without potassium-sparing agent. Hypokalemia (projected K+ ' + proj.potassium.toFixed(1) + ') potentiates digoxin toxicity (arrhythmia, Torsade de Pointes). Add MRA or supplement potassium.');
    }

    // DDI-4: Digoxin + amiodarone markedly raises digoxin exposure.
    if (hasDigoxin && onAmiodarone) {
        warnings.push('DDI WARNING: Amiodarone can raise digoxin levels ~70-100%. Reduce digoxin dose and recheck serum level within 3-5 days.');
    }

    // DDI-5: Non-DHP CCB + beta blocker/digoxin increases bradycardia and AV block risk.
    if (onVerapamilOrDiltiazem && (hasBeta || hasDigoxin)) {
        warnings.push('DDI WARNING: Verapamil/Diltiazem with beta blocker and/or digoxin increases severe bradycardia/AV block risk. Use close ECG and heart-rate monitoring.');
    }

    // DDI-6: Lithium + diuretics can precipitate lithium toxicity.
    if (hasDiuretic && onLithium) {
        warnings.push('DDI WARNING: Loop/thiazide diuretics increase lithium levels and toxicity risk. Check lithium level and renal function after diuretic changes.');
    }

    // DDI-7: Explicit chronotropic risk for BB + Ivabradine co-titration.
    if (hasBeta && hasIvabradine) {
        warnings.push('DDI WARNING: Beta blocker + Ivabradine has additive chronotropic suppression. Monitor heart rate/ECG every 2 weeks during co-titration.');
    }

    return { projectedPatient: proj, cost: totalCost, complexity: complexityScore, warnings, rationale: uniqueRationale, specialFeatureBonus };
}

// --- 4. Delta-from-Current Entry Point ---

export function generateAndScoreModifications(
    patient: Patient,
    availableMedNames: Set<string>,
    prices: Record<string, number>
): SimulationOutput {

    const clinicalAlerts: string[] = [];
    patient = clonePatient(patient);

    const dedupedCurrent = dedupeCurrentRegimen(patient.current_regimen || []);
    if (dedupedCurrent.duplicateNames.length > 0) {
        patient.current_regimen = dedupedCurrent.regimen;
        clinicalAlerts.push(
            `INPUT SAFETY: Duplicate current medications removed (${dedupedCurrent.duplicateNames.join(', ')}). ` +
            'Duplicate entries can double-count hemodynamic effects.'
        );
    }

    // --- Real-world robustness: audit incomplete data and inappropriate arriving regimens ---
    const dataAudit = auditCriticalData(patient);
    clinicalAlerts.push(...dataAudit.alerts);
    const implausibleValueAlerts = validatePhysiologicBounds(patient);
    clinicalAlerts.push(...implausibleValueAlerts);
    clinicalAlerts.push(...detectInappropriateRegimen(patient));

    // Physiologically-impossible inputs are data-entry errors (unit confusion, transcription
    // slips). Every downstream decision — phenotype, contraindications, projections — would be
    // computed on garbage, so this is a hard stop, not a flag-and-proceed. (e.g. LVEF 99 would
    // otherwise classify as HFpEF and drive a confident SGLT2i pathway off a typo.)
    if (implausibleValueAlerts.length > 0) {
        return { scoredRegimens: [], excludedMedications: [...patient.discontinued_meds], clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] };
    }

    // LVEF is the axis the entire phenotype/pathway selection turns on. Without it the tool
    // cannot pick HFrEF vs HFmrEF vs HFpEF — fail safe with alerts only rather than guessing.
    if (dataAudit.unknownLvef) {
        return { scoredRegimens: [], excludedMedications: [...patient.discontinued_meds], clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] };
    }

    // Deterministic, guideline-anchored categorical outputs — independent of scoring.
    const gdmtGaps = computeGdmtGaps(patient);
    const missingDataNotices = buildMissingDataNotices(patient);

    if (patient.sbp <= patient.dbp) {
        clinicalAlerts.push(
            'INPUT ERROR: Systolic BP must be greater than diastolic BP (SBP > DBP). ' +
            'Correct blood pressure values before running recommendations.'
        );
        return { scoredRegimens: [], excludedMedications: [...patient.discontinued_meds], clinicalAlerts, monitoringPlan: [] };
    }

    // --- S4: Pregnancy safety alert ---
    if (patient.is_pregnant === true) {
        clinicalAlerts.push('PREGNANCY ALERT: ACEi, ARB, ARNI, MRA, and nsMRA (Finerenone) are contraindicated (Category X). SGLT2i excluded (Category C — insufficient human safety data). These agents have been excluded from all recommendations.');
    }

    // --- S2: Hemodynamic instability — block pharmacologic optimization ---
    // Threshold raised to SBP < 90 (MAP ~65 mmHg): oral GDMT initiation requires adequate perfusion
    const lowOutput = isLowOutputState(patient);
    if (lowOutput) {
        clinicalAlerts.push(
            'LOW OUTPUT STATE: LVEF < 20% with hypoperfusion markers (cool extremities, narrow pulse pressure, or pre-renal azotemia). ' +
            'Consider inotropic support and Advanced HF consultation before oral GDMT initiation.'
        );
    }

    if (patient.sbp < 90) {
        clinicalAlerts.push(
            'HEMODYNAMIC INSTABILITY: SBP < 90 mmHg. Oral GDMT optimization is unsafe at current blood pressure. ' +
            'Stabilize hemodynamics first. Consider: IV inotropes (dobutamine/milrinone), hemodynamic monitoring (PA catheter), ' +
            'vasopressor support if needed, and Advanced Heart Failure consultation.'
        );
    }

    // --- S3: Advanced HF referral trigger ---
    const advancedHFCriteria = lowOutput ||
        (patient.lvef <= 20 && patient.sbp < 90) ||
        (patient.nyha_class === 'IV' && patient.nt_pro_bnp > 4000);
    if (advancedHFCriteria) {
        clinicalAlerts.push(
            'ADVANCED HEART FAILURE ALERT: This patient meets criteria for Advanced HF evaluation (INTERMACS 3-4). ' +
            'Consider: IV inotropic support, mechanical circulatory support (LVAD/Impella), heart transplant evaluation, ' +
            'CRT/ICD assessment, and palliative care discussion. Refer to Advanced HF specialist.'
        );
    }

    // --- D4: ICD/CRT device eligibility screening (ACC/AHA 2022 §7.3.5, Class I) ---
    const icdCrtEligible = patient.lvef <= 35 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        !advancedHFCriteria; // Advanced HF already triggers its own referral
    if (icdCrtEligible) {
        clinicalAlerts.push(
            'DEVICE THERAPY SCREENING: LVEF ≤ 35% with NYHA Class ' + patient.nyha_class + '. ' +
            'Evaluate for ICD (primary prevention of sudden cardiac death) after ≥ 3 months of optimized GDMT. ' +
            'If QRS ≥ 150ms with LBBB morphology, also evaluate for CRT (Class I, ACC/AHA 2022). ' +
            'Refer to electrophysiology if not already assessed.'
        );
    }

    // --- D5: Cardiac rehabilitation referral (ACC/AHA 2022 §7.3.4, Class I) ---
    const cardiacRehabEligible = patient.lvef <= 40 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        patient.sbp >= 90 && !advancedHFCriteria;
    if (cardiacRehabEligible) {
        clinicalAlerts.push(
            'CARDIAC REHABILITATION: HFrEF with NYHA Class ' + patient.nyha_class +
            '. Exercise-based cardiac rehab is Class I (ACC/AHA 2022) for stable HF patients — improves functional capacity, quality of life, and reduces HF hospitalization. Refer if not already enrolled.'
        );
    }

    // --- P5: Volume depletion alert ---
    const currentFluidBalance = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const isVolumeDepleted = currentFluidBalance < -1.0;
    const hasDiureticInCurrent = (patient.current_regimen || []).some(r =>
        r.med.drug_class === 'Loop Diuretic' || r.med.drug_class === 'Thiazide-like Diuretic'
    );
    if (isVolumeDepleted && hasDiureticInCurrent) {
        clinicalAlerts.push(
            'VOLUME DEPLETION: Patient is ' + Math.abs(currentFluidBalance).toFixed(1) + 'kg below dry weight while on diuretics. ' +
            'Diuretic reduction/discontinuation is the priority intervention before adding new agents. Risk of AKI and hemodynamic collapse.'
        );
    }

    if (patient.egfr < 20) {
        clinicalAlerts.push(
            'SEVERE CKD DIURETIC ALERT: eGFR < 20 may blunt oral loop diuretic response. Consider BID/TID loop dosing strategy, conversion to torsemide/bumetanide, and close daily weight/urine monitoring.'
        );
    }

    const historicalStatusUnknown = hasUnknownHistoricalHFrEF(patient);
    const preservingQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    if (patient.lvef > 40 && historicalStatusUnknown) {
        if (preservingQuadForUnknownHistory) {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Prior reduced EF is undocumented, but existing RAAS/BB/MRA therapy suggests possible HFimpEF. Recommendations preserve quad GDMT while prior records are clarified.'
            );
        } else {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Cannot determine if this patient previously had LVEF <= 40%. If previously on quad GDMT, consider continuing RAAS/BB/MRA/SGLT2i until prior records are clarified.'
            );
        }
    }

    const vericiguatCoreEligible = (patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV') &&
        patient.nt_pro_bnp >= 1600 &&
        patient.lvef < 45;
    // M5: Only alert when worsening status is unknown — suppress when explicitly 'no' (patient definitively ineligible)
    if (vericiguatCoreEligible && patient.recent_hf_worsening_within_6mo === 'unknown') {
        clinicalAlerts.push(
            'VERICIGUAT ELIGIBILITY WARNING: Recent HF worsening status unknown. Document if hospitalization or IV diuretics occurred within 6 months — required before Vericiguat use.'
        );
    }

    // 1. Filter Formulary & Check Exclusions (same logic as before)
    const excludedMeds: ExcludedMedication[] = [...patient.discontinued_meds];
    const excludedNames = new Set(excludedMeds.map(m => m.name));
    // H3 fix: Drug-class-aware exclusion matching. Only attribute side effects to the
    // drug class that caused them — prevents cross-contamination (e.g., cough from a BB
    // incorrectly excluding ACEi, or angioedema from an NSAID excluding all RAAS).
    const raasDiscontinued = excludedMeds.filter(m => RAAS_CLASSES.has(m.drug_class) || m.drug_class === 'RAAS');
    const mraDiscontinued = excludedMeds.filter(m => m.drug_class === 'MRA' || m.drug_class === 'nsMRA');

    const matchesReason = (dm: ExcludedMedication, keyword: string) =>
        `${dm.reason} ${dm.reason_detail ?? ''}`.toLowerCase().includes(keyword);

    // Expanded, class-attributed intolerance recognition. Each intolerance is matched only
    // against the drug class that plausibly caused it (prevents e.g. a beta-blocker's
    // bradycardia from excluding a RAAS inhibitor). Reasons are free text, so we match on
    // clinically meaningful keyword families.
    const bbDiscontinued = excludedMeds.filter(m => m.drug_class === 'Beta Blocker');
    const glp1Discontinued = excludedMeds.filter(m => m.drug_class === 'GLP-1 RA' || m.drug_class === 'GLP-1/GIP RA');

    const hasAngioedemaFromRaas = raasDiscontinued.some(dm => matchesReason(dm, 'angioedema'));
    const hasAngioedemaRisk = hasAngioedemaFromRaas || patient.comorbidities.has("History of Angioedema");
    const hasAceiCoughHistory = raasDiscontinued.some(dm => matchesReason(dm, 'cough'));
    const hasHyperkalemiaHistory = mraDiscontinued.some(dm => matchesReason(dm, 'hyperkalemia'));
    const hasGynecomastiaHistory = mraDiscontinued.some(dm => matchesReason(dm, 'gynecomastia'));

    // Beta-blocker intolerance → defer NEW BB initiation (existing BB is still continued via
    // current-regimen analysis). Bradycardia/AV block → defer all BB; bronchospasm → avoid the
    // non-selective agent (carvedilol), β1-selective agents remain acceptable with caution.
    const hasBbBradycardia = bbDiscontinued.some(dm => matchesReason(dm, 'bradycardia') || matchesReason(dm, 'av block') || matchesReason(dm, 'heart block'));
    const hasBbBronchospasm = bbDiscontinued.some(dm => matchesReason(dm, 'bronchospasm') || matchesReason(dm, 'asthma') || matchesReason(dm, 'wheez'));
    const hasGlp1GiIntolerance = glp1Discontinued.some(dm => matchesReason(dm, 'nausea') || matchesReason(dm, 'vomit') || matchesReason(dm, 'gastrointestinal') || matchesReason(dm, 'gi intolerance'));
    const hasSulfaAllergy = [...patient.allergies].some(a => a.toLowerCase().includes('sulfa') || a.toLowerCase().includes('sulfonamide'));

    const excludeBB = hasBbBradycardia;            // defer all NEW beta-blocker initiation
    const excludeCarvedilol = hasBbBronchospasm;   // non-selective β; prefer β1-selective
    const excludeGLP1 = hasGlp1GiIntolerance;

    if (hasSulfaAllergy) {
        clinicalAlerts.push('SULFA ALLERGY: Loop and thiazide diuretics are sulfonamide derivatives. Cross-reactivity is low but documented — monitor for rash/hypersensitivity. Ethacrynic acid is the sulfonamide-free loop alternative if a true reaction occurs.');
    }
    if (excludeBB) {
        clinicalAlerts.push('BETA-BLOCKER INTOLERANCE: Prior bradycardia/AV block on a beta-blocker. New beta-blocker initiation is deferred; if a beta-blocker is essential, evaluate for pacing. An existing beta-blocker should be reduced, not abruptly stopped.');
    }

    const excludeACEi = hasAngioedemaRisk || hasAceiCoughHistory;
    // H1 fix: ACEi angioedema cross-reactivity with ARBs is only ~2-8% (different mechanism).
    // ACC/AHA 2022: ARBs "can be used with caution" after ACEi angioedema.
    // ARNI excluded (neprilysin inhibition raises bradykinin → worsens angioedema risk).
    // ARBs allowed with mandatory monitoring warning (see below).
    const excludeARNI = hasAngioedemaRisk;
    const excludeMRA = hasHyperkalemiaHistory || hasGynecomastiaHistory;
    const currentHasSteroidalMRA = (patient.current_regimen || []).some(r => r.med.drug_class === 'MRA');
    const currentHasNsMRA = (patient.current_regimen || []).some(r => r.med.drug_class === 'nsMRA');

    // G2: Track which drug classes are fully excluded (for BB-contraindicated ivabradine path)
    const excludedClasses = new Set<string>();

    const formulary = MEDICATION_FORMULARY.filter(m => {
        if (!availableMedNames.has(m.name)) return false;
        if (excludedNames.has(m.name)) return false;

        // D8: Cross-reference patient allergies against formulary drug names
        if (patient.allergies.has(m.name)) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Patient-reported allergy" });
            excludedClasses.add(m.drug_class);
            return false;
        }

        if (m.drug_class === 'ACEi' && excludeACEi) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Cross-reactivity with prior ACEi intolerance" });
            return false;
        }
        if (excludeARNI && m.drug_class === 'ARNI') {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "ARNI excluded: neprilysin inhibition worsens bradykinin-mediated angioedema risk" });
            return false;
        }
        if (m.drug_class === 'MRA' && excludeMRA) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Cross-reactivity with prior MRA intolerance" });
            return false;
        }
        if (m.drug_class === 'Beta Blocker' && excludeBB) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Prior beta-blocker intolerance (bradycardia / AV block) — new initiation deferred" });
            excludedClasses.add(m.drug_class);
            return false;
        }
        if (m.name === 'Carvedilol' && excludeCarvedilol) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Non-selective beta-blocker avoided after bronchospasm; prefer β1-selective (bisoprolol / metoprolol succinate)" });
            return false;
        }
        if ((m.drug_class === 'GLP-1 RA' || m.drug_class === 'GLP-1/GIP RA') && excludeGLP1) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Prior GLP-1 GI intolerance" });
            return false;
        }
        if (m.drug_class === 'nsMRA' && hasHyperkalemiaHistory) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Hyperkalemia intolerance (applies to all MRA types)" });
            return false;
        }
        if (m.drug_class === 'nsMRA' && currentHasSteroidalMRA) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Dual MRA prevention: current steroidal MRA in regimen" });
            return false;
        }
        if (m.drug_class === 'MRA' && currentHasNsMRA) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Dual MRA prevention: current nsMRA in regimen" });
            return false;
        }

        if (m.contraindications && m.contraindications(patient)) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Clinical Contraindication" });
            excludedClasses.add(m.drug_class);
            return false;
        }

        return true;
    });

    // Check if ALL beta blockers were excluded (not just one)
    const allBBExcluded = !formulary.some(m => m.drug_class === 'Beta Blocker');

    // 2. Build dose tiers for available formulary
    const medTiers = formulary.flatMap(m => getDoseTiers(m, patient));

    // 3. Analyze current regimen
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers, allBBExcluded);

    // Criteria-met adjuncts to surface regardless of whether they rank in the top picks —
    // prevents a guideline-indicated add-on (e.g. A-HeFT H/ISDN, SHIFT ivabradine) from being
    // silently absent just because the composite score favored other changes.
    const eligibleAdjuncts = buildEligibleAdjuncts(analysis.addableAdjuncts);

    // 4. Generate candidate modifications
    const binders = medTiers.filter(r => r.med.drug_class === 'K+ Binder');
    const candidateSets = generateCandidateModifications(analysis, patient, binders);

    // 5. Score each candidate
    // H7: Binder rescue — prefer Patiromer, fallback to any available K+ binder (Lokelma)
    const rescueBinder = binders.find(b => b.med.name === 'Patiromer') || binders[0];
    const ivIron = medTiers.find(r => r.med.drug_class === 'IV Iron');
    const ironDeficient = isIronDeficient(patient);
    const results: ScoredRegimen[] = [];

    // --- GDMT completeness target -------------------------------------------------------
    // Standard of care is COMPLETE guideline therapy, rapidly sequenced — not the smallest
    // safe change. The weighted domains alone under-reward each added pillar (guideline 15% ×
    // 20 pts ≈ +3) while cost/adherence immediately penalize the extra drug, so partial
    // regimens out-rank complete ones and the 3-slot display drops the rest. This bonus rewards
    // each INDICATED, ACHIEVABLE therapy actually present, proportionally, with enough weight
    // that the complete safe regimen leads. "Achievable" excludes therapies the patient cannot
    // take (already filtered out of `formulary`), so a patient is never penalized for a
    // contraindicated pillar. It is applied BEFORE the hemodynamic/electrolyte penalties below,
    // so an unsafe projection still disqualifies the regimen regardless of completeness.
    const COMPLETENESS_MAX = 30;
    const phenotype = classifyPhenotype(patient);
    const isReducedPhenotype = phenotype === 'HFrEF' || phenotype === 'HFmrEF';

    interface GdmtSlot { match: (cls: string) => boolean; }
    const completenessSlots: GdmtSlot[] = [];
    if (isReducedPhenotype) {
        completenessSlots.push(
            { match: (c) => RAAS_CLASSES.has(c) },
            { match: (c) => c === 'Beta Blocker' },
            { match: (c) => c === 'MRA' || c === 'nsMRA' },
            { match: (c) => c === 'SGLT2i' }
        );
    } else { // HFpEF
        completenessSlots.push(
            { match: (c) => c === 'SGLT2i' },
            { match: (c) => c === 'MRA' || c === 'nsMRA' } // TOPCAT / FINEARTS-HF adjunct
        );
    }
    // Eligible DISEASE-MODIFYING adjuncts also count toward completeness, sourced from the engine's
    // own eligibility (analysis.addableAdjuncts) so criteria (HR/rhythm for ivabradine, NT-proBNP +
    // worsening for vericiguat, BMI/EF for GLP-1, A-HeFT for H/ISDN, iron studies for IV iron) stay
    // in ONE place. Symptomatic-only adjuncts (loop/thiazide diuretics, digoxin) are excluded — they
    // are not guideline "completeness." Without this, adding an indicated adjunct earned no
    // completeness credit, so the bare pillar regimen out-ranked it and the adjunct fell out of the
    // 3-slot display (e.g. ivabradine in a SHIFT candidate, vericiguat in a VICTORIA candidate).
    const ADJUNCT_COMPLETENESS_CLASSES = new Set(['If Inhibitor', 'sGC Stimulator', 'Vasodilator', 'GLP-1 RA', 'GLP-1/GIP RA', 'IV Iron']);
    const eligibleAdjunctClasses = new Set<string>();
    analysis.addableAdjuncts.forEach(a => { if (ADJUNCT_COMPLETENESS_CLASSES.has(a.med.drug_class)) eligibleAdjunctClasses.add(a.med.drug_class); });
    (patient.current_regimen ?? []).forEach(r => { if (ADJUNCT_COMPLETENESS_CLASSES.has(r.med.drug_class)) eligibleAdjunctClasses.add(r.med.drug_class); });
    // GLP-1 RA and GLP-1/GIP RA are one therapeutic slot (either agent satisfies it).
    const hasGlp1Slot = [...eligibleAdjunctClasses].some(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA');
    eligibleAdjunctClasses.delete('GLP-1 RA');
    eligibleAdjunctClasses.delete('GLP-1/GIP RA');
    if (hasGlp1Slot) completenessSlots.push({ match: (c) => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA' });
    eligibleAdjunctClasses.forEach(cls => completenessSlots.push({ match: (c) => c === cls }));

    // Keep only slots the patient can actually attain (a non-excluded formulary med exists).
    const achievableSlots = completenessSlots.filter(s => formulary.some(m => s.match(m.drug_class)));

    candidateSets.forEach(modSet => {
        const requiresDiureticFirst = isVolumeDepleted && hasDiureticInCurrent;
        if (requiresDiureticFirst) {
            const hasUnsafeIntensification = hasRelevantIntensification(modSet, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES);
            const hasPriorityDeEscalation = hasDiureticDeEscalation(modSet);
            if (hasUnsafeIntensification && !hasPriorityDeEscalation) {
                return;
            }
        }

        let sim = simulateModificationEffect(patient, modSet, prices);
        let activeModSet = modSet;

        // Iron rescue: auto-append IV iron when criteria met (clinic-administered, not competing with oral GDMT)
        if (ironDeficient && ivIron && !modSet.resulting_regimen.some(r => r.med.drug_class === 'IV Iron')) {
            const ironMod: RegimenModification = {
                action: 'add',
                target: ivIron,
                summary: `Add ${ivIron.med.name} ${formatDose(ivIron)} (iron deficiency)`
            };
            const ironModSet: ModificationSet = {
                modifications: [...modSet.modifications, ironMod],
                resulting_regimen: [...modSet.resulting_regimen, ivIron]
            };
            sim = simulateModificationEffect(patient, ironModSet, prices);
            activeModSet = ironModSet;
        }

        // DIAMOND protocol: proactive binder co-prescription when initiating MRA at baseline K+ > 5.0
        const isMraAdd = activeModSet.modifications.some(m =>
            m.action === 'add' && m.target &&
            (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
        );
        const alreadyHasBinder = activeModSet.resulting_regimen.some(r =>
            r.med.drug_class === 'K+ Binder'
        );
        if (isMraAdd && patient.potassium > 5.0 && rescueBinder && !alreadyHasBinder) {
            const diamondMod: RegimenModification = {
                action: 'add',
                target: rescueBinder,
                summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)} (DIAMOND protocol)`
            };
            const diamondModSet: ModificationSet = {
                modifications: [...activeModSet.modifications, diamondMod],
                resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
            };
            sim = simulateModificationEffect(patient, diamondModSet, prices);
            activeModSet = diamondModSet;
        }

        // H7+H8: Binder rescue: if K+ > 5.3, try adding K+ binder (Patiromer preferred, Lokelma fallback)
        // H8 fix: Use activeModSet (which includes iron if appended) not original modSet
        if (sim.projectedPatient.potassium > 5.3 && rescueBinder && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder')) {
            const rescueMod: RegimenModification = {
                action: 'add',
                target: rescueBinder,
                summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)}`
            };
            const rescuedModSet: ModificationSet = {
                modifications: [...activeModSet.modifications, rescueMod],
                resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
            };
            const rescuedSim = simulateModificationEffect(patient, rescuedModSet, prices);

            if (rescuedSim.projectedPatient.potassium < 5.3 && rescuedSim.projectedPatient.potassium > 3.5) {
                sim = rescuedSim;
                sim.warnings.push(`Binder Required: ${rescueBinder.med.name} added to manage Hyperkalemia.`);
                activeModSet = rescuedModSet;
            }
        }

        const p = sim.projectedPatient;

        // Unknown baseline NT-proBNP → neutral 50, not a false 100 (it would otherwise
        // read as "perfect neurohormonal status" simply because the field was blank).
        const s_neuro = dataAudit.unknownBnp ? 50 : calculateNeurohormonalScore(p.nt_pro_bnp);
        const s_func = calculateFunctionalScore(p.nyha_class, p.kccq_score, p.daily_step_count);
        const s_vol = calculateVolumeScore(p.volume_status.dry_weight_kg, p.volume_status.current_weight_kg, p.volume_status.exam_findings, p.oxygen_saturation);
        const s_struc = calculateStructureScore(p.lvef, p.lvedd, p.lavi, patient.lvef, patient.lvedd, patient.lavi);
        const s_cost = calculateCostScore(sim.cost, patient.max_affordable_cost, patient.cost_sensitivity);
        const s_adhere = calculateAdherenceScore(sim.complexity, patient.complexity_tolerance);
        const s_guide = calculateGuidelineConcordanceScore(activeModSet.resulting_regimen, patient);
        // Attach the evidence basis (recommendation class + trials) for the pillars present.
        sim.rationale = [...sim.rationale, ...describeConcordance(activeModSet.resulting_regimen, patient)];

        // Weighted scoring: Clinical domains 60%, Patient factors 25%, Evidence 15%
        // Neuro 20% | Func 15% | Vol 15% | Struct 10% | Cost 15% | Adhere 10% | Guideline 15%
        let overall = s_neuro * 0.20 + s_func * 0.15 + s_vol * 0.15 + s_struc * 0.10
                     + s_cost * 0.15 + s_adhere * 0.10 + s_guide * 0.15;

        // Special feature bonus (normalized by regimen size, capped +15)
        const regimenLength = activeModSet.resulting_regimen.length;
        const normalizedSFBonus = regimenLength > 0
            ? Math.max(-10, Math.min(15, sim.specialFeatureBonus / regimenLength * 3))
            : 0;
        overall += normalizedSFBonus;

        // GDMT completeness bonus — rewards the share of indicated, achievable therapy attained.
        // DOSE-AWARE: a pillar present but below target earns PARTIAL credit, so up-titrating a
        // sub-target agent toward its target raises the score (otherwise a quad at starting doses
        // would look "complete" and the engine would prefer "keep" over titration — GDMT inertia).
        // A single-dose drug, or one already at target / at its maximum available dose, earns full
        // credit (it cannot be titrated further).
        const SUBTARGET_CREDIT = 0.6;
        const slotValue = (s: GdmtSlot): number => {
            const meds = activeModSet.resulting_regimen.filter(r => s.match(r.med.drug_class));
            if (meds.length === 0) return 0;
            const optimal = meds.some(r => {
                const doses = r.med.available_doses;
                if (doses.length === 1) return true;
                const atTarget = !!doses.find(d => d.strength === r.dose.strength)?.is_target_dose;
                const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
                const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
                return atTarget || atMax;
            });
            return optimal ? 1.0 : SUBTARGET_CREDIT;
        };
        let gdmtCompleteness = 0;
        if (achievableSlots.length > 0) {
            const attained = achievableSlots.reduce((sum, s) => sum + slotValue(s), 0);
            gdmtCompleteness = attained / achievableSlots.length;
            overall += COMPLETENESS_MAX * gdmtCompleteness;
        }

        // P5: Volume depletion — boost diuretic removal candidates
        if (isVolumeDepleted) {
            const hasDiureticRemoval = hasDiureticDeEscalation(activeModSet);
            if (hasDiureticRemoval) overall += 20;
        }

        // Graduated hemodynamic safety penalties for PROJECTED SBP.
        // The input SBP < 90 gate is a separate hard block for truly hypotensive patients, and the
        // display filter hides any regimen projecting SBP < 85 — those protect against real harm.
        // This RANKING penalty is therefore recalibrated to trial tolerability so it no longer
        // swamps guideline value: a projected SBP in the low-to-mid 90s is well within COPERNICUS
        // (enrolled ≥ 85) and PIONEER-HF (≥ 100) tolerability, and the projected value here is the
        // CONSERVATIVE pre-compensation estimate. The prior −60/−30 made hemodynamically-inert
        // drugs (e.g. digoxin) out-rank SGLT2i / full GDMT in de-novo patients starting near
        // SBP 100 — backwards. Disqualification at < 85 is retained.
        if (p.sbp < 85) overall = 0;         // Projected severe hypotension — disqualify (also display-filtered)
        else if (p.sbp < 90) overall -= 25;  // Caution; GDMT often still appropriate with monitoring
        else if (p.sbp < 95) overall -= 8;   // Mild; within trial tolerability for the conservative estimate
        if (p.pulse < 50) overall -= 50;
        if (p.potassium > 5.5) overall -= 50;

        // "Binder Required" deliberately COUNTS here: a regimen that needs a rescue binder to
        // stay under the K+ ceiling carries residual hyperkalemia risk. The binder enables the
        // regimen to be considered (DIAMOND), but must not erase the risk in ranking — an
        // otherwise-equal regimen that needs no rescue should score above one that does.
        // Only TRUE safety warnings should reduce the score. Informational / procedural guidance
        // (titration cadence, elderly start-low-go-slow, routine monitoring) must NOT be penalized —
        // counting the "Titration Interval" guidance as a danger made titrating GDMT toward target
        // score LOWER than leaving it sub-target, defeating the point. NOTE: "Binder Required" is
        // deliberately NOT here — a regimen needing K+ binder rescue carries residual hyperkalemia
        // risk and should rank below an equal regimen that does not (DIAMOND enables, doesn't erase).
        const NON_PENALIZED_WARNING_MARKERS = [
            'Elderly patient', 'Frail elderly', 'Hepatic Impairment', 'Monitor: K+',
            'Titration Interval', 'Multiple new medications',
        ];
        const dangerousWarnings = sim.warnings.filter(w =>
            !NON_PENALIZED_WARNING_MARKERS.some(marker => w.includes(marker))
        );
        if (dangerousWarnings.length > 0) overall -= (dangerousWarnings.length * 10);

        // Unknown baseline potassium: the projected-K+ hyperkalemia gate above is meaningless
        // when K+ was never entered (it computes from a 0 baseline and always looks "safe").
        // For any RAAS/MRA initiation or up-titration, apply an explicit caution penalty and
        // a mandatory pre-initiation check — never let blank data clear the gate. (Placed after
        // the dangerousWarnings penalty so the added warning is not double-counted.)
        if (dataAudit.unknownPotassium) {
            const initiatesRaasMra = activeModSet.modifications.some(m =>
                (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
                m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
            );
            if (initiatesRaasMra) {
                overall -= 15;
                sim.warnings.push('POTASSIUM UNKNOWN: Baseline serum potassium was not entered. Obtain a BMP and confirm K+ ≤ 5.0 before initiating or up-titrating this RAAS inhibitor / MRA.');
            }
        }

        const domainScores: DomainScores = {
            neurohormonal: Math.round(s_neuro),
            functional: Math.round(s_func),
            volume: Math.round(s_vol),
            structure: Math.round(s_struc),
            cost: Math.round(s_cost),
            adherence: Math.round(s_adhere),
            guideline: Math.round(s_guide)
        };
        const hasMraInRegimen = activeModSet.resulting_regimen.some(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');

        results.push({
            regimen: activeModSet.resulting_regimen,
            projected_patient: p,
            baseline_lvef: patient.lvef,
            overall_score: Math.round(Math.min(100, Math.max(0, overall))),
            raw_score: overall,
            domain_scores: domainScores,
            special_feature_bonus: Math.round(normalizedSFBonus),
            gdmt_completeness: gdmtCompleteness,
            cost: sim.cost,
            complexity: sim.complexity,
            rationale: sim.rationale,
            risks: [],
            warnings: sim.warnings,
            monitoring_plan: buildMonitoringPlan(patient, p, activeModSet),
            qualitative_projections: buildQualitativeProjections(patient, p, hasMraInRegimen),
            trade_offs: buildTradeOffLabels(domainScores),
            modification_set: activeModSet
        });
    });

    if (typeof process !== 'undefined' && process.env && process.env.DEBUG_CAND) {
        [...results].sort((a, b) => b.overall_score - a.overall_score || (b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0)).slice(0, 14).forEach(r => {
            const ch = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${(m.target ?? m.source)?.med.name} ${m.target?.dose?.strength ?? ''}`);
            console.log(`   [cand] ${r.overall_score} c${(r.gdmt_completeness ?? 0).toFixed(2)} :: ${ch.join(', ') || 'KEEP'}`);
        });
    }

    // 6. Affordability filter + distinct picks (same algorithm as before)
    // Ranking is completeness-aware: when overall scores tie (common once strong regimens clamp
    // at the 100 cap), the MORE guideline-complete regimen ranks first, so the option carrying an
    // indicated add-on (e.g. GLP-1 in obese HFpEF/HFmrEF) wins the display slot instead of an
    // equally-scored but less complete sibling. Score still dominates when it differs.
    // Once strong regimens clamp at the 100 cap, the displayed overall_score ties. Break ties by
    // GDMT completeness FIRST, so an indicated add-on (e.g. GLP-1 in obese HFpEF) wins a display
    // slot over a less-complete but raw-score-inflated sibling (e.g. SGLT2i + a symptomatic loop
    // diuretic). Among equally complete regimens, fall to the UNCAPPED raw score, which preserves
    // the evidence/special-feature differentiation the cap erased (e.g. SGLT2i over an MRA-only
    // pairing in HFmrEF). Cost is deliberately NOT a tiebreaker — it must not override an
    // evidence-based preference (it is already in the cost domain and the affordability filter).
    const byScoreThenCompleteness = (a: ScoredRegimen, b: ScoredRegimen) =>
        b.overall_score - a.overall_score ||
        (b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0) ||
        (b.raw_score ?? 0) - (a.raw_score ?? 0);
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];

    if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort(byScoreThenCompleteness);
    } else if (results.length > 0) {
        const cheapest = results.sort((a, b) => a.cost - b.cost).slice(0, 5);
        const budgetMessage = patient.max_affordable_cost <= 0
            ? 'No zero-copay regimen found. Add covered medications or raise budget.'
            : 'Increase budget to find valid options.';
        outputRegimens = cheapest.map(r => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: Cheapest option ($${r.cost}) displayed. ${budgetMessage}`, ...r.warnings]
        }));
    }

    // Display-safety floors mirror the graduated score penalties: penalties begin at SBP < 95,
    // K+ > 5.5, HR < 50; the more extreme floors below are hard display gates — a projected
    // state past them is never shown, regardless of how well the regimen scores elsewhere.
    const displaySafeRegimens = outputRegimens.filter(r =>
        r.projected_patient.sbp >= 85 && r.projected_patient.potassium <= 6.0 && r.projected_patient.pulse >= 45
    );
    if (outputRegimens.length > 0 && displaySafeRegimens.length === 0) {
        clinicalAlerts.push(
            'NO DISPLAY-SAFE REGIMEN: Candidate regimens projected severe hypotension (SBP < 85), severe hyperkalemia (K+ > 6.0), or severe bradycardia (HR < 45). ' +
            'Stabilize and reassess before oral intensification.'
        );
    }
    outputRegimens = displaySafeRegimens;

    const topPick = outputRegimens[0];
    if (!topPick) return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [] };

    // S2: When hemodynamically unstable (SBP < 90), return alerts only — no oral GDMT.
    if (patient.sbp < 90) {
        return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [] };
    }

    const distinctPicks: ScoredRegimen[] = [topPick];

    for (const r of outputRegimens) {
        if (distinctPicks.length >= 3) break;

        const isDistinct = distinctPicks.every(existing => {
            const costDiff = Math.abs(r.cost - existing.cost);
            const rNames = new Set(r.regimen.map(x => x.med.name));
            const eNames = new Set(existing.regimen.map(x => x.med.name));

            const intersection = [...rNames].filter(x => eNames.has(x)).length;
            const union = new Set([...rNames, ...eNames]).size;
            const similarity = intersection / union;

            const hasArniR = rNames.has('Sacubitril/Valsartan (Entresto)');
            const hasArniE = eNames.has('Sacubitril/Valsartan (Entresto)');

            const hasGLPR = [...rNames].some(n => n.includes('Semaglutide') || n.includes('Tirzepatide'));
            const hasGLPE = [...eNames].some(n => n.includes('Semaglutide') || n.includes('Tirzepatide'));

            if (hasArniR !== hasArniE) return true;
            if (hasGLPR !== hasGLPE) return true;
            if (costDiff > 30) return true;
            if (similarity < 0.7) return true;

            return false;
        });

        if (isDistinct) {
            distinctPicks.push(r);
        }
    }

    // H2: Low-output state — still show recommendations but with mandatory warnings and capped scores.
    // NPs need guidance on current medication management, not a blank screen.
    let finalPicks = distinctPicks;
    if (lowOutput) {
        const lowOutputWarning =
            'LOW OUTPUT STATE: These recommendations require hemodynamic stabilization first. ' +
            'Do NOT initiate new agents until perfusion is restored. ' +
            'If patient is currently on beta-blocker, do NOT abruptly discontinue (Class III harm) — reduce dose if needed. ' +
            'Prioritize: IV inotropes → hemodynamic monitoring → Advanced HF consultation → then cautious oral GDMT.';
        finalPicks = distinctPicks.map(r => ({
            ...r,
            overall_score: Math.min(r.overall_score, 35), // Cap score to signal caution
            warnings: [lowOutputWarning, ...r.warnings]
        }));
    }

    return {
        scoredRegimens: finalPicks,
        excludedMedications: excludedMeds,
        clinicalAlerts,
        monitoringPlan: topPick.monitoring_plan || [],
        gdmtGaps,
        eligibleAdjuncts,
        missingDataNotices,
        followUpCalendar: buildFollowUpCalendar(topPick.modification_set)
    };
}
