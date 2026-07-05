/**
 * 100-SCENARIO CLINICAL AUDIT
 *
 * Standalone QA harness for HeartFailurePATH. These scenarios are intentionally broader
 * than the CI regression set: the goal is to stress phenotype recognition, safety gates,
 * duplicate-therapy cleanup, GDMT gap closure, and data-quality handling.
 *
 * Run: npx tsx scripts/hundredScenarioAudit.ts
 */
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { MEDICATION_FORMULARY } from '../constants';
import type { Patient, RegimenMed, ScoredRegimen, SimulationOutput } from '../types';

const names = MEDICATION_FORMULARY.map(m => m.name);
const available = new Set(names);
const RAAS = new Set(['ARNI', 'ACEi', 'ARB']);
const MRA = new Set(['MRA', 'nsMRA']);
// sGC Stimulator (vericiguat: FDA boxed warning — embryo-fetal toxicity) and If Inhibitor
// (ivabradine: fetal harm, Corlanor labeling) are pregnancy-contraindicated in the formulary.
const TERATOGEN_OR_PREGNANCY_AVOID = new Set(['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA', 'SGLT2i', 'GLP-1 RA', 'GLP-1/GIP RA', 'sGC Stimulator', 'If Inhibitor']);

type Check = (output: SimulationOutput, patient: Patient) => string[];

interface Scenario {
    title: string;
    tags: string[];
    patient: Patient;
    expect: Check[];
}

function reg(seeds: { name: string; strength: number | string; freq?: string }[]): RegimenMed[] {
    return seeds.map(seed => {
        const med = MEDICATION_FORMULARY.find(m => m.name === seed.name);
        if (!med) throw new Error(`Missing formulary med: ${seed.name}`);
        const dose = med.available_doses.find(d => String(d.strength) === String(seed.strength));
        if (!dose) throw new Error(`Missing dose for ${seed.name} ${seed.strength}`);
        const selected_frequency = seed.freq && dose.frequency_options.includes(seed.freq)
            ? seed.freq
            : dose.frequency_options[0];
        return { med, dose, selected_frequency };
    });
}

const baseline: Patient = {
    age: 64,
    sex: 'Male',
    race: 'White',
    height_cm: 175,
    bmi: 28,
    sbp: 122,
    dbp: 76,
    pulse: 74,
    oxygen_saturation: 97,
    rhythm: 'Sinus',
    nt_pro_bnp: 1800,
    nyha_class: 'II',
    kccq_score: 58,
    daily_step_count: 4200,
    peak_flow_lpm: 420,
    lvef: 30,
    lvedd: 60,
    lavi: 38,
    volume_status: { dry_weight_kg: 80, current_weight_kg: 81, exam_findings: new Set<string>() },
    bun: 20,
    creatinine: 1.1,
    egfr: 70,
    potassium: 4.2,
    comorbidities: new Set(['HFrEF']),
    external_medications: new Set<string>(),
    allergies: new Set<string>(),
    discontinued_meds: [],
    ever_lvef_le_40: 'yes',
    recent_hf_worsening_within_6mo: 'no',
    current_regimen: [],
    max_affordable_cost: 4000,
    cost_sensitivity: 2,
    insurance_tier: 'commercial',
    complexity_tolerance: 8,
    max_new_classes_per_visit: 3,
};

function cloneSet<T>(value?: Set<T>): Set<T> {
    return new Set(value ?? []);
}

function base(overrides: Partial<Patient> = {}): Patient {
    const patient: Patient = {
        ...baseline,
        volume_status: {
            ...baseline.volume_status,
            exam_findings: new Set(baseline.volume_status.exam_findings),
        },
        comorbidities: new Set(baseline.comorbidities),
        external_medications: new Set(baseline.external_medications),
        allergies: new Set(baseline.allergies),
        discontinued_meds: baseline.discontinued_meds.map(m => ({ ...m })),
        current_regimen: baseline.current_regimen.map(r => ({ ...r })),
        ...overrides,
    };

    if (overrides.volume_status) {
        patient.volume_status = {
            ...overrides.volume_status,
            exam_findings: cloneSet(overrides.volume_status.exam_findings),
        };
    }
    if (overrides.comorbidities) patient.comorbidities = cloneSet(overrides.comorbidities);
    if (overrides.external_medications) patient.external_medications = cloneSet(overrides.external_medications);
    if (overrides.allergies) patient.allergies = cloneSet(overrides.allergies);
    if (overrides.discontinued_meds) patient.discontinued_meds = overrides.discontinued_meds.map(m => ({ ...m }));
    if (overrides.current_regimen) patient.current_regimen = overrides.current_regimen.map(r => ({ ...r }));
    return patient;
}

function classGroup(drugClass: string): string {
    if (RAAS.has(drugClass)) return 'RAAS Inhibitor';
    if (MRA.has(drugClass)) return 'MRA';
    if (drugClass === 'GLP-1 RA' || drugClass === 'GLP-1/GIP RA') return 'GLP-1 Therapy';
    return drugClass;
}

function hasClass(output: SimulationOutput, predicate: (drugClass: string) => boolean): boolean {
    return output.scoredRegimens.some(r => r.regimen.some(m => predicate(m.med.drug_class)));
}

function hasMed(output: SimulationOutput, name: string): boolean {
    return output.scoredRegimens.some(r => r.regimen.some(m => m.med.name === name));
}

function hasWarning(output: SimulationOutput, text: string): boolean {
    const needle = text.toLowerCase();
    return output.scoredRegimens.some(r => r.warnings.some(w => w.toLowerCase().includes(needle)));
}

function hasAlert(output: SimulationOutput, text: string): boolean {
    const needle = text.toLowerCase();
    return output.clinicalAlerts.some(a => a.toLowerCase().includes(needle));
}

function hasAdjunct(output: SimulationOutput, text: string): boolean {
    const needle = text.toLowerCase();
    return (output.eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes(needle));
}

function hasGap(output: SimulationOutput, text: string): boolean {
    const needle = text.toLowerCase();
    return (output.gdmtGaps ?? []).some(a => a.toLowerCase().includes(needle));
}

function nonKeepMods(regimen: ScoredRegimen): string[] {
    return (regimen.modification_set?.modifications ?? [])
        .filter(m => m.action !== 'keep')
        .map(m => m.summary);
}

function expectRegimen(message = 'expected at least one regimen'): Check {
    return output => output.scoredRegimens.length > 0 ? [] : [message];
}

function expectNoRegimen(message = 'expected no displayed regimens'): Check {
    return output => output.scoredRegimens.length === 0 ? [] : [message];
}

function expectAlert(text: string, message?: string): Check {
    return output => hasAlert(output, text) ? [] : [message ?? `missing alert containing "${text}"`];
}

function expectWarning(text: string, message?: string): Check {
    return output => hasWarning(output, text) ? [] : [message ?? `missing regimen warning containing "${text}"`];
}

function expectAnyClass(predicate: (drugClass: string) => boolean, message: string): Check {
    return output => hasClass(output, predicate) ? [] : [message];
}

function expectNoClass(predicate: (drugClass: string) => boolean, message: string): Check {
    return output => hasClass(output, predicate) ? [message] : [];
}

function expectNoMed(name: string, message?: string): Check {
    return output => hasMed(output, name) ? [message ?? `${name} should not be displayed`] : [];
}

function expectAnyMedOrAdjunct(names: string[], adjunctText: string, message: string): Check {
    return output => {
        const medFound = names.some(name => hasMed(output, name));
        return medFound || hasAdjunct(output, adjunctText) ? [] : [message];
    };
}

function expectAnyClassOrGap(predicate: (drugClass: string) => boolean, gapText: string, message: string): Check {
    return output => hasClass(output, predicate) || hasGap(output, gapText) ? [] : [message];
}

function expectTopHasPillars(count: number): Check {
    return output => {
        const top = output.scoredRegimens[0];
        if (!top) return [`top regimen missing; expected at least ${count} HFrEF pillars`];
        const groups = new Set(top.regimen.map(m => classGroup(m.med.drug_class)));
        const pillarCount = ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'].filter(p => groups.has(p)).length;
        return pillarCount >= count ? [] : [`top regimen has ${pillarCount} HFrEF pillars; expected at least ${count}`];
    };
}

function expectNoPillarRemoval(): Check {
    return output => {
        const bad = output.scoredRegimens.filter(r =>
            (r.modification_set?.modifications ?? []).some(m =>
                m.action === 'remove' &&
                m.source &&
                ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'].includes(classGroup(m.source.med.drug_class))
            )
        );
        return bad.length ? [`${bad.length} regimen(s) remove a disease-modifying pillar`] : [];
    };
}

function expectTitrationUp(message = 'expected at least one up-titration option'): Check {
    return output => output.scoredRegimens.some(r =>
        (r.modification_set?.modifications ?? []).some(m => m.action === 'titrate_up')
    ) ? [] : [message];
}

function expectModification(predicate: (summary: string) => boolean, message: string): Check {
    return output => output.scoredRegimens.some(r => nonKeepMods(r).some(predicate)) ? [] : [message];
}

function expectMaxNewClassGroups(max: number): Check {
    return (output, patient) => {
        const currentGroups = new Set(patient.current_regimen.map(r => classGroup(r.med.drug_class)));
        const violators = output.scoredRegimens.filter(r => {
            const resultingGroups = new Set(r.regimen.map(m => classGroup(m.med.drug_class)));
            let added = 0;
            resultingGroups.forEach(group => { if (!currentGroups.has(group)) added += 1; });
            return added > max;
        });
        return violators.length ? [`${violators.length} regimen(s) exceed max_new_classes_per_visit=${max}`] : [];
    };
}

function expectBinderWithMraWhenKHigh(): Check {
    return output => {
        const bad = output.scoredRegimens.filter(r => {
            const hasMra = r.regimen.some(m => MRA.has(m.med.drug_class));
            const hasBinder = r.regimen.some(m => m.med.drug_class === 'K+ Binder');
            return hasMra && !hasBinder;
        });
        return bad.length ? [`${bad.length} MRA-containing regimen(s) lack K+ binder in borderline/high K+ scenario`] : [];
    };
}

function expectNoDuplicateClassGroups(): Check {
    const blocked = new Set(['RAAS Inhibitor', 'MRA', 'Beta Blocker', 'SGLT2i', 'Loop Diuretic', 'GLP-1 Therapy']);
    return output => {
        const failures: string[] = [];
        output.scoredRegimens.forEach((r, index) => {
            const counts = new Map<string, number>();
            r.regimen.forEach(m => {
                const group = classGroup(m.med.drug_class);
                counts.set(group, (counts.get(group) ?? 0) + 1);
            });
            counts.forEach((count, group) => {
                if (blocked.has(group) && count > 1) failures.push(`regimen ${index + 1} has duplicate ${group}`);
            });
        });
        return failures;
    };
}

function globalSafetyChecks(output: SimulationOutput, patient: Patient): string[] {
    const failures: string[] = [];

    failures.push(...expectNoDuplicateClassGroups()(output, patient));

    output.scoredRegimens.forEach((r, index) => {
        if (r.overall_score < 0 || r.overall_score > 100) failures.push(`regimen ${index + 1} score out of range`);
        Object.entries(r.domain_scores).forEach(([domain, score]) => {
            if (score < 0 || score > 100) failures.push(`regimen ${index + 1} ${domain} score out of range`);
        });
        if (r.projected_patient.sbp < 85) failures.push(`regimen ${index + 1} projects SBP < 85`);
        if (r.projected_patient.pulse < 45) failures.push(`regimen ${index + 1} projects HR < 45`);
        if (r.projected_patient.potassium > 6.0) failures.push(`regimen ${index + 1} projects K+ > 6.0`);
    });

    if (patient.sbp < 90 && output.scoredRegimens.length > 0) failures.push('SBP < 90 produced displayed regimens');
    if (patient.sbp <= patient.dbp && output.scoredRegimens.length > 0) failures.push('invalid BP inversion produced displayed regimens');
    if ((patient.lvef <= 0 || patient.lvef > 80 || patient.potassium > 8) && output.scoredRegimens.length > 0) {
        failures.push('implausible or missing critical input produced displayed regimens');
    }

    const external = patient.external_medications ?? new Set<string>();
    if ((external.has('Sildenafil') || external.has('Tadalafil')) && hasClass(output, c => c === 'Vasodilator')) {
        failures.push('nitrate displayed with PDE5 inhibitor exposure');
    }

    if (patient.is_pregnant && hasClass(output, c => TERATOGEN_OR_PREGNANCY_AVOID.has(c))) {
        failures.push('pregnancy-avoid medication class displayed');
    }

    return failures;
}

const hfrEFPillars = [
    { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
    { name: 'Carvedilol', strength: 25, freq: 'bid' },
    { name: 'Spironolactone', strength: 25 },
    { name: 'Dapagliflozin', strength: 10 },
];

const S: Scenario[] = [
    // A. HFrEF optimization and physiologic constraints
    { title: '001 De novo ideal HFrEF, no constraints', tags: ['HFrEF', 'GDMT'], patient: base(), expect: [expectRegimen(), expectTopHasPillars(2), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered')] },
    { title: '002 ACEi monotherapy, missing three pillars', tags: ['HFrEF', 'GDMT'], patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not added'), expectAnyClassOrGap(c => MRA.has(c), 'mineralocorticoid', 'MRA not offered or surfaced')] },
    { title: '003 ARNI plus SGLT2i only, missing BB and MRA', tags: ['HFrEF', 'GDMT'], patient: base({ current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Dapagliflozin', strength: 10 }]) }), expect: [expectRegimen(), expectAnyClassOrGap(c => c === 'Beta Blocker', 'beta-blocker', 'beta-blocker gap not addressed'), expectAnyClassOrGap(c => MRA.has(c), 'mineralocorticoid', 'MRA gap not addressed')] },
    { title: '004 Beta-blocker plus loop, missing RAAS and SGLT2i', tags: ['HFrEF', 'GDMT'], patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (1+)']) }, current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Furosemide', strength: 40 }]) }), expect: [expectRegimen(), expectAnyClass(c => RAAS.has(c), 'RAAS inhibitor not offered'), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered')] },
    { title: '005 Stable HFrEF on target quadruple therapy', tags: ['HFrEF', 'continuation'], patient: base({ current_regimen: reg(hfrEFPillars) }), expect: [expectRegimen(), expectNoPillarRemoval(), expectTopHasPillars(4)] },
    { title: '006 Quad therapy stuck at starting doses', tags: ['HFrEF', 'titration'], patient: base({ pulse: 82, sbp: 130, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }, { name: 'Carvedilol', strength: 3.125, freq: 'bid' }, { name: 'Spironolactone', strength: 12.5 }, { name: 'Dapagliflozin', strength: 10 }]) }), expect: [expectRegimen(), expectTitrationUp()] },
    { title: '007 Low but permissive SBP 92 in severe HFrEF', tags: ['HFrEF', 'hypotension'], patient: base({ sbp: 92, dbp: 60, lvef: 22, nt_pro_bnp: 3200 }), expect: [expectRegimen('SBP 92 should not be a silent blank'), expectAnyClass(c => c === 'SGLT2i' || RAAS.has(c), 'no low-hemodynamic-cost GDMT offered')] },
    { title: '008 Hard-stop hypotension SBP 88', tags: ['HFrEF', 'hard-stop'], patient: base({ sbp: 88, dbp: 58, pulse: 92 }), expect: [expectNoRegimen(), expectAlert('hemodynamic')] },
    { title: '009 Bradycardia HR 48, avoid BB and ivabradine', tags: ['HFrEF', 'bradycardia'], patient: base({ pulse: 48 }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker' || c === 'If Inhibitor', 'chronotropic drug displayed despite HR 48')] },
    { title: '010 Sinus HR 78 on max beta-blocker, ivabradine candidate', tags: ['HFrEF', 'adjunct'], patient: base({ pulse: 78, lvef: 30, current_regimen: reg(hfrEFPillars) }), expect: [expectAnyMedOrAdjunct(['Ivabradine'], 'ivabradine', 'ivabradine not displayed or surfaced')] },
    { title: '011 Atrial fibrillation with HFrEF and no rate-control med', tags: ['HFrEF', 'AF'], patient: base({ rhythm: 'AFib', pulse: 112, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Dapagliflozin', strength: 10 }]) }), expect: [expectRegimen(), expectNoMed('Ivabradine', 'ivabradine displayed in AF')] },
    { title: '012 Third-degree AV block, avoid BB and digoxin', tags: ['HFrEF', 'conduction'], patient: base({ rhythm: '3rd Degree AV Block', pulse: 52 }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker' || c === 'Inotrope', 'BB or digoxin displayed despite AV block')] },
    { title: '013 Hyperkalemia K 5.8, avoid MRA', tags: ['HFrEF', 'potassium'], patient: base({ potassium: 5.8, egfr: 42, current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoClass(c => MRA.has(c), 'MRA displayed despite K 5.8')] },
    { title: '014 Borderline K 5.1, MRA requires binder mitigation', tags: ['HFrEF', 'potassium'], patient: base({ potassium: 5.1, egfr: 52, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10 }]) }), expect: [expectRegimen(), expectBinderWithMraWhenKHigh()] },
    { title: '015 eGFR 28, steroidal MRA contraindicated', tags: ['HFrEF', 'renal'], patient: base({ egfr: 28, creatinine: 2.4, potassium: 4.7, current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoClass(c => c === 'MRA', 'steroidal MRA displayed at eGFR 28')] },
    { title: '016 eGFR 24, do not initiate SGLT2i', tags: ['HFrEF', 'renal'], patient: base({ egfr: 24, creatinine: 2.8, current_regimen: [] }), expect: [expectRegimen(), expectNoClass(c => c === 'SGLT2i', 'SGLT2i initiated below eGFR threshold')] },
    { title: '017 Existing SGLT2i below initiation threshold should continue', tags: ['HFrEF', 'renal'], patient: base({ egfr: 18, creatinine: 3.2, current_regimen: reg([{ name: 'Dapagliflozin', strength: 10 }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'existing SGLT2i not preserved')] },
    { title: '018 Angioedema history, avoid ACEi and ARNI', tags: ['HFrEF', 'contraindication'], patient: base({ comorbidities: new Set(['HFrEF', 'History of Angioedema']) }), expect: [expectRegimen(), expectNoClass(c => c === 'ACEi' || c === 'ARNI', 'ACEi/ARNI displayed despite angioedema')] },
    { title: '019 Bilateral renal artery stenosis, avoid RAAS blockade', tags: ['HFrEF', 'contraindication'], patient: base({ comorbidities: new Set(['HFrEF', 'Bilateral Renal Artery Stenosis']) }), expect: [expectRegimen(), expectNoClass(c => RAAS.has(c), 'RAAS blockade displayed despite bilateral renal artery stenosis')] },
    { title: '020 Severe asthma bronchospasm, avoid beta-blockers', tags: ['HFrEF', 'pulmonary'], patient: base({ comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']), pulse: 88 }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker', 'beta-blocker displayed despite severe asthma')] },

    // B. HFmrEF, HFpEF, and HFimpEF phenotypes
    { title: '021 HFmrEF LVEF 45 de novo', tags: ['HFmrEF'], patient: base({ lvef: 45, ever_lvef_le_40: 'no', comorbidities: new Set(['HFmrEF']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered in HFmrEF')] },
    { title: '022 HFmrEF lower boundary LVEF 41', tags: ['HFmrEF'], patient: base({ lvef: 41, ever_lvef_le_40: 'no', comorbidities: new Set(['HFmrEF']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered at LVEF 41')] },
    { title: '023 Obese diabetic HFmrEF', tags: ['HFmrEF', 'obesity'], patient: base({ lvef: 44, bmi: 34, ever_lvef_le_40: 'no', comorbidities: new Set(['HFmrEF', 'Diabetes Mellitus Type 2', 'Obesity (BMI > 30)']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered'), expectAnyMedOrAdjunct(['Semaglutide (Wegovy)', 'Tirzepatide (Zepbound)'], 'glp', 'GLP-1/GIP therapy not displayed or surfaced')] },
    { title: '024 HFmrEF with eGFR 24, avoid SGLT2i initiation', tags: ['HFmrEF', 'renal'], patient: base({ lvef: 46, ever_lvef_le_40: 'no', egfr: 24, creatinine: 2.7, comorbidities: new Set(['HFmrEF', 'Chronic Kidney Disease']) }), expect: [expectRegimen(), expectNoClass(c => c === 'SGLT2i', 'SGLT2i initiated in HFmrEF at eGFR 24')] },
    { title: '025 HFmrEF LVEF 45 with eGFR 22, avoid finerenone', tags: ['HFmrEF', 'renal'], patient: base({ lvef: 45, ever_lvef_le_40: 'no', egfr: 22, creatinine: 3.0, comorbidities: new Set(['HFmrEF', 'Diabetes Mellitus Type 2', 'Chronic Kidney Disease']) }), expect: [expectRegimen(), expectNoMed('Finerenone (Kerendia)', 'finerenone displayed below eGFR 25')] },
    { title: '026 HFimpEF prior 30 now 50, untreated', tags: ['HFimpEF'], patient: base({ lvef: 50, previous_lvef: 30, ever_lvef_le_40: 'yes', current_regimen: [] }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered in HFimpEF'), expectAnyClassOrGap(c => RAAS.has(c), 'RAAS', 'RAAS gap not addressed in HFimpEF')] },
    { title: '027 HFimpEF prior 25 now 55 on quad', tags: ['HFimpEF', 'continuation'], patient: base({ lvef: 55, previous_lvef: 25, ever_lvef_le_40: 'yes', current_regimen: reg(hfrEFPillars) }), expect: [expectRegimen(), expectNoPillarRemoval(), expectTopHasPillars(4)] },
    { title: '028 Unknown prior EF but arriving on HFrEF pillars', tags: ['HFimpEF'], patient: base({ lvef: 52, previous_lvef: undefined, ever_lvef_le_40: 'unknown', current_regimen: reg(hfrEFPillars) }), expect: [expectRegimen(), expectNoPillarRemoval(), expectTopHasPillars(4)] },
    { title: '029 HFpEF LVEF 60 de novo', tags: ['HFpEF'], patient: base({ lvef: 60, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF']), nt_pro_bnp: 900 }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered in HFpEF')] },
    { title: '030 Obese HFpEF BMI 36', tags: ['HFpEF', 'obesity'], patient: base({ lvef: 58, bmi: 36, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF', 'Obesity (BMI > 30)']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered in obese HFpEF'), expectAnyMedOrAdjunct(['Semaglutide (Wegovy)', 'Tirzepatide (Zepbound)'], 'glp', 'GLP-1/GIP therapy not displayed or surfaced')] },
    { title: '031 Diabetic HFpEF', tags: ['HFpEF', 'diabetes'], patient: base({ lvef: 62, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF', 'Diabetes Mellitus Type 2']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered in diabetic HFpEF')] },
    { title: '032 HFpEF LVEF 52 with elevated BNP, MRA subset', tags: ['HFpEF'], patient: base({ lvef: 52, ever_lvef_le_40: 'no', nt_pro_bnp: 1700, potassium: 4.1, egfr: 58, comorbidities: new Set(['HFpEF']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i missing from HFpEF output')] },
    { title: '033 HFpEF LVEF 68 with congestion', tags: ['HFpEF', 'volume'], patient: base({ lvef: 68, ever_lvef_le_40: 'no', volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) }, comorbidities: new Set(['HFpEF']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'SGLT2i', 'SGLT2i not offered'), expectAnyClass(c => c === 'Loop Diuretic', 'loop strategy not offered for congested HFpEF')] },
    { title: '034 HFpEF AF with rapid ventricular response', tags: ['HFpEF', 'AF'], patient: base({ lvef: 60, ever_lvef_le_40: 'no', rhythm: 'AFib', pulse: 118, comorbidities: new Set(['HFpEF', 'Atrial Fibrillation']) }), expect: [expectRegimen(), expectNoMed('Ivabradine', 'ivabradine displayed in AF')] },
    { title: '035 HFpEF resistant edema on oral loop', tags: ['HFpEF', 'volume'], patient: base({ lvef: 58, ever_lvef_le_40: 'no', volume_status: { dry_weight_kg: 70, current_weight_kg: 76, exam_findings: new Set(['Edema (3+)', 'JVP Elevated', 'Orthopnea']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80, freq: 'bid' }]), comorbidities: new Set(['HFpEF']) }), expect: [expectRegimen(), expectAnyClass(c => c === 'Loop Diuretic', 'loop strategy not preserved in resistant edema')] },
    { title: '036 HFpEF severe CKD eGFR 20, avoid SGLT2i initiation', tags: ['HFpEF', 'renal'], patient: base({ lvef: 60, ever_lvef_le_40: 'no', egfr: 20, creatinine: 3.4, comorbidities: new Set(['HFpEF', 'Chronic Kidney Disease']) }), expect: [expectNoClass(c => c === 'SGLT2i', 'SGLT2i initiated at eGFR 20')] },
    { title: '037 Pregnant HFpEF', tags: ['HFpEF', 'pregnancy'], patient: base({ sex: 'Female', age: 32, is_pregnant: true, lvef: 58, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF']) }), expect: [expectAlert('pregnan')] },
    { title: '038 Obese HFpEF with MEN2, avoid GLP-1/GIP', tags: ['HFpEF', 'obesity'], patient: base({ lvef: 56, bmi: 37, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF', 'MEN2 Syndrome', 'Obesity (BMI > 30)']) }), expect: [expectRegimen(), expectNoClass(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA', 'GLP-1/GIP displayed despite MEN2')] },
    { title: '039 HFpEF hard-stop hypotension SBP 86', tags: ['HFpEF', 'hard-stop'], patient: base({ lvef: 62, ever_lvef_le_40: 'no', sbp: 86, dbp: 58, comorbidities: new Set(['HFpEF']) }), expect: [expectNoRegimen(), expectAlert('hemodynamic')] },
    { title: '040 HFpEF with unknown prior reduced EF status', tags: ['HFpEF', 'data'], patient: base({ lvef: 60, previous_lvef: undefined, ever_lvef_le_40: 'unknown', comorbidities: new Set(['HFpEF']) }), expect: [expectRegimen(), expectAlert('hfimpef')] },

    // C. Acute/worsening HF and volume management
    { title: '041 Warm-wet HFrEF, no baseline beta-blocker', tags: ['acute', 'HFrEF'], patient: base({ nyha_class: 'III', pulse: 94, volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) }, current_regimen: reg([{ name: 'Furosemide', strength: 40 }]) }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker', 'beta-blocker initiated during warm-wet decompensation'), expectAnyClass(c => c === 'SGLT2i' || MRA.has(c), 'no safe gap-closing therapy offered')] },
    { title: '042 Cold-wet HFrEF on beta-blocker', tags: ['acute', 'HFrEF'], patient: base({ sbp: 92, dbp: 68, lvef: 18, nt_pro_bnp: 5200, nyha_class: 'IV', volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Cool Extremities']) }, current_regimen: reg([{ name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }, { name: 'Furosemide', strength: 80 }]) }), expect: [expectRegimen(), expectModification(s => /carvedilol/i.test(s) && /reduce|down|titrate/i.test(s), 'existing beta-blocker not down-titrated in cold/wet state'), expectWarning('low output')] },
    { title: '043 NYHA IV acute decompensation, no BB initiation', tags: ['acute', 'HFrEF'], patient: base({ nyha_class: 'IV', pulse: 96, volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)', 'JVP Elevated', 'Orthopnea']) }, current_regimen: [] }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker', 'beta-blocker initiated in NYHA IV decompensation')] },
    { title: '044 Low-output state with cool extremities and narrow pulse pressure', tags: ['acute', 'advanced'], patient: base({ lvef: 15, sbp: 92, dbp: 70, nt_pro_bnp: 5200, nyha_class: 'IV', volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set(['Cool Extremities']) } }), expect: [expectRegimen(), expectAlert('low output'), output => output.scoredRegimens.some(r => r.overall_score > 35) ? ['low-output regimen score not capped'] : []] },
    { title: '045 Hypoxic congested HFrEF', tags: ['acute', 'hypoxia'], patient: base({ oxygen_saturation: 86, pulse: 98, volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Rales', 'Orthopnea']) }, current_regimen: reg([{ name: 'Furosemide', strength: 40 }]) }), expect: [expectRegimen(), expectWarning('spO2', 'missing hypoxia warning')] },
    { title: '046 Severe congestion already on high-dose loop', tags: ['volume'], patient: base({ volume_status: { dry_weight_kg: 78, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)', 'JVP Elevated', 'Orthopnea', 'Rales']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectAnyClass(c => c === 'Loop Diuretic', 'loop diuretic not preserved during severe congestion')] },
    { title: '047 Furoscix candidate, persistent congestion on oral loop', tags: ['volume', 'Furoscix'], patient: base({ volume_status: { dry_weight_kg: 78, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), output => output.excludedMedications.some(e => e.name === 'Furoscix (SC Furosemide)') ? ['Furoscix incorrectly excluded in eligible persistent-congestion scenario'] : [], output => output.scoredRegimens.some(r => r.regimen.some(m => m.med.name === 'Furoscix (SC Furosemide)') && !r.warnings.some(w => w.includes('FUROSCIX SAFETY'))) ? ['Furoscix regimen missing device safety warning'] : []] },
    { title: '048 Furoscix blocked by furosemide allergy', tags: ['volume', 'Furoscix'], patient: base({ allergies: new Set(['Furosemide']), volume_status: { dry_weight_kg: 78, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) }, current_regimen: reg([{ name: 'Torsemide', strength: 20, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoMed('Furoscix (SC Furosemide)', 'Furoscix displayed despite furosemide allergy')] },
    { title: '049 Furoscix blocked by adhesive allergy', tags: ['volume', 'Furoscix'], patient: base({ allergies: new Set(['Adhesive acrylate allergy']), volume_status: { dry_weight_kg: 78, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoMed('Furoscix (SC Furosemide)', 'Furoscix displayed despite adhesive/acrylate allergy')] },
    { title: '050 eGFR 12 with congestion, avoid Furoscix and thiazide-like add-ons', tags: ['volume', 'renal'], patient: base({ egfr: 12, creatinine: 5.2, volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)', 'JVP Elevated']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoMed('Furoscix (SC Furosemide)', 'Furoscix displayed at eGFR 12'), expectNoClass(c => c === 'Thiazide-like Diuretic', 'thiazide-like diuretic displayed at eGFR 12')] },
    { title: '051 Volume depleted on loop diuretic', tags: ['volume', 'depletion'], patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 77, exam_findings: new Set<string>() }, bun: 44, creatinine: 1.6, current_regimen: reg([{ name: 'Furosemide', strength: 80 }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectAlert('volume depletion'), expectModification(s => /furosemide/i.test(s) && /remove|down|titrate/i.test(s), 'loop de-escalation not offered in volume depletion')] },
    { title: '052 Euvolemic patient on very high-dose loop', tags: ['volume', 'deprescribe'], patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set<string>() }, current_regimen: reg([{ name: 'Furosemide', strength: 160, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), (output) => hasAlert(output, 'loop diuretic over-treatment') || output.scoredRegimens.some(r => nonKeepMods(r).some(s => /furosemide/i.test(s) && /remove|reduce|down|titrate/i.test(s))) ? [] : ['high-dose loop not reduced, removed, or flagged in euvolemia']] },
    { title: '053 Severe CKD loop resistance', tags: ['volume', 'renal'], patient: base({ egfr: 18, creatinine: 3.4, volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80 }]) }), expect: [expectRegimen(), expectAlert('ckd')] },
    { title: '054 Gout with congestion, diuretic caution', tags: ['volume', 'gout'], patient: base({ comorbidities: new Set(['HFrEF', 'Gout']), volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) }, current_regimen: [] }), expect: [expectRegimen(), output => hasWarning(output, 'gout') || hasClass(output, c => c !== 'Loop Diuretic' && c !== 'Thiazide-like Diuretic') ? [] : ['diuretic gout caution not surfaced']] },
    { title: '055 Hypokalemia on loop with AF, avoid digoxin toxicity setup', tags: ['volume', 'potassium'], patient: base({ rhythm: 'AFib', pulse: 96, potassium: 3.2, current_regimen: reg([{ name: 'Furosemide', strength: 80 }]) }), expect: [expectRegimen(), expectNoMed('Digoxin', 'digoxin displayed with K 3.2')] },

    // D. Safety, DDIs, pregnancy, allergies, intolerance
    { title: '056 Pregnant on ACE inhibitor', tags: ['pregnancy'], patient: base({ sex: 'Female', age: 31, is_pregnant: true, current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('pregnan'), expectNoClass(c => RAAS.has(c) || MRA.has(c) || c === 'SGLT2i', 'pregnancy-contraindicated GDMT displayed')] },
    { title: '057 Pregnant on full quadruple HFrEF therapy', tags: ['pregnancy'], patient: base({ sex: 'Female', age: 30, is_pregnant: true, current_regimen: reg(hfrEFPillars) }), expect: [expectRegimen(), expectAlert('pregnan'), expectNoClass(c => RAAS.has(c) || MRA.has(c) || c === 'SGLT2i', 'teratogenic/avoid GDMT retained in pregnancy')] },
    { title: '058 H-ISDN plus sildenafil exposure', tags: ['DDI'], patient: base({ race: 'Black', nyha_class: 'III', external_medications: new Set(['Sildenafil']), current_regimen: reg([{ name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('pde5'), expectNoClass(c => c === 'Vasodilator', 'nitrate displayed with sildenafil')] },
    { title: '059 Chronic NSAID with RAAS therapy', tags: ['DDI'], patient: base({ comorbidities: new Set(['HFrEF', 'Chronic NSAID Use']), current_regimen: reg([{ name: 'Lisinopril', strength: 20 }]) }), expect: [expectRegimen(), output => hasAlert(output, 'nsaid') || hasWarning(output, 'nsaid') ? [] : ['NSAID + RAAS risk not surfaced']] },
    { title: '060 Lithium plus loop diuretic exposure', tags: ['DDI'], patient: base({ external_medications: new Set(['Lithium']), volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 40 }]) }), expect: [expectRegimen(), expectWarning('lithium')] },
    { title: '061 Amiodarone plus digoxin exposure', tags: ['DDI'], patient: base({ rhythm: 'AFib', external_medications: new Set(['Amiodarone']), current_regimen: reg([{ name: 'Digoxin', strength: 125 }]) }), expect: [expectRegimen(), output => hasMed(output, 'Digoxin') && !hasWarning(output, 'amiodarone') ? ['digoxin retained without amiodarone DDI warning'] : []] },
    { title: '062 Verapamil plus beta-blocker in HFrEF', tags: ['DDI'], patient: base({ external_medications: new Set(['Verapamil']), current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('verapamil'), output => hasClass(output, c => c === 'Beta Blocker') && !hasWarning(output, 'verapamil') ? ['beta-blocker retained without verapamil warning'] : []] },
    { title: '063 AF patient arrives on ivabradine', tags: ['DDI', 'AF'], patient: base({ rhythm: 'AFib', pulse: 86, current_regimen: reg([{ name: 'Ivabradine', strength: 5, freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectNoMed('Ivabradine', 'ivabradine retained in AF')] },
    { title: '064 Type 1 diabetes, avoid SGLT2i', tags: ['contraindication'], patient: base({ comorbidities: new Set(['HFrEF', 'Type 1 Diabetes Mellitus']) }), expect: [expectRegimen(), expectNoClass(c => c === 'SGLT2i', 'SGLT2i displayed in type 1 diabetes')] },
    { title: '065 Prior DKA, avoid SGLT2i', tags: ['contraindication'], patient: base({ comorbidities: new Set(['HFrEF', 'Prior DKA / Euglycemic DKA']) }), expect: [expectRegimen(), expectNoClass(c => c === 'SGLT2i', 'SGLT2i displayed with prior DKA risk')] },
    { title: '066 Obesity with MEN2, no GLP-1/GIP', tags: ['contraindication'], patient: base({ lvef: 58, ever_lvef_le_40: 'no', bmi: 38, comorbidities: new Set(['HFpEF', 'MEN2 Syndrome']) }), expect: [expectRegimen(), expectNoClass(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA', 'GLP-1/GIP displayed despite MEN2')] },
    { title: '067 Obesity with medullary thyroid carcinoma, no GLP-1/GIP', tags: ['contraindication'], patient: base({ lvef: 58, ever_lvef_le_40: 'no', bmi: 38, comorbidities: new Set(['HFpEF', 'Medullary Thyroid Carcinoma']) }), expect: [expectRegimen(), expectNoClass(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA', 'GLP-1/GIP displayed despite MTC')] },
    { title: '068 Child-Pugh B/C liver disease, avoid ARNI', tags: ['contraindication'], patient: base({ comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']) }), expect: [expectRegimen(), expectNoClass(c => c === 'ARNI', 'ARNI displayed in Child-Pugh B/C liver disease')] },
    { title: '069 Child-Pugh B/C liver disease on finerenone', tags: ['contraindication'], patient: base({ lvef: 45, ever_lvef_le_40: 'no', comorbidities: new Set(['HFmrEF', 'Liver Disease (Child-Pugh B/C)']), current_regimen: reg([{ name: 'Finerenone (Kerendia)', strength: 10 }]) }), expect: [expectRegimen(), expectNoMed('Finerenone (Kerendia)', 'finerenone retained in Child-Pugh B/C liver disease')] },
    { title: '070 Severe asthma while taking beta-blocker', tags: ['contraindication', 'pulmonary'], patient: base({ comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']), current_regimen: reg([{ name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectNoClass(c => c === 'Beta Blocker', 'beta-blocker retained despite severe asthma'), expectWarning('taper')] },
    { title: '071 Mild asthma, avoid carvedilol but preserve beta-1 option', tags: ['pulmonary'], patient: base({ comorbidities: new Set(['HFrEF', 'Asthma (Mild/Moderate)']), pulse: 78 }), expect: [expectRegimen(), expectNoMed('Carvedilol', 'carvedilol displayed in mild/moderate asthma')] },
    { title: '072 ACE inhibitor cough intolerance', tags: ['intolerance'], patient: base({ discontinued_meds: [{ name: 'Lisinopril', drug_class: 'ACEi', reason: 'Cough' }], current_regimen: reg([{ name: 'Ramipril', strength: 5 }]) }), expect: [expectRegimen(), expectNoClass(c => c === 'ACEi', 'ACEi displayed despite documented ACEi cough intolerance')] },
    { title: '073 Gynecomastia on spironolactone', tags: ['intolerance'], patient: base({ sex: 'Male', discontinued_meds: [{ name: 'Spironolactone', drug_class: 'MRA', reason: 'Gynecomastia' }], current_regimen: reg([{ name: 'Spironolactone', strength: 25 }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectNoMed('Spironolactone', 'spironolactone retained despite documented gynecomastia')] },
    { title: '074 Sulfa allergy with diuretic need', tags: ['allergy'], patient: base({ allergies: new Set(['Sulfa']), volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)']) } }), expect: [expectRegimen(), expectAlert('sulfa')] },
    { title: '075 Furosemide allergy, avoid Furoscix', tags: ['allergy'], patient: base({ allergies: new Set(['Furosemide']), volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) } }), expect: [expectRegimen(), expectNoMed('Furoscix (SC Furosemide)', 'Furoscix displayed despite furosemide allergy')] },

    // E. Duplicate/redundant therapy and structural regimen cleanup
    { title: '076 Dual RAAS ACEi plus ARB', tags: ['duplicate'], patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Valsartan', strength: 80, freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('dual raas')] },
    { title: '077 Triple RAAS ACEi plus ARB plus ARNI', tags: ['duplicate'], patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Valsartan', strength: 80, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('dual raas')] },
    { title: '078 ACEi plus ARNI together', tags: ['duplicate'], patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }]) }), expect: [expectRegimen(), expectAlert('dual raas')] },
    { title: '079 Dual MRA steroidal plus nsMRA', tags: ['duplicate'], patient: base({ lvef: 45, ever_lvef_le_40: 'no', current_regimen: reg([{ name: 'Spironolactone', strength: 25 }, { name: 'Finerenone (Kerendia)', strength: 10 }]) }), expect: [expectRegimen(), expectAlert('mra')] },
    { title: '080 Dual beta-blocker therapy', tags: ['duplicate'], patient: base({ pulse: 82, current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Metoprolol Succinate', strength: 50 }]) }), expect: [expectRegimen()] },
    { title: '081 Dual SGLT2 inhibitor therapy', tags: ['duplicate'], patient: base({ current_regimen: reg([{ name: 'Dapagliflozin', strength: 10 }, { name: 'Empagliflozin', strength: 10 }]) }), expect: [expectRegimen()] },
    { title: '082 Dual loop therapy', tags: ['duplicate'], patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80 }, { name: 'Torsemide', strength: 20 }]) }), expect: [expectRegimen()] },
    { title: '083 Duplicate same medication entries', tags: ['duplicate'], patient: base({ current_regimen: reg([{ name: 'Furosemide', strength: 40 }, { name: 'Furosemide', strength: 40 }, { name: 'Lisinopril', strength: 10 }]) }), expect: [expectRegimen(), expectAlert('duplicate')] },
    { title: '084 Diltiazem exposure with digoxin/beta-blocker risk', tags: ['DDI'], patient: base({ external_medications: new Set(['Diltiazem']), current_regimen: reg([{ name: 'Digoxin', strength: 125 }]) }), expect: [expectRegimen(), output => hasMed(output, 'Digoxin') && !hasWarning(output, 'diltiazem') && !hasWarning(output, 'verapamil') ? ['digoxin retained without diltiazem/verapamil DDI warning'] : []] },
    { title: '085 External non-DHP CCB in HFrEF', tags: ['DDI'], patient: base({ external_medications: new Set(['Diltiazem']) }), expect: [expectRegimen(), expectAlert('non-dihydropyridine')] },

    // F. Data quality, cost, adherence, and adjunct surfacing
    { title: '086 Missing serum potassium', tags: ['data'], patient: base({ potassium: 0 }), expect: [expectRegimen(), expectAlert('potassium'), output => {
        const raasMra = output.scoredRegimens.filter(r => r.regimen.some(m => RAAS.has(m.med.drug_class) || MRA.has(m.med.drug_class)));
        return raasMra.length > 0 && !hasWarning(output, 'potassium unknown') ? ['RAAS/MRA regimen lacks potassium-unknown warning'] : [];
    }] },
    { title: '087 Missing LVEF', tags: ['data'], patient: base({ lvef: 0 }), expect: [expectNoRegimen(), expectAlert('lvef')] },
    { title: '088 Implausible LVEF 99', tags: ['data'], patient: base({ lvef: 99 }), expect: [expectNoRegimen(), expectAlert('implausible')] },
    { title: '089 Implausible potassium 9.0', tags: ['data'], patient: base({ potassium: 9.0 }), expect: [expectNoRegimen(), expectAlert('implausible')] },
    { title: '090 BP inversion SBP 80 DBP 120', tags: ['data'], patient: base({ sbp: 80, dbp: 120 }), expect: [expectNoRegimen(), expectAlert('systolic')] },
    { title: '091 Missing NT-proBNP', tags: ['data'], patient: base({ nt_pro_bnp: 0 }), expect: [expectRegimen(), expectAlert('nt-probnp')] },
    { title: '092 Missing renal function', tags: ['data'], patient: base({ egfr: 0, creatinine: 0 }), expect: [expectRegimen(), expectAlert('renal')] },
    { title: '093 Zero-dollar budget', tags: ['cost'], patient: base({ max_affordable_cost: 0, cost_sensitivity: 10 }), expect: [expectRegimen(), expectWarning('budget exceeded')] },
    { title: '094 Max one new class per visit', tags: ['adherence'], patient: base({ max_new_classes_per_visit: 1 }), expect: [expectRegimen(), expectMaxNewClassGroups(1)] },
    { title: '095 Complexity tolerance zero', tags: ['adherence'], patient: base({ complexity_tolerance: 0, max_new_classes_per_visit: 1 }), expect: [expectRegimen(), expectMaxNewClassGroups(1)] },
    { title: '096 Elderly age 87, start low and avoid excessive dosing', tags: ['elderly'], patient: base({ age: 87, sbp: 116, egfr: 48, current_regimen: [] }), expect: [expectRegimen(), output => output.scoredRegimens.some(r => r.warnings.some(w => /elderly|start low|frail/i.test(w))) ? [] : ['elderly dosing caution not surfaced']] },
    { title: '097 Recent worsening HFrEF, vericiguat eligible', tags: ['adjunct'], patient: base({ lvef: 32, nyha_class: 'III', nt_pro_bnp: 2600, recent_hf_worsening_within_6mo: 'yes', current_regimen: reg(hfrEFPillars) }), expect: [expectAnyMedOrAdjunct(['Vericiguat'], 'vericiguat', 'vericiguat not displayed or surfaced')] },
    { title: '098 No recent worsening, vericiguat not eligible', tags: ['adjunct'], patient: base({ lvef: 32, nyha_class: 'III', nt_pro_bnp: 2600, recent_hf_worsening_within_6mo: 'no', current_regimen: reg(hfrEFPillars) }), expect: [expectRegimen(), expectNoMed('Vericiguat', 'vericiguat displayed without recent worsening HF')] },
    { title: '099 Iron-deficient HFrEF', tags: ['adjunct'], patient: base({ ferritin: 60, tsat: 15, nyha_class: 'III', current_regimen: reg(hfrEFPillars) }), expect: [expectAnyMedOrAdjunct(['Ferric Carboxymaltose'], 'iron', 'IV iron not displayed or surfaced in iron deficiency')] },
    { title: '100 Low peak flow without known COPD/asthma', tags: ['pulmonary', 'data'], patient: base({ peak_flow_lpm: 280, comorbidities: new Set(['HFrEF']) }), expect: [expectRegimen(), output => output.scoredRegimens.some(r => r.rationale.some(x => /peak flow|copd\/asthma/i.test(x))) ? [] : ['low peak-flow screening rationale missing']] },
];

async function run() {
    if (S.length !== 100) {
        throw new Error(`Expected exactly 100 scenarios, found ${S.length}`);
    }

    const prices = await getDrugPrices(names, 'commercial');
    let passed = 0;
    const failures: { title: string; tags: string[]; messages: string[]; top?: string }[] = [];

    for (const scenario of S) {
        let output: SimulationOutput;
        try {
            output = generateAndScoreModifications(scenario.patient, available, prices);
        } catch (error) {
            failures.push({
                title: scenario.title,
                tags: scenario.tags,
                messages: [`THREW: ${(error as Error).message}`],
            });
            continue;
        }

        const messages = [
            ...globalSafetyChecks(output, scenario.patient),
            ...scenario.expect.flatMap(check => check(output, scenario.patient)),
        ];

        if (messages.length === 0) {
            passed += 1;
            continue;
        }

        const top = output.scoredRegimens[0]
            ? output.scoredRegimens[0].regimen.map(r => `${r.med.name} ${r.dose.strength}${r.dose.unit}`).join(' + ')
            : '(none)';
        failures.push({ title: scenario.title, tags: scenario.tags, messages, top });
    }

    console.log(`\n100-SCENARIO AUDIT: ${passed}/${S.length} clean`);
    if (failures.length > 0) {
        const byTag = new Map<string, number>();
        failures.forEach(f => f.tags.forEach(tag => byTag.set(tag, (byTag.get(tag) ?? 0) + 1)));
        console.log(`\nFAILED SCENARIOS (${failures.length}):`);
        failures.forEach(f => {
            console.log(`\n- ${f.title} [${f.tags.join(', ')}]`);
            if (f.top) console.log(`  top: ${f.top}`);
            f.messages.forEach(m => console.log(`  x ${m}`));
        });
        console.log('\nFAILURE TAG COUNTS:');
        [...byTag.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([tag, count]) => {
            console.log(`- ${tag}: ${count}`);
        });
    }

    process.exit(failures.length > 0 ? 1 : 0);
}

run();
