/**
 * RED TEAM HARNESS
 * Adversarially probes generateAndScoreModifications for safety failures.
 * Each probe constructs a deliberately dangerous / edge-case patient and asserts
 * that the engine does NOT do something a careful clinician would call unsafe.
 *
 * Run: npx tsx scripts/redTeam.ts
 */
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { INITIAL_PATIENT, clonePatient } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';
import { Patient, RegimenMed } from '../types';

const RAAS = new Set(['ARNI', 'ACEi', 'ARB']);
const allNames = new Set(MEDICATION_FORMULARY.map(m => m.name));

function med(name: string, strength: number | string, freq = 'qd'): RegimenMed {
    const m = MEDICATION_FORMULARY.find(f => f.name === name);
    if (!m) throw new Error(`no med ${name}`);
    const dose = m.available_doses.find(d => String(d.strength) === String(strength)) ?? m.available_doses[0];
    const f = dose.frequency_options.includes(freq) ? freq : dose.frequency_options[0];
    return { med: m, dose, selected_frequency: f };
}

function base(overrides: Partial<Patient>): Patient {
    return { ...clonePatient(INITIAL_PATIENT), ...overrides };
}

interface Finding { severity: 'CRITICAL' | 'HIGH' | 'MED' | 'INFO'; msg: string; }

async function run() {
    const prices = await getDrugPrices([...allNames], 'commercial');
    const findings: { probe: string; findings: Finding[] }[] = [];

    const diagnostics: Record<string, string> = {};
    const probe = (name: string, patient: Patient, check: (out: ReturnType<typeof shape>) => Finding[]) => {
        let out;
        try {
            out = shape(generateAndScoreModifications(patient, allNames, prices));
        } catch (e) {
            findings.push({ probe: name, findings: [{ severity: 'CRITICAL', msg: `ENGINE CRASHED: ${(e as Error).message}` }] });
            return;
        }
        diagnostics[name] = `${out.regimens.length} regimen(s)` +
            (out.regimens[0] ? ` | top: ${out.regimens[0].regimen.map(m => m.med.name).join(', ')}` : ' | (none)');
        findings.push({ probe: name, findings: check(out) });
    };

    function shape(o: ReturnType<typeof generateAndScoreModifications>) {
        const regimens = o.scoredRegimens;
        const allMeds = (r: typeof regimens[number]) => r.regimen.map(m => m.med);
        const recommends = (cls: string) => regimens.some(r => allMeds(r).some(m => m.drug_class === cls));
        const recommendsName = (n: string) => regimens.some(r => allMeds(r).some(m => m.name === n));
        const alerts = o.clinicalAlerts;
        const warningsAll = regimens.flatMap(r => r.warnings);
        return { o, regimens, recommends, recommendsName, alerts, warningsAll };
    }

    // ───────────────────────────────────────────────────────────────────────────
    // PROBE 1 — Hidden hyperkalemia via blank K+. A truly hyperkalemic patient whose
    // K+ was not entered (0). Does an MRA still get RECOMMENDED & DISPLAYED?
    probe('1. Blank K+ masking true hyperkalemia (MRA should not be a confident rec)',
        base({ potassium: 0, egfr: 40, lvef: 28, current_regimen: [med('Lisinopril', 10), med('Carvedilol', 25, 'bid')] }),
        ({ recommends, alerts, warningsAll }) => {
            const f: Finding[] = [];
            const mraRec = recommends('MRA') || recommends('nsMRA');
            const hasAlert = alerts.some(a => a.toLowerCase().includes('potassium'));
            const hasWarn = warningsAll.some(w => w.includes('POTASSIUM UNKNOWN'));
            if (mraRec && !hasWarn) f.push({ severity: 'CRITICAL', msg: 'MRA recommended with blank K+ and NO POTASSIUM UNKNOWN warning' });
            if (!hasAlert) f.push({ severity: 'HIGH', msg: 'No data-required alert for blank potassium' });
            if (mraRec && hasWarn) f.push({ severity: 'INFO', msg: 'MRA still appears but is warned + penalized (acceptable mitigation, NOT a hard block)' });
            return f;
        });

    // PROBE 2 — Dual MRA where the STEROIDAL is contraindicated (hyperkalemia intolerance)
    // but the nsMRA is fine. Redundancy logic keeps steroidal; contraindication removes it.
    // Risk: BOTH removed → patient loses a viable MRA pillar (under-treatment).
    probe('2. Dual MRA, steroidal contraindicated, nsMRA viable (should keep an MRA, not drop both)',
        base({
            lvef: 45, nyha_class: 'II', nt_pro_bnp: 1200, potassium: 4.6, egfr: 55,
            comorbidities: new Set(['HFmrEF']),
            discontinued_meds: [{ name: 'Eplerenone', drug_class: 'MRA', reason: 'gynecomastia' }],
            current_regimen: [med('Spironolactone', 25), med('Finerenone (Kerendia)', 10), med('Lisinopril', 10)],
        }),
        ({ recommends, regimens }) => {
            const f: Finding[] = [];
            const anyMra = recommends('MRA') || recommends('nsMRA');
            if (regimens.length > 0 && !anyMra) f.push({ severity: 'HIGH', msg: 'Both MRAs dropped — viable nsMRA (finerenone) lost when only the steroidal was intolerable (under-treatment)' });
            return f;
        });

    // PROBE 3 — Triple RAAS. Keep exactly one, remove two.
    probe('3. Triple RAAS (ACEi + ARB + ARNI) — must reduce to a single RAAS',
        base({ lvef: 30, current_regimen: [med('Lisinopril', 10), med('Valsartan', 80, 'bid'), med('Sacubitril/Valsartan (Entresto)', '49/51', 'bid')] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            const dual = regimens.some(r => r.regimen.filter(m => RAAS.has(m.med.drug_class)).length > 1);
            if (dual) f.push({ severity: 'CRITICAL', msg: 'Output regimen still contains >1 RAAS agent' });
            return f;
        });

    // PROBE 4 — Under-treatment check after CO-compensation removal. COPERNICUS/PIONEER show
    // GDMT is safe & beneficial at SBP ~90 in severe HFrEF. Does the engine now REFUSE all GDMT?
    probe('4. Low-SBP severe HFrEF (SBP 92, LVEF 18) — must still offer SOME GDMT (no false refusal)',
        base({ sbp: 92, dbp: 60, lvef: 18, nyha_class: 'III', nt_pro_bnp: 3000, current_regimen: [], volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) } }),
        ({ regimens, alerts }) => {
            const f: Finding[] = [];
            if (regimens.length === 0 && !alerts.some(a => a.includes('HEMODYNAMIC') || a.includes('LOW OUTPUT') || a.includes('ADVANCED'))) {
                f.push({ severity: 'HIGH', msg: 'No regimens and no explanatory instability alert — silent refusal' });
            }
            if (regimens.length === 0) f.push({ severity: 'INFO', msg: 'No regimen offered (expected if flagged unstable — verify not over-conservative)' });
            return f;
        });

    // PROBE 5 — Newly-contraindicated beta-blocker (new severe asthma). Force-removal would
    // ABRUPTLY discontinue the BB (Class III harm) instead of tapering.
    probe('5. BB becomes contraindicated (new bronchospasm) — must NOT abruptly remove (taper)',
        base({ lvef: 30, comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']), current_regimen: [med('Carvedilol', 25, 'bid'), med('Lisinopril', 10)] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            // A decompensated HFrEF patient with a contraindicated BB still NEEDS GDMT — zero output is under-treatment.
            if (regimens.length === 0) { f.push({ severity: 'HIGH', msg: 'Zero regimens for decompensated HFrEF + contraindicated BB (under-treatment / silent blank)' }); return f; }
            const removed = regimens.some(r => r.modification_set?.modifications.some(m => m.action === 'remove' && m.source?.med.drug_class === 'Beta Blocker'));
            const warnsTaper = regimens.flatMap(r => r.warnings).some(w => /taper|abrupt|withdraw|do not stop/i.test(w));
            // Coherence: the same drug must not be both titrate_down AND remove in one candidate.
            const incoherent = regimens.some(r => {
                const mods = r.modification_set?.modifications ?? [];
                return mods.some(m => m.action === 'remove' && m.source?.med.drug_class === 'Beta Blocker'
                    && mods.some(n => (n.action === 'titrate_down' || n.action === 'titrate_up') && n.source?.med.name === m.source?.med.name));
            });
            if (removed && !warnsTaper) f.push({ severity: 'HIGH', msg: 'Beta-blocker removed with no taper guidance' });
            if (incoherent) f.push({ severity: 'MED', msg: 'Incoherent mod list: same beta-blocker both titrated and removed in one visit' });
            return f;
        });

    // PROBE 6 — Implausible inputs (unit errors / impossible values). Should not silently
    // produce confident recommendations on garbage.
    probe('6a. LVEF 250 (typo) — should be flagged as implausible',
        base({ lvef: 250 }),
        ({ alerts }) => alerts.some(a => a.includes('IMPLAUSIBLE') && a.includes('LVEF')) ? [] : [{ severity: 'MED', msg: 'LVEF 250 not flagged as implausible' }]);

    probe('6b. K+ 50 (entered mg not mEq/L) — should be flagged as implausible',
        base({ potassium: 50, lvef: 30 }),
        ({ alerts }) => alerts.some(a => a.includes('IMPLAUSIBLE') && a.toLowerCase().includes('potassium')) ? [] : [{ severity: 'MED', msg: 'K+ 50 not flagged as implausible' }]);

    probe('6c. Negative dry weight / current weight — engine must not crash or invert volume',
        base({ lvef: 30, volume_status: { dry_weight_kg: -70, current_weight_kg: -73, exam_findings: new Set() } }),
        ({ regimens }) => regimens.length >= 0 ? [{ severity: 'INFO', msg: 'Ran without crash (inspect volume scoring sanity manually)' }] : []);

    // PROBE 7 — Allergy bypass by class. Allergic to Furosemide; is a different loop (Bumetanide)
    // or Furoscix (SC furosemide!) still offered? Furoscix IS furosemide → should be blocked too.
    probe('7. Furosemide allergy — Furoscix (SC furosemide) must NOT be recommended',
        base({ lvef: 30, allergies: new Set(['Furosemide']), volume_status: { dry_weight_kg: 70, current_weight_kg: 75, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) }, current_regimen: [] }),
        ({ recommendsName }) => recommendsName('Furoscix (SC Furosemide)') ? [{ severity: 'HIGH', msg: 'Furoscix (= subcutaneous furosemide) recommended despite a FUROSEMIDE allergy (same molecule)' }] : []);

    // PROBE 8 — Pregnancy with a fully GDMT-loaded regimen. ALL teratogens must be removed.
    probe('8. Pregnant on full quad GDMT — RAAS/MRA/nsMRA/SGLT2i must all be removed',
        base({ is_pregnant: true, sex: 'Female', lvef: 30, current_regimen: [med('Lisinopril', 10), med('Carvedilol', 25, 'bid'), med('Spironolactone', 25), med('Dapagliflozin', 10)] }),
        ({ regimens }) => {
            const bad = regimens.filter(r => r.regimen.some(m => RAAS.has(m.med.drug_class) || m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA' || m.med.drug_class === 'SGLT2i'));
            return bad.length ? [{ severity: 'CRITICAL', msg: `Teratogen retained in ${bad.length} pregnant regimen(s): ${[...new Set(bad.flatMap(r => r.regimen.filter(m => RAAS.has(m.med.drug_class) || ['MRA', 'nsMRA', 'SGLT2i'].includes(m.med.drug_class)).map(m => m.med.name)))].join(', ')}` }] : [];
        });

    // PROBE 9 — Stacked intolerances exclude all RAAS + all BB. Does it degrade gracefully?
    probe('9. All RAAS (angioedema) + all BB (bradycardia) excluded — graceful, not nonsense',
        base({ lvef: 25, pulse: 55, comorbidities: new Set(['HFrEF', 'History of Angioedema']),
            discontinued_meds: [{ name: 'Carvedilol', drug_class: 'Beta Blocker', reason: 'symptomatic bradycardia' }], current_regimen: [] }),
        ({ recommends, regimens }) => {
            const f: Finding[] = [];
            if (recommends('ACEi') || recommends('ARNI')) f.push({ severity: 'HIGH', msg: 'ACEi/ARNI offered despite angioedema history' });
            if (recommends('Beta Blocker')) f.push({ severity: 'HIGH', msg: 'Beta-blocker offered despite bradycardia intolerance' });
            if (regimens.length === 0) f.push({ severity: 'INFO', msg: 'No regimen (verify H/ISDN + SGLT2i + MRA alternatives were considered)' });
            return f;
        });

    // PROBE 10 — Projected hyperkalemia just under the binder-rescue trigger. Add MRA to a
    // patient at K+ 5.4 / eGFR 30. Does it land K+ in a falsely-safe band via binder paper-over?
    probe('10. MRA at K+ 5.4 / eGFR 30 — must include binder AND not display unsafe K+',
        base({ lvef: 30, potassium: 5.4, egfr: 30, creatinine: 2.2, current_regimen: [med('Lisinopril', 10), med('Carvedilol', 25, 'bid')] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            regimens.forEach(r => {
                const hasMra = r.regimen.some(m => m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA');
                const hasBinder = r.regimen.some(m => m.med.drug_class === 'K+ Binder');
                if (hasMra && !hasBinder) f.push({ severity: 'HIGH', msg: 'MRA at K+ 5.4/eGFR 30 without binder rescue' });
                if (r.projected_patient.potassium > 5.5) f.push({ severity: 'CRITICAL', msg: `Displayed regimen projects K+ ${r.projected_patient.potassium.toFixed(1)}` });
            });
            return f;
        });

    // PROBE 11 — Mild/moderate asthma: non-selective carvedilol excluded, β1-selective offered + caution.
    probe('11. Mild/moderate asthma — carvedilol excluded, β1-selective BB offered with caution',
        base({ lvef: 30, pulse: 75, comorbidities: new Set(['HFrEF', 'Asthma (Mild/Moderate)']), current_regimen: [] }),
        ({ recommendsName, regimens, o }) => {
            const f: Finding[] = [];
            if (recommendsName('Carvedilol')) f.push({ severity: 'HIGH', msg: 'Non-selective carvedilol offered in asthma (should use β1-selective)' });
            const hasSelective = recommendsName('Bisoprolol') || recommendsName('Metoprolol Succinate');
            const cautioned = regimens.flatMap(r => r.warnings).some(w => w.includes('ASTHMA + BETA-BLOCKER'));
            if (hasSelective && !cautioned) f.push({ severity: 'MED', msg: 'β1-selective BB offered in asthma without bronchospasm-monitoring caution' });
            if (!hasSelective && !o.gdmtGaps?.length) f.push({ severity: 'MED', msg: 'No BB offered and gap not surfaced — BB pillar silently lost in mild asthma' });
            return f;
        });

    // PROBE 12 — Scoring sanity: an ideal de-novo HFrEF candidate's TOP pick should be multi-pillar,
    // not a single drug riding a special-feature bonus.
    probe('12. Scoring — ideal de-novo HFrEF top pick must be multi-pillar (not 1-drug gaming)',
        base({ lvef: 25, sbp: 125, dbp: 78, potassium: 4.2, egfr: 70, creatinine: 1.0, nyha_class: 'II', max_affordable_cost: 2000, current_regimen: [] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            if (!regimens[0]) return [{ severity: 'HIGH', msg: 'No regimen for an ideal candidate' }];
            const pillars = new Set(regimens[0].regimen.map(m => m.med.drug_class).map(c => RAAS.has(c) ? 'RAAS' : c).filter(c => ['RAAS', 'Beta Blocker', 'MRA', 'SGLT2i'].includes(c)));
            if (pillars.size < 2) f.push({ severity: 'HIGH', msg: `Top pick has only ${pillars.size} pillar(s) for an ideal multi-pillar candidate — possible scoring gaming` });
            return f;
        });

    // PROBE 13 — Budget = 0. Must not crash or emit negative/nonsensical cost output.
    probe('13. Budget $0 — graceful, no crash, costs non-negative',
        base({ lvef: 30, max_affordable_cost: 0, current_regimen: [] }),
        ({ regimens }) => regimens.some(r => r.cost < 0) ? [{ severity: 'HIGH', msg: 'Negative cost produced' }] : [{ severity: 'INFO', msg: `${regimens.length} regimen(s) under $0 budget (budget-exceeded path)` }]);

    // PROBE 14 — Race-based logic: Black NYHA III HFrEF on GDMT should be SURFACED H/ISDN (A-HeFT),
    // either in a regimen or in the eligible-adjuncts list (never silently absent).
    probe('14. Race — Black NYHA III HFrEF on RAAS+BB must surface H/ISDN (A-HeFT)',
        base({ race: 'Black', lvef: 28, nyha_class: 'III', sbp: 125, current_regimen: [med('Lisinopril', 20), med('Carvedilol', 25, 'bid')] }),
        ({ recommends, o }) => {
            const surfaced = recommends('Vasodilator') || (o.eligibleAdjuncts ?? []).some(a => a.includes('H/ISDN'));
            return surfaced ? [] : [{ severity: 'MED', msg: 'H/ISDN neither recommended nor surfaced as an eligible adjunct (A-HeFT indication silently absent)' }];
        });

    // PROBE 15 — Qualitative projection sanity: removing a diuretic (volume depleted) must NOT claim
    // "Reverse remodeling: improve" (deprescribing a loop does not improve EF).
    probe('15. Qualitative projection — diuretic removal must not claim EF improvement',
        base({ lvef: 30, volume_status: { dry_weight_kg: 72, current_weight_kg: 70.5, exam_findings: new Set() }, current_regimen: [med('Lisinopril', 10), med('Carvedilol', 25, 'bid'), med('Furosemide', 40)] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            regimens.forEach(r => {
                const removesDiuretic = r.modification_set?.modifications.some(m => m.action === 'remove' && m.source?.med.drug_class === 'Loop Diuretic');
                const onlyDeprescribe = r.modification_set?.modifications.every(m => m.action === 'remove' || m.action === 'keep');
                const remodel = r.qualitative_projections?.find(p => p.label === 'Reverse remodeling');
                if (removesDiuretic && onlyDeprescribe && remodel?.direction === 'improve') {
                    f.push({ severity: 'MED', msg: 'Pure diuretic deprescribe falsely projects "Reverse remodeling: improve"' });
                }
            });
            return f;
        });

    // PROBE 16 — Dialysis-range eGFR (6). No crash; renal-contraindicated drugs (finerenone) excluded.
    probe('16. Dialysis-range eGFR 6 — no crash; finerenone/SGLT2i-init handled, alerts present',
        base({ lvef: 45, egfr: 6, creatinine: 6.5, potassium: 5.0, comorbidities: new Set(['HFmrEF', 'Chronic Kidney Disease']), current_regimen: [] }),
        ({ recommendsName, o }) => {
            const f: Finding[] = [];
            if (recommendsName('Finerenone (Kerendia)')) f.push({ severity: 'HIGH', msg: 'Finerenone offered at eGFR 6 (contraindicated < 25)' });
            if (!o.clinicalAlerts.some(a => a.includes('CKD') || a.includes('SEVERE CKD'))) f.push({ severity: 'INFO', msg: 'No severe-CKD alert at eGFR 6' });
            return f;
        });

    // PROBE 17 — Evidence-as-data: HFrEF quad at target must score guideline 100 AND surface
    // Class I evidence (recClass + trials) for every pillar present.
    probe('17. Evidence surfacing — HFrEF quad at target scores guideline 100 with Class I citations',
        base({ lvef: 25, sbp: 122, dbp: 76, potassium: 4.2, egfr: 70, creatinine: 1.0, nyha_class: 'II', max_affordable_cost: 3000,
            current_regimen: [med('Sacubitril/Valsartan (Entresto)', '97/103', 'bid'), med('Carvedilol', 25, 'bid'), med('Spironolactone', 25), med('Dapagliflozin', 10)] }),
        ({ regimens }) => {
            const f: Finding[] = [];
            // Pick a regimen that retains all 4 pillars (RAAS, BB, MRA, SGLT2i present).
            const hasAll4 = (r: typeof regimens[number]) => {
                const ks = new Set<string>(r.regimen.map(m => RAAS.has(m.med.drug_class) ? 'RAAS' : m.med.drug_class === 'Beta Blocker' ? 'BB' : (m.med.drug_class === 'MRA' || m.med.drug_class === 'nsMRA') ? 'MRA' : m.med.drug_class === 'SGLT2i' ? 'SGLT2i' : ''));
                return ['RAAS', 'BB', 'MRA', 'SGLT2i'].every(k => ks.has(k));
            };
            const keep = regimens.find(hasAll4);
            if (!keep) return [{ severity: 'HIGH', msg: 'No 4-pillar regimen surfaced for a quad-therapy patient' }];
            if (keep.domain_scores.guideline < 90) f.push({ severity: 'MED', msg: `4-pillar guideline score ${keep.domain_scores.guideline} (expected ≥ 90 for full quad)` });
            const classI = keep.rationale.filter(r => r.startsWith('Guideline:') && r.includes('Class I'));
            if (classI.length < 4) f.push({ severity: 'MED', msg: `Only ${classI.length}/4 pillar Class I citations surfaced` });
            return f;
        });

    // ───────────────────────────────────────────────────────────────────────────
    // REPORT
    const order = { CRITICAL: 0, HIGH: 1, MED: 2, INFO: 3 } as const;
    let crit = 0, high = 0, med2 = 0;
    console.log('\n══════════════════ RED TEAM REPORT ══════════════════\n');
    for (const p of findings) {
        const real = p.findings.filter(f => f.severity !== 'INFO');
        const tag = real.some(f => f.severity === 'CRITICAL') ? '🔴' : real.some(f => f.severity === 'HIGH') ? '🟠' : real.length ? '🟡' : '🟢';
        console.log(`${tag} ${p.probe}`);
        console.log(`     ↳ ${diagnostics[p.probe] ?? ''}`);
        p.findings.sort((a, b) => order[a.severity] - order[b.severity]).forEach(f => {
            console.log(`     [${f.severity}] ${f.msg}`);
            if (f.severity === 'CRITICAL') crit++; else if (f.severity === 'HIGH') high++; else if (f.severity === 'MED') med2++;
        });
        console.log('');
    }
    console.log('─────────────────────────────────────────────────────');
    console.log(`CRITICAL: ${crit}   HIGH: ${high}   MED: ${med2}`);
    console.log('─────────────────────────────────────────────────────\n');
}

run();
