import { motion } from "framer-motion";

interface WaveformAnimationProps {
  isActive: boolean;
}

const BAR_COUNT = 16;

export function WaveformAnimation({ isActive }: WaveformAnimationProps) {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[2px] bg-black rounded-none"
          animate={
            isActive
              ? { height: ["3px", `${8 + Math.random() * 14}px`, "3px"], opacity: [0.4, 1, 0.4] }
              : { height: "2px", opacity: 0.15 }
          }
          transition={
            isActive
              ? { duration: 0.5 + i * 0.04, repeat: Infinity, delay: i * 0.05, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        />
      ))}
    </div>
  );
}
