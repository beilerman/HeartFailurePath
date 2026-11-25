import React, { useId, useState } from 'react';
import { ChevronDownIcon } from './icons';

interface DisclosureProps {
    /** Text or content of the toggle button. */
    title: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    buttonClassName?: string;
}

/** An expander built as a real button with aria-expanded / aria-controls (keyboard and screen-reader friendly). */
export const Disclosure: React.FC<DisclosureProps> = ({ title, children, defaultOpen = false, className = '', buttonClassName = '' }) => {
    const [open, setOpen] = useState(defaultOpen);
    const id = useId();
    return (
        <div className={className}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded ${buttonClassName}`}
            >
                <span>{title}</span>
                <ChevronDownIcon className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {/* Always rendered (hidden when closed) so a printout still contains every reason. */}
            <div id={id} hidden={!open} className="print:!block">{children}</div>
        </div>
    );
};
