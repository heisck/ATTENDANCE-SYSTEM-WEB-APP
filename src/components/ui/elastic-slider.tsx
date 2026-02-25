"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";

import { cn } from "@/lib/utils";

const MAX_OVERFLOW = 50;

interface ElasticSliderProps {
  value?: number;
  defaultValue?: number;
  startingValue?: number;
  maxValue?: number;
  className?: string;
  isStepped?: boolean;
  stepSize?: number;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onValueChange?: (value: number) => void;
  valueFormatter?: (value: number) => string;
}

export default function ElasticSlider({
  value,
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  className,
  isStepped = false,
  stepSize = 1,
  leftIcon = <>-</>,
  rightIcon = <>+</>,
  onValueChange,
  valueFormatter,
}: ElasticSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<"left" | "middle" | "right">("middle");
  const [internalValue, setInternalValue] = useState<number>(defaultValue);

  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  const sliderValue = value ?? internalValue;

  useEffect(() => {
    if (value === undefined) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, value]);

  useMotionValueEvent(clientX, "change", (latest: number) => {
    if (!sliderRef.current) return;

    const { left, right } = sliderRef.current.getBoundingClientRect();
    let outOfBounds = 0;

    if (latest < left) {
      setRegion("left");
      outOfBounds = left - latest;
    } else if (latest > right) {
      setRegion("right");
      outOfBounds = latest - right;
    } else {
      setRegion("middle");
    }

    overflow.jump(decay(outOfBounds, MAX_OVERFLOW));
  });

  const iconOffsetLeft = useTransform(() =>
    region === "left" ? -overflow.get() / Math.max(scale.get(), 1) : 0
  );
  const iconOffsetRight = useTransform(() =>
    region === "right" ? overflow.get() / Math.max(scale.get(), 1) : 0
  );
  const trackScaleX = useTransform(() => {
    if (!sliderRef.current) return 1;
    const { width } = sliderRef.current.getBoundingClientRect();
    return 1 + overflow.get() / Math.max(width, 1);
  });
  const trackScaleY = useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.82]);
  const trackTransformOrigin = useTransform(() => {
    if (!sliderRef.current) return "center";
    const { left, width } = sliderRef.current.getBoundingClientRect();
    return clientX.get() < left + width / 2 ? "right" : "left";
  });
  const trackHeight = useTransform(scale, [1, 1.2], [6, 12]);
  const trackMarginTop = useTransform(scale, [1, 1.2], [0, -3]);
  const trackMarginBottom = useTransform(scale, [1, 1.2], [0, -3]);
  const containerOpacity = useTransform(scale, [1, 1.2], [0.75, 1]);

  const setSliderValue = (next: number) => {
    if (value === undefined) {
      setInternalValue(next);
    }
    onValueChange?.(next);
  };

  const updateValueFromPointer = (pointerX: number) => {
    if (!sliderRef.current) return;
    const { left, width } = sliderRef.current.getBoundingClientRect();

    let nextValue =
      startingValue + ((pointerX - left) / width) * (maxValue - startingValue);
    if (isStepped) {
      nextValue = Math.round(nextValue / stepSize) * stepSize;
    }
    nextValue = Math.min(Math.max(nextValue, startingValue), maxValue);

    setSliderValue(nextValue);
    clientX.jump(pointerX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons <= 0) return;
    updateValueFromPointer(event.clientX);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    updateValueFromPointer(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: "spring", bounce: 0.5 });
  };

  const totalRange = maxValue - startingValue;
  const rangePercentage =
    totalRange === 0 ? 0 : ((sliderValue - startingValue) / totalRange) * 100;

  return (
    <div className={cn("relative flex w-full flex-col items-center justify-center", className)}>
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{ scale, opacity: containerOpacity }}
        className="flex w-full touch-none select-none items-center justify-center gap-3"
      >
        <motion.div
          animate={{
            scale: region === "left" ? [1, 1.25, 1] : 1,
            transition: { duration: 0.2 },
          }}
          style={{ x: iconOffsetLeft }}
          className="text-muted-foreground"
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className="relative flex w-full cursor-grab touch-none select-none items-center py-4 active:cursor-grabbing"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: trackScaleX,
              scaleY: trackScaleY,
              transformOrigin: trackTransformOrigin,
              height: trackHeight,
              marginTop: trackMarginTop,
              marginBottom: trackMarginBottom,
            }}
            className="flex w-full"
          >
            <div className="relative h-full w-full overflow-hidden rounded-full bg-muted">
              <div
                className="absolute h-full rounded-full bg-foreground/45"
                style={{ width: `${rangePercentage}%` }}
              />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{
            scale: region === "right" ? [1, 1.25, 1] : 1,
            transition: { duration: 0.2 },
          }}
          style={{ x: iconOffsetRight }}
          className="text-muted-foreground"
        >
          {rightIcon}
        </motion.div>
      </motion.div>

      <p className="pointer-events-none absolute -bottom-2 text-xs font-medium tracking-wide text-muted-foreground">
        {valueFormatter ? valueFormatter(sliderValue) : Math.round(sliderValue)}
      </p>
    </div>
  );
}

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}
