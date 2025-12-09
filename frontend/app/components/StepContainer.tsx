interface StepContainerProps {
  title: string;
  description?: string;
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
    <div className="bg-white rounded-lg shadow-sm p-6 md:p-8">
      {/* ヘッダー */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        {description && <p className="text-gray-600 mt-2">{description}</p>}
      </div>

      {/* コンテンツ */}
      <div className="mb-8">{children}</div>

      {/* ナビゲーションボタン */}
      {(onNext || onBack) && (
        <div className="flex justify-between items-center pt-6 border-t">
          {showBack && onBack ? (
            <button
              onClick={onBack}
              disabled={isLoading}
              className="px-6 py-2 text-gray-600 hover:text-gray-900 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← 戻る
            </button>
          ) : (
            <div />
          )}

          {onNext && (
            <button
              onClick={onNext}
              disabled={nextDisabled || isLoading}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>処理中...</span>
                </>
              ) : (
                <>
                  <span>{nextLabel}</span>
                  <span>→</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
