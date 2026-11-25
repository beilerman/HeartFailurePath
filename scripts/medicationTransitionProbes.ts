// Reproducible diagnostic inventory; outputs are model assumptions, not clinical validation.
import { MEDICATION_FORMULARY } from '../constants';
import { patient, entry } from './systemicReviewChecks';
import { simulateModificationEffect } from '../services/engine/effects';
import { getMedicationClassGroup } from '../services/engine/registry';
import { writeFileSync } from 'node:fs';
import type { RegimenMed, Patient, RegimenModification } from '../types';
const prices=Object.fromEntries(MEDICATION_FORMULARY.map(m=>[m.name,10]));
const p=patient();p.sbp=130;p.dbp=80;p.pulse=85;p.kccq_score=50;p.lvef=35;p.volume_status.current_weight_kg=120;p.volume_status.dry_weight_kg=90;
const r=(m:any,i=0):RegimenMed=>({med:m,dose:m.available_doses[i],selected_frequency:m.available_doses[i].frequency_options[0]});
const fields=(p:Patient)=>({sbp:p.sbp,dbp:p.dbp,pulse:p.pulse,K:p.potassium,EF:p.lvef,BNP:p.nt_pro_bnp,KCCQ:p.kccq_score,weight:p.volume_status.current_weight_kg,dry:p.volume_status.dry_weight_kg,LVEDD:p.lvedd,LAVI:p.lavi});
const sim=(q:Patient,mods:RegimenModification[],next:RegimenMed[])=>simulateModificationEffect(q,{modifications:mods,resulting_regimen:next},prices).projectedPatient;
const m=(action:any,source?:RegimenMed,target?:RegimenMed):RegimenModification=>({action,source,target,summary:'Adversarial diagnostic'});
const diff=(a:any,b:any)=>Object.fromEntries(Object.keys(a).filter(k=>a[k]!==b[k] && !(typeof a[k]==='number' && typeof b[k]==='number' && Math.abs(a[k]-b[k])<1e-8)).map(k=>[k,{a:a[k],b:b[k]}]));
const report:any={tierCount:MEDICATION_FORMULARY.reduce((n,m)=>n+m.available_doses.reduce((s,d)=>s+d.frequency_options.length,0),0),selfReplace:[],swapRepresentation:[],roundTrip:[],invalidRanges:[],other:[]};
for(const drug of MEDICATION_FORMULARY){
 const a=r(drug),q={...p,current_regimen:[a]};
 const x=sim(q,[],[a]),y=sim(q,[m('remove',a),m('add',undefined,a)],[a]);
 const delta=diff(fields(x),fields(y));if(Object.keys(delta).length)report.selfReplace.push({drug:drug.name,delta});
 const empty={...p,current_regimen:[]};const added=sim(empty,[m('add',undefined,a)],[a]);
 const removed=sim({...added,current_regimen:[a]},[m('remove',a)],[]);const rev=diff(fields(p),fields(removed));
 if(Object.keys(rev).length)report.roundTrip.push({drug:drug.name,delta:rev});
 const low={...q,kccq_score:1,lvef:1};const stop=sim(low,[m('remove',a)],[]);
 if((stop.kccq_score??0)<0 || stop.lvef<0)report.invalidRanges.push({drug:drug.name,EF:stop.lvef,KCCQ:stop.kccq_score});
 for(const other of MEDICATION_FORMULARY){if(drug.name===other.name||getMedicationClassGroup(drug.drug_class)!==getMedicationClassGroup(other.drug_class))continue;
   const b=r(other),swap=sim(q,[m('swap',a,b)],[b]),split=sim(q,[m('remove',a),m('add',undefined,b)],[b]);
   const d=diff(fields(swap),fields(split));if(Object.keys(d).length)report.swapRepresentation.push({from:drug.name,to:other.name,delta:d});
 }
}
const a=entry('Lisinopril',10),b=entry('Valsartan',40),q={...p,current_regimen:[a]};report.other.push({kind:'projected regimen identity',expected:b.med.name,actual:sim(q,[m('swap',a,b)],[b]).current_regimen.map(r=>r.med.name)});
writeFileSync(process.argv[2] ?? 'docs/medication-properties-2026-11-12/probes-after.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({tiers:report.tierCount,selfReplace:report.selfReplace.length,swapRepresentation:report.swapRepresentation.length,roundTrip:report.roundTrip.length,invalidRanges:report.invalidRanges.length,examples:{self:report.selfReplace[0],swap:report.swapRepresentation[0],round:report.roundTrip[0],invalid:report.invalidRanges[0],other:report.other}}));
