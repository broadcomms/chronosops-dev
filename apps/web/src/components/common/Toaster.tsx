/**
 * Toast notification component using sonner
 */
import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      toastOptions={{
        style: {
          background: '#1f2937',
          border: '1px solid #374151',
          color: '#fff',
        },
        classNames: {
          success: 'border-green-500/30',
          error: 'border-red-500/30',
          warning: 'border-yellow-500/30',
          info: 'border-blue-500/30',
        },
      }}
      closeButton
      richColors
    />
  );
}

// Re-export toast for convenience
export { toast } from 'sonner';
