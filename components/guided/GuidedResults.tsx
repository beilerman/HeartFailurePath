import React from 'react';
import type { Patient } from '../../types';
import { ErrorBoundary } from '../ErrorBoundary';
import { ResultsDisplay } from '../ResultsDisplay';
import { PatientBar } from './PatientBar';

interface GuidedResultsProps {
    patient: Patient;
    caseLabel: string;
    onEditInputs: () => void;
    onNewPatient: () => void;
    /** An example is loading and about to run. */
    running: boolean;
    /** Bumped on every run attempt so a latched render error never hides the newest outcome. */
    attempt: number;
    /** Show the lead research notice (the results carry their own once they exist). */
    showNotice: boolean;
    resultsProps: React.ComponentProps<typeof ResultsDisplay>;
}

/** The guided Results phase: patient bar (the one place the case label appears) above the existing results. */
export const GuidedResults: React.FC<GuidedResultsProps> = ({ patient, caseLabel, onEditInputs, onNewPatient, running, attempt, showNotice, resultsProps }) => (
    <div className="[&_[aria-label='Analysis_results']]:scroll-mt-60">
        {showNotice && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 print:hidden" role="note">
                <p className="text-xs font-semibold text-amber-900">Research decision support. Review safety checks before choosing treatment.</p>
            </div>
        )}
        <PatientBar patient={patient} caseLabel={caseLabel} onEditInputs={onEditInputs} onNewPatient={onNewPatient} />
        {running
            ? <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">Running the review…</p>
            : (
                <ErrorBoundary compact key={attempt}>
                    <ResultsDisplay {...resultsProps} showCaseLabel={false} />
                </ErrorBoundary>
            )}
    </div>
);
