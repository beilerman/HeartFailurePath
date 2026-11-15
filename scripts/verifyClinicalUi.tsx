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
import { DOMAIN_KEYS } from '../services/engine/scoreModel';
import { tieSentence } from '../components/scoreExplain';
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
    const q=clonePatient(p);q.sex='Female';q.is_pregnant=undefined;
    assert.equal(validatePatientForm(q).is_pregnant,undefined);
    const output=generateAndScoreModifications(q,names,prices);
    assert.ok(output.decisionReadiness?.missing.some(m=>m.field==='is_pregnant'));
    assert.ok(output.excludedMedications.some(m=>m.reason.includes('pregnancy status')));
    q.is_pregnant=false;assert.equal(validatePatientForm(q).is_pregnant,undefined);
});
check('missing potassium and creatinine remain permitted and valid zero preferences are not missing', () => {
    const q=clonePatient(p);q.potassium=0;q.creatinine=0;q.kccq_score=0;q.max_new_classes_per_visit=0;q.max_affordable_cost=0;
    const errors=validatePatientForm(q);
    for(const field of ['potassium','creatinine','kccq_score','max_affordable_cost']) assert.equal(errors[field],undefined);
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
    const snapshot={patient:p,ranAt:'2026-11-12T16:00:00Z',caseLabel:'EXAMPLE / TEST CASE — synthetic'};
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
    assert.match(note, /CLINICIAN-SELECTED ALTERNATIVE \(option 2 of 2; the tool ordered option 1 first; the other options are on screen\):/);
    assert.match(note, /PROPOSED CHANGES IN OPTION 2/);
    assert.match(note, /TWO CHANGE SUMMARY/);
    assert.match(note, /Carvedilol/);
    assert.match(note, /TWO SAFETY WARNING/);
    assert.match(note, /DIFFERENCES FROM OPTION 1 \(ordered first by the tool\):\n  - Includes Carvedilol .* option 1 does not\.\n  - Does not include Dapagliflozin, which is included in option 1\./);
    assert.ok(note.indexOf('PROPOSED CHANGES IN OPTION 2') < note.indexOf('DIFFERENCES FROM OPTION 1'));
    for (const absent of [/PROPOSED CHANGES IN OPTION 1/, /ONE CHANGE SUMMARY/, /ONE SAFETY WARNING/, /TOP-ORDERED REGIMEN/]) assert.doesNotMatch(note, absent);
});
check('a note for selected option 2 keeps the over-budget and pricing-unavailable headings with option 2 of n', () => {
    const over = { ...selOpt2, warnings: ['BUDGET EXCEEDED: ($999)'] };
    assert.match(buildChartSummary(selInput([selOpt1, over]), 1), /REGIMEN FOR DISCUSSION ONLY \(option 2 of 2; over the stated budget/);
    const noPrice = { ...selOpt2, cost: Infinity };
    assert.match(buildChartSummary(selInput([selOpt1, noPrice]), 1), /PRICING UNAVAILABLE — DISCUSSION ONLY \(option 2 of 2;/);
});
check('selected-option monitoring replaces option 1 monitoring and keeps deferred-therapy items', () => {
    const note = buildChartSummary(selInput([selOpt1, selOpt2], {
        monitoringPlan: [...selOpt1.monitoring_plan!, { test: 'Repeat potassium; start MRA once below 5.0', timing: 'Before any MRA start', details: 'x' }],
        excludedMedications: [e15],
    }), 1);
    assert.match(note, /OPT2-ONLY-MONITORING \(TWO timing\): TWO details/);
    assert.doesNotMatch(note, /OPT1-ONLY-MONITORING/);
    assert.match(note, /Repeat potassium; start MRA once below 5\.0 \(Before any MRA start\)/);
    const e18 = buildChartSummary(selInput([selOpt1, selOpt2], { excludedMedications: [{ ...e15, rule_id: 'E18', drug_class: 'ACEi' }] }), 1);
    assert.match(e18, /Repeat potassium; start RAAS inhibitor if 5\.2 or lower/);
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
    assert.match(note, /Evidence-based beta-blocker .* - started in option 2 \(Carvedilol\)/);
    assert.doesNotMatch(note, /started in option 1/);
    assert.match(buildChartSummary(input), /SGLT2 inhibitor - started in option 1 \(Dapagliflozin\)/);
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
        assert.match(note, /DIFFERENCES FROM OPTION 1/, s.title);
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
    const full = renderToStaticMarkup(<PatientBar patient={clonePatient(p)} caseLabel="EXAMPLE / TEST CASE — x" onEditInputs={() => {}} onNewPatient={() => {}} />);
    assert.match(full, /EXAMPLE \/ TEST CASE/); assert.match(full, />Edit inputs</); assert.match(full, />New patient</);
    assert.match(full, />25%</); assert.match(full, />III</); assert.match(full, />100\/\d+</);
    const q = clonePatient(p); q.potassium = 0; q.egfr = 0; q.creatinine = 0;
    const html = renderToStaticMarkup(<PatientBar patient={q} caseLabel="Custom case" onEditInputs={() => {}} onNewPatient={() => {}} />);
    assert.match(html, /Potassium[\s\S]*?not entered/); assert.match(html, /eGFR[\s\S]*?not entered/);
    assert.doesNotMatch(html, />0</);
});
check('the jump link counts the options other than the one selected, for any selection', () => {
    const html = render({ results: [selOpt1, selOpt2] });
    assert.match(html, />1 other option</); assert.doesNotMatch(html, /alternative option/);
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
    <GuidedResults patient={clonePatient(p)} caseLabel="EXAMPLE / TEST CASE — Once" onEditInputs={() => {}} onNewPatient={() => {}} running={false} attempt={0} showNotice={false}
        resultsProps={{ results: [lead], error: null, hasRun: true, excludedMedications: [], runSnapshot: { patient: p, ranAt: '2026-11-15T12:00:00Z', caseLabel: 'EXAMPLE / TEST CASE — Once' } }} {...extra} />);
check('the guided results show the case label once (patient bar), while the draft note header still carries it', () => {
    const html = guidedResults();
    // The collapsed "Inputs used" record (a <pre>) and the draft note (a <textarea>) keep the stamp by design; the visible label is the bar's.
    const visible = html.replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
    assert.equal((visible.match(/EXAMPLE \/ TEST CASE — Once/g) ?? []).length, 1);
    assert.match(html.match(/<textarea[\s\S]*?<\/textarea>/)![0], /EXAMPLE \/ TEST CASE — Once/);
    // Full form is unchanged: the results component alone still prints its label line.
    assert.match(render({ runSnapshot: { patient: p, ranAt: '2026-11-15T12:00:00Z', caseLabel: 'EXAMPLE / TEST CASE — Once' } }).replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, ''), /EXAMPLE \/ TEST CASE — Once/);
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

console.log(`Clinical UI checks: ${passed} passed; ${failed} failed. Server-rendered content only; browser behavior and visual layout are not verified.`);
