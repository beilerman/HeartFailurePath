import type { RegimenMed, RegimenModification } from '../../types';
import { dosesPerDay } from './regimenUtils';
import { getMedicationClassGroup } from './registry';

const sameExposure = (a: RegimenMed, b: RegimenMed) => a.med.name === b.med.name
    && String(a.dose.strength) === String(b.dose.strength) && a.dose.unit === b.dose.unit
    && a.selected_frequency === b.selected_frequency;
const key = (r: RegimenMed) => `${r.med.name}|${r.dose.strength}|${r.dose.unit}|${r.selected_frequency}`;
const group = (r: RegimenMed) => r.med.facts?.short_course_addon ? `short-course:${r.med.name}` : getMedicationClassGroup(r.med.drug_class);

/**
 * The same before/after exposure must give the same modeled physiology, whether a
 * caller describes it as a swap, a dose change, or separate removal and addition.
 * This does not infer a truly untreated patient or model a washout/cross-taper timeline.
 * Pairing is deterministic; actual clinical instructions remain on the original changes.
 */
export function physiologicTransitions(before: RegimenMed[], after: RegimenMed[], descriptions: RegimenModification[] = []): RegimenModification[] {
    const old = [...before].sort((a,b)=>key(a).localeCompare(key(b)));
    const next = [...after].sort((a,b)=>key(a).localeCompare(key(b)));
    const result: RegimenModification[] = [];
    // Cancel unchanged exposure before pairing anything in the same class.
    for (let i=old.length-1;i>=0;i--) {
        const j=next.findIndex(r=>sameExposure(old[i],r));
        if(j>=0){old.splice(i,1);next.splice(j,1);}
    }
    const push = (source?: RegimenMed, target?: RegimenMed) => {
        const action = !source ? 'add' : !target ? 'remove' : source.med.name !== target.med.name ? 'swap'
            : parseFloat(String(target.dose.strength))*dosesPerDay(target.selected_frequency) > parseFloat(String(source.dose.strength))*dosesPerDay(source.selected_frequency) ? 'titrate_up' : 'titrate_down';
        const described = descriptions.find(m=>m.action===action
            && (!source || (m.source && sameExposure(m.source,source)))
            && (!target || (m.target && sameExposure(m.target,target))));
        result.push({action, ...(source?{source}:{}), ...(target?{target}:{}), summary:described?.summary ?? 'Net change from the recorded regimen'});
    };
    // Same-drug dose/frequency changes take precedence over cross-drug class pairing.
    for (const match of [(a:RegimenMed,b:RegimenMed)=>a.med.name===b.med.name, (a:RegimenMed,b:RegimenMed)=>group(a)===group(b)]) {
        for(let i=0;i<old.length;){
            const j=next.findIndex(r=>match(old[i],r));
            if(j<0){i++;continue;}
            push(old.splice(i,1)[0],next.splice(j,1)[0]);
        }
    }
    old.forEach(r=>push(r));next.forEach(r=>push(undefined,r));
    return result;
}
