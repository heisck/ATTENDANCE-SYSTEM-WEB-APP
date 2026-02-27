"use client";

import {
  motion,
  type MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
  type SpringOptions,
} from "motion/react";
import React, {
  Children,
  cloneElement,
  useEffect,
  useMemo,
  useRef,
} from "react";

export type DockItemData = {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  className?: string;
};

export type DockProps = {
  items: DockItemData[];
  className?: string;
  distance?: number;
  panelHeight?: number;
  baseItemSize?: number;
  dockHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

type DockItemProps = {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  mouseX: MotionValue<number>;
  isInteracting: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  baseItemSize: number;
  magnification: number;
};

function DockItem({
  children,
  className = "",
  onClick,
  mouseX,
  isInteracting,
  spring,
  distance,
  magnification,
  baseItemSize,
}: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isHovered = useMotionValue(0);
  const isFocused = useMotionValue(0);
  const isPressed = useMotionValue(0);
  const hoverOverlayOpacity = useTransform(isHovered, [0, 1], [0, 1]);
  const pressOverlayOpacity = useTransform(isPressed, [0, 1], [0, 1]);

  const mouseDistance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      width: baseItemSize,
    };
    return val - rect.x - baseItemSize / 2;
  });

  const targetSize = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize]
  );
  const size = useSpring(targetSize, spring);

  useEffect(() => {
    const proximityThreshold = baseItemSize * 0.75;

    const updateHoverFromDistance = (distanceValue: number) => {
      if (isFocused.get() === 1) return;
      const isNear = Number.isFinite(distanceValue) && Math.abs(distanceValue) <= proximityThreshold;
      isHovered.set(isInteracting.get() === 1 && isNear ? 1 : 0);
    };

    updateHoverFromDistance(mouseDistance.get());

    const unsubscribeDistance = mouseDistance.on("change", updateHoverFromDistance);
    const unsubscribeInteraction = isInteracting.on("change", (active) => {
      if (isFocused.get() === 1) return;
      if (active === 0) {
        isHovered.set(0);
        return;
      }
      updateHoverFromDistance(mouseDistance.get());
    });

    return () => {
      unsubscribeDistance();
      unsubscribeInteraction();
    };
  }, [baseItemSize, isFocused, isHovered, isInteracting, mouseDistance]);

  return (
    <motion.div
      ref={ref}
      style={{
        width: size,
        height: size,
      }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onPointerDown={() => isPressed.set(1)}
      onPointerUp={() => isPressed.set(0)}
      onPointerCancel={() => isPressed.set(0)}
      onPointerLeave={() => isPressed.set(0)}
      onFocus={() => {
        isFocused.set(1);
        isHovered.set(1);
      }}
      onBlur={() => {
        isFocused.set(0);
        const distanceValue = mouseDistance.get();
        const isNear = Number.isFinite(distanceValue) && Math.abs(distanceValue) <= baseItemSize * 0.75;
        isHovered.set(isInteracting.get() === 1 && isNear ? 1 : 0);
      }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={`relative inline-flex items-center justify-center rounded-full border border-transparent bg-transparent text-black transition-colors duration-150 hover:border-black/15 hover:bg-gray-100/85 active:border-black/20 active:bg-gray-200/90 focus-visible:border-black/15 focus-visible:bg-gray-100/85 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100 dark:shadow-sm dark:shadow-black/25 dark:hover:border-white/20 dark:hover:bg-white/[0.1] dark:active:border-white/25 dark:active:bg-white/[0.14] dark:focus-visible:border-white/20 dark:focus-visible:bg-white/[0.1] ${className}`}
      tabIndex={0}
      role="button"
      aria-haspopup="true"
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-gray-200/85 dark:bg-white/[0.1]"
        style={{ opacity: hoverOverlayOpacity }}
      />
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-gray-300/85 dark:bg-white/[0.16]"
        style={{ opacity: pressOverlayOpacity }}
      />
      {Children.map(children, (child) =>
        React.isValidElement(child)
          ? cloneElement(
              child as React.ReactElement<{ isHovered?: MotionValue<number> }>,
              { isHovered }
            )
          : child
      )}
    </motion.div>
  );
}

type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
};

function DockLabel({ children, className = "", isHovered }: DockLabelProps) {
  const fallbackHover = useMotionValue(0);
  const hover = isHovered ?? fallbackHover;
  const opacity = useTransform(hover, [0, 1], [0, 1]);
  const y = useTransform(hover, [0, 1], [0, -10]);
  const scale = useTransform(hover, [0, 1], [0.96, 1]);

  return (
    <motion.div
      className={`${className} absolute -top-7 left-1/2 w-fit whitespace-pre rounded-md border border-border bg-popover px-2 py-0.5 text-xs text-popover-foreground shadow-sm dark:border-border dark:bg-[#2b2724] dark:text-gray-200 dark:shadow-black/25`}
      role="tooltip"
      style={{ x: "-50%", opacity, y, scale, pointerEvents: "none" }}
    >
      {children}
    </motion.div>
  );
}

type DockIconProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
};

function DockIcon({ children, className = "" }: DockIconProps) {
  return <div className={`flex items-center justify-center ${className}`}>{children}</div>;
}

export default function Dock({
  items,
  className = "",
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = 70,
  distance = 200,
  panelHeight = 64,
  dockHeight = 256,
  baseItemSize = 50,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isInteracting = useMotionValue(0);
  const shouldSnapAfterTap = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches;

  const resetInteraction = () => {
    isInteracting.set(0);
    mouseX.set(Infinity);
  };

  const maxHeight = useMemo(
    () => Math.max(dockHeight, magnification + magnification / 2 + 4),
    [dockHeight, magnification]
  );
  const heightRow = useTransform(isInteracting, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div style={{ height, scrollbarWidth: "none" }} className="mx-2 flex max-w-full items-center">
      <motion.div
        onMouseMove={({ pageX }) => {
          isInteracting.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          resetInteraction();
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          isInteracting.set(1);
          mouseX.set(touch.pageX);
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (!touch) return;
          isInteracting.set(1);
          mouseX.set(touch.pageX);
        }}
        onTouchEnd={() => {
          resetInteraction();
        }}
        onTouchCancel={() => {
          resetInteraction();
        }}
        className={`${className} absolute bottom-2 left-1/2 transform -translate-x-1/2 flex items-end w-fit gap-4 rounded-2xl border border-black/10 bg-white pb-2 px-4 shadow-sm shadow-black/5 backdrop-blur-md supports-[backdrop-filter]:bg-white/90 dark:border-border/80 dark:bg-[#25211e]/90 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-[#25211e]/85`}
        style={{ height: panelHeight, touchAction: "none" }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <DockItem
            key={index}
            onClick={() => {
              if (shouldSnapAfterTap()) {
                resetInteraction();
              }
              item.onClick();
            }}
            className={item.className}
            mouseX={mouseX}
            isInteracting={isInteracting}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  );
}
