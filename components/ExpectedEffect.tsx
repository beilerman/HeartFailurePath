import React, { useId, useMemo } from 'react';
import type { ScoredRegimen, OutcomeContributorView } from '../types';
import { Disclosure } from './Disclosure';
import { OUTCOME_EVIDENCE_TABLE } from '../services/engine/outcomeBenefit';
import { SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import {
    buildExpectedEffect, outcomeLineText, symptomsLineText, burdenLineText, fmtRR, fmtInterval, intervalNoEffectNote, fmtSigned, fmtPoints, movedReason, intervalText,
    basisLabel, harmLevelLabel, harmLabel, MEASURE_LABELS, OUTCOME_SHORT, SEVERITY_LABELS, POPULATION_AVERAGE_NOTE, type OutcomeLine,
} from './expectedEffectModel';

// Screens for the model's expected effect. All numbers come from the engine output (see expectedEffect.ts); this file only phrases them.

const toneFor = (d: 'lower' | 'higher' | 'same', lowerIsGood: boolean) => d === 'same' ? 'text-slate-800' : (d === 'lower') === lowerIsGood ? 'text-emerald-800' : 'text-red-800';
const directionMark = (d: 'lower' | 'higher' | 'same') => d === 'lower' ? '↓' : d === 'higher' ? '↑' : '→';

const OutcomeRow: React.FC<{ o: OutcomeLine }> = ({ o }) => (
    <li className="text-sm text-slate-800">
        <span className={`font-semibold ${toneFor(o.change.direction, true)}`}><span aria-hidden="true">{directionMark(o.change.direction)} </span>{outcomeLineText(o)}</span>
        {o.todays && (
            <span className="block text-xs text-slate-600 mt-0.5">
                At today&apos;s doses: {o.todays.change.text} (relative risk {fmtRR(o.todays.rr)}, {fmtInterval(o.todays.lo, o.todays.hi)}{intervalNoEffectNote(o.todays.lo, o.todays.hi)})
            </span>
        )}
    </li>
);

/** "Expected effect (trial averages)" block for one option, compared with the current regimen, with the evidence behind it one keypress away. */
export const ExpectedEffectBlock: React.FC<{ regimen: ScoredRegimen; rank: number }> = ({ regimen, rank }) => {
    const view = useMemo(() => buildExpectedEffect(regimen), [regimen]);
    const headingId = `expected-effect-${rank}`;
    if (!view) return null;
    const { symptoms, sideEffects } = view;
    const symDir: 'lower' | 'higher' | 'same' = Math.abs(Math.round(symptoms.delta * 10) / 10) === 0 ? 'same' : symptoms.delta > 0 ? 'higher' : 'lower';
    const burdenDir: 'lower' | 'higher' | 'same' = Math.abs(Math.round(sideEffects.burdenChange * 10) / 10) === 0 ? 'same' : sideEffects.burdenChange > 0 ? 'higher' : 'lower';
    return (
        <section aria-labelledby={headingId} className="px-6 py-4 border-b border-slate-100 bg-emerald-50/40">
            <h4 id={headingId} className="text-sm font-bold text-slate-800 mb-0.5">Expected effect (trial averages)</h4>
            {view.noChange ? (
                <p className="text-sm font-semibold text-slate-800">No medication change is proposed in this option, so there is no change in expected effect compared with the current regimen.</p>
            ) : (
                <>
                    <p className="text-xs text-slate-600 mb-2">Compared with the current regimen. New drugs and increases are valued as titrated the way the trials did (&ldquo;as planned&rdquo;).</p>
                    <ul className="space-y-1.5">
                        {view.outcomes.map(o => <OutcomeRow key={o.outcome} o={o} />)}
                        <li className="text-sm text-slate-800">
                            <span className={`font-semibold ${toneFor(symDir, false)}`}><span aria-hidden="true">{directionMark(symDir === 'same' ? 'same' : symDir)} </span>{symptomsLineText(symptoms.delta)}</span>
                            {symptoms.todays !== undefined && <span className="block text-xs text-slate-600 mt-0.5">At today&apos;s doses: {fmtSigned(symptoms.todays)} KCCQ points</span>}
                            {symptoms.notMeasured.length > 0 && <span className="block text-xs text-slate-600 mt-0.5">Not measured, so not counted: {symptoms.notMeasured.join(', ')}.</span>}
                        </li>
                        <li className="text-sm text-slate-800">
                            <span className={`font-semibold ${toneFor(burdenDir, true)}`}><span aria-hidden="true">{directionMark(burdenDir)} </span>{burdenLineText(sideEffects.burdenChange)}</span>
                            {sideEffects.top.length > 0 && (
                                <span className="block text-xs text-slate-600 mt-0.5">
                                    Largest contributors to the change: {sideEffects.top.map(t => `${t.drug}, ${t.label} (${fmtSigned(t.delta)})`).join('; ')}.
                                </span>
                            )}
                        </li>
                    </ul>
                </>
            )}
            <p className="text-xs text-slate-700 mt-2">{POPULATION_AVERAGE_NOTE}</p>
            <Disclosure
                className="mt-2 rounded-lg border border-slate-200 bg-white"
                buttonClassName="px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-slate-50"
                title="Evidence behind these estimates"
            >
                <div className="px-3 pb-3"><EvidenceDrillDown regimen={regimen} /></div>
            </Disclosure>
        </section>
    );
};

// ---- drill-down ----

const Fact: React.FC<{ term: string; children: React.ReactNode }> = ({ term, children }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[7.5rem_1fr] sm:gap-x-2 text-xs mb-1 sm:mb-0"><dt className="font-semibold text-slate-600">{term}</dt><dd className="text-slate-800 [overflow-wrap:anywhere]">{children}</dd></div>
);

const OutcomeContributorItem: React.FC<{ c: OutcomeContributorView; counted: boolean; note?: string }> = ({ c, counted, note }) => {
    const row = OUTCOME_EVIDENCE_TABLE.find(r => r.id === c.row_id);
    const moved = movedReason(c.rr_published, c.rr);
    return (
        <li className="rounded border border-slate-200 bg-slate-50 p-2.5">
            <p className="text-sm font-bold text-slate-900">{c.medication} <span className="font-normal text-slate-600">({c.drug_class}){counted ? '' : ' — not counted'}</span></p>
            {note && <p className="text-xs text-slate-700 mb-1">{note}</p>}
            <dl className="space-y-0.5">
                <Fact term="Published">relative risk {fmtRR(c.rr_published)} ({intervalText(c.ci_low_published, c.ci_high_published)}){row ? `, ${MEASURE_LABELS[row.measure] ?? row.measure}` : ''}</Fact>
                <Fact term="Value used">{fmtRR(c.rr)}{moved ? `. ${moved}` : '. Unchanged.'}{c.interval_imputed ? ' No interval was published; the spread of similar trials was assumed.' : ''}</Fact>
                <Fact term="Dose credit">{Math.round(c.credit * 100)}%{c.drug_class === 'Loop Diuretic' ? '. No measured dose relation, so full credit at any dose; congestion relief by dose is not modelled.' : c.valued_as_titrated ? '. Started or increased in this option, so valued as titrated to the dose the trials achieved.' : '. Valued at today’s dose.'}</Fact>
                <Fact term="Trial">{c.trial}</Fact>
                <Fact term="Citation">{c.citation}</Fact>
                <Fact term="Basis">{basisLabel(c.basis)}</Fact>
            </dl>
        </li>
    );
};

const OutcomeEvidence: React.FC<{ regimen: ScoredRegimen; which?: 'all_cause_death' | 'hf_hospitalization' }> = ({ regimen, which }) => {
    const base = useId();
    return (
    <>
        {(regimen.outcome_estimates ?? []).filter(o => !which || o.outcome === which).map(o => (
            <section key={o.outcome} aria-labelledby={`${base}-${o.outcome}`} className="space-y-1.5">
                <h5 id={`${base}-${o.outcome}`} className="text-sm font-bold text-slate-800">{OUTCOME_SHORT[o.outcome]}: drug by drug</h5>
                <p className="text-xs text-slate-700">
                    This option together: relative risk {fmtRR(o.as_planned.rr)} ({fmtInterval(o.as_planned.ci_low, o.as_planned.ci_high)}) compared with no disease-modifying therapy, as planned; {fmtRR(o.as_prescribed.rr)} at today&apos;s doses.
                    Versus the current regimen: {fmtRR(o.vs_current.rr)} ({fmtInterval(o.vs_current.ci_low, o.vs_current.ci_high)}). The interval assumes the drug effects are independent.
                </p>
                <ul className="space-y-1.5">
                    {o.contributors.map(c => <OutcomeContributorItem key={c.row_id + c.medication} c={c} counted />)}
                    {o.not_counted.map(c => <OutcomeContributorItem key={`nc-${c.row_id}${c.medication}`} c={c} counted={false} note={`Same mechanism as ${c.counted_instead}; only the larger effect is counted.`} />)}
                </ul>
                {o.contributors_without_interval.length > 0 && <p className="text-xs text-slate-700">No published interval for {o.contributors_without_interval.join(', ')}, so the interval above understates the uncertainty.</p>}
            </section>
        ))}
    </>
    );
};

const SymptomEvidence: React.FC<{ regimen: ScoredRegimen }> = ({ regimen }) => {
    const est = regimen.symptom_estimate;
    const hid = useId();
    if (!est) return null;
    const item = (c: (typeof est.contributors)[number], counted: boolean) => {
        const row = SYMPTOM_TABLE.find(r => r.id === c.row_id);
        const moved = movedReason(c.kccq_points_published, c.kccq_points, 1);
        return (
            <li key={`${counted}-${c.row_id}-${c.medication}`} className="rounded border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-sm font-bold text-slate-900">{c.medication} <span className="font-normal text-slate-600">({c.drug_class}){counted ? '' : ' — not counted'}</span></p>
                <dl className="space-y-0.5">
                    {c.not_measured ? (
                        <Fact term="Published">Not measured: no trial reported a KCCQ change for this class. It adds nothing to the symptom estimate (this is not a measured zero).</Fact>
                    ) : (
                        <>
                            <Fact term="Published">{fmtPoints(c.kccq_points_published)} KCCQ points ({intervalText(c.ci_low, c.ci_high, 1)})</Fact>
                            <Fact term="Value used">{fmtPoints(c.kccq_points)} points{moved ? `. ${moved}` : '. Unchanged.'}{c.interval_imputed ? ' No interval was published; the spread of similar trials was assumed.' : ''}</Fact>
                            <Fact term="Dose credit">{Math.round(c.credit * 100)}%. Contributes {fmtPoints(c.points)} points.</Fact>
                        </>
                    )}
                    {row && <Fact term="Instrument">{row.instrument}</Fact>}
                    <Fact term="Trial">{c.trial}</Fact>
                    <Fact term="Citation">{c.citation}</Fact>
                    <Fact term="Basis">{basisLabel(c.basis)}</Fact>
                </dl>
            </li>
        );
    };
    return (
        <section aria-labelledby={hid} className="space-y-1.5">
            <h5 id={hid} className="text-sm font-bold text-slate-800">Symptoms and quality of life (KCCQ): drug by drug</h5>
            <p className="text-xs text-slate-700">This option: {fmtPoints(est.points)} KCCQ points in total, as planned. Points are added across drugs; no trial measured the combinations, so this is an assumption. 20 points is a large clinical change and earns the full symptom score.</p>
            <ul className="space-y-1.5">{est.contributors.map(c => item(c, true))}{est.not_counted.map(c => item(c, false))}</ul>
        </section>
    );
};

const SideEffectEvidence: React.FC<{ regimen: ScoredRegimen }> = ({ regimen }) => {
    const hb = regimen.harm_burden;
    const hid = useId();
    if (!hb) return null;
    const drugs = [...new Set(hb.lines.map(l => l.drug))];
    return (
        <section aria-labelledby={hid} className="space-y-1.5">
            <h5 id={hid} className="text-sm font-bold text-slate-800">Side effects: line by line</h5>
            <p className="text-xs text-slate-700">
                Total burden {fmtPoints(hb.burden)} points. Each line is the one-year excess rate (percent of patients) times a severity weight; harm is charged in full at the trial rate. A rate below zero is not charged. Everyday symptoms are combined into one figure per drug.
            </p>
            {drugs.map(drug => (
                <div key={drug}>
                    <h6 className="text-xs font-bold text-slate-700 uppercase tracking-wide mt-2 mb-1">{drug}</h6>
                    <ul className="space-y-1.5">
                        {hb.lines.filter(l => l.drug === drug).map((l, i) => l.kind === 'harm' ? (
                            <li key={`${l.row_id}-${i}`} className="rounded border border-slate-200 bg-slate-50 p-2.5">
                                <p className="text-sm font-semibold text-slate-900">{harmLabel(l.effect)} <span className="font-normal text-slate-600">({SEVERITY_LABELS[l.severity]}, weight {l.weight})</span></p>
                                <dl className="space-y-0.5">
                                    <Fact term="Rate">{fmtPoints(l.measured_rate)}% measured over one year{l.multipliers.length > 0 ? `; ${fmtPoints(l.adjusted_rate)}% after the patient-specific adjustment` : ''}; {fmtPoints(l.charged_rate)}% charged.{l.split_from ? ' Counts only the patients below the severe threshold.' : ''}</Fact>
                                    <Fact term="Points">{fmtPoints(l.points)}</Fact>
                                    <Fact term="Evidence">{harmLevelLabel(l.level, l.upper_bound)}{l.dose_relation_measured ? '. Rate follows the measured dose groups.' : ''}</Fact>
                                    {l.multipliers.length > 0 && <Fact term="Adjusted for">{l.multipliers.map(m => `×${m.ratio.toFixed(2)} (${m.trial})`).join('; ')}{l.multipliers_combined ? '. Several adjustments are multiplied together; that is an assumption.' : ''}</Fact>}
                                    {l.assumed_because_unknown && <Fact term="Assumed">Assumed because {l.assumed_because_unknown} is not recorded: the higher-risk case is charged.</Fact>}
                                </dl>
                            </li>
                        ) : (
                            <li key={`sym-${i}`} className="rounded border border-slate-200 bg-slate-50 p-2.5">
                                <p className="text-sm font-semibold text-slate-900">Everyday symptoms, combined <span className="font-normal text-slate-600">(weight {l.weight})</span></p>
                                <dl className="space-y-0.5">
                                    <Fact term="Figure">{fmtPoints(l.figure)}% of patients with at least one of the listed symptoms; {fmtPoints(l.points)} points.</Fact>
                                    {l.components.map((c, j) => (
                                        <Fact key={j} term={harmLabel(c.effect)}>
                                            {fmtPoints(c.measured_rate)}% measured{c.multipliers.length > 0 ? `, ${fmtPoints(c.adjusted_rate)}% adjusted` : ''}, {fmtPoints(c.charged_rate)}% charged. {harmLevelLabel(c.level, c.upper_bound)}.
                                        </Fact>
                                    ))}
                                </dl>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {hb.unknown_assumptions.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-2.5">
                    <p className="text-xs font-bold text-amber-900">A patient value is missing: the higher-risk case is assumed</p>
                    <p className="text-xs text-amber-950">An unknown value never makes an option look safer. Where it matters, the harm is charged as the higher-risk case; an adjustment that would lower the risk is not applied.</p>
                    <ul className="list-disc pl-4 text-xs text-amber-950">
                        {hb.unknown_assumptions.map((a, i) => <li key={i}>{a.drug}, {harmLabel(a.effect)}: {a.text}</li>)}
                    </ul>
                </div>
            )}
        </section>
    );
};

export type EvidenceFocus = 'all_cause_death' | 'hf_hospitalization' | 'symptoms' | 'side_effects';

/** The numbers and sources behind an option's expected effect. `focus` limits it to one domain (used by the score dialogs). */
export const EvidenceDrillDown: React.FC<{ regimen: ScoredRegimen; focus?: EvidenceFocus }> = ({ regimen, focus }) => (
    <div className="space-y-4">
        {(!focus || focus === 'all_cause_death' || focus === 'hf_hospitalization') && <OutcomeEvidence regimen={regimen} which={focus === 'all_cause_death' || focus === 'hf_hospitalization' ? focus : undefined} />}
        {(!focus || focus === 'symptoms') && <SymptomEvidence regimen={regimen} />}
        {(!focus || focus === 'side_effects') && <SideEffectEvidence regimen={regimen} />}
        <p className="text-xs text-slate-600">Each figure has a published value and a value used. Small or imprecise trials are pulled toward no effect in proportion to their uncertainty. The full tables are on the Evidence tab.</p>
    </div>
);
