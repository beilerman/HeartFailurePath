import React from 'react';
import type { Patient } from '../../types';
import { STEPS, stepForField } from './steps';
import { enteredFacts } from './patientFacts';
import { blankCoreItems } from './reviewModel';
import { isUseConfirmed, isUseNotAssessed, useStatusWords, type ConfirmResult } from './confirmUse';

interface ReviewStepProps {
    patient: Patient;
    /** [field, message] pairs: input errors plus unfinished entries (same list the sidebar form shows). */
    problems: string[][];
    /** The form's own on-screen hints, keyed by field. */
    hints: Record<string, string>;
    hasErrors: boolean;
    onGoToField: (field: string) => void;
    onRun: () => void;
    pricesReady: boolean;
    priceLoadError?: string | null;
    onRetryPrices?: () => void;
    /** Marks every entered drug as taking as recorded with consistent use (one control for the whole list). */
    onConfirmAllUse?: () => void;
    /** What the last use of the control did (shown while it is still true of the regimen). */
    confirmNote?: Pick<ConfirmResult, 'confirmed' | 'leftAlone'>;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({ patient, problems, hints, hasErrors, onGoToField, onRun, pricesReady, priceLoadError, onRetryPrices, onConfirmAllUse, confirmNote }) => {
    const unconfirmed = patient.current_regimen.filter(r => !isUseConfirmed(r));
    const notAssessed = unconfirmed.filter(isUseNotAssessed);
    const recordedOther = unconfirmed.filter(r => !isUseNotAssessed(r));
    // The result of the last click, kept only while it is still true: each drug it confirmed is still confirmed, each it left alone is still unconfirmed.
    const stillConfirmed = (confirmNote?.confirmed ?? []).filter(n => patient.current_regimen.some(r => r.med.name === n && isUseConfirmed(r)));
    const stillLeft = (confirmNote?.leftAlone ?? []).filter(x => patient.current_regimen.some(r => r.med.name === x.name && !isUseConfirmed(r)));
    const missing = blankCoreItems(patient, hints);
    const entered = enteredFacts(patient);
    return (
        <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">What you entered</h3>
                    {entered.length === 0 && <p className="mt-2 text-sm text-slate-700">Nothing entered yet.</p>}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                        {entered.map(f => (
                            <div key={f.label} className="min-w-0">
                                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{f.label}</dt>
                                <dd className={`mt-0.5 break-words text-sm ${f.entered ? 'font-bold text-slate-900' : 'italic text-slate-600'}`}>
                                    {f.value}
                                    {f.detail && <span className="block text-xs font-normal text-slate-700">{f.detail}</span>}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">Not entered yet</h3>
                    {missing.length === 0
                        ? <p className="mt-2 text-sm text-slate-700">All core items have a value.</p>
                        : <>
                            <p className="mt-1 text-sm text-slate-700">A blank narrows the review rather than blocking it. Not entered does not mean normal or absent; the results say which decisions wait for each missing item.</p>
                            <ul className="mt-3 space-y-2 text-sm text-slate-800">
                                {missing.map(m => (
                                    <li key={m.label}>
                                        <span className="font-semibold">{m.label}</span><span className="text-slate-600">: Not entered</span>
                                        {m.hint && <span className="mt-0.5 block text-xs text-slate-700">{m.hint}</span>}
                                    </li>
                                ))}
                            </ul>
                        </>}
                </div>
            </div>

            {confirmNote && (stillConfirmed.length > 0 || stillLeft.length > 0) && (
                <div role="status" className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950" data-testid="confirm-result">
                    <p className="font-bold">{stillConfirmed.length === 0 ? 'No drug was confirmed' : `${stillConfirmed.length} ${stillConfirmed.length === 1 ? 'drug' : 'drugs'} confirmed as taking as recorded: ${stillConfirmed.join(', ')}`}.</p>
                    {stillLeft.length > 0 && <p className="mt-1">Left as you recorded them, not confirmed: {stillLeft.map(x => `${x.name} (${x.recorded})`).join('; ')}.</p>}
                </div>
            )}

            {unconfirmed.length > 0 && (
                <div role="status" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5" data-testid="unconfirmed-use">
                    <h3 className="text-lg font-bold text-amber-950">Current use is not confirmed ({unconfirmed.length} {unconfirmed.length === 1 ? 'drug' : 'drugs'})</h3>
                    <p className="mt-1 text-sm text-amber-950">The use and course history is not confirmed for {unconfirmed.map(r => r.med.name).join(', ')}. Their doses will not be changed until they are confirmed: no increase or substitution is offered for them, although a reduction or stop that a safety rule requires is still shown.</p>
                    <p className="mt-1 text-sm text-amber-950">Confirm each drug under Medications (&ldquo;Use and course history&rdquo;){notAssessed.length > 0 ? ', or confirm the ones not yet assessed all at once if they are taken as recorded' : ''}.</p>
                    {onConfirmAllUse && notAssessed.length > 0 && <button type="button" onClick={onConfirmAllUse} className="mt-3 min-h-[44px] rounded-lg border-2 border-amber-700 bg-white px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">Confirm all as taking as recorded ({notAssessed.length} not yet assessed)</button>}
                    <p className="mt-1 text-xs text-amber-900">This changes only drugs whose use has not been assessed: {notAssessed.length > 0 ? notAssessed.map(r => r.med.name).join(', ') : 'none now'}. It sets current use to &ldquo;Taking as recorded&rdquo; and consistency of use to &ldquo;Consistent use confirmed&rdquo;. Check that it matches what the patient actually takes.</p>
                    {recordedOther.length > 0 && <p className="mt-1 text-xs text-amber-900">It leaves alone what you recorded for {recordedOther.map(r => `${r.med.name} (${useStatusWords(r.exposure)}${r.exposure?.adherence ? `; ${r.exposure.adherence === 'partial' ? 'partial or interrupted use' : r.exposure.adherence === 'unknown' ? 'consistency unknown' : 'consistent use confirmed'}` : ''})`).join(', ')}.</p>}
                </div>
            )}

            {problems.length > 0 && (
                <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-5">
                    <h3 className="text-lg font-bold text-red-900">Fix before you can run the review ({problems.length})</h3>
                    <ul className="mt-2 space-y-1.5 text-sm text-red-900">
                        {problems.map(([field, msg]) => (
                            <li key={field}>
                                <button type="button" onClick={() => onGoToField(field)} className="min-h-[32px] text-left underline hover:text-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded">{msg}</button>
                                <span className="text-red-800"> (step {stepForField(field) + 1}: {STEPS[stepForField(field)].label})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {priceLoadError && (
                <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>Pricing could not be loaded: {priceLoadError}. Clinical review can continue; affordability will be unassessed.</p>
                    {onRetryPrices && <button type="button" onClick={onRetryPrices} className="mt-1 font-bold underline focus-visible:ring-2">Retry pricing</button>}
                </div>
            )}

            <div>
                <button
                    type="button"
                    onClick={onRun}
                    disabled={hasErrors}
                    className="min-h-[52px] w-full rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-3 text-lg font-bold text-white transition-all hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
                >{hasErrors ? 'Correct or save entries to review' : 'Review available information'}</button>
                <p className="mt-2 text-xs text-slate-700">Missing information narrows the review; invalid values and unfinished entries must be corrected. {!pricesReady && !priceLoadError && patient.insurance_tier ? 'Prices are loading; cost assessment waits for them.' : ''}</p>
            </div>
        </div>
    );
};
