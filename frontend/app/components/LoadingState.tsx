'use client';

import React from 'react';
import { Loader2, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoadingStep {
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
}

interface LoadingStateProps {
  message?: string;
  subMessage?: string;
  steps?: LoadingStep[];
  fullScreen?: boolean;
  className?: string;
}

export default function LoadingState({
  message = '読み込み中...',
  subMessage,
  steps = [],
  fullScreen = true,
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-6 bg-slate-50/50',
        fullScreen ? 'min-h-[80vh] w-full' : 'w-full h-full min-h-[300px]',
        className
      )}
    >
      <div className="max-w-md w-full flex flex-col items-center text-center space-y-8">
        {/* Main Spinner */}
        <div className="relative">
          <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-75" />
          <div className="relative bg-white p-4 rounded-full shadow-lg border border-blue-50">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">
            {message}
          </h3>
          {subMessage && (
            <p className="text-slate-500 text-sm font-medium">
              {subMessage}
            </p>
          )}
        </div>

        {/* Progress Steps (if provided) */}
        {steps.length > 0 && (
          <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 text-left">
            {steps.map((step, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-3 text-sm transition-colors duration-300",
                  step.status === 'pending' ? "opacity-40" : "opacity-100"
                )}
              >
                <div className="shrink-0">
                  {step.status === 'success' && (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  )}
                  {step.status === 'error' && (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  {step.status === 'loading' && (
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  )}
                  {step.status === 'pending' && (
                    <Circle className="w-5 h-5 text-slate-300" />
                  )}
                </div>
                <span className={cn(
                  "font-medium",
                  step.status === 'loading' ? "text-blue-700" : 
                  step.status === 'success' ? "text-slate-700" :
                  step.status === 'error' ? "text-red-700" :
                  "text-slate-500"
                )}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
