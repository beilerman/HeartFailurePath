import { plainText } from './plainText';
import React, { useMemo, useState } from 'react';
import { drugClassLabel } from './drugClassLabel';
import { Disclosure } from './Disclosure';
import { OUTCOME_EVIDENCE_TABLE, shrunkOutcomeRow, outcomeStats } from '../services/engine/outcomeBenefit';
import { SYMPTOM_TABLE, shrunkSymptomRow, symptomStats } from '../services/engine/symptomBenefit';
import { HARM_TABLE } from '../services/engine/harmBurden';
import { DOSE_EVIDENCE } from '../services/engine/doseCredit';
import harmDefinitionsJson from '../data/harmDefinitions.json';
import {
    efRangeText, basisLabel, harmLabel, harmLevelLabel, priorText, verificationLabel, populationKeyLabel, SYMPTOM_HEADING, SYMPTOM_UNIT, CONFLICT_NO_EFFECT_TEXT, DOSE_LEVEL_LABELS, EF_BAND_LABELS, MEASURE_LABELS, OUTCOME_SHORT, SEVERITY_LABELS, intervalText, fmtRR, fmtPoints, borrowedLines, outcomeRowUnweighted, evidenceRowNotes, harmRowNotes, doseRowNotes, doseNotMeasuredText, type DoseNoteRow, excessText,
} from './expectedEffectModel';

// Read-only tables rendered straight from the four evidence data files (data/outcomeEvidence.json, symptomEvidence.json, harmEvidence.json, doseEvidence.json).
// Nothing here is typed in; a row added to a file appears here.

const EFFECTS = new Map((harmDefinitionsJson as unknown as { effects: { effect: string; layer: string; severity?: string }[] }).effects.map(e => [e.effect, e]));
const classesOf = (c: string): string[] => c.split(' / ');

const Th: React.FC<{ children: string }> = ({ children }) => <th scope="col" className="px-3 py-2">{children}</th>;
const THEAD = 'bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider';
const Wrap: React.FC<{ caption: string; children: React.ReactNode }> = ({ caption, children }) => (
    <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-[52rem] w-full text-xs text-left"><caption className="sr-only">{caption}</caption>{children}</table>
    </div>
);
const BorrowedLines: React.FC<{ row: Parameters<typeof borrowedLines>[0] }> = ({ row }) => <>{borrowedLines(row).map(l => <span key={l} className="block font-normal text-slate-700" data-borrowed="1">{l}</span>)}</>;
/** A row with any caveat has a Notes disclosure; a row with none says so (U12), so a missing disclosure is never read as a missing check. */
const NotesBox: React.FC<{ lines: string[] }> = ({ lines }) => lines.length === 0 ? <p className="mt-1.5 text-[11px] text-slate-600" data-row-notes="none">No caveat recorded</p> : (
    <Disclosure className="mt-1.5 rounded border border-slate-200 bg-slate-50" buttonClassName="px-2 py-1 text-[11px] font-bold text-indigo-800 hover:bg-white" title="Notes">
        <ul className="list-disc space-y-1 px-5 pb-2 pt-1 text-slate-800" data-row-notes="1">{lines.map((l, i) => <li key={i}>{plainText(l)}</li>)}</ul>
    </Disclosure>
);
const Source: React.FC<{ trial: string; citation: string; verification?: string }> = ({ trial, citation, verification }) => <><span className="font-semibold">{plainText(trial)}.</span> {plainText(citation)}{verification && <span className="block text-slate-600">Checked: {verificationLabel(verification)}.</span>}</>;

export const EvidenceTables: React.FC = () => {
    const [cls, setCls] = useState('All');
    const classes = useMemo(() => ['All', ...[...new Set([
        ...OUTCOME_EVIDENCE_TABLE.flatMap(r => classesOf(r.drug_class)), ...SYMPTOM_TABLE.flatMap(r => classesOf(r.drug_class)),
        ...HARM_TABLE.rows.map(r => r.drug_class), ...DOSE_EVIDENCE.anchors.map(a => a.drug_class),
    ])].sort()], []);
    const match = (c: string) => cls === 'All' || classesOf(c).includes(cls);
    const outcomes = OUTCOME_EVIDENCE_TABLE.filter(r => match(r.drug_class));
    const symptoms = SYMPTOM_TABLE.filter(r => match(r.drug_class));
    const harms = HARM_TABLE.rows.filter(r => match(r.drug_class));
    const anchors = DOSE_EVIDENCE.anchors.filter(a => match(a.drug_class));
    const c0 = DOSE_EVIDENCE.start_dose_credit.value;
    const section = 'rounded-lg border border-slate-200 bg-white';
    const btn = 'px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50';
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600">
                These tables are read straight from the evidence files the ranking uses. Each figure is a published value and a value used: small or imprecise trials are pulled toward no effect in proportion to their uncertainty. All figures are population averages from trials, not predictions for an individual patient.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700">
                <li>A new drug is valued as titrated to the trial dose, but not beyond the highest dose allowed for this patient by kidney function, interactions and the maximum dose; an increase is valued at the dose it reaches.</li>
                <li>A drug with its own trial dose earns at least the fraction of that dose that is taken, so spironolactone 25 mg earns about 96% of its trial effect.</li>
                <li>Each relative risk is weighted against a prior of no effect, with one prior for death and a separate one for hospitalization, and a row that rests mostly on the prior is marked.</li>
                <li>For a patient in atrial fibrillation the beta-blocker death figure is the atrial fibrillation one, and it is never a reason to stop a beta-blocker used for rate control.</li>
            </ul>
            <div className="max-w-xs">
                <label htmlFor="evidence-class-filter" className="block text-sm font-semibold text-slate-700 mb-1">Filter by drug class</label>
                <select id="evidence-class-filter" value={cls} onChange={e => setCls(e.target.value)} className="block w-full rounded-md border border-slate-300 bg-white py-2 px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                    {classes.map(c => <option key={c} value={c}>{drugClassLabel(c)}</option>)}
                </select>
            </div>
            <p className="text-xs text-slate-600" role="status" aria-live="polite">Showing {outcomes.length} outcome rows, {symptoms.length} symptom rows, {harms.length} side-effect rows and {anchors.length} dose rows.</p>

            <Disclosure className={section} buttonClassName={btn} title={`Death and heart-failure hospitalization: relative risks (${outcomes.length})`}>
                <div className="px-4 pb-4 space-y-2">
                    <p className="text-xs text-slate-600">A figure below 1 means fewer events than the comparator named in the last column (placebo, usual care, or, for sacubitril/valsartan, enalapril joined to enalapril against placebo). Hazard, risk and odds ratios are treated alike; the measure is shown under each figure. &ldquo;Published&rdquo; is the source figure; &ldquo;Used&rdquo; is the value after precision weighting.</p>
                    <Wrap caption="Outcome evidence: drug class, ejection-fraction band, outcome, published and used relative risk, basis and source">
                        <thead className={THEAD}><tr><Th>Class</Th><Th>EF band</Th><Th>Outcome</Th><Th>Published</Th><Th>Used</Th><Th>Basis</Th><Th>Source</Th></tr></thead>
                        <tbody className="divide-y divide-slate-100 align-top">
                            {outcomes.map(r => {
                                const u = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, r);
                                return (
                                    <tr key={r.id} data-evidence-row="outcome" data-row-id={r.id}>
                                        <th scope="row" className="px-3 py-2 font-semibold text-slate-800 min-w-[9rem]">{drugClassLabel(r.drug_class)}<span className="block font-normal text-slate-600">{r.drugs.join(', ')}</span>{r.population_key && <span className="block font-normal text-slate-600">Applies to: {populationKeyLabel(r.drug_class, r.population_key)}</span>}</th>
                                        <td className="px-3 py-2">{EF_BAND_LABELS[r.ef_band]}{efRangeText(r) && <span className="block font-normal text-slate-700" data-ef-range="1">{efRangeText(r)}</span>}</td>
                                        <td className="px-3 py-2">{OUTCOME_SHORT[r.outcome]}</td>
                                        <td className="px-3 py-2 min-w-[9rem]">{r.conflicting_evidence ? <>{CONFLICT_NO_EFFECT_TEXT} <span className="block text-slate-600">{r.conflict_summary}</span></> : <>{fmtRR(r.rr)} ({intervalText(r.ci_low, r.ci_high).replace('95% interval ', '')}) <span className="block text-slate-600">{MEASURE_LABELS[r.measure] ?? r.measure}</span></>}</td>
                                        <td className="px-3 py-2 min-w-[9rem]"><>{fmtRR(u.rr_used)}<span className="block font-normal text-slate-600">{priorText(r.outcome === 'all_cause_death' ? 'death' : 'hospitalization', outcomeStats(OUTCOME_EVIDENCE_TABLE).tau2[r.outcome], u.B, outcomeRowUnweighted(r))}</span></></td>
                                        <td className="px-3 py-2 min-w-[8rem]">{basisLabel(r.basis, r.inferences)}<BorrowedLines row={r} /></td>
                                        <td className="px-3 py-2 min-w-[16rem] [overflow-wrap:anywhere]"><Source trial={r.source.trial} citation={r.source.citation} verification={r.verification} /><span className="block text-slate-600">Compared with: {r.comparator}.</span><NotesBox lines={evidenceRowNotes(r)} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Wrap>
                </div>
            </Disclosure>

            <Disclosure className={section} buttonClassName={btn} title={`Health status: KCCQ-equivalent points (${symptoms.length})`}>
                <div className="px-4 pb-4 space-y-2">
                    <p className="text-xs text-slate-600">{SYMPTOM_HEADING}: the placebo-subtracted change, higher is better. Some rows were measured on the Kansas City Cardiomyopathy Questionnaire (0 to 100 points) and some were converted from another questionnaire or combined from two steps; the Basis column says which, and the Instrument column names the original instrument. A class with no measurement says &ldquo;Not measured&rdquo;; it is not a measured zero.</p>
                    <Wrap caption="Symptom evidence: drug class, ejection-fraction band, published and used health-status points, instrument, basis and source">
                        <thead className={THEAD}><tr><Th>Class</Th><Th>EF band</Th><Th>Published</Th><Th>Used</Th><Th>Instrument</Th><Th>Basis</Th><Th>Source</Th></tr></thead>
                        <tbody className="divide-y divide-slate-100 align-top">
                            {symptoms.map(r => {
                                const u = shrunkSymptomRow(SYMPTOM_TABLE, r), nm = r.basis === 'not_measured';
                                return (
                                    <tr key={r.id} data-evidence-row="symptom" data-row-id={r.id}>
                                        <th scope="row" className="px-3 py-2 font-semibold text-slate-800 min-w-[9rem]">{drugClassLabel(r.drug_class)}</th>
                                        <td className="px-3 py-2">{EF_BAND_LABELS[r.ef_band]}{efRangeText(r) && <span className="block font-normal text-slate-700" data-ef-range="1">{efRangeText(r)}</span>}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{nm ? 'Not measured' : `${fmtPoints(r.kccq_points)} ${SYMPTOM_UNIT} (${intervalText(r.ci_low, r.ci_high, 1).replace('95% interval ', '')})`}</td>
                                        <td className="px-3 py-2 min-w-[9rem]">{nm ? 'Not measured' : <>{fmtPoints(u.used)} {SYMPTOM_UNIT}<span className="block font-normal text-slate-600">{priorText('symptom', symptomStats(SYMPTOM_TABLE).tau2, u.B)}</span></>}</td>
                                        <td className="px-3 py-2 min-w-[8rem]">{r.instrument}</td>
                                        <td className="px-3 py-2 min-w-[8rem]">{basisLabel(r.basis, r.inferences)}<BorrowedLines row={r} /></td>
                                        <td className="px-3 py-2 min-w-[16rem] [overflow-wrap:anywhere]"><Source trial={r.source.trial} citation={r.source.citation} verification={r.verification} /><NotesBox lines={evidenceRowNotes(r)} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Wrap>
                </div>
            </Disclosure>

            <Disclosure className={section} buttonClassName={btn} title={`Side effects: one-year excess harm rates (${harms.length})`}>
                <div className="px-4 pb-4 space-y-2">
                    <p className="text-xs text-slate-600">Excess is the percent of patients with the harm beyond control over one year, or over the window the source covers when that is shorter than a year (the window is then printed in the cell and the figure is used as observed, never scaled up). Severity weights are policy (mild 0.5, moderate 1, serious 3). Everyday symptoms are combined per drug; cross-check rows are not charged. A harm not measured for a drug is borrowed from a measured row of another class with the same mechanism, or not charged where no such row exists.</p>
                    <Wrap caption="Side-effect evidence: drug or class, harm, severity, one-year excess percent, evidence level and source">
                        <thead className={THEAD}><tr><Th>Drug</Th><Th>Harm</Th><Th>Severity</Th><Th>Excess per year</Th><Th>Evidence level</Th><Th>Source</Th></tr></thead>
                        <tbody className="divide-y divide-slate-100 align-top">
                            {harms.map(r => {
                                const def = EFFECTS.get(r.effect);
                                const sev = def?.severity ? SEVERITY_LABELS[def.severity] : r.layer === 'symptomFigure' ? 'everyday symptom (combined)' : 'not charged (cross-check)';
                                return (
                                    <tr key={r.id} data-evidence-row="harm" data-row-id={r.id}>
                                        <th scope="row" className="px-3 py-2 font-semibold text-slate-800 min-w-[9rem]">{r.drugs.length > 0 ? r.drugs.join(', ') : 'Whole class'}<span className="block font-normal text-slate-600">{drugClassLabel(r.drug_class)}</span></th>
                                        <td className="px-3 py-2">{harmLabel(r.effect)}</td>
                                        <td className="px-3 py-2">{sev}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{r.level === 'notMeasured' ? 'Not measured' : excessText(r.one_year_excess_pct, r.excess_window)}</td>
                                        <td className="px-3 py-2 min-w-[10rem]">{harmLevelLabel(r.level, r.upper_bound === true)}{r.level_note ? ` ${r.level_note}` : ''}{r.charge_when ? ' Charged only when a loop diuretic is also in the option.' : ''}</td>
                                        <td className="px-3 py-2 min-w-[16rem] [overflow-wrap:anywhere]"><Source trial={r.source.trial} citation={r.source.citation} verification={r.verification} /><NotesBox lines={harmRowNotes(r)} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Wrap>
                </div>
            </Disclosure>

            <Disclosure className={section} buttonClassName={btn} title={`Dose: the daily dose the trials achieved (${anchors.length})`}>
                <div className="px-4 pb-4 space-y-2">
                    <p className="text-xs text-slate-600">A drug earns full credit at the dose the trials achieved. Where no trial reported the dose reached, full credit is given at the dose the drug's label names as its target (or its maximum recommended dose), and where the label names none, at any dose. A drug left at a lower dose earns less. Credit at the label starting dose is {Math.round(c0 * 100)}% of the full effect, an estimate from two randomized dose comparisons (lisinopril in ATLAS, losartan in HEAAL) with large uncertainty (re-solved with the trials&apos; own high doses it is about 41%), carried to every other class.</p>
                    <Wrap caption="Dose anchors: drug, class, full-credit daily dose, share of the target dose, evidence level and trial">
                        <thead className={THEAD}><tr><Th>Drug</Th><Th>Full-credit daily dose</Th><Th>Share of target</Th><Th>Evidence level</Th><Th>Applies when</Th><Th>Trial</Th></tr></thead>
                        <tbody className="divide-y divide-slate-100 align-top">
                            {anchors.map(a => (
                                <tr key={a.id} data-evidence-row="dose">
                                    <th scope="row" className="px-3 py-2 font-semibold text-slate-800 min-w-[9rem]">{a.drug}<span className="block font-normal text-slate-600">{drugClassLabel(a.drug_class)}</span></th>
                                    <td className="px-3 py-2 whitespace-nowrap">{a.full_credit_daily_mg === null ? 'Not measured' : `${Math.round(a.full_credit_daily_mg * 10) / 10} ${a.unit ?? 'mg'}`}{(a as { dose_population?: string | null }).dose_population ? <span className="block font-normal text-slate-600 whitespace-normal">Whose mean: {(a as { dose_population?: string | null }).dose_population}</span> : null}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{typeof a.achieved_fraction_of_target === 'number' ? `${Math.round(a.achieved_fraction_of_target * 100)}%` : 'Not measured'}</td>
                                    <td className="px-3 py-2 min-w-[10rem]">{doseNotMeasuredText(a as unknown as DoseNoteRow) ?? DOSE_LEVEL_LABELS[a.level] ?? a.level}</td>
                                    <td className="px-3 py-2 min-w-[10rem]">{(a.condition as { text?: string } | null)?.text ?? 'All patients'}</td>
                                    <td className="px-3 py-2 min-w-[16rem] [overflow-wrap:anywhere]"><Source trial={a.trial} citation={a.source.citation} verification={a.verification} /><NotesBox lines={doseRowNotes(a as unknown as DoseNoteRow)} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Wrap>
                </div>
            </Disclosure>
        </div>
    );
};
