import { Button } from "@getficksd/ui/components/button";
import { cn } from "@getficksd/ui/lib/utils";
import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";

export type FormWizardStep = {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
};

type FormWizardProps = {
  steps: FormWizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onNext?: (currentStep: number) => boolean | Promise<boolean>;
  onComplete: () => void | Promise<void>;
  completeLabel?: string;
};

export function FormWizard({
  steps,
  currentStep,
  onStepChange,
  onNext,
  onComplete,
  completeLabel = "Complete",
}: FormWizardProps) {
  const [isBusy, setIsBusy] = useState(false);
  const activeStep = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  if (!activeStep) {
    return null;
  }

  async function advance() {
    setIsBusy(true);
    const canContinue = (await onNext?.(currentStep)) ?? true;

    if (canContinue) {
      onStepChange(currentStep + 1);
    }

    setIsBusy(false);
  }

  async function complete() {
    setIsBusy(true);
    try {
      await onComplete();
    } catch {
      // The caller owns the error message and keeps the wizard on this step.
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ol
        className="grid gap-2 sm:grid-cols-[repeat(var(--step-count),minmax(0,1fr))]"
        style={{ "--step-count": steps.length } as React.CSSProperties}
      >
        {steps.map((step, index) => {
          const complete = index < currentStep;
          const active = index === currentStep;

          return (
            <li
              key={step.id}
              className={cn(
                "border border-border p-3 text-muted-foreground",
                active && "border-primary text-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                <span className="flex size-5 items-center justify-center border border-current">
                  {complete ? <Check className="size-3" /> : index + 1}
                </span>
                {step.title}
              </div>
              {step.description ? <p className="text-xs">{step.description}</p> : null}
            </li>
          );
        })}
      </ol>

      <section aria-labelledby={`wizard-step-${activeStep.id}`}>
        <h2 id={`wizard-step-${activeStep.id}`} className="sr-only">
          {activeStep.title}
        </h2>
        {activeStep.content}
      </section>

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={currentStep === 0 || isBusy}
          onClick={() => onStepChange(currentStep - 1)}
        >
          Previous
        </Button>
        <Button type="button" disabled={isBusy} onClick={isLastStep ? complete : advance}>
          {isBusy ? "Working..." : isLastStep ? completeLabel : "Continue"}
        </Button>
      </div>
    </div>
  );
}
