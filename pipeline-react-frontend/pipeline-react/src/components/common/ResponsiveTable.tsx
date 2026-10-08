import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Table } from 'antd';
import type { TableProps, TablePaginationConfig } from 'antd';
import { motion } from 'motion/react';
import styles from './ResponsiveTable.module.css';

interface ResponsiveTableProps<T> extends TableProps<T> {
  cardRender: (record: T, index: number) => ReactNode;
  breakpoint?: number;
}

export default function ResponsiveTable<T extends object>({
                                                            cardRender,
                                                            breakpoint = 640,
                                                            dataSource,
                                                            pagination,
                                                            ...tableProps
                                                          }: ResponsiveTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCardMode, setIsCardMode] = useState(false);

  const paginationConfig =
      pagination && typeof pagination === 'object'
          ? (pagination as TablePaginationConfig)
          : {};

  const [current, setCurrent] = useState(paginationConfig.current || 1);
  const [pageSize, setPageSize] = useState(paginationConfig.pageSize || 10);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCardMode(entry.contentRect.width < breakpoint);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [breakpoint]);

  useEffect(() => {
    if (paginationConfig.current) {
      setCurrent(paginationConfig.current);
    }
    if (paginationConfig.pageSize) {
      setPageSize(paginationConfig.pageSize);
    }
  }, [paginationConfig.current, paginationConfig.pageSize]);

  const mergedPagination =
      pagination === false
          ? false
          : {
            ...paginationConfig,
            current,
            pageSize,
            onChange: (page: number, size: number) => {
              setCurrent(page);
              setPageSize(size);

              if (paginationConfig.onChange) {
                paginationConfig.onChange(page, size);
              }
            },
            onShowSizeChange: (page: number, size: number) => {
              setCurrent(1);
              setPageSize(size);

              if (paginationConfig.onShowSizeChange) {
                paginationConfig.onShowSizeChange(page, size);
              }
            },
          };

  const pagedData =
      Array.isArray(dataSource) && mergedPagination !== false
          ? dataSource.slice((current - 1) * pageSize, current * pageSize)
          : dataSource;

  return (
      <div ref={containerRef} className={styles.container}>
        {isCardMode ? (
            <div className={styles.cardList}>
              {(pagedData || []).map((record, index) => (
                  <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04, type: 'spring', stiffness: 300, damping: 24 }}
                  >
                    {cardRender(record, index)}
                  </motion.div>
              ))}
            </div>
        ) : (
            <Table<T>
                dataSource={dataSource}
                pagination={mergedPagination}
                {...tableProps}
            />
        )}
      </div>
  );
}