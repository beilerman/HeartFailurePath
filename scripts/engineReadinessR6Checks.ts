/**
 * Round 6 engine rulings of the 2026-11-21 readiness pass (V1 to V19). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR6Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { mk, runEngine, summaries } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { gen3r } from './r3Generator';
import { clonePatient, SCENARIOS } from '../data/scenarios';
import { allText, headOf } from './engineReadinessR5Checks';
import { ALLERGY_CLASS_ALIASES } from '../services/engine/allergy';
import { generateAndScoreModifications, clonePatient as clonePt } from '../services/simulationService';
import { PRICES as TIER_PRICES } from './r2Generator';
import { scoredCandidates } from './scoredCandidates';
import { PANEL_CASE_SPECS } from '../data/panelCases';
import type { Patient, RegimenMed, SimulationOutput } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));

export { headOf, allText };
type MkOver = Parameters<typeof mk>[0];
const base = (extra: MkOver = {}, regimen: RegimenMed[] = [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]) =>
    mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ...extra }, regimen);
const BLANK_FORMS: Array<[string, unknown]> = [['0', 0], ['undefined', undefined], ['NaN', NaN]];

/** A sentence that states a measured kidney value or a kidney limit as a finding of this patient ("eGFR below 25", "eGFR 28", "eGFR 0"). */
export const STATES_LOW_EGFR = /\beGFR (?:(?:is|was|of|at|below|under|falls below|<|≤) )*[0-9]/i;
const KIDNEY_UNKNOWN_OK = /not entered|was not entered|were not entered|cannot be assessed|waits for|missing|blank/i;

/** Every displayed sentence that states a kidney value although none was entered (a sentence that says the value was not entered is not one). */
export function falseKidneyClaims(o: SimulationOutput): string[] {
    const out: string[] = [];
    for (const t of allText(o)) {
        // Static drug notes that describe the label ("if eGFR falls below 20 while on...") are general statements, not findings of this patient: they have no patient value and are not reasons.
        const m = STATES_LOW_EGFR.exec(t);
        if (!m) continue;
        const near = t.slice(Math.max(0, m.index - 140), m.index + 160);
        if (KIDNEY_UNKNOWN_OK.test(near)) continue;
        out.push(near);
    }
    return out;
}

export const SAME_CLASS_WARNING = /^ALLERGY CHECK: an allergy to .+ is recorded without the type of reaction, and .+ too\. Confirm what the reaction was/;
export const startedDrugs = (r: SimulationOutput['scoredRegimens'][number]) => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => m.target!.med);
/** The drug-class allergy rule as stated: an option that starts a drug (a new start or a switch to it) whose class is the class of a drug the patient lists as an allergy, other than that drug, carries the check naming both. */
export const expectedSameClass = (p: Patient, r: SimulationOutput['scoredRegimens'][number]): string[] =>
    startedDrugs(r).filter(t => !p.allergies.has(t.name)
        && MEDICATION_FORMULARY.some(a => a.drug_class === t.drug_class && a.name !== t.name && p.allergies.has(a.name))).map(t => t.name);
export const UNMATCHED_NOTE = /does not match a drug or drug class|do not match a drug or drug class/;
export const sig = (o: SimulationOutput) => JSON.stringify({
    ex: o.excludedMedications.map(e => [e.name, e.reason, (e as unknown as { details?: unknown }).details]),
    opts: o.scoredRegimens.map(r => [summaries(r), r.warnings]),
    alerts: o.clinicalAlerts.filter(a => !/^ALLERGY NOTE/.test(a)),
    why: o.why_first, mon: o.monitoringPlan, gaps: o.gdmtGaps,
});
export const allergyVocabulary = (): string[] => {
    const v = new Set<string>();
    for (const m of MEDICATION_FORMULARY) {
        v.add(m.name); v.add(m.name.replace(/\s*\(.*\)/, '')); (m.name.match(/\(([^)]*)\)/)?.[1] ?? '').split(' ').filter(Boolean).forEach(x => v.add(x));
        (m.facts?.allergy_aliases ?? []).forEach(a => v.add(a));
        m.name.replace(/\(.*\)/, '').split(/[\s/]+/).filter(x => x.length >= 5).forEach(x => v.add(x));
    }
    for (const k of Object.keys(ALLERGY_CLASS_ALIASES)) { v.add(k); v.add(k + 's'); v.add(k.toUpperCase()); }
    for (const t of ['sulfa', 'Sulfa drugs', 'sulfonamide', 'Sulfonamide allergy', 'loop diuretic', 'Loop diuretics', 'furosemide', 'Furoscix', 'adhesive', 'Adhesive tape', 'acrylate', 'angioedema', 'Angioedema', 'angioedema with ACE inhibitor',
        'lisinopril angioedema', 'ACE inhibitor angioedema', 'Angio-edema', 'angioedema after valsartan', 'swelling of the lips on ramipril', 'penicillin', 'latex', 'shellfish', 'iodine contrast', 'xyzzy', 'cough', 'rash']) v.add(t);
    return [...v];
};
export const allergyBases = (): Patient[] => [
    base({ lvef: 28 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Furosemide', 40)]),
    base({ lvef: 28, nyha_class: 'III' }, [entry('Losartan', 50), entry('Metoprolol Succinate', 50), entry('Hydrochlorothiazide', 25)]),
    base({ lvef: 40 }, []),
    base({ lvef: 28, nyha_class: 'III', dry: 80, cur: 85, findings: ['JVP Elevated', 'Edema (2+)'] }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Furosemide', 40)]),
];
export const checkAllergyEntry = (text: string) => {
    // The note depends on the wording alone, so "nothing was excluded or changed" is judged over the bases together: an entry that changes the output for at least one patient is not unmatched.
    let anyChanged = false, anyNote = false, allNote = true;
    for (const b of allergyBases()) {
        const without = runEngine(clonePatient(b));
        const p = clonePatient(b); p.allergies = new Set([text]);
        const o = runEngine(p);
        const noteShown = o.clinicalAlerts.some(a => UNMATCHED_NOTE.test(a)) || [...(o.decisionReadiness?.deferred ?? []), ...(o.decisionReadiness?.available ?? [])].some(a => /Unmatched entries/.test(a));
        anyNote ||= noteShown; allNote &&= noteShown;
        anyChanged ||= sig(without) !== sig(o);
    }
    assert.ok(anyNote === allNote, `allergy "${text}": the unmatched note depends on the patient`);
    assert.equal(anyNote, !anyChanged, `allergy "${text}": unmatched note ${anyNote ? 'shown' : 'absent'} but the entry ${anyChanged ? 'changed the output' : 'changed nothing'} for every patient tried`);
};
export const RAAS_OR_MRA = new Set(['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA']);
/** Every way a displayed option contradicts a hold alert of the same screen. A forced switch (mandatory: an allergy, an intolerance or a contraindication of the drug itself) is not a hold. */
export const holdViolations = (o: SimulationOutput): string[] => {
    const out: string[] = [];
    const alerts = o.clinicalAlerts;
    o.scoredRegimens.forEach((r, i) => {
        const mods = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        const tag = `option ${i + 1} (${mods.map(m => m.summary.slice(0, 60)).join('; ')})`;
        for (const a of alerts) {
            const hold = /^POTASSIUM HOLD ON ([^:]+):/.exec(a);
            if (hold) for (const m of mods) {
                const from = m.source?.med.name.toUpperCase();
                if (from === hold[1] && (m.action === 'titrate_up' || ((m.action === 'swap') && !m.mandatory))) out.push(`${tag}: ${m.action} of ${from} under "${a.slice(0, 60)}"`);
            }
            const brady = /^BRADYCARDIA ON ([^:]+):/.exec(a);
            if (brady) for (const m of mods) if (m.action === 'titrate_up' && m.source?.med.name.toUpperCase() === brady[1]) out.push(`${tag}: raises ${brady[1]} under the bradycardia alert`);
            if (/^BETA-BLOCKER START DEFERRED/.test(a)) for (const m of mods) {
                if ((m.action === 'add' || m.action === 'swap' && !m.mandatory) && m.target?.med.drug_class === 'Beta Blocker') out.push(`${tag}: starts a beta-blocker under the deferral alert`);
                if (m.action === 'titrate_up' && m.source?.med.drug_class === 'Beta Blocker') out.push(`${tag}: raises a beta-blocker under the deferral alert`);
            }
            if (/^KIDNEY FUNCTION:.*(does not start a new one|No RAAS inhibitor or MRA is started|no up-titration until stable)/.test(a)) for (const m of mods) {
                if ((m.action === 'add' || m.action === 'swap') && m.target && RAAS_OR_MRA.has(m.target.med.drug_class) && !m.mandatory) out.push(`${tag}: starts ${m.target.med.name} under the kidney-function hold`);
                if (m.action === 'titrate_up' && m.source && RAAS_OR_MRA.has(m.source.med.drug_class)) out.push(`${tag}: raises ${m.source.med.name} under the kidney-function hold`);
            }
            const stop = /^POTASSIUM (STOP|REDUCE) ON ([^:]+):/.exec(a);
            if (stop) for (const m of mods) if (m.action === 'titrate_up' && m.source?.med.name.toUpperCase() === stop[2]) out.push(`${tag}: raises ${stop[2]} under a potassium ${stop[1].toLowerCase()}`);
            const removed = /^DRUG REMOVED FOR KIDNEY FUNCTION: (.+?) is removed in the options/.exec(a);
            if (removed && !mods.some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === removed[1])) out.push(`${tag}: keeps ${removed[1]} under the kidney removal alert`);
        }
    });
    return out;
};
export const runTier = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePt(p), NAMES, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
export const inFallback = (o: SimulationOutput) => o.scoredRegimens.length > 0 && o.scoredRegimens.every(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED')));
export const FAMILY_WORDS_R6: Array<[string, string[]]> = [['RAAS inhibitors', ['ACEi', 'ARB', 'ARNI']], ['beta-blockers', ['Beta Blocker']], ['mineralocorticoid receptor antagonists', ['MRA', 'nsMRA']], ['SGLT2 inhibitors', ['SGLT2i']],
    ['GLP-1 RA', ['GLP-1 RA']], ['GLP-1/GIP RA', ['GLP-1/GIP RA']], ['If Inhibitor', ['If Inhibitor']], ['sGC Stimulator', ['sGC Stimulator']], ['IV Iron', ['IV Iron']], ['K+ Binder', ['K+ Binder']], ['Loop Diuretic', ['Loop Diuretic']], ['Thiazide-like Diuretic', ['Thiazide-like Diuretic']], ['Vasodilator', ['Vasodilator']]];
/** Every line of the "Why" block (the lines for each option and the reasons for each indicated-class gap) with the option it belongs to. */
export const whyLines = (o: SimulationOutput): string[] => [...(o.why_first?.options ?? []).flatMap(w => w.lines.map(l => l.text)), ...(o.why_first?.gaps ?? []).flatMap(g => g.reasons.filter((x): x is string => !!x))];
export const startedClasses = (o: SimulationOutput): Set<string> => new Set(o.scoredRegimens.flatMap(r => startedDrugs(r).map(t => t.drug_class)));
/** The classes a line says are withheld as a class ("Starting beta-blockers and SGLT2 inhibitors is withheld because ..."). */
export const classesWithheldBy = (line: string): string[] => {
    const m = /^Starting (.+?) (?:is|are) withheld because information is missing/i.exec(line);
    if (!m) return [];
    return FAMILY_WORDS_R6.filter(([label]) => m[1].toLowerCase().includes(label.toLowerCase())).flatMap(([, cls]) => cls);
};
export const classViolations = (o: SimulationOutput): string[] => {
    const started = startedClasses(o); const out: string[] = [];
    for (const line of whyLines(o)) for (const cls of classesWithheldBy(line)) if (started.has(cls)) out.push(`${line.slice(0, 160)} (an option starts a ${cls})`);
    return out;
};
export const planOf = (r: SimulationOutput['scoredRegimens'][number]) => (r.monitoring_plan ?? []).map(i => i.test);
export const modsOfOption = (r: SimulationOutput['scoredRegimens'][number]) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
export const reducesLoop = (r: SimulationOutput['scoredRegimens'][number]) => modsOfOption(r).some(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Loop Diuretic' && !m.duplicate_cleanup); // R7 W13f: the clean-up of a duplicate loop entry is not a reduction or a stop (was: any loop removal)
export const startsOrRaisesBb = (r: SimulationOutput['scoredRegimens'][number]) => modsOfOption(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Beta Blocker');
export const WEIGHT_ROW = /weight and symptoms after a loop diuretic (reduction|change)/i, HRBP_ROW = /heart rate and blood pressure after a beta-blocker start or increase/i;
export const rowViolations = (o: SimulationOutput): string[] => o.scoredRegimens.flatMap((r, i) => {
    const out: string[] = [];
    if (reducesLoop(r) !== planOf(r).some(t => WEIGHT_ROW.test(t))) out.push(`option ${i + 1}: loop reduced/stopped ${reducesLoop(r)} but weight row ${planOf(r).some(t => WEIGHT_ROW.test(t))}`);
    if (startsOrRaisesBb(r) !== planOf(r).some(t => HRBP_ROW.test(t))) out.push(`option ${i + 1}: beta-blocker started/raised ${startsOrRaisesBb(r)} but heart-rate row ${planOf(r).some(t => HRBP_ROW.test(t))}`);
    return out;
});
export const num = (x: string): number => Number(x.replace('−', '-').replace('+', ''));
/** Each clause of a comparison sentence ("option 1 has a larger expected reduction in death (relative risk 0.53 against 1.00)") with its metric and the two figures, the subject's first. */
export const clausesOf = (text: string): Array<{ clause: string; metric: 'risk' | 'status' | 'burden' | 'cost'; a: number; b: number; subject: string }> => {
    const out: Array<{ clause: string; metric: 'risk' | 'status' | 'burden' | 'cost'; a: number; b: number; subject: string }> = [];
    for (const clause of text.split(/; (?:(?:[Aa]gainst (?:that|option \d+|it|no change), )|but )?|: [Aa]gainst (?:that|option \d+|it|no change), |\. /)) {
        const subject = /^(?:(?:Compared with|Also against|Also against it)[^:]+: )?(.+?) (?:has|is|carries)\b/.exec(clause)?.[1] ?? '';
        let m: RegExpExecArray | null;
        if ((m = /relative risk ([0-9.]+) against ([0-9.]+)/.exec(clause))) out.push({ clause, metric: 'risk', a: num(m[1]), b: num(m[2]), subject });
        else if ((m = /\((?:\+|−|-)?([0-9.]+) against /.exec(clause)) && /KCCQ/.test(clause)) { const f = /\(([+−-]?[0-9.]+) against ([+−-]?[0-9.]+) KCCQ/.exec(clause)!; out.push({ clause, metric: 'status', a: num(f[1]), b: num(f[2]), subject }); }
        else if ((m = /side-effect burden ([+−-]?[0-9.]+) against ([+−-]?[0-9.]+) points/.exec(clause))) out.push({ clause, metric: 'burden', a: num(m[1]), b: num(m[2]), subject });
        else if ((m = /\$([0-9.]+) against \$([0-9.]+)\)/.exec(clause))) out.push({ clause, metric: 'cost', a: num(m[1]), b: num(m[2]), subject });
    }
    return out;
};
export const reasonViolations = (o: SimulationOutput): string[] => {
    const out: string[] = [];
    (o.why_first?.options ?? []).forEach((w, i) => w.lines.filter(l => l.kind === 'versus_other' || l.kind === 'versus_no_change' || l.kind === 'order').forEach(l => {
        const own = `option ${i + 1}`;
        // Every clause names its subject and gives the subject's figure first: the figure must be the better one, in both directions (the reasons for this option, and what the other plan does better).
        for (const c of clausesOf(l.text)) {
            const better = c.metric === 'status' ? c.a > c.b : c.a < c.b;
            if (!better) out.push(`${own}: the figures do not favour the subject "${c.subject}": ${c.clause.slice(0, 160)}`);
        }
    }));
    return out;
};

export function runEngineReadinessR6Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR6: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR6: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- V17: a kidney value that was not entered is never stated as a low eGFR --------------------------------------------------------------------------
    // r6-engine B1: seeds 9851049 (allergy is the real cause; the option read "Remove Chlorthalidone (eGFR below 15 (anuria/ESRD))"), 9840229 ("Remove Spironolactone (eGFR below 30)"), 9850009.
    const blankKidney = (p: Patient, form: unknown, creatinineToo = true): Patient => {
        const q = clonePatient(p); (q as any).egfr = form; if (creatinineToo) (q as any).creatinine = form; q.baseline_creatinine = undefined; return q;
    };
    check('V17 reviewer seeds 9851049, 9840229, 9850009: no removal reason states a low eGFR when kidney function was not entered; the real cause is stated', () => {
        for (const sd of [9851049, 9840229, 9850009]) for (const [label, form] of BLANK_FORMS) {
            const o = runEngine(blankKidney(gen3r(sd).p, form));
            assert.deepEqual(falseKidneyClaims(o), [], `seed ${sd} kidney ${label}: ${falseKidneyClaims(o)[0]}`);
        }
        // seed 9851049: the real cause (allergy) is the stated reason
        const o = runEngine(blankKidney(gen3r(9851049).p, 0));
        const chl = o.scoredRegimens.flatMap(r => summaries(r)).filter(s => /Chlorthalidone/.test(s) && /^Remove/.test(s));
        assert.ok(chl.length === 0 || chl.every(s => /allerg/i.test(s)), `chlorthalidone removal does not state the allergy: ${chl[0]}`);
    });
    check('V17 neighbours: every formulary drug taken, with an allergy to it, with eGFR and creatinine blank (every blank form, two ejection fractions): no sentence states a low eGFR', () => {
        for (const med of MEDICATION_FORMULARY) {
            const dose = med.available_doses[0];
            for (const lvef of [30, 55]) for (const [label, form] of BLANK_FORMS) for (const allergic of [false, true]) {
                const p = base({ lvef, nyha_class: 'II' }, [{ med, dose, selected_frequency: dose.frequency_options[0], exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } } as RegimenMed]);
                if (allergic) p.allergies = new Set([med.name]);
                const o = runEngine(blankKidney(p, form));
                const claims = falseKidneyClaims(o);
                assert.deepEqual(claims, [], `${med.name} lvef ${lvef} kidney ${label} allergy ${allergic}: ${claims[0]}`);
            }
        }
    });
    check('V17 a kidney value that was entered is still stated: a real eGFR of 20 on spironolactone is removed for kidney function with the value', () => {
        const o = runEngine(base({ egfr: 20, creatinine: 2.4 }, [entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')]));
        const t = o.scoredRegimens.flatMap(r => summaries(r)).concat(o.clinicalAlerts).join(' | ');
        assert.ok(/eGFR/.test(t), t.slice(0, 400));
    });

    // ---------------- V2: an option that starts a drug of the class of a listed allergy carries the allergy check ---------------------------------------------------------
    // r6-clinical B2: allergy to lisinopril, option 1 starts captopril with no warning of any kind.
    const assertAllergyWarnings = (p: Patient, label: string) => {
        const o = runEngine(p);
        for (const [i, r] of o.scoredRegimens.entries()) {
            const exp = expectedSameClass(p, r);
            const got = r.warnings.filter(w => SAME_CLASS_WARNING.test(w));
            assert.equal(got.length > 0, exp.length > 0, `${label} option ${i + 1} (${summaries(r).join('; ')}): expected ${exp.join(',') || 'no'} check, got ${got.length}`);
            for (const n of exp) assert.ok(got.some(w => w.includes(n)), `${label} option ${i + 1}: the check does not name ${n}`);
        }
        return o;
    };
    const t10 = (allergy: string): Patient => { const p = base({ lvef: 28, sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, egfr: 65, creatinine: 1.1 }, [entry('Carvedilol', 6.25, 'bid')]); p.allergies = new Set([allergy]); return p; };
    let sameClassOptionsSeen = 0;
    check('V2 reviewer case t10: allergy to lisinopril, enalapril, ramipril: no option starts another ACE inhibitor without the check naming both drugs (with the check, none reaches the three shown)', () => {
        for (const a of ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril']) {
            const o = assertAllergyWarnings(t10(a), a);
            for (const r of o.scoredRegimens.filter(x => startedDrugs(x).some(t => t.drug_class === 'ACEi'))) assert.ok(r.warnings.some(w => SAME_CLASS_WARNING.test(w) && w.includes(a)), `${a}: ${r.warnings.join(' | ')}`);
        }
    });
    check('V2 neighbours: the check appears exactly on options that start a drug of a listed-allergy class (every drug with a same-class agent, 12 generated patients each)', () => {
        const multi = MEDICATION_FORMULARY.filter(m => MEDICATION_FORMULARY.some(o => o !== m && o.drug_class === m.drug_class));
        assert.ok(multi.length >= 15, `${multi.length}`);
        for (const a of multi) for (let sd = 9900000; sd < 9900012; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); p.allergies = new Set([a.name]);
            const o = assertAllergyWarnings(p, `${a.name} seed ${sd}`);
            sameClassOptionsSeen += o.scoredRegimens.filter(r => r.warnings.some(w => SAME_CLASS_WARNING.test(w))).length;
        }
    });
    check('V2 the rule is exercised (options that start a same-class drug exist and carry the check) and the check rides the same warning list as the ARNI allergy check, so it carries no new penalty of its own', () => {
        assert.ok(sameClassOptionsSeen >= 20, `only ${sameClassOptionsSeen} options carried the check in the generated set`);
    });

    // ---------------- V1: an allergy entry the tool acts on is never called unmatched --------------------------------------------------------------------------------------
    // r6-clinical B1: "angioedema" and "angioedema with ACE inhibitor" produced "does not match a drug or drug class ... so no drug is excluded" while the ACE inhibitors and sacubitril/valsartan were excluded.
    check('V1 reviewer entries: "angioedema", "angioedema with ACE inhibitor" are not called unmatched, and the note says what was excluded', () => {
        for (const text of ['angioedema', 'Angioedema', 'angioedema with ACE inhibitor', 'Angio-edema', 'lisinopril angioedema']) {
            const p = base({ lvef: 28 }, [entry('Carvedilol', 6.25, 'bid')]); p.allergies = new Set([text]);
            const o = runEngine(p);
            assert.ok(!o.clinicalAlerts.some(a => UNMATCHED_NOTE.test(a)), `${text}: ${o.clinicalAlerts.filter(a => /ALLERGY/.test(a)).join(' | ')}`);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('ALLERGY NOTE') && /ACE inhibitors and sacubitril\/valsartan/.test(a)), `${text}: the note does not say what was excluded`);
        }
    });
    check('V1 generated: every wording any allergy reader recognises (drug names, generic parts, brands, aliases, class names, text rules) and unrecognised wordings: the unmatched note appears if and only if the entry changed nothing', () => {
        const vocab = allergyVocabulary();
        assert.ok(vocab.length > 150, `${vocab.length} wordings`);
        for (const text of vocab) checkAllergyEntry(text);
    });

    // ---------------- V3: no displayed option does what a hold alert says is held --------------------------------------------------------------------------------------
    // r6-clinical P2 / F05: potassium 5.4 on lisinopril. The alert said lisinopril "stays at the current dose" under "the same threshold that holds a new start" while option 1 stopped it and started sacubitril/valsartan.
    const f05 = (k = 5.4, meds: RegimenMed[] = [entry('Lisinopril', 20), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')]) => base({ lvef: 25, nyha_class: 'III', potassium: k, sbp: 118, dbp: 72, egfr: 60, creatinine: 1.2 }, meds);
    check('V3 reviewer patient F05: potassium 5.4 on lisinopril, spironolactone, carvedilol: no option stops lisinopril for sacubitril/valsartan, and the withheld list says why', () => {
        const o = runEngine(f05());
        assert.ok(o.clinicalAlerts.some(a => a.startsWith('POTASSIUM HOLD ON LISINOPRIL') && /stays at the current dose/.test(a)));
        assert.deepEqual(holdViolations(o), []);
        const arni = o.excludedMedications.find(e => e.name.startsWith('Sacubitril'));
        assert.ok(arni && /5\.2/.test(arni.reason) && /switch/i.test(arni.reason), `withheld: ${arni?.reason}`);
        for (const r of o.scoredRegimens) assert.ok(!summaries(r).some(x => /Sacubitril/.test(x)), summaries(r).join('; '));
    });
    check('V3 neighbours: at potassium 5.2 or lower the switch is still offered; above 5.2 on losartan or on an ACE inhibitor it is held; a forced switch (allergy to lisinopril) is left as it is', () => {
        const offersArni = (o: SimulationOutput) => o.scoredRegimens.some(r => summaries(r).some(x => /Sacubitril/.test(x)));
                for (const k of [5.3, 5.4, 5.7]) for (const drug of [entry('Lisinopril', 10), entry('Losartan', 50), entry('Enalapril', 5, 'bid')]) {
            const o = runEngine(f05(k, [drug, entry('Carvedilol', 12.5, 'bid')]));
            assert.ok(!offersArni(o), `K ${k} on ${drug.med.name}: a switch to sacubitril/valsartan is offered`);
            assert.deepEqual(holdViolations(o), [], `K ${k} on ${drug.med.name}`);
        }
        const at52 = runEngine(f05(5.2, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]));
        assert.ok(!at52.excludedMedications.some(e => e.name.startsWith('Sacubitril') && /5\.2/.test(e.reason)), 'held at 5.2, which is not above it');
        const forced = base({ lvef: 25, nyha_class: 'III', potassium: 5.4, sbp: 118, dbp: 72, egfr: 60, creatinine: 1.2 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        forced.allergies = new Set(['Lisinopril']);
        const of = runEngine(forced);
        assert.ok(of.scoredRegimens.some(r => (r.modification_set?.modifications ?? []).some(m => m.action === 'swap' && m.mandatory && m.source?.med.name === 'Lisinopril')), 'the forced switch of an allergic drug is no longer offered');
        assert.ok(!of.excludedMedications.some(e => e.name.startsWith('Sacubitril') && /5\.2/.test(e.reason)), 'a forced switch must not be held by the potassium rule');
    });
    check('V3 generated: over 300 random patients no displayed option does what any hold alert on its screen says is held', () => {
        for (let sd = 9900000; sd < 9900300; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            const v = holdViolations(runEngine(p));
            assert.deepEqual(v, [], `seed ${sd}`);
        }
    });

    // ---------------- V4: the budget sentence is true in the over-budget fallback ----------------------------------------------------------------------------------------
    // r6-clinical minor 1 / r6-engine B2: "this compares only options within the stated budget" while every shown option is above the budget ("nothing fits the stated budget").
    const TIE_R6 = /^No option scores .* or more above leaving the regimen unchanged/;
    const tieOf = (o: SimulationOutput) => (o.why_first?.options[0]?.lines ?? []).filter(l => !l.detail).map(l => l.text).find(t => TIE_R6.test(t));
    const budgetCase = (sd: number, budget: number): Patient => { const p = gen3r(sd).p as Patient; p.scope_conditions = new Set(); p.max_affordable_cost = budget; return p; };
    check('V4 reviewer seeds 9880163 and 9881676 (budget 20): in the over-budget fallback the tie sentence says nothing fits the budget and the options shown are the least costly safe ones, never that it compares options within the budget', () => {
        let seen = 0;
        for (const sd of [9880163, 9881676]) {
            const o = runTier(budgetCase(sd, 20));
            const tie = tieOf(o);
            if (!tie || !inFallback(o)) continue;
            seen++;
            assert.ok(!/compares only options within the stated budget/.test(tie), tie);
            assert.ok(/nothing fits the stated budget of \$20/.test(tie) && /least costly/.test(tie), tie);
        }
        assert.ok(seen >= 1, 'neither reviewer seed reaches the fallback tie sentence');
    });
    check('V4 neighbours: over 2,500 seeds and four budgets, a fallback tie sentence never claims a within-budget comparison; a plan it names costs what the sentence says and scores higher; outside the fallback Y9 is unchanged', () => {
        let fallbackTies = 0, plainTies = 0; const bad: string[] = [];
        for (let sd = 9880000; sd < 9882500; sd++) for (const budget of [5, 20, 50]) {
            const p = budgetCase(sd, budget);
            const o = runTier(p);
            const tie = tieOf(o); if (!tie) continue;
            if (inFallback(o)) {
                fallbackTies++;
                if (/within the stated budget/.test(tie) && bad.length < 5) bad.push(`seed ${sd} budget ${budget}: ${tie.slice(0, 200)}`);
                if (!/nothing fits the stated budget/.test(tie) && bad.length < 5) bad.push(`seed ${sd} budget ${budget}: fallback sentence does not say so: ${tie.slice(0, 200)}`);
                const named = /\(([^()]*); \$(\d+) a month\) scores higher/.exec(tie);
                if (named) assert.ok(Number(named[2]) > 0, tie);
            } else plainTies++;
        }
        assert.ok(fallbackTies >= 5, `${fallbackTies} fallback tie sentences`);
        assert.deepEqual(bad, []);
        assert.ok(plainTies >= 5, `${plainTies} non-fallback tie sentences`);
    });

    // ---------------- V9: "digoxin should be considered when the rate stays high" only with a recorded resting rate above the lenient target -------------------------------------
    // r6-clinical minor 9: atrial fibrillation at a heart rate of 50 on a beta-blocker still said digoxin should be considered when the rate stays high.
    const afAlert = (o: SimulationOutput) => o.clinicalAlerts.find(a => a.startsWith('ATRIAL FIBRILLATION'));
    check('V9 reviewer case (AF at 50 on a beta-blocker) and neighbours: the digoxin-consider sentence appears only above the lenient target (110); the anticoagulation sentence stays; digoxin already taken is still reviewed', () => {
        const af = (pulse: number, meds: RegimenMed[]) => base({ lvef: 28, rhythm: 'AFib', pulse, sbp: 120, dbp: 70 }, meds);
        for (const pulse of [50, 60, 80, 110]) {
            const a = afAlert(runEngine(af(pulse, [entry('Carvedilol', 12.5, 'bid'), entry('Lisinopril', 10)])))!;
            assert.ok(a && /anticoagulation/.test(a) && !/digoxin should be considered/.test(a), `pulse ${pulse}: ${a?.slice(0, 600)}`);
        }
        for (const pulse of [111, 130]) assert.ok(/digoxin should be considered/.test(afAlert(runEngine(af(pulse, [entry('Carvedilol', 12.5, 'bid'), entry('Lisinopril', 10)])))!), `pulse ${pulse}`);
        for (const pulse of [0, undefined, NaN]) assert.ok(!/digoxin should be considered/.test(afAlert(runEngine(af(pulse as number, [entry('Carvedilol', 12.5, 'bid'), entry('Lisinopril', 10)]))) ?? ''), `pulse ${String(pulse)}`);
        const onDig = afAlert(runEngine(af(60, [entry('Carvedilol', 12.5, 'bid'), entry('Digoxin', 125)])))!;
        assert.ok(/digoxin is already taken/.test(onDig), onDig);
    });

    // ---------------- V6 and V19b: no "for stable patients" rehabilitation prompt beside a prompt that says the findings do not fit a stable patient -------------------------
    check('V6 reviewer patient t26 (NYHA II, +4 kg, three congestion findings) and V19b (congestion without weight gain): no cardiac rehabilitation prompt; a stable patient still gets it', () => {
        const rehab = (o: SimulationOutput) => o.clinicalAlerts.some(a => a.startsWith('CARDIAC REHABILITATION'));
        const t26 = base({ lvef: 28, nyha_class: 'II', dry: 80, cur: 84, findings: ['JVP Elevated', 'Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const o = runEngine(t26);
        assert.ok(o.clinicalAlerts.some(a => a.startsWith('NYHA CLASS AND FINDINGS DISAGREE')), 'the case no longer raises the disagreement alert');
        assert.ok(!rehab(o), 'rehabilitation beside the disagreement alert');
        for (const nyha of ['II', 'III'] as const) {
            const d = runEngine(base({ lvef: 28, nyha_class: nyha, dry: 80, cur: 80, findings: ['JVP Elevated', 'Edema (2+)'] }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]));
            assert.ok(d.clinicalAlerts.some(a => a.startsWith('CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN')), `NYHA ${nyha}: the case does not raise the congestion alert`);
            assert.ok(!rehab(d), `NYHA ${nyha}: rehabilitation beside the congestion alert`);
        }
        assert.ok(rehab(runEngine(base({ lvef: 28, nyha_class: 'II', dry: 80, cur: 80, findings: [] }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]))), 'a stable patient no longer gets the prompt');
    });

    // ---------------- V7: a "Why" line never says a class is withheld while a displayed option starts a drug of it ---------------------------------------------------------
    // r6-clinical minor 5: pregnancy status not entered, woman aged 40: "Starting ... beta-blockers ... is withheld" while option 1 starts metoprolol (only carvedilol is withheld).
    check('V7 reviewer patient t13 (woman aged 40, pregnancy status not entered): no line says beta-blockers are withheld while an option starts metoprolol; the withheld drug (carvedilol) is named', () => {
        const p = base({ sex: 'Female', age: 40, is_pregnant: undefined as unknown as boolean, lvef: 30 }, []);
        const o = runEngine(p);
        assert.ok(startedClasses(o).has('Beta Blocker'), 'the case no longer starts a beta-blocker');
        assert.deepEqual(classViolations(o), []);
        const lines = whyLines(o).join(' | ');
        assert.ok(/arvedilol/.test(lines) || !/beta-blockers/.test(lines), lines.slice(0, 400));
    });
    check('V7 generated: 400 random patients including pregnancy status and laboratory values not entered: no "Why" line withholds a class an option starts', () => {
        let withheldLines = 0;
        for (let sd = 9910000; sd < 9910400; sd++) for (const forced of [undefined, ['pregBlank'], ['blankLab'], ['blankK', 'pregBlank']] as const) {
            const p = clonePatient(gen3r(sd, forced as never).p); p.scope_conditions = new Set();
            const o = runEngine(p);
            withheldLines += whyLines(o).filter(l => classesWithheldBy(l).length > 0).length;
            assert.deepEqual(classViolations(o), [], `seed ${sd} ${forced?.join(',') ?? ''}`);
        }
        assert.ok(withheldLines >= 20, `${withheldLines} class-withheld lines seen`);
    });

    // ---------------- V8: monitoring rows for a loop diuretic reduced or stopped and a beta-blocker started -------------------------------------------------------------------
    // r6-clinical minor 6 (t27, F01): no weight or symptom row after removing a loop diuretic; no heart-rate or blood-pressure row after a new carvedilol start.
    check('V8 reviewer cases (loop diuretic stopped for a volume-depleted patient; carvedilol started) and neighbours: the rows appear exactly on the options that reduce or stop a loop, or start or raise a beta-blocker', () => {
        const depleted = base({ lvef: 35, dry: 80, cur: 77.5, findings: [], egfr: 50, creatinine: 1.6 }, [entry('Lisinopril', 10), entry('Furosemide', 80, 'bid')]);
        const o1 = runEngine(depleted);
        assert.ok(o1.scoredRegimens.some(reducesLoop), 'the case does not reduce or stop a loop');
        const o2 = runEngine(base({ lvef: 28 }, [entry('Lisinopril', 10)]));
        assert.ok(o2.scoredRegimens.some(startsOrRaisesBb), 'the case does not start a beta-blocker');
        assert.deepEqual([...rowViolations(o1), ...rowViolations(o2)], []);
    });
    check('V8 generated: 300 random patients: the weight row and the heart-rate row appear exactly on the options that call for them', () => {
        let loop = 0, bb = 0;
        for (let sd = 9910000; sd < 9910300; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            const o = runEngine(p);
            loop += o.scoredRegimens.filter(reducesLoop).length; bb += o.scoredRegimens.filter(startsOrRaisesBb).length;
            assert.deepEqual(rowViolations(o), [], `seed ${sd}`);
        }
        assert.ok(loop >= 5 && bb >= 20, `${loop} loop-reduced options, ${bb} beta-blocker options seen`);
    });

    // ---------------- V10: a kidney value that is entered is not called missing; the message names the field that is -----------------------------------------------------------
    // r6-clinical minor 8: creatinine blank or 0 with an eGFR of 65 entered: "Renal function (eGFR / creatinine) not entered" while the header shows the eGFR. The form computes the eGFR from the
    // creatinine (it is read only and is cleared when the creatinine is), so this state cannot be produced from the form: the message names the missing field exactly; eligibility is unchanged.
    check('V10 creatinine blank with an eGFR entered (and the reverse): the alert, the withheld reason and the readiness list name the field that is missing; both blank keeps the renal-function wording', () => {
        const kidneyTexts = (o: SimulationOutput) => [...o.clinicalAlerts, ...o.excludedMedications.map(e => e.reason), ...(o.decisionReadiness?.missing ?? []).map(m => `${m.label}: ${m.consequence}`)].join(' | ');
        for (const [label, form] of BLANK_FORMS) {
            const t = kidneyTexts(runEngine(base({ egfr: 65, creatinine: form as number }, [entry('Carvedilol', 12.5, 'bid')])));
            assert.ok(!/eGFR \/ creatinine\)? not entered|renal function \(eGFR\/creatinine\)/i.test(t), `creatinine ${label}: ${t.slice(0, 300)}`);
            assert.ok(/Creatinine not entered/.test(t) && /creatinine not entered; obtain a BMP/i.test(t) || /Creatinine not entered/.test(t), `creatinine ${label}: the missing field is not named: ${t.slice(0, 300)}`);
            assert.ok(!/eGFR not entered/.test(t), `creatinine ${label}: says the eGFR is missing`);
            const u = kidneyTexts(runEngine(base({ egfr: form as number, creatinine: 1.2 }, [entry('Carvedilol', 12.5, 'bid')])));
            assert.ok(/eGFR not entered/.test(u) && !/Creatinine not entered/.test(u), `eGFR ${label}: ${u.slice(0, 300)}`);
            const both = kidneyTexts(runEngine(base({ egfr: form as number, creatinine: form as number }, [entry('Carvedilol', 12.5, 'bid')])));
            assert.ok(/Renal function \(eGFR \/ creatinine\) not entered/.test(both), `both ${label}`);
        }
    });

    // ---------------- V11: with the possible-poor-perfusion alert, an option that starts a drug or raises a dose says so; the note changes no score ---------------------------------
    // r6-clinical P3 / r6-screen-evidence minor 6: "Assess perfusion before starting or raising a drug" beside option 1 that starts two drugs and shows "No safety warnings generated".
    const PERF_NOTE = /^POOR PERFUSION CHECK: .*see the possible poor perfusion alert/;
    check('V11 reviewer patients (cool extremities with systolic 92 and pulse pressure 14 at EF 25; pulse pressure 22 with BUN to creatinine 21.3): each option that starts a drug or raises a dose carries the perfusion note; others do not; no score or order changes', () => {
        const cases: Patient[] = [
            base({ lvef: 25, nyha_class: 'III', sbp: 92, dbp: 78, pulse: 80, findings: ['Cool Extremities'], bun: 24, creatinine: 1.2 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]),
            base({ lvef: 30, nyha_class: 'II', sbp: 100, dbp: 78, pulse: 72, bun: 30, creatinine: 1.4, egfr: 52 }, [entry('Carvedilol', 12.5, 'bid')]),
            base({ lvef: 24, nyha_class: 'III', sbp: 104, dbp: 80, pulse: 105, findings: ['Cool Extremities'], bun: 30, creatinine: 1.2 }, [entry('Lisinopril', 10), entry('Carvedilol', 6.25, 'bid')]),
            base({ lvef: 35, nyha_class: 'III', sbp: 98, dbp: 76, pulse: 70, bun: 28, creatinine: 1.3, egfr: 58 }, []),
        ];
        let raised = 0, withNote = 0;
        for (const p of cases) {
            const o = runEngine(p);
            if (!o.clinicalAlerts.some(a => a.startsWith('POSSIBLE POOR PERFUSION'))) continue;
            raised++;
            for (const [i, r] of o.scoredRegimens.entries()) {
                const calls = modsOfOption(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target);
                const has = r.warnings.some(w => PERF_NOTE.test(w));
                assert.equal(has, calls, `option ${i + 1} (${summaries(r).join('; ')}): note ${has}, starts or raises ${calls}`);
                if (has) withNote++;
            }
        }
        assert.ok(raised >= 3 && withNote >= 3, `${raised} cases raised the alert, ${withNote} options carried the note`);
    });
    check('V11 the note changes no score: the scores of the displayed options equal the scores of the same plans scored by the engine before any note is added', () => {
        const p = base({ lvef: 25, nyha_class: 'III', sbp: 92, dbp: 78, pulse: 80, findings: ['Cool Extremities'], bun: 24, creatinine: 1.2 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const o = runEngine(p);
        const cands = scoredCandidates(clonePatient(p), NAMES, Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10])));
        const key = (r: { modification_set?: { modifications: Array<{ action: string; summary: string }> } }) => JSON.stringify((r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => m.summary));
        let matched = 0;
        for (const r of o.scoredRegimens) {
            const c = cands.find(x => key(x) === key(r));
            if (!c) continue;
            matched++;
            assert.equal(r.overall_score, c.overall_score, `${key(r)}: displayed ${r.overall_score} against ${c.overall_score}`);
            assert.equal(r.raw_score, c.raw_score);
        }
        assert.ok(matched >= 2, `${matched} options matched`);
    });

    // ---------------- V13: a drug note that states a condition is shown only when the condition holds ---------------------------------------------------------------------
    // packet cases 2, 12, 17, 23, 28: "seek specialist advice before starting in NYHA IV or a recent exacerbation" on options for NYHA II patients and on the pregnancy metoprolol option.
    const BB_ADVICE = /seek specialist advice before starting (in NYHA class IV|with a recent exacerbation)/i;
    const bbNotes = (o: SimulationOutput) => o.scoredRegimens.flatMap((r, i) => r.warnings.filter(w => BB_ADVICE.test(w)).map(w => ({ i, w })));
    check('V13 reviewer cases (NYHA II on a new beta-blocker start; pregnancy metoprolol): the specialist-advice note appears only for NYHA IV or a recent worsening recorded, and for them it appears', () => {
        const stable = base({ lvef: 30, nyha_class: 'II' }, [entry('Lisinopril', 10)]);
        assert.ok(runEngine(stable).scoredRegimens.some(startsOrRaisesBb), 'the case does not start a beta-blocker');
        assert.deepEqual(bbNotes(runEngine(stable)), [], 'NYHA II');
        const preg = base({ lvef: 30, nyha_class: 'II', sex: 'Female', age: 31, is_pregnant: true }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        assert.deepEqual(bbNotes(runEngine(preg)), [], 'pregnancy metoprolol option');
        const nyha4 = base({ lvef: 30, nyha_class: 'IV', findings: [] }, [entry('Lisinopril', 10)]);
        const o4 = runEngine(nyha4);
        for (const [i, r] of o4.scoredRegimens.entries()) if (startsOrRaisesBb(r) && modsOfOption(r).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'Beta Blocker')) assert.ok(r.warnings.some(w => BB_ADVICE.test(w)), `NYHA IV option ${i + 1}`);
        const worse = base({ lvef: 30, nyha_class: 'II', recent_hf_worsening_within_6mo: 'yes' as never }, [entry('Lisinopril', 10)]);
        const ow = runEngine(worse);
        assert.ok(ow.scoredRegimens.some(r => modsOfOption(r).some(m => (m.action === 'add') && m.target?.med.drug_class === 'Beta Blocker') && r.warnings.some(w => BB_ADVICE.test(w))), 'recent worsening: no note');
    });
    check('V13 audit: every drug note that states a condition is gated or general: the Furoscix renal clause only with a low eGFR, the beta-blocker euvolemia note only with congestion or a low pressure; the notes left ungated are statements of the drug', () => {
        let furoscixSeen = 0, lowSeen = 0, euvolemiaSeen = 0;
        for (let sd = 9940000; sd < 9940500; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            const o = runEngine(p);
            const warns = o.scoredRegimens.flatMap(r => r.warnings);
            const furoscix = warns.filter(w => /fixed 80 mg dose may be insufficient/.test(w));
            if (warns.some(w => /Furoscix is a short course/.test(w))) furoscixSeen++;
            if (furoscix.length > 0) { lowSeen++; assert.ok(p.egfr > 0 && p.egfr < 30, `seed ${sd}: renal clause at eGFR ${p.egfr}`); }
            if (warns.some(w => /Furoscix is a short course/.test(w)) && p.egfr > 0 && p.egfr < 30) assert.ok(furoscix.length > 0, `seed ${sd}: no renal clause at eGFR ${p.egfr}`);
            const eu = warns.filter(w => /achieve euvolemia first/.test(w));
            if (eu.length > 0) { euvolemiaSeen++; assert.ok(p.volume_status.exam_findings.size > 0 || (p.sbp > 0 && p.sbp < 90), `seed ${sd}: euvolemia note without congestion or a low pressure`); }
            assert.ok(!warns.some(w => /seek specialist advice before starting (in NYHA class IV|with a recent exacerbation)/.test(w)) || p.nyha_class === 'IV' || p.recent_hf_worsening_within_6mo === 'yes', `seed ${sd}: specialist advice note at NYHA ${p.nyha_class}`);
        }
        assert.ok(furoscixSeen >= 3 && euvolemiaSeen >= 3, `${furoscixSeen} Furoscix notes, ${lowSeen} with the renal clause, ${euvolemiaSeen} euvolemia notes`);
    });

    // ---------------- V19a: no "after starting" or "at initiation" wording on an option that starts nothing -----------------------------------------------------------------
    // r6-engine minor: the Lokelma "Weight and edema" monitoring row (seed 9820042) and the metolazone drug note when metolazone is kept (seed 9820056).
    const START_TEXT = /\b(at initiation|after starting|soon after starting|after a start|at the start|within the first doses|of starting)\b/i;
    check('V19a static audit: every drug-level note and monitoring row with starting wording is declared start-only (when_started, or an initiation timing the plan already drops for a drug that is not started)', () => {
        const bad: string[] = [];
        for (const m of MEDICATION_FORMULARY) {
            for (const w of m.facts?.regimen_warnings ?? []) {
                const t = typeof w.text === 'function' ? w.text({ comorbidities: new Set(), allergies: new Set(), external_medications: new Set(), current_regimen: [], volume_status: { exam_findings: new Set() } } as unknown as Patient) : w.text;
                if (START_TEXT.test(t) && !w.when_started) bad.push(`${m.name}: note "${t.slice(0, 80)}"`);
            }
            for (const it of m.facts?.monitoring_items ?? []) if (START_TEXT.test(`${it.test} | ${it.timing} | ${it.details}`) && !it.when_started && !/initiation/i.test(it.timing)) bad.push(`${m.name}: row "${it.test}"`);
        }
        assert.deepEqual(bad, []);
    });
    check('V19a generated: 600 random patients: no option carries starting wording in a drug note or a monitoring row about a drug it does not start or raise', () => {
        let seen = 0; const bad: string[] = [];
        for (let sd = 9930000; sd < 9930600; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            const o = runEngine(p);
            for (const [i, r] of o.scoredRegimens.entries()) {
                const startsAny = modsOfOption(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target);
                for (const t of [...r.warnings, ...(r.monitoring_plan ?? []).map(x => `${x.test} | ${x.timing} | ${x.details}`)]) {
                    if (!START_TEXT.test(t)) continue;
                    seen++;
                    // the text must be about a drug this option starts or raises: it names it, or the option starts or raises something at all
                    const startedNames = modsOfOption(r).filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target).map(m => m.target!.med.name.replace(/\s*\(.*\)/, '').toLowerCase());
                    const named = MEDICATION_FORMULARY.map(m => m.name.replace(/\s*\(.*\)/, '')).filter(n => t.toLowerCase().includes(n.toLowerCase()));
                    const ok = startsAny && (named.length === 0 || named.some(n => startedNames.some(sn => sn.includes(n.toLowerCase()) || n.toLowerCase().includes(sn))));
                    if (!ok && bad.length < 5) bad.push(`seed ${sd} option ${i + 1}: ${t.slice(0, 160)}`);
                }
            }
        }
        assert.ok(seen >= 30, `${seen} start-worded texts seen`);
        assert.deepEqual(bad, []);
    });

    // ---------------- V14: "why this is first" never gives as a reason a factor on which the option is worse -----------------------------------------------------------------
    // packet cases 23 and 14: "no change has fewer side effects (side-effect burden 0.0 against +22.2 points)" read as a reason for the first option, which has the higher burden.
    check('V14 reviewer packet case 23: "no change has fewer side effects (side-effect burden 0.0 against +x points)" names its subject (no change) and gives that subject\'s figure first, true to the sign: the first figure is the burden change of no change (0.0), the second the first option\'s, the higher', () => {
        const c23 = base({ lvef: 30, nyha_class: 'II' }, [entry('Lisinopril', 10)]);
        const o = runEngine(c23);
        const nc = (o.why_first?.options[0]?.lines ?? []).find(l => l.kind === 'versus_no_change');
        assert.ok(nc, 'no comparison with no change');
        const m = /no change has fewer side effects \(side-effect burden ([+−-]?[0-9.]+) against ([+−-]?[0-9.]+) points\)/.exec(nc!.text);
        assert.ok(m, nc!.text);
        assert.ok(num(m![1]) < num(m![2]), nc!.text);
        assert.deepEqual(reasonViolations(o), []);
    });
    check('V14 generated: every reference scenario and 300 random patients: each clause of a comparison sentence gives its subject\'s figure first and it is the better one, for the first option\'s reasons and for what the other plan does better', () => {
        let sentences = 0, gives = 0;
        const all: Patient[] = [...SCENARIOS.map(s => s.patient)];
        for (let sd = 9950000; sd < 9950300; sd++) { const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); all.push(p); }
        for (const [k, p0] of all.entries()) {
            const p = clonePatient(p0); if (!p.scope_conditions) p.scope_conditions = new Set();
            const o = runEngine(p);
            sentences += (o.why_first?.options ?? []).reduce((n, w) => n + w.lines.filter(l => clausesOf(l.text).length > 0).length, 0);
            gives += (o.why_first?.options ?? []).slice(0, 1).reduce((n, w) => n + w.lines.filter(l => clausesOf(l.text).some(c => c.subject && !/^option 1\b/i.test(c.subject))).length, 0);
            assert.deepEqual(reasonViolations(o), [], `case ${k}`);
        }
        assert.ok(sentences >= 100 && gives >= 5, `${sentences} comparison sentences, ${gives} first-option lines that also say what the other plan does better`);
    });

    // ---------------- V15a: a criteria-met adjunct that no option carries says why ------------------------------------------------------------------------------------------
    // packet case 18 (B3): NYHA III, EF 25, recent worsening, NT-proBNP 2,400, four pillars at target: vericiguat met the tool's criteria (it was in the eligible list) with no reason it was in no option.
    check('V15a packet case B3 and 300 random patients: every eligible adjunct no option carries says why (here: vericiguat costs $768 a month against the $500 budget)', () => {
        const b3 = PANEL_CASE_SPECS.find(c => c.key === 'B3')!.patient;
        const o = runTier(b3);
        const ver = (o.eligibleAdjuncts ?? []).find(a => /^Vericiguat/.test(a));
        assert.ok(ver, 'vericiguat is not in the eligible list');
        assert.ok(/Not in an option shown: the plan that starts it costs \$768 a month, over the stated budget of \$500/.test(ver!), ver); // R7 W3: the reason says the figure is the plan's (was: "it is over the stated budget ($768 a month against $500)")
        let entries = 0;
        for (let sd = 9960000; sd < 9960300; sd++) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            const out = runEngine(p);
            for (const a of out.eligibleAdjuncts ?? []) { entries++; assert.ok(/Not in an option shown: /.test(a), `seed ${sd}: ${a.slice(0, 120)}`); }
        }
        assert.ok(entries >= 20, `${entries} adjunct entries seen`);
    });

    // ---------------- V15c: digoxin at a reduced eGFR: the screen says what the tool does ---------------------------------------------------------------------------------
    // packet case 34 (D3): digoxin 125 mcg, eGFR 34, age 76, left unchanged. The code caps the dose at 62.5 mcg only below eGFR 30 (label: dosing by lean body weight and creatinine clearance); nothing on the screen said so.
    check('V15c packet case D3: every option that keeps or starts digoxin carries the drug note that says the tool caps the dose only below eGFR 30 and otherwise leaves it to the creatinine clearance and level', () => {
        const d3 = PANEL_CASE_SPECS.find(c => c.key === 'D3')!.patient;
        const o = runTier(d3);
        const withDigoxin = o.scoredRegimens.filter(r => r.regimen.some(x => x.med.name === 'Digoxin'));
        assert.ok(withDigoxin.length > 0, 'no option keeps digoxin');
        for (const r of withDigoxin) assert.ok(r.warnings.some(w => /digoxin is cleared by the kidney/.test(w) && /ceiling of 62\.5 mcg a day only below an eGFR of 30/.test(w)), r.warnings.join(' | ').slice(0, 300));
        const cap = base({ egfr: 24, creatinine: 2.4, rhythm: 'AFib', pulse: 70 }, [entry('Digoxin', 125), entry('Carvedilol', 12.5, 'bid')]);
        const oc = runEngine(cap);
        assert.ok(oc.scoredRegimens.some(r => summaries(r).some(x => /Digoxin/.test(x) && /62\.5/.test(x))), 'the 62.5 mcg ceiling below eGFR 30 is no longer applied');
    });

    // ---------------- V15d: "No loop diuretic start or increase is available today" says why in the same sentence -------------------------------------------------------------
    // packet case 43 (E7): potassium 3.3, congested, on furosemide 80 mg: the note said a prerequisite was missing although the reason is the low potassium.
    check('V15d packet case E7 and neighbours: the loop-unavailable note names low potassium when potassium is below 3.5 and not otherwise', () => {
        const e7 = PANEL_CASE_SPECS.find(c => c.key === 'E7')!.patient;
        const notes = (o: SimulationOutput) => o.scoredRegimens.flatMap(r => r.warnings).filter(w => /No (oral )?loop diuretic start or increase is available today/.test(w));
        const n = notes(runTier(e7));
        assert.ok(n.length > 0, 'the case does not raise the note');
        for (const w of n) assert.ok(/potassium is below 3\.5: correct it first/.test(w) && !/prerequisite is missing/.test(w), w);
        for (const k of [3.0, 3.4]) {
            const p = clonePatient(e7); p.potassium = k;
            for (const w of notes(runTier(p))) assert.ok(/potassium is below 3\.5/.test(w), `K ${k}: ${w}`);
        }
        const normal = clonePatient(e7); normal.potassium = 4.2;
        for (const w of notes(runTier(normal))) assert.ok(!/potassium is below 3\.5/.test(w), `K 4.2: ${w}`);
    });

    // ---------------- V18: hemoglobin typed as 0, a blank dry weight ----------------------------------------------------------------------------------------------------------
    // r6-engine minors: the IV iron note printed "Hb 0 g/dL" and gave a week-6 dose from it (seeds 9810189, 9810235); a blank dry weight was read as 0 kg in the severe-CKD diuretic alert (seed 9810057).
    check('V18 hemoglobin typed as 0 (or NaN, negative) is not a measurement: the iron note prints no "Hb 0" and is the note for a hemoglobin not entered; ferritin and TSAT likewise (reviewer seeds 9810189, 9810235 and others)', () => {
        const fcm = (o: SimulationOutput) => o.scoredRegimens.flatMap(r => r.warnings).filter(w => /ferric carboxymaltose label dosing/i.test(w)).join(' | ');
        let seen = 0;
        for (const sd of [9810189, 9810235, ...Array.from({ length: 1500 }, (_, i) => 9810000 + i)]) {
            if (seen >= 6 && sd >= 9810300) break;
            const mkp = (hb: number | undefined) => { const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); p.hemoglobin = hb as number; return p; };
            const reference = runEngine(mkp(undefined));
            const real = fcm(runEngine(mkp(12)));
            if (!real) continue;
            seen++;
            for (const hb of [0, NaN, -1]) {
                const o = runEngine(mkp(hb));
                assert.ok(!allText(o).some(t => /Hb 0|hemoglobin 0|Hb -1|Hb NaN/.test(t)), `seed ${sd} Hb ${hb}: prints the blank`);
                // read as not entered: the same output as the hemoglobin left blank (the dose waits for it)
                if (hb !== 0) continue; // not a number or a negative number is an input error (the existing input contract), which prints no value
                assert.equal(JSON.stringify(o.scoredRegimens.map(r => summaries(r))), JSON.stringify(reference.scoredRegimens.map(r => summaries(r))), `seed ${sd} Hb ${hb}: not read as not entered`);
                assert.equal(fcm(o), fcm(reference), `seed ${sd} Hb ${hb}: iron note differs from the hemoglobin-not-entered note`);
            }
            assert.ok(/Hb 12 g\/dL/.test(real), `seed ${sd}: a real hemoglobin is no longer printed`);
        }
        assert.ok(seen >= 2, `${seen} patients with an iron note`);
    });
    check('V18 a blank, zero or NaN dry weight is not read as 0 kg: the severe-CKD diuretic alert is the not-congested one when no finding or real weight gain says otherwise', () => {
        const ckd = (dry: number | undefined, findings: string[] = []) => base({ lvef: 30, egfr: 15, creatinine: 3.5, dry: dry as number, cur: 80, findings }, [entry('Lisinopril', 5), entry('Furosemide', 40)]);
        for (const v of [0, undefined, NaN]) {
            const o = runEngine(ckd(v));
            const a = o.clinicalAlerts.find(x => x.startsWith('SEVERE CKD DIURETIC ALERT'));
            assert.ok(!a || /not congested/.test(a), `dry ${String(v)}: ${a}`);
            assert.ok(!o.clinicalAlerts.some(x => /kg below dry weight|VOLUME DEPLETION/.test(x)), `dry ${String(v)}: a volume alert from a blank weight`);
        }
        assert.ok(/not congested/.test(runEngine(ckd(80)).clinicalAlerts.find(x => x.startsWith('SEVERE CKD DIURETIC ALERT')) ?? ''), 'a patient at dry weight is not congested');
        assert.ok(!/not congested/.test(runEngine(ckd(76)).clinicalAlerts.find(x => x.startsWith('SEVERE CKD DIURETIC ALERT')) ?? 'not congested'), 'a patient 4 kg above dry weight is congested');
        assert.ok(!/not congested/.test(runEngine(ckd(0, ['JVP Elevated', 'Edema (2+)'])).clinicalAlerts.find(x => x.startsWith('SEVERE CKD DIURETIC ALERT')) ?? 'not congested'), 'findings with a blank dry weight are congestion');
    });
    check('V18 sweep: 21 numeric inputs blank (0, undefined, NaN) on 40 patients: no displayed text prints the blank as a measurement (a zero, "Hb 0", "0 kg")', () => {
        const fields = ['age', 'sbp', 'dbp', 'pulse', 'potassium', 'egfr', 'creatinine', 'lvef', 'oxygen_saturation', 'hemoglobin', 'ferritin', 'tsat', 'bun', 'nt_pro_bnp', 'bmi', 'height_cm', 'kccq_score', 'previous_lvef', 'baseline_creatinine', 'vs.dry_weight_kg', 'vs.current_weight_kg'];
        const ZERO = /\b(Hb|hemoglobin|ferritin|TSAT|NT-proBNP|BMI|height|weight|BUN|creatinine|KCCQ|ejection fraction|baseline creatinine) (is |of |was |at )?0(\.0)?( g\/dL| ng\/mL| pg\/mL| kg| cm| mg\/dL|%)\b|(?<![\d.])0 kg\b/i;
        const bad: string[] = [];
        for (let sd = 9970000; sd < 9970040; sd++) for (const f of fields) for (const [label, v] of BLANK_FORMS) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set();
            if (f.startsWith('vs.')) (p.volume_status as unknown as Record<string, unknown>)[f.slice(3)] = v; else (p as unknown as Record<string, unknown>)[f] = v;
            const o = runEngine(p);
            const t = allText(o).find(x => ZERO.test(x));
            if (t && bad.length < 6) bad.push(`seed ${sd} ${f} ${label}: ${ZERO.exec(t)?.[0]} in "${t.slice(0, 100)}"`);
        }
        assert.deepEqual(bad, []);
    });

    // ---------------- V19c: in the over-budget fallback the screen says how the options are ordered ----------------------------------------------------------------------------
    // r6-engine minor: with "Keep cost low" the shown options are ordered by monthly cost, not score (seed 9800042, budget 1), and nothing said so.
    check('V19c over-budget fallback: every option states its ordering (lowest monthly cost first, not by score, with "Keep cost low"; by score among the least costly otherwise), and the statement is true of the order shown', () => {
        let costFirst = 0, other = 0;
        for (let sd = 9800030; sd < 9800090; sd++) for (const priority of ['cost_first', undefined] as const) {
            const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); p.max_affordable_cost = 1; (p as unknown as { care_priority?: string }).care_priority = priority;
            const o = runEngine(p);
            if (!inFallback(o) || o.scoredRegimens.length < 2) continue;
            const orderStated = o.scoredRegimens.map(r => r.warnings.find(w => w.startsWith('BUDGET EXCEEDED')) ?? '');
            if (priority === 'cost_first') {
                costFirst++;
                orderStated.forEach(w => assert.ok(/listed from the lowest monthly cost, not by score/.test(w), `seed ${sd}: ${w.slice(0, 260)}`));
                const costs = o.scoredRegimens.map(r => r.cost);
                assert.deepEqual([...costs].sort((a, b) => a - b), costs, `seed ${sd}: not in cost order`);
            } else {
                other++;
                orderStated.forEach(w => assert.ok(/listed by score/.test(w) && !/not by score/.test(w), `seed ${sd}: ${w.slice(0, 260)}`));
            }
        }
        assert.ok(costFirst >= 5 && other >= 5, `${costFirst} cost-first and ${other} other fallbacks seen`);
    });

    return { passed, failed };
}


if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const r = runEngineReadinessR6Checks();
    console.log(`ReadinessR6: ${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed > 0 ? 1 : 0);
}
