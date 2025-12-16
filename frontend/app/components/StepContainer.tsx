'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

interface StepContainerProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
  isLoading?: boolean;
}

export default function StepContainer({
  title,
  description,
  children,
  onNext,
  onBack,
  nextLabel,
  nextDisabled = false,
  showBack = true,
  isLoading = false,
}: StepContainerProps) {
  const t = useTranslations('components.stepContainer');
  const finalNextLabel = nextLabel || t('next');

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        {description && <CardDescription className="text-base">{description}</CardDescription>}
      </CardHeader>

      <CardContent>{children}</CardContent>

      {(onNext || onBack) && (
        <CardFooter className="flex justify-between border-t pt-6">
          {showBack && onBack ? (
            <Button onClick={onBack} disabled={isLoading} variant="ghost">
              {t('back')}
            </Button>
          ) : (
            <div />
          )}

          {onNext && (
            <Button onClick={onNext} disabled={nextDisabled || isLoading} size="lg">
              {isLoading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  <span>{t('processing')}</span>
                </>
              ) : (
                <>
                  <span>{finalNextLabel}</span>
                  <span className="ml-2">→</span>
                </>
              )}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}