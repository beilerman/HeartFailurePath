import { LOWER_CASE_OPENERS } from './engine/textCase';
import { MEDICATION_FORMULARY } from '../constants';
import { resolveAllergy } from './engine/allergy';
import { hasAngioedemaHistory } from './engine/intolerance';
import { classifyPhenotype as classifyPhenotypeForSwitch } from './engine/domains';
import { validateEngineInput } from './engine/inputContract';
import { isActiveExposure } from './engine/medicationExposure';
import { Patient, RegimenMed, SimulationOutput } from '../types';
import { blankIronInputsToUndefined, valueUnknown } from './clinicalPredicates';
import { runEligibilityStage, taggedDiscontinuedMeds } from './engine/eligibility';
import { getDoseTiers, clonePatient, dedupeCurrentRegimen, hasCongestion, loopDoseEffect, loopTotals, oralLoopFe } from './engine/regimenUtils';
import { auditInputs, raiseClinicalAlerts, checkSafetyHardStops, validatePhysiologicBounds, duplicateEntryAlert, withoutImplausibleValues } from './engine/gates';
import { sameClassAllergies, allergyViaComponentOnly } from './engine/intolerance';
import { assessDecisionReadiness, limitedInformationReview, needsDoseIntervalReview } from './engine/decisionReadiness';
import { analyzeCurrentRegimen, generateCandidateModifications } from './engine/candidates';
import { buildScoringContext, scoreCandidates, intensifiesRaasOrMra, labPrerequisiteBlank } from './engine/scoring';
import { selectWithRanking } from './engine/selection';
import { buildWhyFirst, adjunctNotShownReason, stopSentence, LIMIT_ZERO_SENTENCE, urgentAlertHeads, ADVISORY_ALERT_HEADS, withoutRehabilitationBesideInstability } from './engine/whyFirst';
import { pillarFamilyOf } from './engine/domains';
import { evidenceBandStatement } from './engine/outcomeBenefit';
import { PILLAR_LABELS } from './engine/explain';
import { URGENT_POTASSIUM_MONITORING, describeAdjunct, buildEligibleAdjunctEntries, assembleOutput, reconcilePlanAlerts, annotateGdmtGapsWithMraPotassium, annotateGdmtGapsWithRaasPotassium, urgentStateMonitoring, mergeUrgentMonitoring, stopPathPotassiumMonitoring } from './engine/explain';
import { settleOptionReferences, withPerfusionException, orderAlerts, lowPotassiumAlerts, elevatedPotassiumNoRaiserAlerts, elevatedPotassiumOnRaiserAlerts, POSSIBLE_POOR_PERFUSION_HEAD } from './engine/urgentStates';
import { allEnteredUrgentAlerts, forStopPath, onePerFinding, noMedicationChangeReadiness, monitoringWithoutMissingAlertReferences, missingAllergyNotes, allergyConflictAlerts } from './engine/stopPathAlerts';
import { CONGESTION_EXCESS_KG_ABOVE } from './engine/thresholds';
import { scopeStatusFor, SCOPE_HIDDEN_ALERT_HEADS } from './engine/scopeGate';

// Public facade: every symbol this module exported before the phase-4 split is re-exported here,
// so nothing outside services/ needs an import change.
export { isTargetDoseForPatient, getTargetDosePatientContext, clonePatient, hasCongestion } from './engine/regimenUtils';
export { isRenalOnlyContraindication, deriveIntolerancePolicy, currentMedIntoleranceReason } from './engine/intolerance';
export type { IntolerancePolicy } from './engine/intolerance';
export { MRA_POOL_CLASSES } from './engine/registry';
import { getMedicationClassGroup } from './engine/registry';
export {
    BNP_SCORE_TARGET, BNP_SCORE_CRITICAL, NYHA_SCORE_MAP, FUNCTIONAL_STEPS_FULL_CREDIT, VOLUME_SCORING,
    adherenceComplexityThreshold, calculateStructureScoreComponents, CONCORDANCE_TABLE, pillarKeyOf, pillarFamilyOf, classifyPhenotype,
    STRUCTURE_BLEND_WEIGHTS, DOMAIN_GOALS,
} from './engine/domains';
export type { PillarKey, PillarConcordance, Phenotype } from './engine/domains';
export { DISPLAY_FLOORS } from './engine/selection';
export { assessDecisionReadiness, knownUrgentFindings } from './engine/decisionReadiness';
export { BREASTFEEDING_NOT_ASSESSED, VISIT_LIMIT_WORDS } from './engine/thresholds';
export { HYPOTENSION_SBP_BELOW, MRA_START_K_MAX, MRA_START_K_CEILING, HYPOKALEMIA_K_BELOW, BB_HR_BELOW, SEVERE_CKD_EGFR_BELOW, LOW_OUTPUT } from './engine/thresholds';

/** U12: an alert is "HEADING: sentence"; the sentence begins with a capital letter (several builders wrote it in lower case after the heading). A text with no heading is left as written. */
export function capitalizeAlertBody(a: string): string {
    const m = /^([A-Z][A-Z0-9 ,'’()\/+.-]*[A-Z0-9)]): ([a-z])/.exec(a);
    // R7 W7: a body that opens with an abbreviation or unit written in lower or mixed case by convention (eGFR, mg, mmol, mEq, mmHg, bpm) keeps its case ("EGFR not entered" was wrong).
    if (m && LOWER_CASE_OPENERS.test(a.slice(m[1].length + 2))) return a;
    return m ? `${m[1]}: ${m[2].toUpperCase()}${a.slice(m[0].length)}` : a;
}

/**
 * THE engine entry point. Deterministic and side-effect free: given a patient (including
 * their current regimen), the set of formulary med names available for simulation, and a
 * price map, it:
 *   1. Separates invalid inputs from incomplete observations. Missing core observations
 *      yield a focused safety review; known urgent measurements remain visible. Full
 *      regimen generation still stops at implausible values, SBP < 90, K+ >= 6.5 or SBP <= DBP.
 *   2. Filters the formulary through allergy / intolerance-policy / contraindication /
 *      renal gates (recording every exclusion with its reason).
 *   3. Analyzes the current regimen (contraindicated / intolerable / redundant meds,
 *      titratable and swappable agents, missing pillars, eligible adjuncts).
 *   4. Generates candidate modification sets (add / titrate_up / titrate_down / swap /
 *      remove / keep) with forced cleanups injected, then simulates each candidate's
 *      MARGINAL delta from observed state and scores assessed domains using the selected
 *      eight-domain weight profile, plus named adjustments. Unassessed domains contribute
 *      no weight; the remaining weights are rescaled. No observation is imputed.
 *   5. Applies affordability + display-safety filters and returns <= 3 distinct picks with
 *      monitoring plans, qualitative projections, exclusions, alerts, and follow-up data.
 *
 * @param patient           Cloned internally — the caller's object is never mutated.
 * @param availableMedNames Formulary med names enabled for this simulation run (UI toggles).
 * @param prices            name → monthly cost map from pricingService.getDrugPrices.
 */
/** R9 Z3: when removing a duplicate loop diuretic lowers the total oral loop dose, the duplicate-therapy alert states the total with both and with the one kept (computed from the regimen). */
function loopDuplicateTotals(kept: RegimenMed, removed: RegimenMed[]): string {
    if (kept.med.drug_class !== 'Loop Diuretic') return '';
    const both = oralLoopFe([kept, ...removed]), only = oralLoopFe([kept]);
    return only < both - 1e-9 ? ` Taking ${removed.length === 1 ? 'both' : removed.length === 2 ? 'all three' : `all ${removed.length + 1}`}, the total oral loop diuretic dose is about ${Math.round(both * 10) / 10} mg of furosemide a day; with only ${kept.med.name} kept it would be about ${Math.round(only * 10) / 10}.` : '';
}
export function generateAndScoreModifications(
    patient: Patient,
    availableMedNames: Set<string>,
    prices: Record<string, number>
): SimulationOutput {
    const scope = scopeStatusFor(patient);
    const out0 = runEngine(patient, availableMedNames, prices);
    // R7 W7: the hold alert's clause about a switch to sacubitril/valsartan is true only where the tool would offer that switch for this patient: a reduced-EF upgrade (candidates.ts), with the
    // drug neither excluded, nor allergic, nor barred by an angioedema history. Applied to every output (a stop path never reaches the option stage).
    const switchClause = ', and before any switch to sacubitril/valsartan (a switch is held at the same potassium)';
    const arniNames = MEDICATION_FORMULARY.filter(m => m.drug_class === 'ARNI').map(m => m.name);
    // Read only when a hold alert is present, and never allowed to fail a run: a malformed patient has been refused by the input contract already (no hold alert) and reads as "no clause removed".
    const switchOffered = (): boolean => { try {
        return classifyPhenotypeForSwitch(patient) !== 'HFpEF' && !hasAngioedemaHistory(patient)
            && !out0.excludedMedications.some(e => arniNames.includes(e.name)) && ![...(patient.allergies ?? [])].some(a => resolveAllergy(a, MEDICATION_FORMULARY).some(n => arniNames.includes(n)));
    } catch { return true; } };
    const hasHold = out0.clinicalAlerts.some(a => a.startsWith('POTASSIUM HOLD ON') && a.includes(switchClause));
    const dropClause = hasHold && !switchOffered();
    // R10 A10: at potassium 5.5 to 5.9 on a renin-angiotensin drug or MRA, at least one alert names the value even when every per-drug potassium alert is skipped (each such drug is removed in every
    // option for another reason, or no option is shown). The same advisory sentence as the no-raiser alert, worded for a patient who takes such a drug. Alert only: no option changes.
    const withPotassiumNamed = (list: string[]): string[] => { try { const extra = elevatedPotassiumOnRaiserAlerts(patient, list); return extra.length ? orderAlerts([...list, ...extra], ADVISORY_ALERT_HEADS) : list; } catch { return list; } };
    const alerts0 = withPotassiumNamed(withoutRehabilitationBesideInstability(out0.clinicalAlerts)).map(a => (dropClause && a.startsWith('POTASSIUM HOLD ON') ? a.replace(switchClause, '') : a));
    // R7 W13a: a screen that proposes nothing still answers a typed allergy entry.
    const noteList = (): string[] => { try { return missingAllergyNotes(patient, alerts0); } catch { return []; } };
    // R8 X11d: a drug taken and recorded as an allergy is always flagged, whichever path ended the run.
    const conflicts = (): string[] => { try { return allergyConflictAlerts(patient, alerts0); } catch { return []; } };
    const withConflicts = (list: string[]): string[] => { const c = conflicts(); return c.length === 0 ? list : orderAlerts([...c, ...list], ADVISORY_ALERT_HEADS); };
    const out = { ...out0, clinicalAlerts: out0.scoredRegimens.length === 0 ? withConflicts([...alerts0, ...noteList()]) : withConflicts(alerts0) };
    // A monitoring row that points at the hypoxia alert is never shown without that alert on the screen (W1).
    // R6 V5: the same for every alert a monitoring row points at (low blood pressure, heart block, potassium emergency): a row never says "see the ... alert" for an alert that is not on the screen.
    const monitoringPlan = monitoringWithoutMissingAlertReferences(out.monitoringPlan, out.clinicalAlerts);
    if (scope.state === 'outside') {
        // The tool has said it cannot judge therapy for this patient: no prompt that proposes therapy or assesses indication, and no "what can be assessed" wording (W5).
        const headOf = (a: string) => { const k = a.indexOf(': '); return k > 0 ? a.slice(0, k) : a.slice(0, 40); };
        return { ...out, monitoringPlan, clinicalAlerts: out.clinicalAlerts.filter(a => !SCOPE_HIDDEN_ALERT_HEADS.includes(headOf(a))).map(capitalizeAlertBody), gdmtGaps: [], eligibleAdjuncts: [], missingDataNotices: [], decisionReadiness: undefined, scope_status: scope };
    }
    return { ...out, monitoringPlan, clinicalAlerts: out.clinicalAlerts.map(capitalizeAlertBody), scope_status: scope };
}

function runEngine(
    patient: Patient,
    availableMedNames: Set<string>,
    prices: Record<string, number>
): SimulationOutput {

    const input = validateEngineInput(patient);
    // The stop sentence names the alerts raised BY the stage that stopped the run (those not present before it); when the stage raised none, every urgent alert in force.
    const withStop = (out: SimulationOutput, before: ReadonlySet<string> | number, limited = false): SimulationOutput => {
        const fresh = out.clinicalAlerts.filter(a => typeof before === 'number' || !before.has(a));
        const named = urgentAlertHeads(fresh).length > 0 ? fresh : out.clinicalAlerts;
        // Every stop state carries its own monitoring item (T24), and no alert points at "the options below" when none is shown (T18).
        // R6 V5: no medication change is proposed, so no therapy prompt (eligible adjuncts) is shown and the readiness text says so.
        const finalAlerts = orderAlerts(onePerFinding([...new Set(settleOptionReferences(out.clinicalAlerts, false).map(forStopPath))]), ADVISORY_ALERT_HEADS);
        return { ...out, eligibleAdjuncts: [], excludedMedications: out.excludedMedications.map(e => ({ ...e, reason: forStopPath(e.reason), ...(e.why ? { why: e.why.map(forStopPath) } : {}) })), ...(out.decisionReadiness ? { decisionReadiness: noMedicationChangeReadiness(out.decisionReadiness) } : {}), clinicalAlerts: finalAlerts, monitoringPlan: mergeUrgentMonitoring(out.monitoringPlan, [...urgentStateMonitoring(patient), ...stopPathPotassiumMonitoring(patient)]), why_first: { options: [], gaps: [], stop: stopSentence(named, limited) } };
    };
    // Every stop path keeps the urgent alerts the entered values justify (T16): the focused findings (pressure, potassium, oxygen) and the unstable states, heart block and slow rate.
    const urgentFromEntered = (p: Patient): string[] => allEnteredUrgentAlerts(p);
    if (input.errors.length > 0) return withStop({ scoredRegimens: [], excludedMedications: [], clinicalAlerts: [...urgentFromEntered(patient), ...input.errors], monitoringPlan: [] }, 0);
    const clinicalAlerts: string[] = [];
    patient = clonePatient(patient);
    blankIronInputsToUndefined(patient);
    // The same drug entered twice is resolved BEFORE the use records are read, so the kept use record (the more cautious one) never depends on entry order (U5).
    const resolved = dedupeCurrentRegimen(input.regimen);
    if (resolved.duplicateNames.length > 0) clinicalAlerts.push(duplicateEntryAlert(resolved));
    patient.recorded_medication_exposures = resolved.regimen;
    patient.current_regimen = resolved.regimen.filter(isActiveExposure);
    for (const r of resolved.regimen.filter(r => !isActiveExposure(r)).sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0)) clinicalAlerts.push(`EXPOSURE HISTORY: ${r.med.name} is recorded as ${r.exposure!.status}. It is not counted as active therapy. Recorded physiology is preserved; no loss of benefit is back-calculated. Confirm the course, or whether to restart, before a new dose.`);
    const unconfirmedUse = patient.current_regimen.filter(r => r.exposure?.status !== 'active' || r.exposure?.adherence !== 'consistent');
    if (unconfirmedUse.length) clinicalAlerts.push(`MEDICATION USE REVIEW: Confirm actual current dose and consistent use before increasing or substituting ${unconfirmedUse.map(r => r.med.name).sort().join(', ')}. Safety-driven reductions/removals and unrelated eligible decisions remain assessable. Treatment duration and individual response are not inferred.`);
    clinicalAlerts.push(...lowPotassiumAlerts(withoutImplausibleValues(patient)));
    clinicalAlerts.push(...elevatedPotassiumNoRaiserAlerts(withoutImplausibleValues(patient)));
    const intervalUnreviewed = patient.current_regimen.filter(r => needsDoseIntervalReview(patient,r));
    if (intervalUnreviewed.length) clinicalAlerts.push(`DOSE TIMING REVIEW: Before increasing ${intervalUnreviewed.map(r=>r.med.name).sort().join(', ')}, assess the drug-specific interval at the current dose and tolerance. Dates alone do not establish readiness; other eligible decisions remain available.`);
    const decisionReadiness = assessDecisionReadiness(patient);
    const withReadiness = (output: SimulationOutput): SimulationOutput => ({ ...output, decisionReadiness });
    if (decisionReadiness.mode === 'limited_review') {
        const review = limitedInformationReview(patient, decisionReadiness);
        review.clinicalAlerts.unshift(...clinicalAlerts, ...validatePhysiologicBounds(patient));
        return withStop(review, 0, true);
    }

    // 1. Audit inputs: duplicates, missing/implausible data, unknown LVEF, SBP <= DBP (alerts-only hard stops).
    const alertsBeforeAudit = new Set(clinicalAlerts);
    const audit = auditInputs(patient, clinicalAlerts);
    if (audit.stop) {
        // An implausible value is a probable typing error: its own alert says so, so the focused findings (which would read the typo as a measurement) are not added.
        // Every urgent alert the entered values justify is raised (W3); an exact repeat of one the audit already raised is not added again.
        const have = new Set(audit.stop.clinicalAlerts);
        audit.stop.clinicalAlerts.unshift(...urgentFromEntered(patient).filter(a => !have.has(a)));
        return withStop(withReadiness(audit.stop), alertsBeforeAudit);
    }
    const { dataAudit, missingDataNotices } = audit;
    let gdmtGaps = audit.gdmtGaps;

    // Scope gate (policy, scopeGate.ts): the alert leads the list on every later path.
    const scope = scopeStatusFor(patient);
    if (scope.state === 'outside') clinicalAlerts.unshift(scope.text);

    // 2. Raise the alert-only gates (pregnancy, low output, referrals, volume depletion, ...).
    const flags = raiseClinicalAlerts(patient, dataAudit, clinicalAlerts);

    // 3. Hard safety stops: SBP < 90 or K+ >= 6.5 returns alerts only.
    const alertsBeforeStops = new Set(clinicalAlerts);
    const hardStop = checkSafetyHardStops(patient, clinicalAlerts, gdmtGaps, missingDataNotices);
    if (hardStop) return withStop(withReadiness(hardStop), alertsBeforeStops);

    // Scope gate (policy): a ticked condition the trials did not study means no ranked option; every alert about the current regimen above still stands.
    if (scope.state === 'outside') {
        return withStop(withReadiness({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: patient.potassium >= 6.0 ? [URGENT_POTASSIUM_MONITORING] : [], gdmtGaps, eligibleAdjuncts: [], missingDataNotices, followUpCalendar: [] }), new Set<string>(clinicalAlerts));
    }

    // 4. Eligibility: numbered rules withhold drugs (allergy, intolerance, contraindication, renal) with a reason.
    const { formulary, excludedMeds, intolerancePolicy, allBBExcluded, allRAASExcluded, unresolvedFoundationalClass } =
        runEligibilityStage(patient, dataAudit.unknownRenal, availableMedNames, clinicalAlerts);

    gdmtGaps = annotateGdmtGapsWithRaasPotassium(annotateGdmtGapsWithMraPotassium(gdmtGaps, excludedMeds), excludedMeds);

    // 5. Enumerate: dose tiers -> analyze the current regimen -> candidate modifications (add/titrate/swap/remove/keep).
    const medTiers = formulary.flatMap(m => getDoseTiers(m, patient));
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers, allBBExcluded, allRAASExcluded, unresolvedFoundationalClass);
    // Criteria-met adjuncts to surface regardless of whether they rank in the top picks —
    // prevents a guideline-indicated add-on (e.g. A-HeFT H/ISDN, SHIFT ivabradine) from being
    // silently absent just because the composite score favored other changes.
    const adjunctEntries = buildEligibleAdjunctEntries(analysis.addableAdjuncts, patient);
    let eligibleAdjuncts = adjunctEntries.map(e => e.label);
    // Duplicate agents of one class (S5): say which was kept and why, and ask the clinician to confirm which one the patient actually takes.
    analysis.duplicateNotes.forEach(n => clinicalAlerts.push(
        `DUPLICATE THERAPY: the regimen lists more than one ${n.group} (${[n.kept, ...n.removed].map(r => r.med.name).sort().join(' and ')}). The duplicate clean-up treats ${n.kept.med.name} as the one to keep and ${n.removed.map(r => r.med.name).join(', ')} as the duplicate to remove because ${n.basis}. What each option does with each drug is on its change lines. Confirm which one the patient actually takes before acting.${loopDuplicateTotals(n.kept, n.removed)}`));
    const candidateSets = generateCandidateModifications(analysis, patient);

    // Laboratory prerequisite (rule E16 + candidate drop): say once, not per candidate, that RAAS/MRA starts and
    // dose increases are withheld because potassium or renal function is blank.
    if (labPrerequisiteBlank(dataAudit) &&
        (excludedMeds.some(m => m.rule_id === 'E16') || candidateSets.some(intensifiesRaasOrMra))) {
        clinicalAlerts.push('LABS REQUIRED: potassium/renal function not entered — RAAS inhibitor and MRA starts and dose increases are withheld until a basic metabolic panel is available. Enter labs that reflect the patient\'s current medications and clinical state.');
    }

    // 6. Score: rescue appends -> simulate -> 8 domain scores -> weights + named adjustments -> ScoredRegimen.
    const scoringContext = buildScoringContext(patient, prices, intolerancePolicy, dataAudit, formulary, medTiers, analysis, flags);
    const results = scoreCandidates(candidateSets, scoringContext);

    // 7. Rank and select: affordability filter/fallback, display-safety floors, <= 3 distinct picks.
    const alertsBeforeSelection = new Set(clinicalAlerts);
    const { picks, trace: selection } = selectWithRanking(results, patient, clinicalAlerts);
    // R8 X11c: a drug the options would have started but that fails its own contraindication check on the regimen the option produces is named in the withheld list with that reason
    // (unless it is already withheld, or a displayed option does start it).
    [...analysis.startRuleDrops.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([name, reason]) => {
        if (excludedMeds.some(e => e.name === name) || picks.some(r => (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.name === name))) return;
        const med = MEDICATION_FORMULARY.find(x => x.name === name);
        excludedMeds.push({ name, drug_class: med?.drug_class ?? '', rule_id: 'E13', rule_name: 'Clinical contraindication', reason: `${reason}, which applies to the regimen an option that starts it would produce`, why: [`${reason}: the drug's own check fails on the regimen an option that starts it would produce`] });
    });
    // R8 X6e: an allergy to an angiotensin receptor blocker of unstated type puts the allergy check on sacubitril/valsartan (it contains valsartan), and the check can keep it out of every option shown. The
    // withheld list says so, with the check and what to do about it, instead of leaving the drug silently absent.
    formulary.filter(m => m.drug_class === 'ARNI').forEach(m => {
        const listed = sameClassAllergies(patient, m);
        if (listed.length === 0 || !allergyViaComponentOnly(patient, m)) return;
        if (excludedMeds.some(e => e.name === m.name) || picks.some(r => (r.modification_set?.modifications ?? []).some(x => (x.action === 'add' || x.action === 'swap') && x.target?.med.name === m.name))) return;
        excludedMeds.push({ name: m.name, drug_class: m.drug_class, rule_id: 'E02', rule_name: 'Patient-reported allergy',
            reason: `Not in an option shown: an allergy to ${listed.length > 2 ? `${listed.slice(0, 2).join(', ')} and others` : listed.join(' and ')} is recorded without the type of reaction, and ${m.name.replace(/\s*\(.*\)/, '')} contains valsartan, an angiotensin receptor blocker, so it carries the allergy check. Confirm what the reaction was; if it was not to valsartan, the drug can be considered` });
    });
    // An empty result always states a reason. The display-floor case raises NO DISPLAY-SAFE in selection; every other route to "no options" is named here
    // (review 3: a forced beta-blocker switch in a low-output state left an empty page with only unrelated alerts).
    if (picks.length === 0 && !clinicalAlerts.some(a => a.startsWith('NO DISPLAY-SAFE') || a.startsWith('NO REGIMEN CHANGE SHOWN'))) {
        clinicalAlerts.push(`NO REGIMEN CHANGE SHOWN: no change to the current regimen, and not the current regimen itself, passed this tool's rules for this patient (${candidateSets.length} candidate regimens built, ${results.length} scored). ` +
            `${Math.round(patient.max_new_classes_per_visit ?? 2) <= 0 ? `${LIMIT_ZERO_SENTENCE} ` : ''}This is a limit of the tool, not a statement that nothing should be done: review the alerts above and the withheld drugs with their reasons, and decide clinically.`);
    }
    if (picks.length === 0) return withStop(withReadiness({ scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [] }), alertsBeforeSelection);

    // The congestion display rule (S1, POLICY, not a ranking factor): in acute decompensation or the cold state, a congested patient's options all carry a loop diuretic step when one is
    // eligible (candidates.ts); when none is eligible each option says why.
    const un = analysis.unstable;
    if ((un.decompensated || un.cold) && un.congested) {
        picks.forEach((r, i) => {
            // R10 A5: the note is not shown on an option that starts, switches to or raises a loop diuretic (it would contradict the option).
            const callsLoop = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic');
            if (!un.loopStep) { if (!callsLoop) picks[i] = { ...r, warnings: [`Drug note: No oral loop diuretic start or increase is available today: ${un.loopUnavailableReason}.`, ...r.warnings] }; }
            else if (r.modification_set?.loop_step_omitted) picks[i] = { ...r, warnings: [`Drug note: No loop diuretic step is included in this option: ${r.modification_set.loop_step_omitted}.`, ...r.warnings] };
        });
    } else if (un.loopHeldForWeightWithFindings) {
        // R5 Y3: congestion on examination at a weight not above the threshold: say why no diuretic is offered, in every state (the same reason text as above).
        picks.forEach((r, i) => { picks[i] = { ...r, warnings: [`Drug note: No loop diuretic start or increase is available today: a new loop diuretic is started only when the weight is more than ${CONGESTION_EXCESS_KG_ABOVE} kg above dry weight.`, ...r.warnings] }; });
    }

    // R10 A3: an option whose resulting regimen has no loop diuretic, for a patient with recorded congestion, says so with the true cause (the rule that withheld a replacement). Information only:
    // added after scoring, no score and no order changes.
    if (hasCongestion(patient)) {
        const oralLoops = MEDICATION_FORMULARY.filter(m => m.drug_class === 'Loop Diuretic' && !m.facts?.short_course_addon);
        const allergic = (n: string) => patient.allergies.has(n) || excludedMeds.some(e => e.name === n && e.rule_id === 'E02');
        const plain = (n: string) => n.replace(/\s*\(.*\)/, '');
        picks.forEach((r, i) => {
            if (r.regimen.some(x => x.med.drug_class === 'Loop Diuretic')) return;
            const unconfirmedLoops = unconfirmedUse.filter(x => x.med.drug_class === 'Loop Diuretic' && !x.med.facts?.short_course_addon && !r.regimen.some(y => y.med.name === x.med.name)).map(x => plain(x.med.name).toLowerCase()).sort();
            const cause = un.potassiumEmergency ? 'a loop diuretic is not started while potassium is 6.0 or above'
                : patient.potassium > 0 && patient.potassium < 3.5 ? 'a loop diuretic is not started while potassium is below 3.5'
                : oralLoops.every(m => allergic(m.name)) ? 'every loop diuretic is excluded by the recorded allergies'
                : unconfirmedLoops.length > 0 ? `a replacement is offered once it is confirmed whether the patient takes ${unconfirmedLoops.join(' and ')}`
                : !un.loopStep && un.loopUnavailableReason ? un.loopUnavailableReason : '';
            picks[i] = { ...r, warnings: [`This option leaves the patient without a loop diuretic although congestion is recorded${cause ? `: ${cause}` : ''}.`, ...r.warnings] };
        });
    }

    // R8 X13 / X4: an oral loop step is said for what it is. (a) A raise with no recorded congestion: the tool holds a loop increase only at or below the recorded dry weight with no congestion finding, so a
    // weight a little above dry weight does not hold it; the option says that, because nothing else gives a reason. (b) A step that comes with the clean-up of a duplicate loop entry leaves the total loop
    // dose unchanged (one drug replaces two); the option says so. Both are information added after scoring: no score and no order changes.
    picks.forEach((r, i) => {
        const mods = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        const stepsUp = mods.some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon);
        if (!stepsUp) return;
        const effect = loopDoseEffect(patient, r);
        const mgFe = (n: number) => `${Math.round(n * 10) / 10}`;
        if (effect !== 'raises') {
            // R9 Z3: the totals are computed from the regimen before and the regimen the option produces; "unchanged" only when they are equal; a removal is named by its real reason.
            const { before, after } = loopTotals(patient, r);
            const oral = (m: { source?: RegimenMed; target?: RegimenMed }) => { const x = m.source ?? m.target; return !!x && x.med.drug_class === 'Loop Diuretic' && !x.med.facts?.short_course_addon; };
            const step = mods.find(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon)!;
            const others = mods.filter(m => m !== step && oral(m) && m.source).map(m => {
                const nm = m.source!.med.name.replace(/\s*\(.*\)/, '');
                return m.action === 'remove' ? `${nm} is removed (${m.duplicate_cleanup ? 'the duplicate entry' : m.mandatory ? 'for the safety reason on its change line' : 'by this option'})` : m.action === 'titrate_down' ? `${nm} is lowered` : `${nm} is switched`;
            });
            const stepName = step.target!.med.name.replace(/\s*\(.*\)/, '');
            const detail = `${stepName} is raised${others.length ? ` and ${others.join(' and ')}` : ''}`;
            picks[i] = { ...r, warnings: [effect === 'unchanged'
                ? `Drug note: The loop diuretic step in this option leaves the total oral loop diuretic dose unchanged at about ${mgFe(before)} mg of furosemide a day: ${detail}.`
                : `Drug note: The loop diuretic step in this option lowers the total oral loop diuretic dose, from about ${mgFe(before)} to about ${mgFe(after)} mg of furosemide a day: ${detail}.`, ...r.warnings] };
        } else if (effect === 'raises' && !hasCongestion(patient)) {
            const known = !valueUnknown(patient.volume_status.current_weight_kg) && !valueUnknown(patient.volume_status.dry_weight_kg);
            const kg = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
            const where = known ? `the weight is ${kg.toFixed(1)} kg above the recorded dry weight, which is not more than ${CONGESTION_EXCESS_KG_ABOVE.toFixed(1)} kg, and no congestion finding is recorded` : 'the weight or the dry weight is not entered, and no congestion finding is recorded';
            picks[i] = { ...r, warnings: [`Drug note: This option raises the loop diuretic although no congestion is recorded (${where}). The tool holds a loop increase only when the weight is at or below the recorded dry weight with no congestion finding, so this increase was not held. Confirm that a higher dose is wanted.`, ...r.warnings] };
        }
    });

    // R8 X8b: the low-baseline-pressure caution (ARNI AT LOW BASELINE SBP, effects.ts) is written for a START. A RAISE of sacubitril/valsartan at the same pressure gets the same information as a note:
    // added after scoring, so no score and no order changes.
    if (patient.sbp > 0 && patient.sbp < 100) {
        picks.forEach((r, i) => {
            const raises = (r.modification_set?.modifications ?? []).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'ARNI');
            const starts = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI');
            if (raises && !starts && !r.warnings.some(w => w.startsWith('ARNI AT LOW BASELINE SBP'))) picks[i] = { ...r, warnings: [`Drug note: this option raises sacubitril/valsartan at a systolic pressure of ${patient.sbp} mmHg. PARADIGM-HF excluded a systolic pressure below 100 (a trial criterion; the label sets no systolic threshold). Ask about symptoms of low blood pressure, correct any volume or salt depletion first, and recheck blood pressure and kidney function within 1-2 weeks.`, ...r.warnings] };
        });
    }

    // R6 V11: with the possible-poor-perfusion alert on the screen, an option that starts a drug or raises a dose says that perfusion is assessed first. It is added AFTER scoring, so it is information:
    // it changes no score and no order (the alert itself leaves the options unchanged by design).
    if (clinicalAlerts.some(a => a.startsWith(POSSIBLE_POOR_PERFUSION_HEAD))) {
        picks.forEach((r, i) => {
            const calls = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target);
            if (calls) picks[i] = { ...r, warnings: [`POOR PERFUSION CHECK: the findings recorded can indicate poor perfusion (see the possible poor perfusion alert). Assess perfusion before starting or raising a drug in this option.`, ...r.warnings] };
        });
    }

    // T28: in the poor-perfusion state the one start the rule keeps is a beta-blocker that must stop for a safety reason (allergy, pregnancy, a contraindication, an intolerance): stopping it
    // outright is abrupt withdrawal, so it is replaced by another agent at that agent's lowest starting dose (a large reduction in beta-blocker dose). The option and the alert say so.
    if (un.cold) {
        let exceptionShown = false;
        picks.forEach((r, i) => {
            const m = (r.modification_set?.modifications ?? []).find(x => x.action === 'swap' && x.mandatory && x.source?.med.drug_class === 'Beta Blocker' && x.target);
            if (!m) return;
            exceptionShown = true;
            const why = analysis.intolerableCurrentMeds.get(m.source!.med.name) ?? analysis.contraindicationReasonByName.get(m.source!.med.name) ?? 'a safety rule applies to it';
            picks[i] = { ...r, warnings: [`Drug note: Poor perfusion exception: no drug is started in this state, but ${m.source!.med.name} must stop for a safety reason (${why}), and stopping a beta-blocker abruptly is itself harmful. This option replaces it with ${m.target!.med.name} at its lowest starting dose, which is a large reduction in beta-blocker dose. Reassess heart rate, blood pressure and perfusion after the change.`, ...r.warnings] };
        });
        if (exceptionShown) { const swapped = withPerfusionException(clinicalAlerts); clinicalAlerts.length = 0; clinicalAlerts.push(...swapped); }
    }

    // 8. Explain: monitoring plan, projections, trade-offs, low-output cap, follow-up calendar.
    // A class that a displayed option starts is not also listed as an adjunct that is not in an option (W7b).
    // W3: a line about a class is not shown when the patient already takes a drug of the class or an option shown starts, switches to or RAISES one; a line that names one specific
    // different drug (Furoscix) is dropped only when an option shown starts that drug.
    const modsShown = picks.flatMap(r => r.modification_set?.modifications ?? []);
    const startedGroups = new Set(modsShown.filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target).map(m => getMedicationClassGroup(m.target!.med.drug_class)));
    const startedNames = new Set(modsShown.filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => m.target!.med.name));
    const takenGroups = new Set(patient.current_regimen.map(r => getMedicationClassGroup(r.med.drug_class)));
    eligibleAdjuncts = adjunctEntries.filter(e => e.specific ? ![...e.names].some(n => startedNames.has(n)) : ![...e.groups].some(g => startedGroups.has(g) || takenGroups.has(g))).map(e => e.label);
    const reconciled = reconcilePlanAlerts(clinicalAlerts, picks, patient);
    clinicalAlerts.length = 0; clinicalAlerts.push(...reconciled);
    const assembled = withReadiness(assembleOutput(patient, picks, flags.lowOutput, { excludedMeds, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices }));
    const familyLabel = (cls: string): string => { const k = pillarFamilyOf(cls); return k === 'RAAS' ? 'RAAS inhibitors' : k === 'BB' ? 'beta-blockers' : k === 'MRA' ? 'mineralocorticoid receptor antagonists' : k === 'SGLT2i' ? 'SGLT2 inhibitors' : cls; };
    const whyFirst = buildWhyFirst({
        patient, candidates: results, picks: assembled.scoredRegimens, eligibleFormulary: formulary, excludedMeds, gdmtGaps,
        unconfirmedUse: unconfirmedUse.map(r => r.med.name).sort(), doseTimingReview: intervalUnreviewed.map(r => r.med.name).sort(),
        urgentAlertHeads: urgentAlertHeads(clinicalAlerts), selection,
    }, { RAAS: PILLAR_LABELS['RAAS Inhibitor'], BB: PILLAR_LABELS['Beta Blocker'], MRA: PILLAR_LABELS['MRA'], SGLT2i: PILLAR_LABELS['SGLT2i'] }, familyLabel);
    // R6 V15a: an eligible adjunct that no option carries says why (the patient met the tool's own criteria for it).
    const whyCtx = { patient, candidates: results, picks: assembled.scoredRegimens, eligibleFormulary: formulary, excludedMeds, gdmtGaps, unconfirmedUse: [], doseTimingReview: [], urgentAlertHeads: [], selection } as Parameters<typeof adjunctNotShownReason>[0];
    const adjunctNames = new Map<string, string[]>();
    analysis.addableAdjuncts.forEach(r => { const label = describeAdjunct(r.med, patient); adjunctNames.set(label, [...(adjunctNames.get(label) ?? []), r.med.name]); });
    const eligibleWithReasons = (assembled.eligibleAdjuncts ?? []).map(label => {
        const why = adjunctNames.has(label) ? adjunctNotShownReason(whyCtx, adjunctNames.get(label)!) : null;
        return why ? `${label.replace(/\.$/, '')}. Not in an option shown: ${why}.` : label;
    });
    const ordered = { ...assembled, eligibleAdjuncts: eligibleWithReasons, clinicalAlerts: orderAlerts(assembled.clinicalAlerts, ADVISORY_ALERT_HEADS), evidence_band: evidenceBandStatement(patient) };
    return whyFirst ? { ...ordered, why_first: whyFirst } : ordered;
}

export { medicationEffectContext } from './engine/treatmentAssessment';
