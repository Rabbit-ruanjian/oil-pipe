import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import styles from './DataPage.module.css';

export type DataSection = 'project' | 'pipeline' | 'pump' | 'oil';

const ITEMS: Array<{ key: DataSection; label: string; path: string }> = [
  { key: 'project', label: '项目', path: '/data/project' },
  { key: 'pipeline', label: '管道', path: '/data/pipeline' },
  { key: 'pump', label: '泵站', path: '/data/pump' },
  { key: 'oil', label: '油品', path: '/data/oil' },
];

export default function DataManagementNav({
  active,
  counts,
}: {
  active: DataSection;
  counts?: Partial<Record<DataSection, number>>;
}) {
  const navigate = useNavigate();
  const [liveCounts, setLiveCounts] = useState<Partial<Record<DataSection, number>>>({});

  useEffect(() => {
    let active = true;

    const loadCounts = async () => {
      const [projectResult, pumpResult, oilResult] = await Promise.allSettled([
        projectApi.list(),
        pumpStationApi.list(),
        oilPropertyApi.list(),
      ]);

      const nextCounts: Partial<Record<DataSection, number>> = {};
      const projects = projectResult.status === 'fulfilled' && Array.isArray(projectResult.value.data)
        ? projectResult.value.data
        : [];
      if (projectResult.status === 'fulfilled') nextCounts.project = projects.length;
      if (pumpResult.status === 'fulfilled' && Array.isArray(pumpResult.value.data)) {
        nextCounts.pump = pumpResult.value.data.length;
      }
      if (oilResult.status === 'fulfilled' && Array.isArray(oilResult.value.data)) {
        nextCounts.oil = oilResult.value.data.length;
      }

      if (projects.length > 0) {
        const pipelineResults = await Promise.allSettled(
          projects.map((project) => pipelineApi.listByProject(project.proId)),
        );
        nextCounts.pipeline = pipelineResults.reduce(
          (total, result) => total + (result.status === 'fulfilled' && Array.isArray(result.value.data) ? result.value.data.length : 0),
          0,
        );
      } else if (projectResult.status === 'fulfilled') {
        nextCounts.pipeline = 0;
      }

      if (active) setLiveCounts(nextCounts);
    };

    void loadCounts();
    return () => {
      active = false;
    };
  }, []);

  const visibleCounts = useMemo(() => ({ ...liveCounts, ...counts }), [counts, liveCounts]);

  return (
    <div className={styles.dataManagementRow}>
      <div className={styles.dataManagementHint}>
        项目 / 管道参数 / 泵站参数 / 油品参数主数据（真实数据 · 可搜索筛选）
      </div>
      <nav className={styles.dataTabs} aria-label="数据管理分类">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.dataTab} ${active === item.key ? styles.dataTabActive : ''}`}
            onClick={() => navigate(item.path)}
          >
            {item.label}
            {typeof visibleCounts[item.key] === 'number' ? <span>{visibleCounts[item.key]}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
