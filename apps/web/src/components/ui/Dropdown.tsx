
/**
* Dropdown menu component for action grouping
*/

import { useState, useRef, useEffect, type ReactNode } from 'react';

interface DropdownProps {
    trigger: ReactNode;
    children: ReactNode;
    align?: 'left' | 'right';
}

export function Dropdown({ trigger, children, align = 'right' }: DropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Close on escape key
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }


        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            return () => document.removeEventListener('keydown', handleEscape);
        }
    }, [isOpen]);


    return (
        <div ref={dropdownRef} className="relative">
            <div onClick={() => setIsOpen(!isOpen)}>
                {trigger}
            </div>
            {isOpen && (
                <div
                    className={`absolute top-full mt-1 z-50 min-w-[180px] py-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg ${align === 'right' ? 'right-0' : 'left-0'
                        }`}
                >
                    <div onClick={() => setIsOpen(false)}>
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
}

interface DropdownItemProps {
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    children: ReactNode;
}

export function DropdownItem({ onClick, disabled = false, className = '', children }: DropdownItemProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition ${disabled
                    ? 'text-gray-500 cursor-not-allowed'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                } ${className}`}
        >
            {children}
        </button>
    );
}


export function DropdownSeparator() {
    return <div className="my-1 border-t border-gray-700" />;
}
