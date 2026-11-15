// Reproducible diagnostic inventory; outputs are model assumptions, not clinical validation.
import { writeFileSync } from 'node:fs';
import { MEDICATION_FORMULARY } from '../constants';
import { patient } from './systemicReviewChecks';
import { effectDose, dailyDose } from '../services/engine/regimenUtils';
const p=patient();
const rows=MEDICATION_FORMULARY.map(m=>({name:m.name,class:m.drug_class,facts:m.facts,start:m.start_dose_for?.(p),checks:m.contraindication_checks?.map(c=>c.reason),features:m.special_features?.map(s=>({feature:s.feature,points:s.points})),renal:[20,35,55,90].map(e=>({egfr:e,...m.renal_adjustment?.(e,p)})),doseEffects:m.available_doses.flatMap(d=>d.frequency_options.map(f=>{const r={med:m,dose:d,selected_frequency:f};return {dose:d.strength,unit:d.unit,frequency:f,daily:dailyDose(r),effectDose:effectDose(r),chf:m.chf_effects(effectDose(r)),hemo:m.hemodynamic_effects(effectDose(r)),sideEffects:m.side_effects(d.strength)}}))}));
writeFileSync(process.argv[2] ?? 'docs/medication-properties-2026-11-12/inventory.json',JSON.stringify(rows,null,2));
for(const r of rows){const a=r.doseEffects[0],b=r.doseEffects.at(-1)!;console.log(JSON.stringify({name:r.name,cls:r.class,start:r.start,first:{dose:a.dose,freq:a.frequency,...a.chf,...a.hemo},last:{dose:b.dose,freq:b.frequency,...b.chf,...b.hemo},flatHemo:JSON.stringify(a.hemo)===JSON.stringify(b.hemo),frequencySensitive:r.facts?.effects_on_daily_dose,doses:r.doseEffects.length}));}
