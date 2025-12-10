interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  steps: { label: string }[];
}

export default function ProgressBar({ currentStep, totalSteps, steps }: ProgressBarProps) {
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;

  return (
    <div className="w-full mb-8">
      {/* モバイル用: シンプルなプログレスバー */}
      <div className="md:hidden">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Step {currentStep} of {totalSteps}</span>
          <span>{Math.round((currentStep / totalSteps) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(currentStep / totalSteps) * 100}%` }}
          />
        </div>
        <p className="text-sm text-gray-700 mt-2 font-medium">{steps[currentStep - 1]?.label}</p>
      </div>

      {/* デスクトップ用: 詳細なステップインジケーター */}
      <div className="hidden md:block relative">
        {/* 背景の線 */}
        <div className="absolute top-5 left-16 right-16 h-0.5 bg-gray-200 z-0 -translate-y-1/2" />
        
        {/* 進行状況の線 */}
        <div className="absolute top-5 left-16 right-16 h-0.5 z-0 -translate-y-1/2">
          <div 
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        <div className="flex justify-between w-full">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isCompleted = stepNumber < currentStep;
            const isCurrent = stepNumber === currentStep;

            return (
              <div key={stepNumber} className="flex flex-col items-center z-10 relative">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-gray-100 text-gray-500 border-2 border-gray-200'
                  }`}
                >
                  {isCompleted ? '✓' : stepNumber}
                </div>
                <div className="mt-2 text-center w-32">
                  <p
                    className={`text-xs font-medium ${
                      isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
                    }`}
                  >
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
