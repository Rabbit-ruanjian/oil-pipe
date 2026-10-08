import { motion } from 'motion/react';
import type { Variants } from 'motion/react';
import type { ReactNode } from 'react';

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 20, duration: 0.35 },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

export default function AnimatedPage({ children, className }: AnimatedPageProps) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className={className}>
      {children}
    </motion.div>
  );
}
