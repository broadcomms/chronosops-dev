/**
 * Page layout wrapper component
 */
import type { ReactNode } from 'react';
import { Navigation } from './Navigation';

interface PageLayoutProps {
  children: ReactNode;
  title?: string;
  fullWidth?: boolean;
}

export function PageLayout({ children, title, fullWidth = false }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation />

      <main className={`${fullWidth ? '' : 'mx-auto max-w-7xl'} px-4 py-6`}>
        {title && (
          <h1 className="mb-6 text-2xl font-bold text-white">{title}</h1>
        )}
        {children}
      </main>

      <footer className="border-t border-gray-800 py-4 text-center text-sm text-gray-500">
        ChronosOps - Autonomous Incident Response Agent
      </footer>
    </div>
  );
}

/**
 * Section component for consistent spacing
 */
interface SectionProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
  rightElement?: ReactNode;
}

export function Section({ children, title, description, className = '', rightElement }: SectionProps) {
  return (
    <section className={`mb-6 ${className}`}>
      {(title || description || rightElement) && (
        <div className="mb-4 flex items-start justify-between">
          <div>
            {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
            {description && <p className="text-sm text-gray-400">{description}</p>}
          </div>
          {rightElement}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Card component for content containers
 */
interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export function Card({ children, className = '', padding = 'md', onClick }: CardProps) {
  const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`rounded-lg border border-gray-800 bg-gray-800/50 ${paddingClasses[padding]} ${className} ${onClick ? 'text-left w-full' : ''}`}
    >
      {children}
    </Component>
  );
}

/**
 * Grid layout component
 */
interface GridProps {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Grid({ children, cols = 3, gap = 'md', className = '' }: GridProps) {
  const colClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  const gapClasses = {
    sm: 'gap-3',
    md: 'gap-4',
    lg: 'gap-6',
  };

  return (
    <div className={`grid ${colClasses[cols]} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
}
