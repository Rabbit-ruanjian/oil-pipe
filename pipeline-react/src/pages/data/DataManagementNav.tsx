import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApartmentOutlined,
  BankOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';

import { oilPropertyApi, pipelineApi, projectApi, pumpStationApi } from '../../api';
import styles from './DataPage.module.css';

export type DataSection = 'project' | 'pipeline' | 'pump' | 'oil';

const ITEMS: Array<{ key: DataSection; label: string; path: string; icon: ReactNode }> = [
  { key: 'project', label: '项目管理', path: '/data/project', icon: <BankOutlined /> },
  { key: 'pipeline', label: '管道参数', path: '/data/pipeline', icon: <ApartmentOutlined /> },
  { key: 'pump', label: '泵站参数', path: '/data/pump', icon: <DatabaseOutlined /> },
  { key: 'oil', label: '油品参数', path: '/data/oil', icon: <ExperimentOutlined /> },
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

  const summaryItems = [
    { key: 'project' as const, value: visibleCounts.project, unit: '个项目', hint: '输油干线 / 支线', tone: 'blue', icon: <BankOutlined /> },
    { key: 'pipeline' as const, value: visibleCounts.pipeline, unit: '条管道', hint: '统一维护管道参数', tone: 'gold', icon: <ApartmentOutlined /> },
    { key: 'pump' as const, value: visibleCounts.pump, unit: '座泵站', hint: '泵型 / 扬程 / 效率', tone: 'violet', icon: <DatabaseOutlined /> },
    { key: 'oil' as const, value: visibleCounts.oil, unit: '种油品', hint: '密度 / 黏度 / 物性', tone: 'green', icon: <ExperimentOutlined /> },
  ];

  return (
    <div className={styles.dataManagementBlock}>
      <section className={styles.summaryGrid} aria-label="数据汇总">
        {summaryItems.map((item) => (
          <div key={item.key} className={`${styles.summaryCard} ${styles[`summaryCard${item.tone}`]}`}>
            <span className={styles.summaryIcon}>{item.icon}</span>
            <span className={styles.summaryCopy}>
              <strong>{typeof item.value === 'number' ? item.value : '—'}<small>{item.unit}</small></strong>
              <em>{item.hint}</em>
            </span>
          </div>
        ))}
      </section>
      <div className={styles.dataManagementRow}>
        <div className={styles.dataManagementHint}>真实数据 · 可搜索筛选 · 统一参数源</div>
        <nav className={styles.dataTabs} aria-label="数据管理分类">
          {ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.dataTab} ${active === item.key ? styles.dataTabActive : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className={styles.dataTabIcon}>{item.icon}</span>
              {item.label}
              {typeof visibleCounts[item.key] === 'number' ? <span>{visibleCounts[item.key]}</span> : null}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
