import type { Patient } from '../../types';
import { SCENARIOS } from '../../data/scenarios';
import { NOT_ENTERED, currentDrugNames } from './patientFacts';

/**
 * The curated example patients. Keyed by scenario title in data/scenarios.ts (the patient is read from
 * there, so the facts on a card cannot drift from what loads). The sentence says what the case shows.
 */
export interface DemoCase { scenarioTitle: string; title: string; sentence: string }

export const DEMO_CASES: readonly DemoCase[] = [
    { scenarioTitle: 'John Doe (Wet & Warm)', title: 'Reduced EF with congestion',
      sentence: 'Fluid overloaded and on only part of the foundational therapy: shows which drugs the tool would add first and why.' },
    { scenarioTitle: 'Hyperkalemia (K+ 5.6) - Avoid MRA', title: 'High potassium',
      sentence: 'Potassium of 5.6 holds back the drugs that raise it; shows what the tool still offers and the reason for each hold.' },
    { scenarioTitle: 'Obese HFpEF (BMI 35, LVEF 58)', title: 'Preserved EF with obesity',
      sentence: 'A different drug set than reduced EF: every option starts the SGLT2 inhibitor dapagliflozin, with semaglutide, furosemide or spironolactone.' },
    { scenarioTitle: 'Severe CKD Loop Resistance (eGFR 18)', title: 'Advanced kidney disease',
      sentence: 'An eGFR of 18 withholds RAAS inhibitors without specialist advice; the options centre on the diuretic.' },
    { scenarioTitle: 'Elderly >80 on All 4 Pillars (Age Dosing)', title: 'Four drugs below target dose',
      sentence: 'All four foundational drugs are already on board; each option raises one dose: spironolactone, sacubitril/valsartan or metoprolol.' },
    { scenarioTitle: 'Severe Hypotension (BP 85/55) - No Drug Recs', title: 'Low blood pressure, safety stop',
      sentence: 'Systolic pressure under 90: the tool stops, shows safety alerts only and offers no drug options.' },
];

export const demoPatient = (d: DemoCase): Patient => {
    const s = SCENARIOS.find(x => x.title === d.scenarioTitle);
    if (!s) throw new Error(`Example case not found in scenarios: ${d.scenarioTitle}`);
    return s.patient;
};

const pos = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Four short key facts, read from the patient object. */
export function caseFacts(p: Patient): string[] {
    const lvef = pos(p.lvef); const sbp = pos(p.sbp); const dbp = pos(p.dbp); const k = pos(p.potassium); const egfr = pos(p.egfr);
    const drugs = currentDrugNames(p);
    return [
        `${lvef !== undefined ? `EF ${lvef}%` : `EF ${NOT_ENTERED}`} · ${p.nyha_class ? `NYHA ${p.nyha_class}` : `NYHA ${NOT_ENTERED}`}`,
        sbp !== undefined && dbp !== undefined ? `BP ${sbp}/${dbp}` : `BP ${NOT_ENTERED}`,
        `Potassium ${k !== undefined ? k.toFixed(1) : NOT_ENTERED} · eGFR ${egfr !== undefined ? Math.round(egfr) : NOT_ENTERED}`,
        drugs.length ? `On ${drugs.join(', ')}` : 'No heart-failure drugs yet',
    ];
}
