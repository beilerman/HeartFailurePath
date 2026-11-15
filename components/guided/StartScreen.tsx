import React from 'react';
import { DEMO_CASES, caseFacts, demoPatient } from './demoCases';

interface StartScreenProps {
    /** Loads the named scenario and runs the review. */
    onOpenExample: (scenarioTitle: string) => void;
    /** Starts the steps with a blank patient. */
    onNewPatient: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onOpenExample, onNewPatient }) => (
    <div className="space-y-8 pb-12">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5" role="note">
            <p className="text-sm font-semibold text-amber-900">
                Research decision support for heart-failure medication review. Check proposed changes, safety warnings, monitoring and affordability with the patient before choosing treatment.
            </p>
        </div>

        <section aria-labelledby="examples-heading">
            <h2 id="examples-heading" className="text-2xl font-bold text-slate-900 tracking-tight">Example patients</h2>
            <p className="mt-1 max-w-3xl text-base text-slate-700">
                These six are synthetic examples made up for demonstration, not real patients. Each opens with its inputs filled in and runs the review straight away.
            </p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {DEMO_CASES.map(d => (
                    <li key={d.scenarioTitle} className="flex">
                        <article className="flex w-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                            <p className="self-start rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-700">Synthetic example</p>
                            <h3 className="mt-3 text-lg font-bold text-slate-900">{d.title}</h3>
                            <p className="mt-1 text-sm text-slate-700">{d.sentence}</p>
                            <ul className="mt-3 space-y-1 text-sm text-slate-800">
                                {caseFacts(demoPatient(d)).map(fact => <li key={fact} className="flex gap-2"><span aria-hidden="true" className="text-slate-400">•</span><span>{fact}</span></li>)}
                            </ul>
                            <div className="mt-auto pt-5">
                            <button
                                type="button"
                                onClick={() => onOpenExample(d.scenarioTitle)}
                                aria-label={`Open and review: ${d.title} (synthetic example)`}
                                className="min-h-[44px] w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-base font-bold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            >Open and review</button>
                            </div>
                        </article>
                    </li>
                ))}
            </ul>
        </section>

        <section aria-labelledby="new-patient-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
                <h2 id="new-patient-heading" className="text-xl font-bold text-slate-900">Your own patient</h2>
                <p className="mt-1 text-sm text-slate-700">Enter a case step by step. Leave out anything you do not know; the review says which decisions then wait.</p>
            </div>
            <button
                type="button"
                onClick={onNewPatient}
                className="mt-4 min-h-[44px] w-full rounded-lg border-2 border-indigo-600 bg-white px-5 py-2.5 text-base font-bold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:mt-0 sm:w-auto sm:flex-shrink-0"
            >New patient</button>
        </section>
    </div>
);
