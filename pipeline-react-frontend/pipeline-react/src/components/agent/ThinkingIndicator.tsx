import { AnimatePresence, motion } from 'motion/react';
import styles from './ThinkingIndicator.module.css';

interface ThinkingIndicatorProps {
  visible: boolean;
}

const dots = [0, 1, 2];

export default function ThinkingIndicator({ visible }: ThinkingIndicatorProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.thinkingContainer}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
        >
          <span className={styles.label}>智能助手正在思考</span>
          <span className={styles.dots}>
            {dots.map((i) => (
              <motion.span
                key={i}
                className={styles.dot}
                animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
