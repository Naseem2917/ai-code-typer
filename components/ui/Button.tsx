import React, { forwardRef, useContext, useRef, useImperativeHandle } from 'react';
import { AppContext } from '../../context/AppContext';
import { useAccessKey } from '../../hooks/useAccessKey';
import { AccessKeyLabel } from './AccessKeyLabel';
import { ModalContext } from './Modal';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  accessKeyChar?: string;
  accessKeyLabel?: string;
  accessKey?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  accessKeyChar,
  accessKeyLabel,
  isLoading,
  accessKey, // Destructure accessKey to prevent passing it to DOM element
  ...props
}, ref) => {
  const context = useContext(AppContext);
  const isInsideModal = useContext(ModalContext);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => buttonRef.current!);

  // Use accessKey prop as fallback for accessKeyChar
  const effectiveAccessKey = accessKeyChar || accessKey;

  useAccessKey(effectiveAccessKey, () => buttonRef.current?.click(), { disabled: props.disabled });

  const baseClasses = 'font-medium rounded-lg transition-all duration-200 relative inline-flex items-center justify-center';

  const variantClasses = {
    primary: 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md hover:opacity-90 disabled:opacity-50 glow-hover',
    secondary: 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 disabled:opacity-50',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50',
    outline: 'bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700 disabled:opacity-50',
    destructive: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50',
  };

  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-base px-6 py-3',
    icon: 'p-2',
  };

  // Show label if: visible, has key, not disabled, AND (inside modal OR no modal open)
  const shouldShowLabel = context?.isAccessKeyMenuVisible && effectiveAccessKey && !props.disabled && (isInsideModal || !context?.isAnyModalOpen);

  return (
    <button
      ref={buttonRef}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {shouldShowLabel && (
        <AccessKeyLabel label={accessKeyLabel || effectiveAccessKey} />
      )}
      {children}
    </button>
  );
});

Button.displayName = 'Button';