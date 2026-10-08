import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Variants } from 'motion/react';

interface AnimatedListContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
};

export function AnimatedListContainer({ children, className, staggerDelay = 0.06 }: AnimatedListContainerProps) {
  const variants = {
    ...containerVariants,
    show: { ...containerVariants.show, transition: { staggerChildren: staggerDelay } },
  };

  return (
    <motion.div variants={variants} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function AnimatedListItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
