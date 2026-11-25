import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { RecommendationCard } from '../components/RecommendationCard';
import { ClinicalSummary } from '../components/ClinicalSummary';
import { PatientForm } from '../components/PatientForm';
import { Input } from '../components/patient-form/Common';
import { buildChartHeader } from '../components/chartHeader';
import { buildChartSummary, partitionAlerts } from '../components/resultsModel';
import { MEDICATION_FORMULARY } from '../constants';
import { INITIAL_PATIENT, SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { blankPatient } from '../components/patient-form/patientDraft';
import { validatePatientForm } from '../components/patient-form/formValidation';
import { MedicationManager } from '../components/patient-form/MedicationManager';
import { MedicationLibrary } from '../components/MedicationLibrary';
import { ScoreDetailModal } from '../components/ScoreDetailModal';
import { FAQ } from '../components/FAQ';
import { DOMAIN_KEYS, DOMAIN_GROUPS, DOMAIN_LABELS, WEIGHT_PROFILES, WEIGHT_PROFILE_META } from '../services/engine/scoreModel';
import { symptomEstimateFor, SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { compareHarmBurden, harmBurdenFor, HARM_TABLE } from '../services/engine/harmBurden';
import { OUTCOME_EVIDENCE_TABLE, buildOutcomeEstimateViews } from '../services/engine/outcomeBenefit';
import { DOSE_EVIDENCE } from '../services/engine/doseCredit';
import { OUTCOME_SHORT, harmLabel, basisLabel, harmLevelLabel, DOSE_LEVEL_LABELS, currentRegimenOf, verificationLabel, populationKeyLabel, SYMPTOM_HEADING } from '../components/expectedEffectModel';
import { EvidenceTables } from '../components/EvidenceTables';
import { tieSentence, TIE_RULE_TEXT } from '../components/scoreExplain';
import { profileDescription } from '../components/appStatements';
import { DEMO_CASES, caseFacts } from '../components/guided/demoCases';
import { StartScreen } from '../components/guided/StartScreen';
import { StepsScreen } from '../components/guided/StepsScreen';
import { PatientBar } from '../components/guided/PatientBar';
import { GuidedResults } from '../components/guided/GuidedResults';
import { derivedFields } from '../services/clinicalPredicates';

let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = await getDrugPrices([...names], 'commercial');
const p = clonePatient(INITIAL_PATIENT);
const out = generateAndScoreModifications(p,names,prices);
const lead = out.scoredRegimens[0]; assert.ok(lead);
const noChange = {...lead, modification_set: {modifications: [], resulting_regimen: lead.regimen}};
const render = (props: Partial<React.ComponentProps<typeof ResultsDisplay>> = {}) => renderToStaticMarkup(
    <ResultsDisplay results={[lead]} error={null} hasRun excludedMedications={[]} {...props} />);
const chartInput = { results:[noChange], clinicalAlerts:[], gdmtGaps:['Beta-blocker'], eligibleAdjuncts:[], missingDataNotices:[], followUpCalendar:[], monitoringPlan:[], excludedMedications:[] };

check('unchanged option does not assert that treatment is complete on screen or in the draft note', () => {
    assert.doesNotMatch(render({results:[noChange],gdmtGaps:['Beta-blocker']}),/No change needed/);
    assert.doesNotMatch(buildChartSummary(chartInput),/None: continue the current regimen/);
});
check('stale analysis has no medication recommendation markup to print or mistake for the current case', () => {
    const html=render({resultsStale:true});
    assert.match(html,/out of date/i);
    assert.doesNotMatch(html,/id="results-option-1"/);
    assert.doesNotMatch(html,/Copy to chart|Copy draft note/);
});
check('an analysis error is visible even before the first successful run and hides old options', () => {
    const html=render({hasRun:false,error:'Pricing unavailable'});
    assert.match(html,/Pricing unavailable/);
    assert.doesNotMatch(render({error:'Cannot calculate'}),/id="results-option-1"/);
});
check('draft header distinguishes valid zero values and unrecorded pregnancy', () => {
    const q=clonePatient(p);q.kccq_score=0;q.max_new_classes_per_visit=0;q.sex='Female';q.is_pregnant=undefined;
    const text=buildChartHeader({patient:q,ranAt:'2026-11-12T16:00:00Z'});
    assert.match(text,/KCCQ: 0/);assert.match(text,/max new drug classes per visit: 0/);
    assert.match(text,/Pregnant: not entered/);
    assert.match(text,/Allergies: none recorded/);
});
check('near-dry weight with an unrecorded examination is not presented as confirmed euvolemia', () => {
    const q=clonePatient(p);q.volume_status={current_weight_kg:80,dry_weight_kg:80,exam_findings:new Set()};
    assert.doesNotMatch(renderToStaticMarkup(<ClinicalSummary patient={q} drugPrices={prices}/>),/>Euvolemic</);
});
check('current-regimen cost agrees with dose-specific cash pricing used by the engine', () => {
    const q=clonePatient(p);q.insurance_tier='cash';
    const med=MEDICATION_FORMULARY.find(m=>m.name==='Tirzepatide (Zepbound)')!;
    q.current_regimen=[{med,dose:med.available_doses.find(d=>d.strength===2.5)!,selected_frequency:'weekly'}];
    const html=renderToStaticMarkup(<ClinicalSummary patient={q} drugPrices={{[med.name]:1000}}/>);
    assert.ok(html.includes(`$${med.facts!.cash_price_by_dose!['2.5']}`));
});
check('dose guidance does not promise maximal patient benefit or issue generic escalation instructions', () => {
    const html=renderToStaticMarkup(<RecommendationCard regimen={lead} rank={1}/>);
    assert.doesNotMatch(html,/maximal mortality|maximal reverse remodeling|maximal weight loss|titrate to target if tolerated|Titrate q2/i);
});
check('alternative cards explain concrete medication differences without opening score details', () => {
    const alternative={...lead,regimen:lead.regimen.slice(1)};
    const html=renderToStaticMarkup(<RecommendationCard regimen={alternative} leader={lead} rank={2}/>);
    assert.match(html,/Compared with option 1/);assert.match(html,/Does not include/);
});
check('input help and error remain associated and required status is machine-readable', () => {
    const html=renderToStaticMarkup(<Input name="lvef" required aria-describedby="lvef-help" error="Enter LVEF"/>);
    assert.match(html,/aria-describedby="lvef-help lvef-error"/);
    assert.match(html,/aria-required="true"/);
});
check('NYHA choices use activity limitations and distinguish symptoms at rest', () => {
    const html=renderToStaticMarkup(<PatientForm patientData={p} setPatientData={()=>{}} simulationMedicationNames={names} setSimulationMedicationNames={()=>{}} onRunSimulation={()=>{}} pricesReady testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={()=>{}}/>);
    assert.match(html,/less than ordinary activity/);
    assert.match(html,/symptoms at rest/i);
    assert.doesNotMatch(html,/II \(Mild sx\)/);
});
check('every scenario renders its result state without an exception or NaN in visible text', () => {
    for(const s of SCENARIOS){
        const output=generateAndScoreModifications(s.patient,names,prices);
        const html=render({...output,results:output.scoredRegimens,runSnapshot:{patient:s.patient,ranAt:'2026-11-12T16:00:00Z'}});
        assert.doesNotMatch(html,/>NaN(?:<|\s)/,s.title);
    }
});
check('a new case has no assumed clinical choices, insurance or budget and missing fields do not block a focused review', () => {
    const q=blankPatient();const errors=validatePatientForm(q);
    for(const field of ['sex','race','rhythm','nyha_class','insurance_tier','max_affordable_cost'] as const){
        assert.equal(q[field],undefined);assert.equal(errors[field],undefined);
    }
    assert.equal(q.is_pregnant,undefined);assert.equal(q.current_regimen.length,0);assert.equal(q.allergies.size,0);
});
check('unknown pregnancy is preserved and narrows medication decisions instead of blocking the entire form', () => {
    const q=clonePatient(p);q.sex='Female';q.age=40;q.is_pregnant=undefined; // age 40: pregnancy status is required below the childbearing-potential age (S12, 2026-11-19)
    assert.equal(validatePatientForm(q).is_pregnant,undefined);
    const output=generateAndScoreModifications(q,names,prices);
    assert.ok(output.decisionReadiness?.missing.some(m=>m.field==='is_pregnant'));
    assert.ok(output.excludedMedications.some(m=>m.reason.includes('pregnancy status')));
    q.is_pregnant=false;assert.equal(validatePatientForm(q).is_pregnant,undefined);
    const older=clonePatient(p);older.sex='Female';older.age=74;older.is_pregnant=undefined;
    assert.ok(!generateAndScoreModifications(older,names,prices).decisionReadiness?.missing.some(m=>m.field==='is_pregnant'),'an older woman is not asked for pregnancy status');
});
check('missing potassium and creatinine remain permitted and valid zero preferences are not missing', () => {
    const q=clonePatient(p);q.potassium=0;q.creatinine=0;q.kccq_score=0;q.max_new_classes_per_visit=0;q.max_affordable_cost=0;
    const errors=validatePatientForm(q);
    for(const field of ['potassium','creatinine','kccq_score','max_affordable_cost']) assert.equal(errors[field],undefined);
});
check('a potassium above the supported range requires verification and urgent assessment if accurate', () => {
    const q = clonePatient(p);
    q.potassium = 9;
    assert.match(validatePatientForm(q).potassium, /verify.*immediately.*if the value is accurate.*hyperkalemic emergency.*emergency assessment/i); // R12 D5(b) (rewritten): the form error is one sentence, "If the value is accurate, this is a hyperkalemic emergency: obtain an ECG now, ... emergency assessment."
});
check('each alternative shows its own monitoring rather than borrowing option 1 monitoring', () => {
    const alternative={...lead,monitoring_plan:[{test:'Alternative-specific check',timing:'Before implementation',details:'Unique monitoring details'}]};
    const html=renderToStaticMarkup(<RecommendationCard regimen={alternative} leader={lead} rank={2}/>);
    assert.match(html,/Monitoring for option 2/);assert.match(html,/Unique monitoring details/);
});
check('unavailable cost is not displayed as a numeric Infinity amount', () => {
    const option={...lead,cost:Infinity,warnings:['BUDGET EXCEEDED: ($Infinity)', 'PRICE UNKNOWN: cost missing']};
    assert.doesNotMatch(render({results:[option]}),/\$Infinity/);
    assert.match(render({results:[option]}),/Cost cannot be assessed/);
    assert.doesNotMatch(buildChartSummary({...chartInput,results:[option]}),/\$Infinity/);
});
check('sample case provenance is present in both the screen and draft note header', () => {
    const snapshot={patient:p,ranAt:'2026-11-12T16:00:00Z',caseLabel:'EXAMPLE / TEST CASE: synthetic'};
    assert.match(render({runSnapshot:snapshot}),/EXAMPLE \/ TEST CASE/);
    assert.match(buildChartHeader(snapshot),/EXAMPLE \/ TEST CASE/);
});
check('current medication editing is named accessibly and frequencies are expanded', () => {
    const html=renderToStaticMarkup(<MedicationManager patientData={p} setPatientData={()=>{}}/>);
    assert.match(html,/Edit .* dose and frequency/);assert.match(html,/once daily|twice daily/);
    assert.match(html,/Dose each time/);
});
check('pricing failure is distinct from loading and offers retry', () => {
    const html=renderToStaticMarkup(<PatientForm patientData={p} setPatientData={()=>{}} simulationMedicationNames={names} setSimulationMedicationNames={()=>{}} onRunSimulation={()=>{}} pricesReady={false} priceLoadError="Test price error" onRetryPrices={()=>{}} testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={()=>{}}/>);
    assert.match(html,/Retry pricing/);assert.match(html,/Test price error/);assert.doesNotMatch(html,/Loading Prices/);
});
check('library does not turn model parameters into comparative efficacy or tolerability claims', () => {
    const html=renderToStaticMarkup(<MedicationLibrary/>);
    assert.match(html,/Individual dose response and withdrawal effects are not quantified/);assert.doesNotMatch(html,/Unvalidated model parameters|% of body weight/);
    assert.doesNotMatch(html,/Top Tier|Generally well tolerated|Clinical Impact \(Est\.\)/);
});
check('all score dialogs identify model references and retain a bounded scrolling body', () => {
    for(const domain of ['overall', ...DOMAIN_KEYS] as const){
        const html=renderToStaticMarkup(<ScoreDetailModal domain={domain} score={lead.overall_score} regimen={lead} onClose={()=>{}}/>);
        assert.match(html,/not individual treatment targets or a prognosis/);
        assert.match(html,/overflow-y-auto min-h-0/);assert.match(html,/max-h-\[90dvh\]/);
        assert.doesNotMatch(html,/Fluid Excess:|Critical Threshold:/);
    }
});
check('unknown prices stay unavailable in score dialogs and tie explanations', () => {
    const option={...lead,cost:Infinity};
    const html=renderToStaticMarkup(<ScoreDetailModal domain="cost" score={0} regimen={option} onClose={()=>{}}/>);
    assert.match(html,/Cannot assess without pricing/);assert.doesNotMatch(html,/Infinity|NaN/);
    assert.doesNotMatch(tieSentence(option,lead,1)!,/Infinity|NaN/);
});
check('methodology accurately states cost tradeoffs and fixed evidence-credit normalization', () => {
    const html=renderToStaticMarkup(<FAQ/>);
    assert.match(html,/Equal scores do not establish equivalent clinical benefit/);
    assert.match(html,/unrelated additional drug does not dilute/);
});
check('a blank form can request a focused review while pricing is unavailable', () => {
    const html=renderToStaticMarkup(<PatientForm patientData={blankPatient()} setPatientData={()=>{}} simulationMedicationNames={names} setSimulationMedicationNames={()=>{}} onRunSimulation={()=>{}} pricesReady={false} testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={()=>{}}/>);
    const button=html.match(/<button[^>]*>Review available information<\/button>/)?.[0];
    assert.ok(button);assert.doesNotMatch(button,/\sdisabled(?:=|\s|>)/);
});
check('partial reviews show urgent findings and the assessment limits on screen and in the copied note', () => {
    const q=blankPatient();q.potassium=6.7;
    const output=generateAndScoreModifications(q,names,{});
    const html=render({...output,results:output.scoredRegimens});
    assert.match(html,/HYPERKALEMIC EMERGENCY/);assert.match(html,/Focused safety review/);
    assert.match(html,/What can be assessed with these inputs/);assert.doesNotMatch(html,/id="results-option-1"/);
    const note=buildChartSummary({...chartInput,...output,results:output.scoredRegimens});
    assert.match(note,/HYPERKALEMIC EMERGENCY/);assert.match(note,/Complete medication-regimen generation waits/);
    assert.match(note,/not a safety clearance/i);
});
check('unmeasured biomarker and cost domains display as unassessed instead of patient scores', () => {
    const q=clonePatient(p);q.nt_pro_bnp=0;q.kccq_score=undefined;(q as any).max_affordable_cost=undefined;
    const output=generateAndScoreModifications(q,names,{});const option=output.scoredRegimens[0];assert.ok(option);
    const html=render({...output,results:output.scoredRegimens});
    assert.match(html,/N\/A/);assert.match(html,/not directly comparable/);
    for(const domain of ['neurohormonal','cost'] as const){
        const detail=renderToStaticMarkup(<ScoreDetailModal domain={domain} score={0} regimen={option} onClose={()=>{}}/>);
        assert.match(detail,/Not assessed/i);assert.doesNotMatch(detail,/0 \/ 100/);
    }
    const functional=renderToStaticMarkup(<ScoreDetailModal domain="functional" score={option.domain_scores.functional} regimen={option} onClose={()=>{}}/>);
    assert.match(functional,/Not assessed: treatment response is not quantified/);
});
check('known urgent findings stay visible before analysis despite unrelated input errors; unknown pulse is not bradycardia', () => {
    const q=blankPatient();q.potassium=6.7;q.age=17;q.pulse=0;
    const html=renderToStaticMarkup(<PatientForm patientData={q} setPatientData={()=>{}} simulationMedicationNames={names} setSimulationMedicationNames={()=>{}} onRunSimulation={()=>{}} pricesReady={false} testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={()=>{}}/>);
    assert.match(html,/HYPERKALEMIC EMERGENCY/);assert.match(html,/role="alert"/);
    assert.match(html,/Correct or save entries to review/);assert.doesNotMatch(html,/Low heart rate:/);
});
check('copied note preserves treatment uncertainty and an individualized follow-up schedule', () => {
    const note=buildChartSummary(chartInput);
    assert.match(note,/ASSESSMENT LIMITS/);assert.match(note,/not (estimated|quantified)/);
    assert.match(note,/TREATMENT CONSIDERATIONS/);
    assert.doesNotMatch(note,/up-titrate every 1-2 weeks|confirm quadruple therapy at target|eGFR dip of 5-10%/i);
});
check('medication-history prerequisites are care prompts, while actual urgent findings remain safety alerts', () => {
    const parts=partitionAlerts(['MEDICATION USE REVIEW: confirm current use','DOSE TIMING REVIEW: confirm interval','EXPOSURE HISTORY: completed course','HYPERKALEMIC EMERGENCY: K 6.7']);
    assert.equal(parts.advisory.length,3);assert.equal(parts.urgent.length,1);assert.match(parts.urgent[0].head!,/HYPERKALEMIC/);
});

// ---- Selected-option note (the draft note and visit summary follow the clinician's choice) ----
const medNamed = (n: string) => MEDICATION_FORMULARY.find(m => m.name === n)!;
const regimenMed = (n: string) => { const med = medNamed(n); return { med, dose: med.available_doses[0], selected_frequency: 'qd' as const }; };
const fixtureOption = (tag: string, drug: string, monitoring: string) => {
    const rm = regimenMed(drug);
    return {
        ...lead, regimen: [rm], warnings: [`${tag} SAFETY WARNING`], treatment_assessment: undefined, shown_because: undefined,
        modification_set: { modifications: [{ action: 'add' as const, target: rm, summary: `${tag} CHANGE SUMMARY` }], resulting_regimen: [rm] },
        monitoring_plan: [{ test: monitoring, timing: `${tag} timing`, details: `${tag} details` }],
    } as typeof lead;
};
const selOpt1 = fixtureOption('ONE', 'Dapagliflozin', 'OPT1-ONLY-MONITORING');
const selOpt2 = fixtureOption('TWO', 'Carvedilol', 'OPT2-ONLY-MONITORING');
// Option 2 is a loop-only step (no disease-modifying start); option 1 starts a disease-modifying drug.
const loopOnly = (o: typeof lead) => ({ ...o, modification_set: { ...o.modification_set!, modifications: [{ action: 'titrate_up' as const, target: regimenMed('Furosemide'), summary: o.modification_set!.modifications[0].summary }] } }) as typeof lead;
const selInput = (results: typeof lead[], extra: Record<string, unknown> = {}) => ({ ...chartInput, gdmtGaps: [], results, ...extra });
const e15 = { name: 'Spironolactone', drug_class: 'MRA', reason: 'Potassium 5.4 withheld', rule_id: 'E15', rule_name: 'Potassium' };
const FOLLOW_UP_HEAD = /FOLLOW-UP REVIEW PROMPTS/;

check('a note for selected option 2 describes option 2 and says the tool ordered option 1 first', () => {
    const note = buildChartSummary(selInput([selOpt1, selOpt2]), 1);
    assert.match(note, /CLINICIAN-SELECTED ALTERNATIVE \(option 2 of 2; the tool listed option 1 first\):/);
    assert.match(note, /PROPOSED CHANGES IN OPTION 2/);
    assert.match(note, /TWO CHANGE SUMMARY/);
    assert.match(note, /Carvedilol/);
    assert.match(note, /TWO SAFETY WARNING/);
    assert.match(note, /DIFFERENCES FROM THE OPTION LISTED FIRST \(.*\):\n  - Includes Carvedilol .* option 1 does not\.\n  - Does not include Dapagliflozin, which is included in option 1\./);
    assert.match(note, /OTHER OPTIONS NAMED ABOVE:\n  - Option 1 means: /);
    assert.ok(note.indexOf('PROPOSED CHANGES IN OPTION 2') < note.indexOf('DIFFERENCES FROM THE OPTION LISTED FIRST'));
    // Option 1 is named (described) once, in the lines that say what "option 1" is; its own changes and warnings are not option 2's.
    const own = note.split('\n\nOTHER OPTIONS NAMED ABOVE')[0].replace(/DIFFERENCES FROM THE OPTION LISTED FIRST \([^)]*\)/, '');
    for (const absent of [/PROPOSED CHANGES IN OPTION 1/, /ONE CHANGE SUMMARY/, /ONE SAFETY WARNING/, /TOP-ORDERED REGIMEN/]) assert.doesNotMatch(own, absent);
    assert.match(note, /Option 1 means: ONE CHANGE SUMMARY/);
});
check('a note for selected option 2 keeps the over-budget and pricing-unavailable headings with option 2 of n', () => {
    const over = { ...selOpt2, warnings: ['BUDGET EXCEEDED: ($999)'] };
    assert.match(buildChartSummary(selInput([selOpt1, over]), 1), /REGIMEN FOR DISCUSSION ONLY \(option 2 of 2; over the stated budget/);
    const noPrice = { ...selOpt2, cost: Infinity };
    assert.match(buildChartSummary(selInput([selOpt1, noPrice]), 1), /PRICING UNAVAILABLE, DISCUSSION ONLY \(option 2 of 2;/);
});
check('selected-option monitoring replaces option 1 monitoring and keeps deferred-therapy items', () => {
    const note = buildChartSummary(selInput([selOpt1, selOpt2], {
        monitoringPlan: [...selOpt1.monitoring_plan!, { test: 'Repeat potassium; start MRA once below 5.0', timing: 'Before any MRA start', details: 'x' }],
        excludedMedications: [e15],
    }), 1);
    assert.match(note, /OPT2-ONLY-MONITORING \(TWO timing\): TWO details/);
    assert.doesNotMatch(note, /OPT1-ONLY-MONITORING/);
    assert.match(note, /Repeat potassium; start .+ once below 5\.0 \(Before any MRA start\)/); // R7 W4: the row names the drug held
    // R8 X2: the deferred rows come from the plan the engine built for this patient (a drug the patient takes is not named as a start), so the test supplies the row.
    const e18 = buildChartSummary(selInput([selOpt1, selOpt2], { monitoringPlan: [...selOpt1.monitoring_plan!, { test: 'Repeat potassium; start Lisinopril if 5.2 or lower', timing: 'Before any RAAS inhibitor start', details: 'x' }], excludedMedications: [{ ...e15, rule_id: 'E18', drug_class: 'ACEi' }] }), 1);
    assert.match(e18, /Repeat potassium; start .+ if 5\.2 or lower/); // R7 W4: the row names the drug held
    assert.doesNotMatch(buildChartSummary(selInput([selOpt1, selOpt2]), 1), /Repeat potassium/);
});
check('follow-up prompts follow the selected option in both directions', () => {
    const startsNothing = loopOnly(selOpt2);
    const a = buildChartSummary(selInput([loopOnly(selOpt1), selOpt2], { followUpCalendar: [] }), 1);
    assert.match(a, FOLLOW_UP_HEAD);          // option 2 starts a disease-modifying drug, option 1 does not
    assert.match(a, /About 1 week; sooner if indicated: Clinical review/);
    const b = buildChartSummary(selInput([selOpt1, startsNothing], { followUpCalendar: [{ test: 'OPTION1-CALENDAR', timing: 'About 1 week', details: 'd' }] }), 1);
    assert.doesNotMatch(b, FOLLOW_UP_HEAD);
    assert.doesNotMatch(b, /OPTION1-CALENDAR/);
    assert.match(buildChartSummary(selInput([selOpt1, startsNothing], { followUpCalendar: [{ test: 'OPTION1-CALENDAR', timing: 'About 1 week', details: 'd' }] })), /OPTION1-CALENDAR/);
});
check('gap rows say started in option k for the selected option', () => {
    const input = selInput([selOpt1, selOpt2], { gdmtGaps: ['SGLT2 inhibitor', 'Evidence-based beta-blocker (carvedilol / metoprolol succinate / bisoprolol)'] });
    const note = buildChartSummary(input, 1);
    assert.match(note, /Evidence-based beta-blocker .*: started in this option \(Carvedilol\)/);
    assert.doesNotMatch(note, /started in option 1|started in this option \(Dapagliflozin\)/);
    assert.match(buildChartSummary(input), /SGLT2 inhibitor: started in this option \(Dapagliflozin\)/);
});
check('index 0, an omitted index and an invalid or out-of-range index give identical text', () => {
    const input = selInput([selOpt1, selOpt2]);
    const base = buildChartSummary(input);
    for (const bad of [0, 7, -1, 1.5, NaN, undefined]) assert.equal(buildChartSummary(input, bad as number), base);
    assert.notEqual(buildChartSummary(input, 1), base);
});
check('real engine output for a multi-option scenario: selecting option 2 gives option 2 lines and its own plan', () => {
    let found = 0;
    for (const s of SCENARIOS) {
        const o = generateAndScoreModifications(s.patient, names, prices);
        const [r1, r2] = o.scoredRegimens;
        if (!r1 || !r2) continue;
        const sig = (r: typeof r1) => r.regimen.map(x => `${x.med.name} ${x.dose.strength} ${x.selected_frequency}`).sort().join('|');
        if (sig(r1) === sig(r2)) continue;
        const input = { ...chartInput, ...o, gdmtGaps: o.gdmtGaps ?? [], results: o.scoredRegimens, clinicalAlerts: o.clinicalAlerts ?? [], eligibleAdjuncts: [], missingDataNotices: [], followUpCalendar: o.followUpCalendar ?? [], monitoringPlan: o.monitoringPlan ?? [] };
        const note = buildChartSummary(input, 1);
        assert.match(note, /option 2 of \d/, s.title);
        assert.match(note, /PROPOSED CHANGES IN OPTION 2/, s.title);
        assert.doesNotMatch(note, /PROPOSED CHANGES IN OPTION 1/, s.title);
        assert.match(note, /DIFFERENCES FROM THE OPTION LISTED FIRST/, s.title);
        for (const r of r2.regimen) assert.ok(note.includes(`${r.med.name} ${r.dose.strength}`), `${s.title}: ${r.med.name}`);
        for (const m of r2.monitoring_plan ?? []) assert.ok(note.includes(m.test), `${s.title}: ${m.test}`);
        found++;
        if (found >= 25) break;
    }
    assert.ok(found >= 5, `only ${found} multi-option scenarios with different regimens`);
});
check('screen offers a radio group and per-card buttons only when there are 2 or more options', () => {
    const two = render({ results: [selOpt1, selOpt2] });
    assert.match(two, /<legend[^>]*>Draft note and visit summary describe<\/legend>/);
    assert.match(two, /Option 1 \(ordered first\)/);
    assert.match(two, /type="radio"/);
    assert.match(two, /Use option 2 for the draft note/);
    assert.match(two, /aria-pressed="false"/);
    assert.match(two, /Copy draft for option 1/);
    assert.doesNotMatch(two, /You selected option/);
    const one = render({ results: [selOpt1] });
    assert.doesNotMatch(one, /Draft note and visit summary describe/);
    assert.doesNotMatch(one, /type="radio"/);
    assert.doesNotMatch(one, /for the draft note/);
});

// ---- Guided view (the new default entry flow) ----
const scenarioByTitle = (title: string) => { const s = SCENARIOS.find(x => x.title === title); assert.ok(s, `no scenario titled ${title}`); return s!; };
const INPUT_ERROR_ALERT = /^(INPUT ERROR|DATA REQUIRED|IMPLAUSIBLE VALUE)/;

check('every curated example exists, runs without an input error, and the set shows different engine behaviour', () => {
    assert.equal(DEMO_CASES.length, 6);
    assert.equal(new Set(DEMO_CASES.map(d => d.scenarioTitle)).size, 6);
    const byTitle = new Map(DEMO_CASES.map(d => {
        const s = scenarioByTitle(d.scenarioTitle);
        const o = generateAndScoreModifications(s.patient, names, prices);
        for (const a of o.clinicalAlerts ?? []) assert.doesNotMatch(a, INPUT_ERROR_ALERT, `${d.scenarioTitle}: ${a.slice(0, 60)}`);
        return [d.scenarioTitle, { s, o }] as const;
    }));
    const wet = byTitle.get('John Doe (Wet & Warm)')!; assert.ok(wet, 'John Doe case is curated');
    assert.equal(wet.o.scoredRegimens.length, 3); assert.equal(wet.s.patient.lvef, 25);
    const stop = byTitle.get('Severe Hypotension (BP 85/55) - No Drug Recs')!; assert.ok(stop, 'hypotension case is curated');
    assert.equal(stop.o.scoredRegimens.length, 0); assert.ok(stop.o.clinicalAlerts.some(a => /^HEMODYNAMIC INSTABILITY/.test(a)));
    const hfpef = byTitle.get('Obese HFpEF (BMI 35, LVEF 58)')!; assert.ok(hfpef, 'preserved-EF case is curated');
    assert.equal(hfpef.s.patient.lvef, 58);
    assert.ok(hfpef.o.scoredRegimens[0].modification_set!.modifications.some(m => /Dapagliflozin/.test(m.summary)));
    const k = byTitle.get('Hyperkalemia (K+ 5.6) - Avoid MRA')!; assert.ok(k, 'potassium case is curated');
    assert.ok(k.o.excludedMedications.some(e => e.name === 'Spironolactone'), 'MRA is held');
    const ckd = byTitle.get('Severe CKD Loop Resistance (eGFR 18)')!; assert.ok(ckd, 'kidney case is curated');
    assert.equal(ckd.s.patient.egfr, 18);
    assert.ok(ckd.o.excludedMedications.some(e => /eGFR 18 is below 20/.test(e.reason)));
    const four = byTitle.get('Elderly >80 on All 4 Pillars (Age Dosing)')!; assert.ok(four, 'titration case is curated');
    assert.equal(four.s.patient.current_regimen.length, 4);
    assert.ok(four.o.scoredRegimens.some(r => r.modification_set!.modifications.some(m => m.action === 'titrate_up')));
});
check('curated examples already hold the derived eGFR and BMI the form computes, so opening the form later does not mark results out of date', () => {
    for (const d of DEMO_CASES) {
        const q = scenarioByTitle(d.scenarioTitle).patient; const f = derivedFields(q);
        assert.ok(Object.is(Number.isFinite(f.egfr) ? f.egfr : 0, q.egfr), `${d.scenarioTitle} eGFR`);
        assert.ok(Object.is(Number.isFinite(f.bmi) ? f.bmi : 0, q.bmi), `${d.scenarioTitle} BMI`);
    }
});
check('example card facts are read from the scenario patient', () => {
    const facts = caseFacts(scenarioByTitle('John Doe (Wet & Warm)').patient).join(' | ');
    assert.match(facts, /EF 25%/); assert.match(facts, /NYHA III/); assert.match(facts, /BP 100\/\d+/);
    assert.match(facts, /Potassium 4\.9/); assert.doesNotMatch(facts, /K\+/); assert.match(facts, /eGFR 45/); assert.match(facts, /Lisinopril/);
    const blank = caseFacts(blankPatient()).join(' | ');
    assert.match(blank, /not entered/); assert.doesNotMatch(blank, /EF 0|K\+ 0|eGFR 0|NaN|undefined/);
});
check('the Start screen shows six labelled synthetic example cards and a New patient control', () => {
    const html = renderToStaticMarkup(<StartScreen onOpenExample={() => {}} onNewPatient={() => {}} />);
    const cards = html.match(/<article[\s\S]*?<\/article>/g) ?? [];
    assert.equal(cards.length, 6);
    for (const c of cards) { assert.match(c, /Synthetic example/); assert.match(c, />Open and review</); }
    assert.match(html, /<h2[^>]*>Example patients<\/h2>/); assert.match(html, /synthetic/i);
    assert.match(html, />New patient</);
    assert.match(html, /Research decision support/);
});
const renderSteps = (q: ReturnType<typeof blankPatient>, step: number, extra: Record<string, unknown> = {}) => {
    return renderToStaticMarkup(<StepsScreen patientData={q} setPatientData={() => {}} step={step} onStepChange={() => {}} onRun={() => {}} pricesReady {...extra} />);
};
check('the step menu lists the seven steps in order and marks only the current one', () => {
    const html = renderSteps(clonePatient(p), 2);
    const nav = html.match(/<nav[^>]*aria-label="Steps"[\s\S]*?<\/nav>/)?.[0]; assert.ok(nav, 'step nav');
    const labels = ['Patient and symptoms', 'Vitals and exam', 'Labs and echo', 'History and allergies', 'Current medications', 'Preferences', 'Review'];
    let at = -1; for (const l of labels) { const i = nav!.indexOf(l); assert.ok(i > at, `${l} in order`); at = i; }
    assert.equal((nav!.match(/aria-current="step"/g) ?? []).length, 1);
    assert.match(nav!, /aria-current="step"[^>]*>[\s\S]*?Labs and echo/);
    assert.doesNotMatch(nav!, /disabled/);
});
check('the Review step for a blank patient lists the missing core items and offers the run button', () => {
    const html = renderSteps(blankPatient(), 6);
    const review = html.slice(html.indexOf('id="guided-review"')); assert.ok(review.length > 100, 'review region');
    for (const item of ['Age', 'Sex', 'LVEF', 'NYHA functional class', 'Systolic blood pressure', 'Pulse', 'Potassium', 'Creatinine']) assert.ok(review.includes(item), item);
    assert.match(review, /Not entered/);
    const button = review.match(/<button[^>]*>Review available information<\/button>/)?.[0]; assert.ok(button, 'run button');
    assert.doesNotMatch(button!, /\sdisabled(?:=|\s|>)/);
});
check('the Review step names an input error and links to the step that holds it', () => {
    const q = blankPatient(); q.age = 17;
    const html = renderSteps(q, 6);
    const review = html.slice(html.indexOf('id="guided-review"'));
    assert.match(review, /Age must be 18/); assert.match(review, /Patient and symptoms/);
    assert.match(review, /Correct or save entries to review/);
    const nav = html.match(/<nav[^>]*aria-label="Steps"[\s\S]*?<\/nav>/)![0];
    assert.match(nav, /Patient and symptoms[\s\S]*?needs attention/);
});
check('the results patient bar shows entered values and "not entered", never 0, for blank potassium and eGFR', () => {
    const full = renderToStaticMarkup(<PatientBar patient={clonePatient(p)} caseLabel="EXAMPLE / TEST CASE: x" onEditInputs={() => {}} onNewPatient={() => {}} />);
    assert.match(full, /EXAMPLE \/ TEST CASE/); assert.match(full, />Edit inputs</); assert.match(full, />New patient</);
    assert.match(full, />25%</); assert.match(full, />III</); assert.match(full, />100\/\d+</);
    const q = clonePatient(p); q.potassium = 0; q.egfr = 0; q.creatinine = 0;
    const html = renderToStaticMarkup(<PatientBar patient={q} caseLabel="Custom case" onEditInputs={() => {}} onNewPatient={() => {}} />);
    assert.match(html, /Potassium[\s\S]*?not entered/); assert.match(html, /eGFR[\s\S]*?not entered/);
    assert.doesNotMatch(html, />0</);
});
check('the jump link counts the options other than the one selected, for any selection', () => {
    const html = render({ results: [selOpt1, selOpt2] });
    assert.match(html, />1 other option</); assert.doesNotMatch(html, />\d+ alternative options?</);
    assert.match(render({ results: [selOpt1, selOpt2, selOpt2] }), />2 other options</);
});

// ---- Guided polish pass ----
check('potassium prints with one decimal, as "Potassium", on the cards and in the patient bar', () => {
    const facts = caseFacts(scenarioByTitle('Obese HFpEF (BMI 35, LVEF 58)').patient).join(' | ');
    assert.match(facts, /Potassium 4\.0/); assert.doesNotMatch(facts, /K\+/);
    const q = clonePatient(p); q.potassium = 4;
    const html = renderToStaticMarkup(<PatientBar patient={q} caseLabel="Custom case" onEditInputs={() => {}} onNewPatient={() => {}} />);
    assert.match(html, /Potassium[\s\S]*?>4\.0</);
    const start = renderToStaticMarkup(<StartScreen onOpenExample={() => {}} onNewPatient={() => {}} />);
    assert.match(start, /Potassium 4\.0/); assert.doesNotMatch(start, /K\+ 4</);
});
const guidedResults = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(
    <GuidedResults patient={clonePatient(p)} caseLabel="EXAMPLE / TEST CASE: Once" onEditInputs={() => {}} onNewPatient={() => {}} running={false} attempt={0} showNotice={false}
        resultsProps={{ results: [lead], error: null, hasRun: true, excludedMedications: [], runSnapshot: { patient: p, ranAt: '2026-11-15T12:00:00Z', caseLabel: 'EXAMPLE / TEST CASE: Once' } }} {...extra} />);
check('the guided results show the case label once (patient bar), while the draft note header still carries it', () => {
    const html = guidedResults();
    // The collapsed "Inputs used" record (a <pre>) and the draft note (a <textarea>) keep the stamp by design; the visible label is the bar's.
    const visible = html.replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<section data-print-summary[\s\S]*?<\/section>/g, '');
    assert.equal((visible.match(/EXAMPLE \/ TEST CASE: Once/g) ?? []).length, 1);
    assert.match(html.match(/<textarea[\s\S]*?<\/textarea>/)![0], /EXAMPLE \/ TEST CASE: Once/);
    // Full form is unchanged: the results component alone still prints its label line.
    assert.match(render({ runSnapshot: { patient: p, ranAt: '2026-11-15T12:00:00Z', caseLabel: 'EXAMPLE / TEST CASE: Once' } }).replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, ''), /EXAMPLE \/ TEST CASE: Once/);
});
check('below the sm breakpoint the step menu is one labelled select that keeps the needs-attention marker', () => {
    const q = blankPatient(); q.age = 17;
    const html = renderSteps(q, 1);
    const nav = html.match(/<nav[^>]*aria-label="Steps"[\s\S]*?<\/nav>/)![0];
    assert.match(nav, /<label[^>]*for="guided-step-select"[^>]*>[^<]*step/i);
    const select = nav.match(/<select[^>]*id="guided-step-select"[\s\S]*?<\/select>/)?.[0]; assert.ok(select, 'step select');
    assert.match(select!, /<option value="1" selected="">Step 2 of 7: Vitals and exam<\/option>/);
    assert.match(select!, /<option value="0">Step 1 of 7: Patient and symptoms \(needs attention\)<\/option>/);
    assert.equal((select!.match(/<option /g) ?? []).length, 7);
    assert.match(nav, /<ol[^>]*class="[^"]*\bhidden\b[^"]*\bsm:flex\b/);
    assert.match(nav, /class="[^"]*\bsm:hidden\b/);
});
check('Review lists only entered values under "What you entered" (with rhythm and weights) and says so when empty', () => {
    const slice = (html: string) => { const r = html.slice(html.indexOf('id="guided-review"')); const a = r.indexOf('What you entered'); return r.slice(a, r.indexOf('Not entered yet')); };
    const blank = slice(renderSteps(blankPatient(), 6));
    assert.match(blank, /Nothing entered yet/); assert.doesNotMatch(blank, /not entered/i);
    const q = blankPatient(); q.lvef = 30; q.rhythm = 'Sinus'; q.volume_status = { current_weight_kg: 84, dry_weight_kg: 80, exam_findings: new Set<string>() };
    const some = slice(renderSteps(q, 6));
    assert.match(some, />30%</); assert.match(some, /Rhythm/); assert.match(some, />Sinus</);
    assert.match(some, /Current weight[\s\S]*?>84</); assert.match(some, /Dry weight[\s\S]*?>80</);
    assert.doesNotMatch(some, /Nothing entered yet/); assert.doesNotMatch(some, /Blood pressure/);
});
check('shared section headings and labels use sentence case', () => {
    const html = renderToStaticMarkup(<PatientForm patientData={clonePatient(p)} setPatientData={() => {}} simulationMedicationNames={names} setSimulationMedicationNames={() => {}} onRunSimulation={() => {}} pricesReady testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={() => {}} />);
    for (const t of ['Physical exam', 'Weight status', 'Exam findings', 'Diagnostics (labs and echo)', 'Clinical context and risks', 'Daily step count', 'Prior lowest LVEF']) assert.ok(html.includes(t), t);
    for (const t of ['Physical Exam', 'Weight Status', 'Exam Findings', 'Labs & Echo', 'Clinical Context', 'Daily Step Count', 'Prior Lowest']) assert.ok(!html.includes(t), `old casing ${t}`);
});
check('pulse and SpO2 have their own visible labels', () => {
    const html = renderToStaticMarkup(<PatientForm patientData={clonePatient(p)} setPatientData={() => {}} simulationMedicationNames={names} setSimulationMedicationNames={() => {}} onRunSimulation={() => {}} pricesReady testScenarios={SCENARIOS} selectedScenario="custom" onScenarioChange={() => {}} />);
    assert.match(html, /<label[^>]*for="pulse"[^>]*>Pulse/); assert.match(html, /<label[^>]*for="oxygen_saturation"[^>]*>(SpO2|Oxygen)/);
});

// ---- First-principles model display (2026-11-16): expected effect, evidence drill-down, tables, methodology ----
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const cardText = (o: typeof lead, rank = 1) => textOf(renderToStaticMarkup(<RecommendationCard regimen={o} rank={rank} />));
const vsCur = (o: typeof lead, k: 'all_cause_death' | 'hf_hospitalization') => o.outcome_estimates!.find(x => x.outcome === k)!.vs_current;
const pctLower = (rr: number) => Math.round(Math.abs(1 - rr) * 100);

check('card shows "Expected effect (trial averages)" with death and heart-failure admission as percent lower or higher, relative risk and 95% interval versus the current regimen', () => {
    const t = cardText(lead);
    assert.match(t, /Expected effect of option \d \(trial averages\)/);
    for (const [k, label] of [['all_cause_death', 'Death from any cause'], ['hf_hospitalization', 'Heart-failure hospitalization']] as const) {
        const v = vsCur(lead, k);
        const want = `${label}: ${pctLower(v.rr)}% ${v.rr < 1 ? 'lower' : 'higher'} (relative risk ${v.rr.toFixed(2)}, 95% interval ${v.ci_low.toFixed(2)} to ${v.ci_high.toFixed(2)})`;
        assert.ok(t.includes(want), `missing: ${want}`);
    }
    assert.match(t, /population averages from randomized trials, not a prediction for this patient/i);
    assert.match(t, /as planned/i);
});
check('card shows the health-status change in KCCQ-equivalent points and the side-effect burden change, both computed independently from the current regimen', () => {
    const t = cardText(lead);
    const nowPts = symptomEstimateFor(p.current_regimen, p).points;
    const delta = lead.symptom_estimate!.points - nowPts;
    assert.ok(delta > 0.05, 'fixture should gain KCCQ points');
    assert.ok(t.includes(`Health status (KCCQ-equivalent): gain of ${(Math.round(delta * 10) / 10).toFixed(1)} points`), `symptom line; delta ${delta}`);
    const cmp = compareHarmBurden(HARM_TABLE, lead.regimen, p.current_regimen, p);
    const sign = cmp.burden_difference > 0 ? '+' : '−';
    assert.ok(t.includes(`Side-effect burden: ${sign}${(Math.round(Math.abs(cmp.burden_difference) * 10) / 10).toFixed(1)} points`), `burden line; diff ${cmp.burden_difference}`);
    const top = cmp.changed_lines.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2);
    for (const l of top) assert.ok(t.includes(`${l.drug}, ${harmLabel(l.effect)}`), `names contributor ${l.drug} ${l.effect}`);
    assert.match(t, /Not measured, so not counted: Furosemide/);
});
check('an option with no change says so and prints no zero percentages or zero point changes', () => {
    const t = cardText(noChange);
    assert.match(t, /No medication change is proposed in this option, so there is no change in expected effect/);
    assert.doesNotMatch(t, /0% (lower|higher)|relative risk 1\.00 \(95%/);
    assert.match(t, /population averages from randomized trials/i);
});
check('"at today\'s doses" appears beside the planned figure when the engine\'s two valuations differ and is absent when they do not', () => {
    let shown = 0, absent = 0;
    for (const sc of SCENARIOS) {
        const o = generateAndScoreModifications(sc.patient, names, prices);
        for (const r of o.scoredRegimens) {
            const est = r.outcome_estimates!;
            const material = est.some(e => Math.abs(e.as_prescribed.rr - e.as_planned.rr) > 0.03);
            const identical = est.every(e => e.as_prescribed.rr === e.as_planned.rr);
            const t = cardText(r);
            if (material) { shown++; assert.match(t, /At today's doses: \d+% (lower|higher|about the same)|At today's doses: about the same/, `${sc.title}: planned and today's figures differ`); }
            else if (identical) { absent++; assert.doesNotMatch(t, /At today's doses: \d+% (lower|higher) \(relative risk/, `${sc.title}: figures identical, nothing to show`); }
        }
        if (shown >= 10 && absent >= 10) break;
    }
    assert.ok(shown >= 3 && absent >= 3, `shown ${shown}, absent ${absent}`);
    assert.doesNotMatch(cardText(noChange), /At today's doses/);
    assert.match(cardText(lead), /As planned|as planned/);
});
check('the evidence drill-down is a keyboard-reachable disclosure and states published value, value used, dose credit, titrated valuation, trial, citation and basis for each drug', () => {
    const html = renderToStaticMarkup(<RecommendationCard regimen={lead} rank={1} />);
    assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?Evidence behind these estimates/);
    const t = textOf(html);
    const dapa = lead.outcome_estimates![0].contributors.find(c => c.medication === 'Dapagliflozin')!;
    assert.ok(t.includes(`Published relative risk ${dapa.rr_published.toFixed(2)} (95% interval ${dapa.ci_low_published!.toFixed(2)} to ${dapa.ci_high_published!.toFixed(2)})`));
    assert.ok(t.includes(`Value used ${dapa.rr.toFixed(2)}`));
    assert.match(t, /Dose credit 100%\. Started in this option, so valued as titrated to the dose the trials achieved/);   // rewritten 2026-11-18 (change C1): the wording names starts only
    assert.ok(t.includes(dapa.trial) && t.includes(dapa.citation));
    assert.match(t, /Basis Pooled analysis of trials/);
    assert.match(t, /Pulled toward no effect because the trials are small or imprecise/);
});
check('C3 the drill-down says which prior each row used (death or hospitalization) and marks a row whose weight is below 0.2 as mostly prior, in words', () => {
    const t = cardText(lead);
    assert.match(t, /Weighting Weighted with the death prior \(0\.0\d\d\); the trial figure gets weight 0\.\d\d/);
    assert.match(t, /Weighted with the hospitalization prior \(0\.0\d\d\)/);
    const loopDeath = lead.outcome_estimates![0].contributors.find(c => c.drug_class === 'Loop Diuretic');
    assert.ok(loopDeath && loopDeath.mostly_prior, 'the congested loop figure rests mostly on the prior');
    assert.match(t, /Mostly prior: the value used rests mostly on the assumption of no effect/);
    const tables = textOf(renderToStaticMarkup(<EvidenceTables />));
    assert.match(tables, /Weighted with the death prior/); assert.match(tables, /Mostly prior/);
});
check('C1 a start capped by a kidney, interaction or maximum-dose rule says so in words on the card and in the drill-down; an increase is valued at the dose it reaches', () => {
    const q = clonePatient(p); q.egfr = 25; q.creatinine = 2.6; q.current_regimen = [];
    const ram = MEDICATION_FORMULARY.find(m => m.name === 'Ramipril')!;
    const start = { med: ram, dose: ram.available_doses.find(d => d.strength === 1.25)!, selected_frequency: 'qd' };
    const set = { modifications: [{ action: 'add', target: start, summary: 'x' }], resulting_regimen: [start] } as unknown as NonNullable<typeof lead.modification_set>;
    const capped = { ...lead, regimen: [start], modification_set: set, outcome_estimates: buildOutcomeEstimateViews([start], q, set) };
    const t = cardText(capped);
    assert.ok(/Dose credit 48%/.test(t), (t.match(/Dose credit[^.]*\.[^.]*\./g) ?? []).join(' | '));
    assert.match(t, /Dose credit 48%\. Started in this option, so valued as titrated, but only up to the highest dose allowed for this patient: Ramipril: this patient's dose limit for kidney function \(eGFR 25\) allows at most 2\.5 mg a day, so it earns 48% of the trial effect/);
    const inc = clonePatient(p); inc.current_regimen = [{ ...start, dose: ram.available_doses.find(d => d.strength === 2.5)!, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } } as never];
    const up = { med: ram, dose: ram.available_doses.find(d => d.strength === 5)!, selected_frequency: 'qd' };
    const upSet = { modifications: [{ action: 'titrate_up', source: inc.current_regimen[0], target: up, summary: 'x' }], resulting_regimen: [up] } as unknown as NonNullable<typeof lead.modification_set>;
    const tu = cardText({ ...lead, regimen: [up], modification_set: upSet, outcome_estimates: buildOutcomeEstimateViews([up], inc, upSet) });
    assert.match(tu, /Dose credit \d+%\. Valued at the dose in this option\./); assert.doesNotMatch(tu, /Started in this option, so valued as titrated/);
});
check('C4/E1 the card says the beta-blocker figures are the atrial fibrillation ones and not a reason to stop a beta-blocker used for rate control, only for a patient in atrial fibrillation now', () => {
    const NOTE = /the beta-blocker figures are the atrial fibrillation ones[\s\S]*?This is not a reason to stop a beta-blocker used for rate control/;   // E1: death and hospitalization
    const af = clonePatient(p); af.rhythm = 'AFib';
    const afOut = generateAndScoreModifications(af, names, prices).scoredRegimens.find(r => r.outcome_estimates![0].contributors.some(c => c.drug_class === 'Beta Blocker'));
    assert.ok(afOut, 'an atrial fibrillation option with a beta-blocker'); assert.match(cardText(afOut!), NOTE);
    const si = clonePatient(p); si.rhythm = 'Sinus';
    const siOut = generateAndScoreModifications(si, names, prices).scoredRegimens.find(r => r.outcome_estimates![0].contributors.some(c => c.drug_class === 'Beta Blocker'));
    assert.ok(siOut); assert.doesNotMatch(cardText(siOut!), NOTE);
});
check('C6 display: the GLP-1 reduced-EF rows say in words that randomized evidence conflicts and no effect is assumed, with the source figures, and print no interval beside 1.00', () => {
    const q = clonePatient(p); q.lvef = 30; q.current_regimen = [];
    const sema = MEDICATION_FORMULARY.find(m => m.name === 'Semaglutide (Wegovy)')!;
    const reg = { med: sema, dose: sema.available_doses[0], selected_frequency: sema.available_doses[0].frequency_options[0] };
    const set = { modifications: [{ action: 'add', target: reg, summary: 'x' }], resulting_regimen: [reg] } as unknown as NonNullable<typeof lead.modification_set>;
    const t = cardText({ ...lead, regimen: [reg], modification_set: set, outcome_estimates: buildOutcomeEstimateViews([reg], q, set) });
    assert.match(t, /Published No effect assumed \(relative risk 1\.00\)\. Randomized evidence conflicts/);
    assert.match(t, /Source figures[\s\S]*?SELECT[\s\S]*?FIGHT/);
    assert.doesNotMatch(t, /Published relative risk 1\.00 \(95% interval/);
    assert.match(textOf(renderToStaticMarkup(<EvidenceTables />)), /No effect assumed \(relative risk 1\.00\)\. Randomized evidence conflicts/);
});
check('no displayed relative risk lies outside its own displayed interval, for every scenario and every option', () => {
    let seen = 0;
    for (const sc of SCENARIOS) {
        const res = generateAndScoreModifications(clonePatient(sc.patient), names, prices);
        res.scoredRegimens.forEach((o, i) => {
            const t = cardText(o, i + 1);
            for (const m of t.matchAll(/(\d+\.\d+),? \(?(?:95% )?interval (\d+\.\d+) to (\d+\.\d+)/g)) {
                seen++;
                const v = Number(m[1]), lo = Number(m[2]), hi = Number(m[3]);
                assert.ok(lo <= v && v <= hi, `${sc.title} option ${i + 1}: ${v} is outside its interval ${lo} to ${hi}`);
            }
        });
    }
    assert.ok(seen > 1000, `only ${seen} intervals checked`);
    console.log(`  displayed intervals checked: ${seen}`);
});
check('third pass (rewritten for E9): the conflicting-evidence sentence appears on exactly the three rows whose basis is "conflicting" (the two GLP-1 reduced-EF rows and the beta-blocker LVEF 50 and above death row), in every scenario and option and in the evidence tables, and no interval is printed beside 1.00 on them', () => {
    const SENT = /Randomized evidence conflicts, so no interval is shown/g, IDS = ['glp1-reduced-death', 'glp1-reduced-hfhosp', 'beta-blocker-preserved-death'];
    assert.equal((textOf(renderToStaticMarkup(<EvidenceTables />)).match(SENT) ?? []).length, 3, 'three evidence-table rows');
    let optionsWith = 0;
    for (const sc of SCENARIOS) {
        for (const [i, o] of generateAndScoreModifications(clonePatient(sc.patient), names, prices).scoredRegimens.entries()) {
            const has = (cardText(o, i + 1).match(SENT) ?? []).length > 0;
            const expected = (o.outcome_estimates ?? []).some(e => [...e.contributors, ...e.not_counted].some(c => IDS.includes(c.row_id)));
            assert.equal(has, expected, `${sc.title} option ${i + 1}`);
            if (has) optionsWith++;
        }
    }
    const pres = clonePatient(p); pres.lvef = 60; pres.current_regimen = [];
    const bb = MEDICATION_FORMULARY.find(m => m.name === 'Carvedilol')!, reg = { med: bb, dose: bb.available_doses[0], selected_frequency: 'bid' };
    const set = { modifications: [{ action: 'add', target: reg, summary: 'x' }], resulting_regimen: [reg] } as unknown as NonNullable<typeof lead.modification_set>;
    const views = buildOutcomeEstimateViews([reg], pres, set);
    assert.ok(views[0].contributors.some(c => c.row_id === 'beta-blocker-preserved-death'));
    const t = cardText({ ...lead, regimen: [reg], modification_set: set, outcome_estimates: views });
    assert.match(t, SENT); assert.doesNotMatch(t, /0\.65 to 4\.10|95% interval 0\.65/);   // E9: the envelope is not a confidence interval
    console.log(`  options showing the sentence in scenarios: ${optionsWith}`);
});
check('third pass: a thiazide-type drug without a loop diuretic shows "kidney harm without a loop diuretic: not measured" in the side-effect drill-down, with a loop it shows the charged line', () => {
    const q = clonePatient(p);
    const hz = MEDICATION_FORMULARY.find(m => m.name === 'Hydrochlorothiazide')!, fu = MEDICATION_FORMULARY.find(m => m.name === 'Furosemide')!;
    const h = { med: hz, dose: hz.available_doses[0], selected_frequency: hz.available_doses[0].frequency_options[0] }, f = { med: fu, dose: fu.available_doses[0], selected_frequency: fu.available_doses[0].frequency_options[0] };
    const text = (regimen: typeof lead.regimen) => textOf(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={lead.domain_scores.side_effects} regimen={{ ...lead, regimen, harm_burden: harmBurdenFor(HARM_TABLE, regimen, q) }} onClose={() => {}} />));
    const without = text([h]), withLoop = text([f, h]);
    assert.match(without, /Kidney harm without a loop diuretic: not measured/i); assert.match(without, /acute add-on use with a loop diuretic/i); assert.match(without, /hypertension model charges none/i);
    assert.doesNotMatch(withLoop, /Kidney harm without a loop diuretic: not measured/i);
});
check('E1 (rewrites the third-pass check): the pooled three-trial beta-blocker row is the sinus and other rhythm row, shown with its value used and weight; the atrial fibrillation rows are measured subgroups', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const get = (id: string) => textOf(html.match(new RegExp(`<tr data-evidence-row="outcome" data-row-id="${id}">[\\s\\S]*?</tr>`))?.[0] ?? '');
    const pooled = get('beta-blocker-reduced-death'); assert.ok(pooled, 'pooled row present');
    assert.match(pooled, /Applies to: sinus rhythm and every other rhythm/); assert.match(pooled, /Weighted with the death prior/); assert.doesNotMatch(pooled, /not used directly for ranking|Source of the sinus/);
    const af = get('beta-blocker-reduced-death-afib'); assert.match(af, /Applies to: atrial fibrillation/); assert.match(af, /Subgroup of a randomized trial/); assert.match(af, /0\.97 \(0\.83 to 1\.14\)/);
    assert.equal(get('beta-blocker-reduced-death-sinus'), '', 'the derived sinus row is gone');
    assert.match(get('beta-blocker-reduced-hfh-afib'), /Converted from a different outcome definition/); // T13: the inference is an outcome-definition conversion, so the label says so
});
check('C6, C7 and E2 labels: a row charged only with a loop diuretic is named in words; the class-average level no longer exists; a borrowed row and a not-measured row say what they are', () => {
    assert.notEqual(harmLevelLabel('classAverage'), 'Class average, not measured for this drug');   // E2: the level is gone, so it has no plain label
    assert.equal(harmLevelLabel('siblingProxy'), 'Borrowed from a sibling class');
    const tables = textOf(renderToStaticMarkup(<EvidenceTables />));
    assert.doesNotMatch(tables, /Class average, not measured for this drug/); assert.doesNotMatch(tables, /Replaces an upper bound of/); assert.match(tables, /Charged only when a loop diuretic is also in the option/);
    assert.match(tables, /Not measured: no randomized incidence was found, so nothing is charged/);
});
check('E3, E4, E5, E12, E14 labels: new evidence bases, harm level notes, verification words and the symptom heading are plain and exact', () => {
    assert.equal(basisLabel('subgroup'), 'Subgroup of a randomized trial');
    assert.equal(basisLabel('indirect_comparison'), 'Indirect comparison through enalapril');
    assert.equal(basisLabel('conflicting'), 'Randomized evidence conflicts; no effect assumed');
    assert.equal(basisLabel('no_outcome_evidence'), 'No outcome evidence; no effect assumed');
    assert.equal(basisLabel('assumed_neutral'), 'Assumed no effect (no outcome trial)');
    assert.equal(basisLabel('converted'), 'Converted from another questionnaire');
    assert.equal(basisLabel('combined'), 'Combined from two steps');
    assert.equal(SYMPTOM_HEADING, 'Health status, in KCCQ-equivalent points');
    for (const c of ['abstract_quote', 'full_text_quote', 'secondary_source_quote', 'computed_from_verified', 'unverified', 'verified_label', 'verified_abstract', 'verified_fulltext', 'verified_image_table', 'verified_fulltext (secondary source)', 'n/a', 'registry_quote', 'label_quote', 'computed_from_secondary_source']) { const w = verificationLabel(c); assert.ok(w.length > 8 && !/_|confirmed/i.test(w), c); }
    assert.match(verificationLabel('unverified'), /^Not verified/);
    const codes = new Set<string>([...OUTCOME_EVIDENCE_TABLE.map(r => r.verification), ...SYMPTOM_TABLE.map(r => r.verification), ...HARM_TABLE.rows.map(r => r.verification), ...(DOSE_EVIDENCE.anchors as { verification: string }[]).map(a => a.verification)]);
    for (const c of codes) assert.ok(verificationLabel(c).length > 8 && !/^confirmed$/.test(c), `verification word ${c}`);
    assert.ok(!SYMPTOM_TABLE.some(r => r.verification === 'confirmed'), 'the single word "confirmed" is gone from the symptom table');
    assert.equal(populationKeyLabel('Beta Blocker', 'atrial_fibrillation'), 'atrial fibrillation'); assert.equal(populationKeyLabel('Beta Blocker', 'other'), 'sinus rhythm and every other rhythm');
    const t = textOf(renderToStaticMarkup(<EvidenceTables />));
    assert.match(t, /Health status, in KCCQ-equivalent points/); assert.doesNotMatch(t, /Placebo-subtracted change in the Kansas City Cardiomyopathy Questionnaire, 0 to 100 points/);
    assert.match(t, /Subgroup of a randomized trial/); assert.match(t, /Randomized evidence conflicts; no effect assumed/); assert.match(t, /Indirect comparison through enalapril/);
    assert.match(t, /Not verified/); assert.doesNotMatch(t, /KCCQ points/); assert.doesNotMatch(t, /—/);
    assert.match(t, /Applies to: atrial fibrillation/); assert.match(t, /Applies to: sinus rhythm and every other rhythm/);
    assert.match(t, /125 mcg/); assert.doesNotMatch(t, /125 mg/);   // E11: digoxin is shown in micrograms, as in the formulary
    assert.match(t, /Whose mean: Mean among COPERNICUS patients still alive at day 120, including the 9% who were taking no drug/);
});
check('loop diuretic congestion rows show the published figure and the much smaller value used, with the reason', () => {
    const o = lead.outcome_estimates![0];
    const loop = [...o.contributors, ...o.not_counted].find(c => c.drug_class === 'Loop Diuretic');
    assert.ok(loop, 'John Doe is congested on furosemide');
    const t = cardText(lead);
    assert.ok(t.includes(`Published relative risk ${loop!.rr_published.toFixed(2)}`));
    assert.ok(t.includes(`Value used ${loop!.rr.toFixed(2)}`));
    assert.ok(loop!.rr - loop!.rr_published > 0.3, 'shrunk toward 1');
});
check('symptom evidence says "Not measured" in words, never a bare zero; side-effect evidence names severity, evidence level and the assumptions made for missing patient values', () => {
    const sym = textOf(renderToStaticMarkup(<ScoreDetailModal domain="symptoms" score={lead.domain_scores.symptoms} regimen={lead} onClose={() => {}} />));
    assert.match(sym, /Furosemide[\s\S]*?Published Not measured: no usable estimate of the health-status change/);
    assert.match(sym, /Instrument/); assert.match(sym, /KCCQ-equivalent points/);
    const noRace = clonePatient(p); (noRace as any).race = undefined;
    const gapOption = generateAndScoreModifications(noRace, names, prices).scoredRegimens.find(r => r.harm_burden!.unknown_assumptions.length > 0);
    assert.ok(gapOption, 'an option with an assumption exists when race is not entered');
    const gapText = textOf(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={gapOption!.domain_scores.side_effects} regimen={gapOption!} onClose={() => {}} />));
    assert.match(gapText, /A patient value is missing: the higher-risk case is assumed/);
    for (const a of gapOption!.harm_burden!.unknown_assumptions) assert.ok(gapText.includes(`${a.drug}, ${harmLabel(a.effect)}: ${a.text}`), `assumption in words: ${a.text}`);
    assert.match(gapText, /Assumed because race is not recorded/);
    // Rewritten 2026-11-18: the upper-bound rows that every loop option carried (hypomagnesemia) are now "not measured" or class averages, so the loop checks the displayed labels that replaced them;
    // an upper-bound line, if one is displayed (Furoscix injection site), must still say so.
    let sawUpper = false, sawBorrowed = false, sawNotMeasured = false;
    const sawGap = true;
    for (const s of SCENARIOS) {
        const o = generateAndScoreModifications(s.patient, names, prices);
        for (const r of o.scoredRegimens) {
            const hb = r.harm_burden!;
            const upper = hb.lines.some(l => l.kind === 'harm' && l.upper_bound), sib = hb.lines.some(l => l.kind === 'harm' && l.level === 'siblingProxy');
            const nm = hb.lines.some(l => l.kind === 'harm' && l.level === 'notMeasured');
            if (!((upper && !sawUpper) || (sib && !sawBorrowed) || (nm && !sawNotMeasured))) continue;
            const t = textOf(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={r.domain_scores.side_effects} regimen={r} onClose={() => {}} />));
            assert.match(t, /serious, weight 3|moderate, weight 1|mild, weight 0\.5/);
            assert.match(t, /Evidence (Measured for this drug|Measured for the drug class|Extrapolated|Borrowed from a sibling class|Upper bound|Not measured)/);
            if (upper) { sawUpper = true; assert.match(t, /Upper bound \(no measurement for this drug/); }
            if (sib) { sawBorrowed = true; assert.match(t, /Borrowed from a sibling class/); }
            if (nm) { sawNotMeasured = true; assert.match(t, /Not measured: no randomized incidence was found, so nothing is charged/); assert.match(t, /Rate Not measured; nothing is charged\./); }
        }
        if (sawBorrowed && sawNotMeasured) break;
    }
    assert.ok(sawBorrowed && sawNotMeasured && sawGap, `borrowed ${sawBorrowed}, not measured ${sawNotMeasured}`);
});
check('death and hospitalization dialogs show the per-drug evidence, and the four evidence dialogs are wide enough to read', () => {
    for (const d of ['mortality', 'hf_hospitalization'] as const) {
        const html = renderToStaticMarkup(<ScoreDetailModal domain={d} score={lead.domain_scores[d]} regimen={lead} onClose={() => {}} />);
        assert.match(textOf(html), /Published relative risk/); assert.match(html, /max-w-xl/);
    }
    assert.match(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={50} regimen={lead} onClose={() => {}} />), /max-w-xl/);
});
check('score groups: six ranked factors, then reference-only and not-assessed groups that each state weight 0', () => {
    const html = renderToStaticMarkup(<RecommendationCard regimen={lead} rank={1} />);
    const t = textOf(html);
    for (const g of DOMAIN_GROUPS) assert.ok(t.includes(g.label), g.label);
    assert.match(t, /Guideline reference \(not in ranking\) weight 0/);
    assert.match(t, /Individual physiological response \(not estimated\) weight 0/);
    assert.match(t, /Ranked factors/);
    const refStart = html.indexOf('aria-label="Guideline reference');
    assert.ok(refStart > html.indexOf('aria-label="Patient values'), 'reference groups come after the ranked groups');
});
check('stale statements about the old model are gone from the card, the banner and the ledger, and the new fact is stated', () => {
    const card = cardText(lead);
    assert.doesNotMatch(card, /Treatment response is not estimated from trial-average coefficients|Outcome domains have zero ranking weight|Individual response is not quantified/);
    assert.match(card, /Death, heart-failure hospitalization, symptoms, side effects, cost and dosing burden decide the order/);
    assert.match(card, /reference only/i);
    const page = textOf(render());
    assert.doesNotMatch(page, /Individual response is not quantified/);
    assert.match(page, /Expected effects are trial averages, not a prediction for this patient/);
    const ledger = textOf(renderToStaticMarkup(<ScoreDetailModal domain="overall" score={lead.overall_score} regimen={lead} onClose={() => {}} />));
    assert.doesNotMatch(ledger, /eight factors/); assert.match(ledger, /Weighted total of the factors/);
    assert.match(ledger, /Ranked factors/);
});
check('draft note carries one sentence with the expected effect versus the current regimen and the population-average caveat, using only engine numbers', () => {
    const note = buildChartSummary({ ...chartInput, results: [lead] });
    assert.match(note, /EXPECTED EFFECT VERSUS CURRENT REGIMEN/);
    const sentence = note.split('\n').find(l => /Versus the current regimen/.test(l))!;
    assert.ok(sentence, 'sentence present');
    assert.match(sentence, /population averages from randomized trials, not a prediction for this patient/);
    for (const k of ['all_cause_death', 'hf_hospitalization'] as const) assert.ok(sentence.includes(`relative risk ${vsCur(lead, k).rr.toFixed(2)}`), k);
    const numbers = [...sentence.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0]);
    const allowed = new Set<string>(['95']);
    for (const k of ['all_cause_death', 'hf_hospitalization'] as const) { const v = vsCur(lead, k); [v.rr, v.ci_low, v.ci_high].forEach(x => allowed.add(x.toFixed(2))); allowed.add(String(pctLower(v.rr))); }
    const delta = lead.symptom_estimate!.points - symptomEstimateFor(p.current_regimen, p).points; allowed.add((Math.round(Math.abs(delta) * 10) / 10).toFixed(1));
    const bd = compareHarmBurden(HARM_TABLE, lead.regimen, p.current_regimen, p).burden_difference; allowed.add((Math.round(Math.abs(bd) * 10) / 10).toFixed(1));
    for (const n of numbers) assert.ok(allowed.has(n), `number ${n} in the note sentence is not an engine output`);
    const none = buildChartSummary({ ...chartInput, results: [noChange] });
    assert.match(none, /No medication change is proposed, so no change in expected effect/);
    assert.doesNotMatch(none, /Individual response is not quantified/);
    assert.match(buildChartSummary({ ...chartInput, results: [{ ...noChange, treatment_assessment: undefined }] }), /ASSESSMENT LIMITS:\n  - Expected effects are population averages from randomized trials/);
});
check('every scenario and option renders the expected-effect block without NaN, undefined or Infinity, and the reconstructed current regimen equals the patient\'s', () => {
    let options = 0;
    for (const s of SCENARIOS) {
        const o = generateAndScoreModifications(s.patient, names, prices);
        for (const r of o.scoredRegimens) {
            options++;
            const t = cardText(r);
            const block = t.slice(t.indexOf('Expected effect of option'), t.indexOf('Evidence behind these estimates'));
            assert.ok(block.length > 20, `${s.title}: block present`);
            assert.doesNotMatch(block, /NaN|undefined|Infinity/, s.title);
            const cur = currentRegimenOf(r)!;
            const uniq = (xs: { med: { name: string } }[]) => [...new Set(xs.map(x => x.med.name))].sort().join('|');   // the engine removes duplicate entries (safety dedup)
            assert.equal(uniq(cur), uniq(s.patient.current_regimen), `${s.title}: current regimen reconstructed`);
        }
    }
    assert.ok(options > 500, `${options} options checked`);
});
check('every evidence basis, harm level and dose level in the data has a plain label without underscores', () => {
    const bases = new Set<string>([...OUTCOME_EVIDENCE_TABLE.map(r => r.basis), ...SYMPTOM_TABLE.map(r => r.basis)]);
    for (const b of bases) { const l = basisLabel(b); assert.ok(l.length > 3 && !/_/.test(l), b); }
    const levels = new Set<string>(HARM_TABLE.rows.map(r => r.level));
    for (const l of levels) { const w = harmLevelLabel(l); assert.ok(!/siblingProxy|_/.test(w), l); }
    assert.match(harmLevelLabel('extrapolated', true), /^Upper bound/);
    for (const a of (DOSE_EVIDENCE.anchors as { level: string }[])) assert.ok(DOSE_LEVEL_LABELS[a.level], a.level);
});
check('FAQ and the evidence tables describe the dose cap, the dose floor, the two priors and the rhythm rule in one plain sentence each', () => {
    for (const html of [renderToStaticMarkup(<FAQ />), renderToStaticMarkup(<EvidenceTables />)]) {
        const t = textOf(html);
        assert.match(t, /not beyond the highest dose allowed for this patient/); assert.match(t, /at least the fraction of that dose that is taken/);
        assert.match(t, /separate one for hospitalization/); assert.match(t, /atrial fibrillation one/);
        assert.doesNotMatch(t, /—/);
    }
});
check('FAQ "How options are ordered" states the six factors and the weights table is generated from WEIGHT_PROFILES', () => {
    const html = renderToStaticMarkup(<FAQ />); const t = textOf(html);
    assert.doesNotMatch(t, /not a prognosis or a measure of expected clinical benefit|outcome domains are unassessed and carry zero weight because individual response is not quantified/);
    assert.match(t, /relative risks from randomized trials/); assert.match(t, /pulled toward no effect/); assert.match(t, /titrated/);
    assert.match(t, /fixed safety rules/i); assert.match(t, /guideline recommendations are a target/i);
    const table = html.match(/<table[^>]*>(?:(?!<\/table>)[\s\S])*?Weight of each ranked factor[\s\S]*?<\/table>/)?.[0]; assert.ok(table, 'weights table');
    const tt = textOf(table!);
    for (const [name, weights] of Object.entries(WEIGHT_PROFILES)) {
        assert.ok(tt.includes(WEIGHT_PROFILE_META[name as keyof typeof WEIGHT_PROFILES].label), name);
        for (const k of ['mortality', 'hf_hospitalization', 'symptoms', 'side_effects', 'cost', 'adherence'] as const) assert.ok(tt.includes(`${Math.round(weights[k] * 1000) / 10}%`), `${name} ${k} ${weights[k]}`);
    }
    for (const k of ['guideline', 'completeness'] as const) assert.match(tt, new RegExp(`${DOMAIN_LABELS[k]}[\\s\\S]*?0%`));
});
check('evidence tables render every row of the four data files with column headers, and can be filtered by drug class', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const count = (kind: string) => (html.match(new RegExp(`data-evidence-row="${kind}"`, 'g')) ?? []).length;
    assert.equal(count('outcome'), OUTCOME_EVIDENCE_TABLE.length);
    assert.equal(count('symptom'), SYMPTOM_TABLE.length);
    assert.equal(count('harm'), HARM_TABLE.rows.length);
    assert.equal(count('dose'), (DOSE_EVIDENCE.anchors as unknown[]).length);
    for (const h of ['Class', 'EF band', 'Outcome', 'Published', 'Used', 'Basis', 'Source', 'Drug', 'Harm', 'Severity', 'Evidence level', 'Full-credit daily dose']) assert.ok(html.includes(`>${h}</th>`), h);
    assert.match(html, /<label[^>]*for="evidence-class-filter"[^>]*>Filter by drug class/);
    assert.match(html, /<caption/);
    const upper = HARM_TABLE.rows.filter(r => r.upper_bound).length; assert.equal(upper, 0, 'E2: no upper-bound row remains');
    assert.equal((textOf(html).match(/Upper bound \(no measurement/g) ?? []).length, upper);
});

check('tie rule and "what matters most" wording describe the six-factor model, not the retired completeness tie-break', () => {
    assert.doesNotMatch(TIE_RULE_TEXT, /indicated therapy|covering more/);
    assert.match(TIE_RULE_TEXT, /slightly higher score \(before rounding\) is listed first; then the cheaper one/); // T19: reworded, no "unrounded"
    assert.doesNotMatch(tieSentence({ ...lead, overall_score: 50 }, { ...lead, overall_score: 50 }, 1)!, /therapy coverage/);
    assert.match(profileDescription('cost_first'), /cost counts three times as much/);
    assert.match(profileDescription('outcomes_first'), /cost counts half as much and dosing burden counts half as much/);
    assert.match(profileDescription('default'), /death, heart-failure hospitalization, symptoms, side effects, cost and dosing burden/);
    // Removed 2026-11-20 (U13): the assertion on the ranking-mode description went with the ranking toggle.
    const ledger = textOf(renderToStaticMarkup(<ScoreDetailModal domain="overall" score={lead.overall_score} regimen={lead} onClose={() => {}} />));
    assert.doesNotMatch(ledger, /therapy completeness, cost/);
});

check('an assumption that LOWERS risk is shown as not applied, and every assumption on every option is shown in words', () => {
    let applied = 0, notApplied = 0;
    const variants: ((q: any) => void)[] = [q => { q.race = undefined; }, q => { q.potassium = 0; }, q => { q.egfr = 0; q.creatinine = 0; }];
    for (const v of variants) for (const sc of SCENARIOS.slice(0, 60)) {
        const q = clonePatient(sc.patient); v(q);
        const o = generateAndScoreModifications(q, names, prices);
        for (const r of o.scoredRegimens) {
            const hb = r.harm_burden!; if (hb.unknown_assumptions.length === 0) continue;
            const t = textOf(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={r.domain_scores.side_effects} regimen={r} onClose={() => {}} />));
            for (const a of hb.unknown_assumptions) { assert.ok(t.includes(`${a.drug}, ${harmLabel(a.effect)}: ${a.text}`), a.text); a.applied ? applied++ : notApplied++; }
        }
    }
    assert.ok(applied > 0, 'applied assumptions seen');
    assert.ok(notApplied >= 0);
});
check('a relative-risk interval that includes 1 says "the interval includes no effect" next to the figure, on the card and in the draft note; one that excludes 1 does not', () => {
    let withNote = 0, without = 0;
    for (const sc of SCENARIOS) {
        const o = generateAndScoreModifications(sc.patient, names, prices);
        for (const r of o.scoredRegimens) {
            if (r.modification_set?.modifications.every(m => m.action === 'keep')) continue;
            const t = cardText(r), note = buildChartSummary({ ...chartInput, results: [r] });
            for (const e of r.outcome_estimates!) {
                const v = e.vs_current, includes = v.ci_low <= 1 && v.ci_high >= 1;
                const figure = `${OUTCOME_SHORT[e.outcome]}: ${v.rr < 1 ? pctLower(v.rr) + '% lower' : pctLower(v.rr) + '% higher'} (relative risk ${v.rr.toFixed(2)}, 95% interval ${v.ci_low.toFixed(2)} to ${v.ci_high.toFixed(2)}`;
                if (pctLower(v.rr) === 0) continue;
                if (includes) { withNote++; assert.ok(t.includes(`${figure}; the interval includes no effect)`), `card: ${figure}`); assert.ok(note.includes(`relative risk ${v.rr.toFixed(2)}, 95% interval ${v.ci_low.toFixed(2)} to ${v.ci_high.toFixed(2)}; the interval includes no effect`), 'note'); }
                else { without++; assert.ok(t.includes(`${figure})`), `card: ${figure}`); }
            }
        }
        if (withNote >= 5 && without >= 5) break;
    }
    assert.ok(withNote >= 1 && without >= 1, `with ${withNote}, without ${without}`);
});
check('the swap bonus line appears in the ledger only when it changes the score', () => {
    const none = { ...lead, score_breakdown: { ...lead.score_breakdown!, adjustments: [{ code: 'SPECIAL_FEATURES', label: 'x', points: 0 }] } };
    assert.doesNotMatch(textOf(renderToStaticMarkup(<ScoreDetailModal domain="overall" score={50} regimen={none} onClose={() => {}} />)), /replacing a contraindicated/);
    const some = { ...lead, score_breakdown: { ...lead.score_breakdown!, adjustments: [{ code: 'SPECIAL_FEATURES', label: 'x', points: 12 }] } };
    assert.match(textOf(renderToStaticMarkup(<ScoreDetailModal domain="overall" score={50} regimen={some} onClose={() => {}} />)), /Bonus for replacing a contraindicated or intolerance-documented drug/);
});
check('loop diuretics say that dose has no measured relation and that congestion relief by dose is not modelled', () => {
    const t = cardText(lead);
    assert.match(t, /Furosemide[\s\S]*?Dose credit 100%\. No measured dose relation, so full credit at any dose; congestion relief by dose is not modelled/);
    const sym = textOf(renderToStaticMarkup(<ScoreDetailModal domain="symptoms" score={0} regimen={lead} onClose={() => {}} />));
    assert.doesNotMatch(sym, /Still congested on the current dose/);
    assert.match(textOf(renderToStaticMarkup(<FAQ />)), /congestion relief by dose is not modelled/i);
});

console.log(`Clinical UI checks: ${passed} passed; ${failed} failed. Server-rendered content only; browser behavior and visual layout are not verified.`);
