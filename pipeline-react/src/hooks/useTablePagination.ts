import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TablePaginationConfig } from 'antd';

type UseTablePaginationOptions = {
  initialPageSize?: number;
  pageSizeOptions?: string[];
};

export default function useTablePagination(
  total: number,
  options: UseTablePaginationOptions = {},
) {
  const {
    initialPageSize = 10,
    pageSizeOptions = ['10', '20', '50', '100'],
  } = options;

  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (current > maxPage) {
      setCurrent(maxPage);
    }
  }, [current, pageSize, total]);

  const resetPagination = useCallback(() => {
    setCurrent(1);
  }, []);

  const pagination = useMemo<TablePaginationConfig>(() => ({
    current,
    pageSize,
    total,
    pageSizeOptions,
    showSizeChanger: {
      showSearch: false,
    },
    onChange: (page, nextPageSize) => {
      if (nextPageSize !== pageSize) {
        setPageSize(nextPageSize);
        setCurrent(1);
        return;
      }
      setCurrent(page);
    },
  }), [current, pageSize, pageSizeOptions, total]);

  return {
    pagination,
    resetPagination,
  };
}
