import React, { useEffect, useRef, useState } from 'react';
import type { Patient } from '../../types';
import { FormSection, usePatientFormModel } from '../patient-form/usePatientFormModel';
import { REVIEW_STEP, STEPS, stepForField } from './steps';
import { ReviewStep } from './ReviewStep';
import { confirmUnassessedUse, type ConfirmResult } from './confirmUse';

interface StepsScreenProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    /** Current step, 0-based. Owned by the app so the step survives switching views. */
    step: number;
    onStepChange: (step: number) => void;
    /** The existing run action; the Review step calls it behind the same validation gate. */
    onRun: () => void;
    onPendingChange?: (pending: boolean) => void;
    onBackToStart?: () => void;
    pricesReady: boolean;
    priceLoadError?: string | null;
    onRetryPrices?: () => void;
}

const navBtn = 'min-h-[44px] rounded-lg px-5 py-2.5 text-base font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';

export const StepsScreen: React.FC<StepsScreenProps> = ({ patientData, setPatientData, step, onStepChange, onRun, onPendingChange, onBackToStart, pricesReady, priceLoadError, onRetryPrices }) => {
    // The same state, validation and field handlers as the sidebar form. All step panels stay mounted (hidden when
    // not current), so an unfinished medication or history entry is not lost when the step changes.
    const model = usePatientFormModel({ patientData, setPatientData, onPendingChange });
    const headingRef = useRef<HTMLHeadingElement>(null);
    const navRef = useRef<HTMLElement>(null);
    const focusAfterStep = useRef<string | null>(null);
    const first = useRef(true);
    const [confirmNote, setConfirmNote] = useState<Pick<ConfirmResult, 'confirmed' | 'leftAlone'> | undefined>(undefined);

    // Focus moves to the step heading when the step changes (or to a specific field when arriving from an error link).
    useEffect(() => {
        const field = focusAfterStep.current; focusAfterStep.current = null;
        if (first.current) { first.current = false; headingRef.current?.focus({ preventScroll: true }); return; }
        navRef.current?.scrollIntoView({ block: 'start' });
        if (field) { model.focusField(field); return; }
        headingRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    const attention = new Set<number>();
    for (const [field] of model.problemEntries) attention.add(stepForField(field));

    const goToStep = (i: number) => onStepChange(Math.min(REVIEW_STEP, Math.max(0, i)));
    const goToField = (field: string) => {
        const target = stepForField(field);
        if (target === step) { model.focusField(field); return; }
        focusAfterStep.current = field;
        goToStep(target);
    };

    return (
        <div className="pb-12">
            <nav ref={navRef} aria-label="Steps" className="mb-5">
                <ol className="hidden flex-wrap gap-2 sm:flex">
                    {STEPS.map((s, i) => {
                        const current = i === step;
                        return (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    onClick={() => goToStep(i)}
                                    aria-current={current ? 'step' : undefined}
                                    className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${current ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-indigo-400'}`}
                                >
                                    <span className={`mr-1.5 ${current ? 'text-indigo-100' : 'text-slate-500'}`}>{i + 1}</span>{s.label}
                                    {attention.has(i) && <><span aria-hidden="true" className="ml-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-500 align-middle" /><span className="sr-only"> needs attention</span></>}
                                </button>
                            </li>
                        );
                    })}
                </ol>
                {/* Small screens: one labelled menu instead of seven wrapped buttons. */}
                <div className="sm:hidden">
                    <label htmlFor="guided-step-select" className="mb-1 block text-sm font-semibold text-slate-700">Go to step</label>
                    <select
                        id="guided-step-select"
                        value={step}
                        onChange={e => goToStep(Number(e.target.value))}
                        className="block min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                        {STEPS.map((s, i) => <option key={s.id} value={i}>{`Step ${i + 1} of ${STEPS.length}: ${s.label}${attention.has(i) ? ' (needs attention)' : ''}`}</option>)}
                    </select>
                </div>
            </nav>

            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 ref={headingRef} tabIndex={-1} id="guided-step-heading" className="text-2xl font-bold tracking-tight text-slate-900 focus:outline-none">
                    <span className="text-slate-500">Step {step + 1} of {STEPS.length}: </span>{STEPS[step].label}
                </h2>
                {onBackToStart && <button type="button" onClick={onBackToStart} className="min-h-[44px] rounded px-2 text-sm font-semibold text-indigo-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Choose a different patient</button>}
            </div>

            {model.urgentFindings.length > 0 && (
                <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
                    <p className="font-bold">Recorded findings need prompt clinical review</p>
                    <ul className="mt-2 list-disc space-y-2 pl-5">{model.urgentFindings.map(finding => <li key={finding}>{finding}</li>)}</ul>
                    <p className="mt-2">These findings remain visible while other entries are incomplete or being corrected.</p>
                </div>
            )}

            {STEPS.map((s, i) => (
                <section key={s.id} hidden={i !== step} aria-labelledby={i === step ? 'guided-step-heading' : undefined} id={s.id === 'review' ? 'guided-review' : `guided-step-${s.id}`}>
                    {s.id === 'review' ? (
                        <ReviewStep
                            patient={patientData}
                            problems={model.problemEntries}
                            hints={model.clinicalWarnings}
                            hasErrors={model.hasValidationErrors}
                            onGoToField={goToField}
                            onRun={onRun}
                            pricesReady={pricesReady}
                            priceLoadError={priceLoadError}
                            onRetryPrices={onRetryPrices}
                            onConfirmAllUse={() => { const res = confirmUnassessedUse(patientData.current_regimen); setPatientData(prev => ({ ...prev, current_regimen: confirmUnassessedUse(prev.current_regimen).regimen })); setConfirmNote({ confirmed: res.confirmed, leftAlone: res.leftAlone }); }}
                            confirmNote={confirmNote}
                        />
                    ) : (
                        <div className={`guided-fields grid gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 [&>section]:!mt-0 ${s.sections.length > 1 ? 'lg:grid-cols-2' : ''}`}>
                            {s.sections.map(id => <FormSection key={id} id={id} model={model} />)}
                        </div>
                    )}
                </section>
            ))}

            <div className="mt-6 flex items-center justify-between gap-3">
                {step > 0
                    ? <button type="button" onClick={() => goToStep(step - 1)} className={`${navBtn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>Back</button>
                    : <span />}
                {step < REVIEW_STEP && <button type="button" onClick={() => goToStep(step + 1)} className={`${navBtn} bg-indigo-600 text-white hover:bg-indigo-700`}>Next: {STEPS[step + 1].label}</button>}
            </div>
        </div>
    );
};
