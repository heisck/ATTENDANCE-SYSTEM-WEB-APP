"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export type HubNoticeItem = {
  id: string;
  name: string;
  role: string;
  content: string;
  avatar: string;
};

type HubNoticeCarouselProps = {
  items: HubNoticeItem[];
  autoplay?: boolean;
};

export function HubNoticeCarousel({ items, autoplay = false }: HubNoticeCarouselProps) {
  const [active, setActive] = useState(0);

  const handleNext = useCallback(() => {
    if (items.length === 0) return;
    setActive((prev) => (prev + 1) % items.length);
  }, [items.length]);

  const handlePrev = useCallback(() => {
    if (items.length === 0) return;
    setActive((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length]);

  useEffect(() => {
    if (!autoplay || items.length < 2) return;
    const interval = setInterval(handleNext, 5000);
    return () => clearInterval(interval);
  }, [autoplay, handleNext, items.length]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/85 px-5 py-6 text-sm text-muted-foreground">
        No hub notices available.
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[202px] flex-col items-end">
      <div className="mb-3 flex justify-center gap-2">
        <motion.button
          type="button"
          onClick={handlePrev}
          className="group/button bg-background flex h-8 w-8 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          aria-label="Previous notice"
        >
          <ChevronLeft className="text-foreground h-5 w-5 transition-transform duration-300 group-hover/button:-rotate-12" />
        </motion.button>
        <motion.button
          type="button"
          onClick={handleNext}
          className="group/button bg-background flex h-8 w-8 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          aria-label="Next notice"
        >
          <ChevronRight className="text-foreground h-5 w-5 transition-transform duration-300 group-hover/button:rotate-12" />
        </motion.button>
      </div>

      <div className="relative min-h-[150px] w-full">
        <AnimatePresence>
          {items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{
                opacity: index === active ? 1 : 0,
                scale: index === active ? 1 : 0.95,
                y: index === active ? 0 : 30,
              }}
              exit={{ opacity: 0, scale: 0.9, y: -30 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className={`absolute inset-0 ${index === active ? "z-10" : "z-0"}`}
            >
              <div className="bg-background rounded-2xl border px-5 py-5 shadow-lg transition-all duration-200">
                <motion.p
                  key={`${item.id}-${active}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-foreground mb-5 text-base leading-relaxed"
                >
                  {(item.content || "").split(" ").map((word, wordIndex) => (
                    <motion.span
                      key={`${item.id}-word-${wordIndex}`}
                      initial={{ filter: "blur(4px)", opacity: 0, y: 5 }}
                      animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut", delay: wordIndex * 0.02 }}
                      className="inline-block"
                    >
                      {word}&nbsp;
                    </motion.span>
                  ))}
                </motion.p>
                <motion.div
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground text-sm font-semibold">
                    {item.avatar}
                  </div>
                  <div>
                    <div className="text-foreground font-semibold">{item.name}</div>
                    <span className="text-muted-foreground text-sm">{item.role}</span>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

