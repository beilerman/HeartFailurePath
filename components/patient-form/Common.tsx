import React from 'react';
import { ChevronDownIcon } from '../icons';

export const Label = ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 mb-1.5">
        {children}
    </label>
);

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: string;
    warning?: string;
}

export const Input = ({ error, warning, ...rest }: InputProps) => {
    const id = rest.id || (rest.name as string | undefined);
    const errorId = error && id ? `${id}-error` : undefined;
    const warningId = warning && !error && id ? `${id}-warning` : undefined;
    const describedBy = errorId || warningId || undefined;

    const borderClass = error
        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
        : warning
            ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500';

    return (
        <>
            <input
                {...rest}
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                className={`block w-full rounded-md bg-white py-2 px-3 text-sm text-slate-900 focus:ring-1 disabled:opacity-50 disabled:bg-slate-100 shadow-sm transition-all placeholder:text-slate-400 ${borderClass} ${rest.className || ''}`}
            />
            {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
            {warning && !error && <p id={warningId} className="mt-1 text-xs text-amber-600">{warning}</p>}
        </>
    );
};

export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <div className="relative w-full">
        <select
            {...props}
            id={props.id || (props.name as string | undefined)}
            className={`block w-full appearance-none rounded-md border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-100 shadow-sm transition-all ${props.className || ''}`}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
            <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
        </div>
    </div>
);
