import React from 'react';
import { ChevronDownIcon } from '../icons';

export const Label = ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) => (
    <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 mb-1.5">
        {children}
    </label>
);

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        id={props.id || (props.name as string | undefined)}
        className={`block w-full rounded-md border-slate-300 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-100 shadow-sm transition-all placeholder:text-slate-400 ${props.className || ''}`}
    />
);

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
