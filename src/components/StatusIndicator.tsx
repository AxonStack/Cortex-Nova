import { motion } from "framer-motion";
import type { NovaStatus } from "../store/novaStore";

interface StatusIndicatorProps {
  status: NovaStatus;
}

const STATUS_CONFIG: Record<NovaStatus, { label: string }> = {
  idle:       { label: "IDLE" },
  listening:  { label: "LISTENING" },
  processing: { label: "PROCESSING" },
  speaking:   { label: "SPEAKING" },
  error:      { label: "ERROR" },
};

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const { label } = STATUS_CONFIG[status];
  return (
    <motion.div
      key={status}
      className="flex items-center gap-2 text-[10px] tracking-widest text-black/50 uppercase"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full border border-black/40"
        style={{ background: status === "error" ? "#000" : status === "idle" ? "transparent" : "#000" }}
      />
      {label}
    </motion.div>
  );
}
