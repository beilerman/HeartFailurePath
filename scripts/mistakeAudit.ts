/**
 * MISTAKE AUDIT — 51 scenarios modeling common real-world treatment errors, most with
 * medications already on board. Each scenario declares what the engine SHOULD do; the
 * harness reports deviations. Standalone QA (not part of CI). Run: npx tsx scripts/mistakeAudit.ts
 */
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { MEDICATION_FORMULARY } from '../constants';
import type { Patient, RegimenMed, SimulationOutput, ExcludedMedication } from '../types';

const names = MEDICATION_FORMULARY.map(m => m.name);
const available = new Set(names);
const RAAS = new Set(['ARNI', 'ACEi', 'ARB']);

function reg(seeds: { name: string; strength: number | string; freq?: string }[]): RegimenMed[] {
    return seeds.map(s => {
        const med = MEDICATION_FORMULARY.find(m => m.name === s.name);
        if (!med) throw new Error(`no med ${s.name}`);
        const dose = med.available_doses.find(d => String(d.strength) === String(s.strength));
        if (!dose) throw new Error(`no dose ${s.name} ${s.strength}`);
        const freq = s.freq && dose.frequency_options.includes(s.freq) ? s.freq : dose.frequency_options[0];
        return { med, dose, selected_frequency: freq };
    });
}

function base(overrides: Partial<Patient>): Patient {
    const p: Patient = {
        age: 64, sex: 'Male', race: 'White', height_cm: 175, bmi: 27,
        sbp: 122, dbp: 76, pulse: 72, oxygen_saturation: 97, rhythm: 'Sinus',
        nt_pro_bnp: 1500, nyha_class: 'II', kccq_score: 60, daily_step_count: 4000,
        lvef: 30, lvedd: 58, lavi: 36,
        volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set() },
        bun: 20, creatinine: 1.1, egfr: 70, potassium: 4.2,
        comorbidities: new Set(['HFrEF']),
        external_medications: new Set<string>(),
        allergies: new Set<string>(),
        discontinued_meds: [],
        ever_lvef_le_40: 'yes',
        recent_hf_worsening_within_6mo: 'no',
        current_regimen: [],
        max_affordable_cost: 2000, cost_sensitivity: 1, insurance_tier: 'commercial',
        complexity_tolerance: 9, max_new_classes_per_visit: 3,
    };
    return { ...p, ...overrides };
}

// --- accessors ---
const A = (o: SimulationOutput) => {
    const regs = o.scoredRegimens;
    const hasClassInAny = (pred: (c: string) => boolean) => regs.some(r => r.regimen.some(m => pred(m.med.drug_class)));
    const hasMedInAny = (n: string) => regs.some(r => r.regimen.some(m => m.med.name === n));
    const excludedClass = (pred: (c: string) => boolean) => o.excludedMedications.some((e: ExcludedMedication) => pred(e.drug_class));
    const alert = (kw: string) => o.clinicalAlerts.some(a => a.toLowerCase().includes(kw.toLowerCase()));
    const anyWarn = (kw: string) => regs.some(r => r.warnings.some(w => w.toLowerCase().includes(kw.toLowerCase())));
    const adjunct = (kw: string) => (o.eligibleAdjuncts ?? []).some(a => a.toLowerCase().includes(kw.toLowerCase()));
    const dualClass = (pred: (c: string) => boolean) => regs.some(r => r.regimen.filter(m => pred(m.med.drug_class)).length > 1);
    const removesMed = (n: string) => regs.length > 0 && regs.every(r => (r.modification_set?.modifications ?? []).some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === n));
    return { regs, hasClassInAny, hasMedInAny, excludedClass, alert, anyWarn, adjunct, dualClass, removesMed };
};

interface Scenario { title: string; patient: Patient; expect: (o: SimulationOutput, p: Patient) => string[]; }

const S: Scenario[] = [
    // ===== A. Dual / redundant therapy =====
    { title: '01 Dual RAAS: Lisinopril + Losartan', patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 20 }, { name: 'Losartan', strength: 50 }, { name: 'Carvedilol', strength: 25, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => RAAS.has(c))) e.push('dual RAAS still displayed'); if (!a.alert('dual raas') && !a.alert('inappropriate')) e.push('no dual-RAAS deprescribe alert'); return e; } },
    { title: '02 ACEi + ARNI together', patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => RAAS.has(c))) e.push('ACEi+ARNI both displayed'); if (!a.alert('dual raas') && !a.alert('inappropriate')) e.push('no dual-RAAS alert'); return e; } },
    { title: '03 Dual MRA: Spironolactone + Finerenone', patient: base({ current_regimen: reg([{ name: 'Spironolactone', strength: 25 }, { name: 'Finerenone (Kerendia)', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => c === 'MRA' || c === 'nsMRA')) e.push('dual MRA displayed'); if (!a.alert('mra') && !a.alert('inappropriate')) e.push('no dual-MRA alert'); return e; } },
    { title: '04 Dual beta-blocker: Carvedilol + Metoprolol', patient: base({ pulse: 80, current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Metoprolol Succinate', strength: 50 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => c === 'Beta Blocker')) e.push('two beta-blockers displayed simultaneously'); return e; } },
    { title: '05 Dual SGLT2i: Dapagliflozin + Empagliflozin', patient: base({ current_regimen: reg([{ name: 'Dapagliflozin', strength: 10 }, { name: 'Empagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => c === 'SGLT2i')) e.push('two SGLT2i displayed simultaneously'); return e; } },
    { title: '06 Dual loop: Furosemide + Torsemide', patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (1+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 40 }, { name: 'Torsemide', strength: 20 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => c === 'Loop Diuretic')) e.push('two loop diuretics displayed simultaneously'); return e; } },
    { title: '07 ARB + ARNI (double valsartan)', patient: base({ current_regimen: reg([{ name: 'Valsartan', strength: 80 }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.dualClass(c => RAAS.has(c))) e.push('ARB+ARNI both displayed'); if (!a.alert('dual raas') && !a.alert('inappropriate')) e.push('no dual-RAAS alert'); return e; } },

    // ===== B. Underdosing / clinical inertia =====
    { title: '08 Quad all at starting dose for years', patient: base({ pulse: 78, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }, { name: 'Carvedilol', strength: 3.125, freq: 'bid' }, { name: 'Spironolactone', strength: 12.5 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; const upTitr = a.regs.some(r => (r.modification_set?.modifications ?? []).some(m => m.action === 'titrate_up')); if (!upTitr) e.push('no up-titration offered despite all pillars at starting dose'); return e; } },
    { title: '09 ACEi low-dose monotherapy, missing 3 pillars', patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 5 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added'); if (!a.hasClassInAny(c => c === 'MRA' || c === 'nsMRA') && !a.adjunct('mineralocorticoid')) e.push('MRA not offered'); return e; } },
    { title: '10 Beta-blocker stuck at 3.125, HR 88', patient: base({ pulse: 88, sbp: 128, current_regimen: reg([{ name: 'Carvedilol', strength: 3.125, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; const bbUp = a.regs.some(r => (r.modification_set?.modifications ?? []).some(m => m.action === 'titrate_up' && m.source?.med.drug_class === 'Beta Blocker')); if (!bbUp) e.push('beta-blocker not up-titrated despite HR 88, SBP 128'); return e; } },

    // ===== C. Wrong therapy for phenotype =====
    { title: '11 HFpEF (LVEF 60) on full quad', patient: base({ lvef: 60, lvedd: 48, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF']), current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i (HFpEF Class I) not added'); return e; } },
    { title: '12 HFpEF on Digoxin, sinus rhythm (no indication)', patient: base({ lvef: 58, ever_lvef_le_40: 'no', rhythm: 'Sinus', comorbidities: new Set(['HFpEF']), current_regimen: reg([{ name: 'Digoxin', strength: 125 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added in HFpEF'); return e; } },
    { title: '13 HFrEF on GLP-1 (no HFrEF indication), non-obese', patient: base({ lvef: 30, bmi: 26, current_regimen: reg([{ name: 'Semaglutide (Wegovy)', strength: 1 }, { name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added'); return e; } },

    // ===== D. Contraindicated drug on board =====
    { title: '14 Pregnant on Lisinopril (teratogen)', patient: base({ sex: 'Female', age: 31, is_pregnant: true, current_regimen: reg([{ name: 'Lisinopril', strength: 10 }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Lisinopril')) e.push('ACEi retained in pregnancy'); if (!a.alert('pregnan')) e.push('no pregnancy alert'); return e; } },
    { title: '15 Pregnant on Losartan (ARB)', patient: base({ sex: 'Female', age: 29, is_pregnant: true, current_regimen: reg([{ name: 'Losartan', strength: 50 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Losartan')) e.push('ARB retained in pregnancy'); if (!a.alert('pregnan')) e.push('no pregnancy alert'); return e; } },
    { title: '16 Pregnant on Spironolactone', patient: base({ sex: 'Female', age: 33, is_pregnant: true, current_regimen: reg([{ name: 'Spironolactone', strength: 25 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Spironolactone')) e.push('MRA retained in pregnancy'); return e; } },
    { title: '17 HFrEF on Verapamil (non-DHP CCB, external)', patient: base({ external_medications: new Set(['Verapamil']), current_regimen: reg([{ name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.alert('non-dihydropyridine') && !a.alert('verapamil') && !a.alert('inappropriate')) e.push('no non-DHP CCB inappropriate-therapy alert'); return e; } },
    { title: '18 Asthma on Carvedilol (non-selective)', patient: base({ pulse: 80, comorbidities: new Set(['HFrEF', 'Asthma (Mild/Moderate)']), current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Carvedilol')) e.push('non-selective Carvedilol retained in asthma (expect β1-selective)'); return e; } },
    { title: '19 Severe asthma on Bisoprolol', patient: base({ pulse: 80, comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']), current_regimen: reg([{ name: 'Bisoprolol', strength: 5 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasClassInAny(c => c === 'Beta Blocker') && !a.anyWarn('taper') && !a.anyWarn('asthma')) e.push('beta-blocker retained in severe asthma without taper/asthma guidance'); return e; } },
    { title: '20 K+ 5.8 on Spironolactone', patient: base({ potassium: 5.8, current_regimen: reg([{ name: 'Spironolactone', strength: 25 }, { name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Spironolactone') && !a.anyWarn('hyperkalemia') && !a.anyWarn('binder')) e.push('MRA at K+ 5.8 retained without hyperkalemia mitigation'); return e; } },
    { title: '21 eGFR 25 on Spironolactone (MRA CI <30)', patient: base({ egfr: 25, creatinine: 2.6, current_regimen: reg([{ name: 'Spironolactone', strength: 25 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Spironolactone')) e.push('Spironolactone retained at eGFR 25 (CI < 30)'); return e; } },
    { title: '22 AFib on Ivabradine (CI in AFib)', patient: base({ rhythm: 'AFib', pulse: 96, current_regimen: reg([{ name: 'Ivabradine', strength: 5, freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Ivabradine')) e.push('Ivabradine retained in AFib (contraindicated)'); return e; } },
    { title: '23 H/ISDN on board + Sildenafil (fatal DDI)', patient: base({ race: 'Black', nyha_class: 'III', external_medications: new Set(['Sildenafil']), current_regimen: reg([{ name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasClassInAny(c => c === 'Vasodilator')) e.push('nitrate retained with PDE5i (absolute CI)'); if (!a.alert('pde5')) e.push('no nitrate+PDE5i alert'); return e; } },
    { title: '24 Digoxin + K+ 3.2 + loop (toxicity setup)', patient: base({ rhythm: 'AFib', potassium: 3.2, current_regimen: reg([{ name: 'Digoxin', strength: 125 }, { name: 'Furosemide', strength: 80 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Digoxin') && !a.anyWarn('digoxin')) e.push('Digoxin + hypokalemia without toxicity warning'); return e; } },
    { title: '25 Digoxin 125 + eGFR 25 (accumulation)', patient: base({ rhythm: 'AFib', egfr: 25, creatinine: 2.6, current_regimen: reg([{ name: 'Digoxin', strength: 125 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Digoxin') && !a.anyWarn('digoxin')) e.push('Digoxin renal accumulation not addressed'); return e; } },
    { title: '26 Liver disease (Child-Pugh B/C) on ARNI', patient: base({ comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']), current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasClassInAny(c => c === 'ARNI')) e.push('ARNI retained in Child-Pugh B/C (hepatic CI)'); return e; } },
    { title: '27 Liver disease on Finerenone', patient: base({ lvef: 45, ever_lvef_le_40: 'no', comorbidities: new Set(['HFmrEF', 'Liver Disease (Child-Pugh B/C)']), current_regimen: reg([{ name: 'Finerenone (Kerendia)', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Finerenone (Kerendia)')) e.push('Finerenone retained in Child-Pugh B/C (CYP3A4 CI)'); return e; } },

    // ===== E. Diuretic mistakes =====
    { title: '28 Euvolemic on Furosemide 160 (over-diuresis)', patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() }, current_regimen: reg([{ name: 'Furosemide', strength: 160 }, { name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; const reduced = a.regs.some(r => (r.modification_set?.modifications ?? []).some(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Loop Diuretic')); const flagged = a.alert('over-treatment') || a.alert('over-diuresis'); if (!reduced && !flagged) e.push('high-dose loop at euvolemia neither reduced nor flagged'); return e; } },
    { title: '29 Volume depleted (-2kg) on loop, adding RAAS', patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 78, exam_findings: new Set() }, bun: 40, creatinine: 1.6, current_regimen: reg([{ name: 'Furosemide', strength: 80 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.alert('volume depletion') && !a.anyWarn('volume')) e.push('no volume-depletion alert with diuretic'); return e; } },
    { title: '29b Severe CKD eGFR 18 on Furosemide qd', patient: base({ egfr: 18, creatinine: 3.4, volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 80 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.alert('ckd') && !a.anyWarn('split') && !a.alert('eGFR')) e.push('no severe-CKD loop strategy guidance'); return e; } },

    // ===== F. DDIs on board =====
    { title: '30 RAAS + chronic NSAID', patient: base({ comorbidities: new Set(['HFrEF', 'Chronic NSAID Use']), current_regimen: reg([{ name: 'Lisinopril', strength: 20 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.anyWarn('nsaid') && !a.alert('nsaid')) e.push('no RAAS+NSAID AKI warning'); return e; } },
    { title: '31 Digoxin + Amiodarone (external)', patient: base({ rhythm: 'AFib', external_medications: new Set(['Amiodarone']), current_regimen: reg([{ name: 'Digoxin', strength: 125 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Digoxin') && !a.anyWarn('amiodarone')) e.push('no Digoxin+Amiodarone DDI warning'); return e; } },
    { title: '32 Loop + Lithium (external)', patient: base({ external_medications: new Set(['Lithium']), volume_status: { dry_weight_kg: 80, current_weight_kg: 82.5, exam_findings: new Set(['Edema (1+)']) }, current_regimen: reg([{ name: 'Furosemide', strength: 40 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.anyWarn('lithium')) e.push('no Lithium+diuretic DDI warning'); return e; } },
    { title: '33 BB + Ivabradine on board (chronotropic DDI)', patient: base({ pulse: 74, lvef: 32, current_regimen: reg([{ name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Ivabradine', strength: 5, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; const both = a.regs.some(r => { const cls = new Set(r.regimen.map(m => m.med.drug_class)); return cls.has('Beta Blocker') && cls.has('If Inhibitor'); }); const warned = a.regs.some(r => { const cls = new Set(r.regimen.map(m => m.med.drug_class)); return cls.has('Beta Blocker') && cls.has('If Inhibitor') && r.warnings.some(w => w.toLowerCase().includes('ivabradine')); }); if (both && !warned) e.push('BB+Ivabradine without chronotropic DDI warning'); return e; } },
    { title: '34 Verapamil (external) + BB on board', patient: base({ external_medications: new Set(['Verapamil']), current_regimen: reg([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasClassInAny(c => c === 'Beta Blocker') && !a.anyWarn('verapamil')) e.push('no Verapamil+BB bradycardia DDI warning'); return e; } },

    // ===== G. Intolerance mishandling =====
    { title: '35 ACEi cough documented but still on ACEi', patient: base({ discontinued_meds: [{ name: 'Lisinopril', drug_class: 'ACEi', reason: 'Cough' }], current_regimen: reg([{ name: 'Ramipril', strength: 5 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; // ACEi should be excluded; switch to ARB/ARNI
        if (!a.excludedClass(c => c === 'ACEi')) e.push('ACEi not excluded despite documented cough'); return e; } },
    { title: '36 Angioedema history but on Lisinopril', patient: base({ comorbidities: new Set(['HFrEF', 'History of Angioedema']), current_regimen: reg([{ name: 'Lisinopril', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (a.hasMedInAny('Lisinopril')) e.push('ACEi retained despite angioedema history'); return e; } },
    { title: '37 Gynecomastia on Spironolactone', patient: base({ discontinued_meds: [{ name: 'Spironolactone', drug_class: 'MRA', reason: 'Gynecomastia' }], current_regimen: reg([{ name: 'Spironolactone', strength: 25 }, { name: 'Lisinopril', strength: 10 }]) }),
      expect: () => [] /* informational: ideally switch to eplerenone; not strictly required */ },

    // ===== H. Missing pillars (clinical inertia) =====
    { title: '38 HFrEF on ACEi+BB only (no MRA/SGLT2i)', patient: base({ current_regimen: reg([{ name: 'Lisinopril', strength: 20 }, { name: 'Carvedilol', strength: 25, freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added'); if (!a.hasClassInAny(c => c === 'MRA' || c === 'nsMRA') && !a.adjunct('mineralocorticoid')) e.push('MRA not offered'); return e; } },
    { title: '39 HFrEF on ARNI+SGLT2i only (no BB/MRA)', patient: base({ pulse: 76, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'Beta Blocker')) e.push('beta-blocker not added'); if (!a.hasClassInAny(c => c === 'MRA' || c === 'nsMRA') && !a.adjunct('mineralocorticoid')) e.push('MRA not offered'); return e; } },
    { title: '40 HFrEF triple, no SGLT2i (modern gap)', patient: base({ current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i (top GDMT gap) not added'); return e; } },
    { title: '41 HFrEF on BB+loop only', patient: base({ volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) }, current_regimen: reg([{ name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Furosemide', strength: 40 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => RAAS.has(c))) e.push('RAAS not added'); if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added'); return e; } },
    { title: '42 Diabetic HFrEF on metformin, no SGLT2i', patient: base({ comorbidities: new Set(['HFrEF', 'Diabetes Mellitus Type 2']), external_medications: new Set(['Metformin']), current_regimen: reg([{ name: 'Lisinopril', strength: 20 }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added in diabetic HFrEF'); return e; } },

    // ===== I. Other indication gaps / appropriate continuation =====
    { title: '43 NYHA I asymptomatic HFrEF LVEF 38, untreated', patient: base({ lvef: 38, nyha_class: 'I', nt_pro_bnp: 400, kccq_score: 90, current_regimen: [] }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('asymptomatic HFrEF not offered SGLT2i'); if ((o.gdmtGaps ?? []).length === 0) e.push('no GDMT gaps surfaced for untreated HFrEF'); return e; } },
    { title: '44 HFimpEF (prev 25, now 50) on quad — must continue', patient: base({ lvef: 50, previous_lvef: 25, ever_lvef_le_40: 'yes', current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; // should NOT deprescribe pillars
        const removesPillar = a.regs[0] && (a.regs[0].modification_set?.modifications ?? []).some(m => m.action === 'remove' && (RAAS.has(m.source?.med.drug_class ?? '') || m.source?.med.drug_class === 'Beta Blocker' || m.source?.med.drug_class === 'MRA' || m.source?.med.drug_class === 'SGLT2i')); if (removesPillar) e.push('HFimpEF top pick deprescribes a pillar (should continue)'); return e; } },
    { title: '45 Obese HFpEF, no GLP-1', patient: base({ lvef: 56, bmi: 34, ever_lvef_le_40: 'no', comorbidities: new Set(['HFpEF']), current_regimen: reg([{ name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA') && !a.adjunct('glp-1')) e.push('GLP-1 not surfaced for obese HFpEF'); return e; } },
    { title: '46 Iron deficient (ferritin 40) on full GDMT', patient: base({ ferritin: 40, tsat: 15, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'IV Iron') && !a.adjunct('iron')) e.push('IV iron not surfaced despite iron deficiency'); return e; } },
    { title: '47 Black NYHA III HFrEF on quad, no H/ISDN', patient: base({ race: 'Black', nyha_class: 'III', kccq_score: 45, current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'Vasodilator') && !a.adjunct('hydralazine')) e.push('H/ISDN not surfaced for Black NYHA III on GDMT'); return e; } },
    { title: '48 HR 78 sinus on max BB, LVEF 30 (ivabradine)', patient: base({ pulse: 78, lvef: 30, rhythm: 'Sinus', current_regimen: reg([{ name: 'Carvedilol', strength: 50, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'If Inhibitor') && !a.adjunct('ivabradine')) e.push('ivabradine not surfaced (HR 78, sinus, max BB, LVEF 30)'); return e; } },
    { title: '49 Worsening HFrEF, BNP 2500, no vericiguat', patient: base({ lvef: 32, nyha_class: 'III', nt_pro_bnp: 2500, recent_hf_worsening_within_6mo: 'yes', current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Spironolactone', strength: 25 }, { name: 'Dapagliflozin', strength: 10 }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'sGC Stimulator') && !a.adjunct('vericiguat')) e.push('vericiguat not surfaced (VICTORIA criteria met)'); return e; } },
    { title: '50 Sub-target ARNI 24/26 alone, everything else missing', patient: base({ current_regimen: reg([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }]) }),
      expect: (o) => { const a = A(o); const e: string[] = []; if (!a.hasClassInAny(c => c === 'SGLT2i')) e.push('SGLT2i not added'); if (!a.hasClassInAny(c => c === 'Beta Blocker')) e.push('beta-blocker not added'); return e; } },
];

async function run() {
    let pass = 0; const problems: { title: string; errs: string[] }[] = [];
    for (const sc of S) {
        const prices = await getDrugPrices(names, sc.patient.insurance_tier);
        let out: SimulationOutput;
        try { out = generateAndScoreModifications(sc.patient, available, prices); }
        catch (err) { problems.push({ title: sc.title, errs: ['THREW: ' + (err as Error).message] }); continue; }
        const errs = sc.expect(out, sc.patient);
        if (errs.length === 0) pass++;
        else problems.push({ title: sc.title, errs });
    }
    console.log(`\n════════ MISTAKE AUDIT: ${pass}/${S.length} clean ════════`);
    if (problems.length) {
        console.log(`\nPOTENTIAL ERRORS (${problems.length} scenarios):`);
        problems.forEach(p => { console.log(`\n• ${p.title}`); p.errs.forEach(e => console.log(`    ✗ ${e}`)); });
    }
}
run();
