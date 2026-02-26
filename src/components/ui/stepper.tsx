"use client";

import React, {
  useState,
  Children,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void | boolean | Promise<void | boolean>;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  footerInnerClassName?: string;
  backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  completeButtonText?: string;
  disableStepIndicators?: boolean;
  renderStepIndicator?: (props: {
    step: number;
    currentStep: number;
    onStepClick: (clicked: number) => void;
  }) => ReactNode;
}

export default function Stepper({
  children,
  className,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = "",
  stepContainerClassName = "",
  contentClassName = "",
  footerClassName = "",
  footerInnerClassName = "mt-10",
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = "Back",
  nextButtonText = "Continue",
  completeButtonText = "Complete",
  disableStepIndicators = false,
  renderStepIndicator,
  ...rest
}: StepperProps) {
  const [currentStep, setCurrentStep] = useState<number>(initialStep);
  const [direction, setDirection] = useState<number>(0);
  const [finishing, setFinishing] = useState(false);

  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep: number) => {
    setCurrentStep(newStep);
    if (newStep <= totalSteps) {
      onStepChange(newStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = async () => {
    if (finishing) return;

    setFinishing(true);
    try {
      const result = await onFinalStepCompleted();
      if (result === false) return;
      setDirection(1);
      updateStep(totalSteps + 1);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className={cn("flex w-full flex-col items-center justify-center px-1 sm:px-2", className)} {...rest}>
      <div
        className={cn(
          "mx-auto flex h-[clamp(460px,82vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-xl",
          stepCircleContainerClassName,
        )}
      >
        <div
          className={cn(
            "flex w-full flex-wrap items-center justify-center gap-3 px-7 pb-6 pt-7 sm:px-8 sm:pb-7 sm:pt-8",
            stepContainerClassName,
          )}
        >
          {stepsArray.map((_, index) => {
            const stepNumber = index + 1;
            return (
              <React.Fragment key={stepNumber}>
                {renderStepIndicator ? (
                  renderStepIndicator({
                    step: stepNumber,
                    currentStep,
                    onStepClick: (clicked) => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    },
                  })
                ) : (
                  <StepIndicator
                    step={stepNumber}
                    disableStepIndicators={disableStepIndicators}
                    currentStep={currentStep}
                    onClickStep={(clicked) => {
                      setDirection(clicked > currentStep ? 1 : -1);
                      updateStep(clicked);
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={cn("min-h-0 flex-1 px-7 pb-4 sm:px-8 sm:pb-5", contentClassName)}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {!isCompleted && (
          <div className={cn("px-7 pb-7 sm:px-8 sm:pb-8", footerClassName)}>
            <div className={cn("flex items-center justify-between", footerInnerClassName)}>
              <button
                onClick={handleBack}
                type="button"
                aria-label="Previous step"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                disabled={currentStep === 1 || finishing || backButtonProps.disabled}
                {...backButtonProps}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={isLastStep ? handleComplete : handleNext}
                type="button"
                aria-label={isLastStep ? "Complete sign up" : "Next step"}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                disabled={finishing || nextButtonProps.disabled}
                {...nextButtonProps}
              >
                {finishing ? <span className="h-2 w-2 rounded-full bg-current" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StepContentWrapperProps {
  isCompleted: boolean;
  currentStep: number;
  direction: number;
  children: ReactNode;
  className?: string;
}

function StepContentWrapper({
  isCompleted,
  currentStep,
  direction,
  children,
  className = "",
}: StepContentWrapperProps) {
  return (
    <div className={`relative h-full overflow-hidden ${className}`}>
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          <motion.div
            key={currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35 }}
            className="absolute inset-0 overflow-y-auto pr-1"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "-100%" : "100%",
    opacity: 0,
  }),
  center: {
    x: "0%",
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "40%" : "-40%",
    opacity: 0,
  }),
};

interface StepProps {
  children: ReactNode;
}

export function Step({ children }: StepProps) {
  return <div className="mx-auto w-full max-w-none py-1">{children}</div>;
}

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  onClickStep: (clicked: number) => void;
  disableStepIndicators?: boolean;
}

function StepIndicator({
  step,
  currentStep,
  onClickStep,
  disableStepIndicators = false,
}: StepIndicatorProps) {
  const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete";

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) {
      onClickStep(step);
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
      animate={status}
      initial={false}
      variants={{
        inactive: { scale: 1, backgroundColor: "#00000000", color: "#737373", borderColor: "#a3a3a3" },
        active: { scale: 1, backgroundColor: "#737373", color: "#ffffff", borderColor: "#737373" },
        complete: { scale: 1, backgroundColor: "#111111", color: "#ffffff", borderColor: "#111111" },
      }}
      disabled={disableStepIndicators}
    >
      {status === "complete" ? <CheckIcon className="h-4 w-4" /> : <span>{step}</span>}
    </motion.button>
  );
}

interface CheckIconProps extends React.SVGProps<SVGSVGElement> {}

function CheckIcon(props: CheckIconProps) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          delay: 0.05,
          type: "tween",
          ease: "easeOut",
          duration: 0.2,
        }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
