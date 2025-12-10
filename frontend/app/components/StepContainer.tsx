import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
  nextLabel = '次へ',
  nextDisabled = false,
  showBack = true,
  isLoading = false,
}: StepContainerProps) {
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
              ← 戻る
            </Button>
          ) : (
            <div />
          )}

          {onNext && (
            <Button onClick={onNext} disabled={nextDisabled || isLoading} size="lg">
              {isLoading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  <span>処理中...</span>
                </>
              ) : (
                <>
                  <span>{nextLabel}</span>
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
