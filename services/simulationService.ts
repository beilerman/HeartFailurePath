
import { Patient, Medication, ScoredRegimen, RegimenMed, ExcludedMedication, ModificationAction, RegimenModification, ModificationSet } from '../types';
import { MEDICATION_FORMULARY } from '../constants';

// --- Helper Functions ---
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

    // Unique only
    tiers = [...new Set(tiers)];

    return tiers.map(dose => ({
        med,
        dose,
        selected_frequency: dose.frequency_options[0]
    }));
}

function getMedicationClassGroup(drugClass: string): string {
    if (['ARNI', 'ACEi', 'ARB'].includes(drugClass)) return 'RAAS Inhibitor';
    if (['GLP-1 RA', 'GLP-1/GIP RA'].includes(drugClass)) return 'GLP-1 Therapy';
    return drugClass;
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
    const isHFimpEF = patient.previous_lvef !== undefined && patient.previous_lvef <= 40 && patient.lvef > 40;
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

    // Build a map of all available meds by class group for lookup
    const tiersByGroup = new Map<string, RegimenMed[]>();
    medTiers.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        if (!tiersByGroup.has(group)) tiersByGroup.set(group, []);
        tiersByGroup.get(group)!.push(r);
    });

    // Titration analysis: for each current med, find higher/lower dose tiers
    const titratableUp: RegimenAnalysis['titratableUp'] = [];
    const titratableDown: RegimenAnalysis['titratableDown'] = [];

    currentRegimen.forEach(current => {
        const allTiers = getDoseTiers(current.med, patient);
        const currentStrength = Number(current.dose.strength);

        const higherDoses = allTiers.filter(t =>
            Number(t.dose.strength) > currentStrength
        );
        const lowerDoses = allTiers.filter(t =>
            Number(t.dose.strength) < currentStrength
        );

        if (higherDoses.length > 0) {
            titratableUp.push({ current, options: higherDoses });
        }
        if (lowerDoses.length > 0) {
            titratableDown.push({ current, options: lowerDoses });
        }
    });

    // Swap analysis: for each current med, find other meds in same class group
    const swappable: RegimenAnalysis['swappable'] = [];
    currentRegimen.forEach(current => {
        const group = getMedicationClassGroup(current.med.drug_class);
        const groupTiers = tiersByGroup.get(group) || [];
        const candidates = groupTiers.filter(t => t.med.name !== current.med.name);
        if (candidates.length > 0) {
            swappable.push({ from: current, candidates });
        }
    });

    // Removable: diuretics when euvolemic
    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    // Removable: diuretics when euvolemic or volume-depleted
    const removable: RegimenMed[] = [];
    currentRegimen.forEach(r => {
        if (r.med.drug_class === 'Loop Diuretic' && fluidExcess < 0.5) {
            removable.push(r);
        }
        // Also flag thiazide-like diuretics for removal in euvolemia/depletion
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
    const hasBBInCurrent = currentClasses.has('Beta Blocker');

    // H/ISDN: Black + NYHA III-IV (A-HeFT), or no RAAS
    if ((isBlack && isNyhaIIIorIV) || !hasRAASInCurrent) {
        const hidralazineTiers = medTiers.filter(r => r.med.drug_class === 'Vasodilator');
        if (hidralazineTiers.length > 0 && !currentClasses.has('Vasodilator')) {
            addableAdjuncts.push(hidralazineTiers[0]);
        }
    }

    // Ivabradine: Sinus + HR >= 70 + LVEF <= 35 + (has BB OR all BB contraindicated) (SHIFT; ESC 2021 Class IIb)
    const ivabradineEligible = isSinusRhythm && patient.pulse >= 70 && patient.lvef <= 35 &&
        (hasBBInCurrent || allBBExcluded === true);
    if (ivabradineEligible) {
        const ivabTiers = medTiers.filter(r => r.med.drug_class === 'If Inhibitor');
        if (ivabTiers.length > 0 && !currentClasses.has('If Inhibitor')) {
            addableAdjuncts.push(ivabTiers[0]);
        }
    }

    // Vericiguat: NYHA II-IV + NT-proBNP >= 1600 + LVEF < 45 (VICTORIA trial enrollment criteria)
    if (isNyhaIIIorIV && patient.nt_pro_bnp >= 1600 && patient.lvef < 45) {
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
            addableAdjuncts.push(...safeSlice(loopTiers, 2));
        }
    }

    // Thiazide if severe congestion + already on loop
    if (fluidExcess > 4.0 && currentClasses.has('Loop Diuretic')) {
        const thiazTiers = medTiers.filter(r => r.med.drug_class === 'Thiazide-like Diuretic');
        if (thiazTiers.length > 0 && !currentClasses.has('Thiazide-like Diuretic')) {
            addableAdjuncts.push(thiazTiers[0]);
        }
    }

    // Iron if iron-deficient
    const needsIron = (patient.ferritin && patient.ferritin < 100) || (patient.tsat && patient.tsat < 20);
    if (needsIron && !currentClasses.has('IV Iron')) {
        const ironTiers = medTiers.filter(r => r.med.drug_class === 'IV Iron');
        if (ironTiers.length > 0) {
            addableAdjuncts.push(ironTiers[0]);
        }
    }

    // GLP-1 if obese + HFpEF/HFmrEF (STEP-HFpEF, SUMMIT trials — no evidence for HFrEF)
    if (patient.bmi >= 30 && patient.lvef >= 40 && !currentClasses.has('GLP-1 RA') && !currentClasses.has('GLP-1/GIP RA')) {
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
        addablePillars
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
                summary: `Swap ${from.med.name} → ${to.med.name} ${formatDose(to)}`
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
                        { action: 'swap', source: from, target: bestSwap, summary: `Swap ${from.med.name} → ${bestSwap.med.name} ${formatDose(bestSwap)}` },
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
                        { action: 'swap', source: from, target: bestSwap, summary: `Swap ${from.med.name} → ${bestSwap.med.name} ${formatDose(bestSwap)}` },
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
    if (currentRegimen.length > 0) {
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

    // Filter by max_new_classes_per_visit
    return candidates.filter(c => {
        const newClassCount = countNewClassGroups(c.resulting_regimen, currentRegimen);
        return newClassCount <= maxNewPerVisit;
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
function calculateGuidelineConcordanceScore(
    resultingRegimen: RegimenMed[],
    patient: Patient
): number {
    const pillarClasses = new Set<string>();
    resultingRegimen.forEach(r => {
        const cls = r.med.drug_class;
        if (['ARNI', 'ACEi', 'ARB'].includes(cls)) pillarClasses.add('RAAS');
        else if (cls === 'Beta Blocker') pillarClasses.add('BB');
        else if (cls === 'MRA') pillarClasses.add('MRA');
        else if (cls === 'SGLT2i') pillarClasses.add('SGLT2i');
    });

    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const hasDiuretic = resultingRegimen.some(r =>
        r.med.drug_class === 'Loop Diuretic' || r.med.drug_class === 'Thiazide-like Diuretic'
    );

    // G4: HFimpEF — if LVEF was ≤40% and has improved, score as HFrEF (continue all pillars)
    const isHFimpEF = patient.previous_lvef !== undefined && patient.previous_lvef <= 40 && patient.lvef > 40;

    if (patient.lvef >= 50 && !isHFimpEF) {
        // HFpEF: SGLT2i is the only Class I pillar (EMPEROR-Preserved, DELIVER)
        let score = 0;
        if (pillarClasses.has('SGLT2i')) {
            score += 70;
            const sglt2med = resultingRegimen.find(r => r.med.drug_class === 'SGLT2i');
            if (sglt2med) {
                const isTarget = sglt2med.med.available_doses.find(
                    d => d.strength === sglt2med.dose.strength
                )?.is_target_dose;
                if (isTarget) score += 15;
            }
        }
        if (fluidExcess <= 1.0 || hasDiuretic) score += 15;
        return Math.min(100, score);
    }

    if (patient.lvef >= 41 && !isHFimpEF) {
        // HFmrEF (LVEF 41-49): RAAS & SGLT2i = Class I, BB & MRA = Class IIb
        let score = 0;
        // Class I pillars: 22 pts each
        if (pillarClasses.has('RAAS')) score += 22;
        if (pillarClasses.has('SGLT2i')) score += 22;
        // Class IIb pillars: 13 pts each (weaker evidence — CHARM/TOPCAT subgroups)
        if (pillarClasses.has('BB')) score += 13;
        if (pillarClasses.has('MRA')) score += 13;
        // = max 70 from pillars

        // Target dose bonus: +5 per pillar at target (max 20)
        resultingRegimen.forEach(r => {
            const group = getMedicationClassGroup(r.med.drug_class);
            if (['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'].includes(group)) {
                const isTarget = r.med.available_doses.find(
                    d => d.strength === r.dose.strength
                )?.is_target_dose;
                if (isTarget) score += 5;
            }
        });

        // Volume management bonus
        if (fluidExcess <= 1.0 || hasDiuretic) score += 10;
        return Math.min(100, score);
    }

    // HFrEF (LVEF ≤ 40): Class I — all 4 pillars equal weight
    let score = 0;
    ['RAAS', 'BB', 'MRA', 'SGLT2i'].forEach(pillar => {
        if (pillarClasses.has(pillar)) score += 20;
    });

    // Target dose bonus: +5 per pillar at guideline target
    resultingRegimen.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        if (['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'].includes(group)) {
            const isTarget = r.med.available_doses.find(
                d => d.strength === r.dose.strength
            )?.is_target_dose;
            if (isTarget) score += 5;
        }
    });

    return Math.min(100, score);
}

// --- DBP Coupling: Drug-class-specific SBP→DBP ratios ---
// Vasodilators widen pulse pressure (DBP drops less); BB drops DBP proportionally
function getDbpRatio(drugClass: string): number {
    if (['ARNI', 'ACEi', 'ARB'].includes(drugClass)) return 0.50;  // Vasodilators
    if (drugClass === 'Beta Blocker') return 0.70;                   // Proportional
    if (drugClass === 'Loop Diuretic' || drugClass === 'Thiazide-like Diuretic') return 0.50; // Preload
    if (drugClass === 'SGLT2i') return 0.40;                         // Osmotic/preload
    if (drugClass === 'Vasodilator') return 0.50;                    // H/ISDN
    if (drugClass === 'sGC Stimulator') return 0.55;                 // Vericiguat
    return 0.60;                                                      // Default
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
    let hasGLP1 = false;
    let raasCount = 0;
    let diureticEffectStrength = 0;

    // Renal risk factor for K+ retention
    let renalRiskFactor = 1.0;
    if (currentPatient.egfr < 60) renalRiskFactor = 1.2;
    if (currentPatient.egfr < 45) renalRiskFactor = 1.5;
    if (currentPatient.egfr < 30) renalRiskFactor = 2.0;

    // Track drug types from resulting regimen (for synergy/safety checks)
    resultingRegimen.forEach(r => {
        const cls = r.med.drug_class;
        const dose = r.dose.strength;
        if (cls === 'Loop Diuretic') { hasDiuretic = true; diureticEffectStrength += r.med.chf_effects(dose).weight_reduction_kg; }
        if (cls === 'SGLT2i') hasSGLT2 = true;
        if (cls === 'MRA') hasMRA = true;
        if (cls === 'Beta Blocker') hasBeta = true;
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

            lvefDelta += chf.lvef_improvement_absolute;
            bnpFactor *= (1 - chf.bnp_reduction_percent);
            weightDelta += chf.weight_reduction_kg;
            kccqDelta += chf.kccq_improvement;
            if (chf.lavi_reduction_percent > 0) laviFactorTotal *= (1 - chf.lavi_reduction_percent);
            if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent > 0) lveddFactorTotal *= (1 - chf.lvedd_reduction_percent);

            sbpDelta += hemo.sbp_drop;
            dbpDelta += hemo.sbp_drop * getDbpRatio(mod.target.med.drug_class);
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
        && currentClasses.has('Beta Blocker') && currentClasses.has('MRA') && currentClasses.has('SGLT2i');
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
    // Quad therapy raw deltas (e.g. +27%) are compressed via exponential saturation
    // Max recovery = gap to normal (55%); can't project above physiological ceiling
    const maxLvefRecovery = Math.max(5, 55 - currentPatient.lvef);
    const attenuatedLvefDelta = lvefDelta > 0
        ? maxLvefRecovery * (1 - Math.exp(-lvefDelta / (maxLvefRecovery * 0.7)))
        : lvefDelta; // Negative deltas (removal) pass through unattenuated
    proj.lvef = Math.min(55, currentPatient.lvef + attenuatedLvefDelta);
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

    proj.sbp = finalSbp;
    proj.dbp = finalDbp;
    proj.pulse = currentPatient.pulse - hrDelta;
    proj.potassium = currentPatient.potassium + kDelta;

    // --- Titration Timeline Warning ---
    const newAdds = modificationSet.modifications.filter(m => m.action === 'add');
    if (newAdds.length >= 2) {
        const targetAdds = newAdds.filter(m => m.target?.dose.is_target_dose);
        if (targetAdds.length >= 2) {
            warnings.push('Multiple new medications at target dose. In practice, initiate at low dose and titrate each q2-4 weeks.');
        }
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

    if (raasCount > 1) {
        warnings.push("CONTRAINDICATION: Dual RAAS blockade (ACEi + ARB/ARNI) increases renal risk without benefit.");
    }

    if (currentPatient.oxygen_saturation && currentPatient.oxygen_saturation < 90) {
        warnings.push("Hypoxia Alert: SpO2 < 90%. Evaluate for Pulmonary Edema.");
    }

    // Liver disease safety warnings
    if (currentPatient.comorbidities.has('Liver Disease (Child-Pugh B/C)')) {
        const hasMRAInRegimen = resultingRegimen.some(r => r.med.drug_class === 'MRA');
        if (hasMRAInRegimen) {
            const mraName = resultingRegimen.find(r => r.med.drug_class === 'MRA')?.med.name;
            warnings.push(`Hepatic Impairment: ${mraName} accumulates in cirrhosis. Monitor K+ and renal function closely. Consider dose reduction.`);
        }
    }

    // Digoxin narrow therapeutic index monitoring (DIG trial: target 0.5-0.9 ng/mL)
    const hasDigoxin = resultingRegimen.some(r => r.med.drug_class === 'Inotrope');
    if (hasDigoxin) {
        const digoxinDose = resultingRegimen.find(r => r.med.drug_class === 'Inotrope');
        const renalNote = currentPatient.egfr < 45 ? ' Renal impairment increases toxicity risk — recheck level after any eGFR change.' : '';
        const kNote = (hasDiuretic && !hasMRA) ? ' Concurrent diuretic without MRA increases hypokalemia-mediated toxicity risk.' : '';
        warnings.push(`Digoxin Monitoring: Check serum digoxin level in 5-7 days (target 0.5-0.9 ng/mL). Monitor for toxicity (nausea, visual changes, arrhythmia).${renalNote}${kNote}`);
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

    return { projectedPatient: proj, cost: totalCost, complexity: complexityScore, warnings, rationale: uniqueRationale, specialFeatureBonus };
}

// --- 4. Delta-from-Current Entry Point ---

export function generateAndScoreModifications(
    patient: Patient,
    availableMedNames: Set<string>,
    prices: Record<string, number>
): { scoredRegimens: ScoredRegimen[], excludedMedications: ExcludedMedication[], clinicalAlerts: string[] } {

    const clinicalAlerts: string[] = [];

    // --- S4: Pregnancy safety alert ---
    if (patient.is_pregnant === true) {
        clinicalAlerts.push('PREGNANCY ALERT: ACEi, ARB, ARNI, and MRA are contraindicated (Category X). SGLT2i excluded (Category C — insufficient human safety data). These agents have been excluded from all recommendations.');
    }

    // --- S2: Hemodynamic instability — block pharmacologic optimization ---
    if (patient.sbp < 85) {
        clinicalAlerts.push(
            'HEMODYNAMIC INSTABILITY: SBP < 85 mmHg. Oral GDMT optimization is unsafe at current blood pressure. ' +
            'Stabilize hemodynamics first. Consider: IV inotropes (dobutamine/milrinone), hemodynamic monitoring (PA catheter), ' +
            'vasopressor support if needed, and Advanced Heart Failure consultation.'
        );
    }

    // --- S3: Advanced HF referral trigger ---
    const advancedHFCriteria = (patient.lvef <= 20 && patient.sbp < 90) ||
        (patient.nyha_class === 'IV' && patient.nt_pro_bnp > 4000);
    if (advancedHFCriteria) {
        clinicalAlerts.push(
            'ADVANCED HEART FAILURE ALERT: This patient meets criteria for Advanced HF evaluation (INTERMACS 3-4). ' +
            'Consider: IV inotropic support, mechanical circulatory support (LVAD/Impella), heart transplant evaluation, ' +
            'CRT/ICD assessment, and palliative care discussion. Refer to Advanced HF specialist.'
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

    // 1. Filter Formulary & Check Exclusions (same logic as before)
    const excludedMeds: ExcludedMedication[] = [...patient.discontinued_meds];
    const excludedNames = new Set(excludedMeds.map(m => m.name));
    const exclusionReasons = new Set(excludedMeds.map(m => m.reason));

    const excludeACEi = exclusionReasons.has("Angioedema") || exclusionReasons.has("Cough");
    const excludeMRA = exclusionReasons.has("Hyperkalemia") || exclusionReasons.has("Gynecomastia");

    // G2: Track which drug classes are fully excluded (for BB-contraindicated ivabradine path)
    const excludedClasses = new Set<string>();

    const formulary = MEDICATION_FORMULARY.filter(m => {
        if (!availableMedNames.has(m.name)) return false;
        if (excludedNames.has(m.name)) return false;

        if (m.drug_class === 'ACEi' && excludeACEi) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Cross-reactivity with prior ACEi intolerance" });
            return false;
        }
        if (m.drug_class === 'MRA' && excludeMRA) {
            excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason: "Cross-reactivity with prior MRA intolerance" });
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
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers);

    // 4. Generate candidate modifications
    const binders = medTiers.filter(r => r.med.drug_class === 'K+ Binder');
    const candidateSets = generateCandidateModifications(analysis, patient, binders);

    // 5. Score each candidate
    const patiromer = binders.find(b => b.med.name === 'Patiromer');
    const ivIron = medTiers.find(r => r.med.drug_class === 'IV Iron');
    const ironDeficient = (patient.ferritin !== undefined && patient.ferritin < 100)
        || (patient.tsat !== undefined && patient.tsat < 20);
    const results: ScoredRegimen[] = [];

    candidateSets.forEach(modSet => {
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

        // Binder rescue: if K+ > 5.3, try adding Patiromer
        if (sim.projectedPatient.potassium > 5.3 && patiromer) {
            const rescueMod: RegimenModification = {
                action: 'add',
                target: patiromer,
                summary: `Add ${patiromer.med.name} ${formatDose(patiromer)}`
            };
            const rescuedModSet: ModificationSet = {
                modifications: [...modSet.modifications, rescueMod],
                resulting_regimen: [...modSet.resulting_regimen, patiromer]
            };
            const rescuedSim = simulateModificationEffect(patient, rescuedModSet, prices);

            if (rescuedSim.projectedPatient.potassium < 5.3 && rescuedSim.projectedPatient.potassium > 3.5) {
                sim = rescuedSim;
                sim.warnings.push("Binder Required: Patiromer added to manage Hyperkalemia.");
                activeModSet = rescuedModSet;
            }
        }

        const p = sim.projectedPatient;

        const s_neuro = calculateNeurohormonalScore(p.nt_pro_bnp);
        const s_func = calculateFunctionalScore(p.nyha_class, p.kccq_score, p.daily_step_count);
        const s_vol = calculateVolumeScore(p.volume_status.dry_weight_kg, p.volume_status.current_weight_kg, p.volume_status.exam_findings, p.oxygen_saturation);
        const s_struc = calculateStructureScore(p.lvef, p.lvedd, p.lavi, patient.lvef, patient.lvedd, patient.lavi);
        const s_cost = calculateCostScore(sim.cost, patient.max_affordable_cost, patient.cost_sensitivity);
        const s_adhere = calculateAdherenceScore(sim.complexity, patient.complexity_tolerance);
        const s_guide = calculateGuidelineConcordanceScore(activeModSet.resulting_regimen, patient);

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

        // P5: Volume depletion — boost diuretic removal candidates
        if (isVolumeDepleted) {
            const hasDiureticRemoval = activeModSet.modifications.some(m =>
                m.action === 'remove' && m.source &&
                (m.source.med.drug_class === 'Loop Diuretic' || m.source.med.drug_class === 'Thiazide-like Diuretic')
            );
            if (hasDiureticRemoval) overall += 20;
        }

        // Safety penalties
        if (p.sbp < 85) overall = 0;
        else if (p.sbp < 90) overall -= 50;
        if (p.pulse < 50) overall -= 50;
        if (p.potassium > 5.5) overall -= 50;

        const dangerousWarnings = sim.warnings.filter(w =>
            !w.includes("Binder Required") && !w.includes("Elderly patient") &&
            !w.includes("Frail elderly") && !w.includes("Hepatic Impairment") &&
            !w.includes("Monitor: K+")
        );
        if (dangerousWarnings.length > 0) overall -= (dangerousWarnings.length * 10);

        results.push({
            regimen: activeModSet.resulting_regimen,
            projected_patient: p,
            baseline_lvef: patient.lvef,
            overall_score: Math.round(Math.max(0, overall)),
            domain_scores: {
                neurohormonal: Math.round(s_neuro),
                functional: Math.round(s_func),
                volume: Math.round(s_vol),
                structure: Math.round(s_struc),
                cost: Math.round(s_cost),
                adherence: Math.round(s_adhere),
                guideline: Math.round(s_guide)
            },
            special_feature_bonus: Math.round(normalizedSFBonus),
            cost: sim.cost,
            complexity: sim.complexity,
            rationale: sim.rationale,
            risks: [],
            warnings: sim.warnings,
            modification_set: activeModSet
        });
    });

    // 6. Affordability filter + distinct picks (same algorithm as before)
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];

    if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort((a, b) => b.overall_score - a.overall_score);
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

    const topPick = outputRegimens[0];
    if (!topPick) return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts };

    // S2: When hemodynamically unstable, return only the clinical alerts — no drug recommendations
    if (patient.sbp < 85) {
        return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts };
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

    return {
        scoredRegimens: distinctPicks,
        excludedMedications: excludedMeds,
        clinicalAlerts
    };
}
