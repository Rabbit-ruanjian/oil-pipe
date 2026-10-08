export interface SensitivitySmartReportBasicInfo {
  projectName: string;
  analysisType: string;
  sensitiveVariableType: string;
  baseCondition: string;
  generatedAt: string;
}

export interface SensitivitySmartReportResultCards {
  baseResult: string;
  mostSensitiveVariable: string;
  sensitivityCoefficient: string;
  maxImpactPercent: string;
  impactRanking: string;
  riskLevel: string;
}

export interface SensitivitySmartReportRankingItem {
  rank: number;
  variableName: string;
  sensitivityCoefficient: number | null;
  description?: string;
}

export interface SensitivitySmartReportTrendPoint {
  changeRateLabel: string;
  changeRateValue: number;
  pressure: number | null;
  frictionLoss: number | null;
  pressureChangePercent: number | null;
  frictionChangePercent: number | null;
  flowState: string;
}

export interface SensitivitySmartReportImpactItem {
  variableName: string;
  maxImpactPercent: number | null;
}

export interface SensitivitySmartReportChartMetaItem {
  title: string;
  chartType: 'bar-horizontal' | 'line' | 'bar';
  xField: string;
  yFields: string[];
  description: string;
}

export interface SensitivitySmartReportAnalysis {
  resultSummary: string[];
  keyChangeAnalysis: string[];
  riskRecognition: string[];
  optimizationSuggestions: string[];
}

export interface SensitivitySmartReportPayload {
  title: string;
  description: string;
  basicInfo: SensitivitySmartReportBasicInfo;
  resultCards: SensitivitySmartReportResultCards;
  chartMeta: {
    sensitivityRanking: SensitivitySmartReportChartMetaItem;
    changeTrend: SensitivitySmartReportChartMetaItem;
    maxImpact: SensitivitySmartReportChartMetaItem;
  };
  rankingData: SensitivitySmartReportRankingItem[];
  trendData: SensitivitySmartReportTrendPoint[];
  impactData: SensitivitySmartReportImpactItem[];
  analysis: SensitivitySmartReportAnalysis;
}

export const SENSITIVITY_REPORT_PAGE_COPY = {
  defaultTitle: '敏感性分析智能报告',
  defaultDescription:
    '本报告基于当前项目敏感性分析计算结果自动生成，主要针对所选敏感变量变化对系统运行结果的影响程度进行分析，重点评估不同变化比例下压力、摩阻损失及流态变化情况，并识别对系统运行影响最显著的关键变量。',
  sectionTitles: {
    basicInfo: '基本信息',
    coreResults: '核心结果卡片',
    chartAnalysis: '图表分析区',
    trendTable: '变化比例流态表',
    analysis: '智能分析正文',
    resultSummary: '结果摘要',
    keyChangeAnalysis: '关键变化分析',
    riskRecognition: '风险识别',
    optimizationSuggestions: '运行建议',
  },
  labels: {
    projectName: '项目名称',
    analysisType: '分析类型',
    sensitiveVariableType: '敏感变量类型',
    baseCondition: '基准工况',
    generatedAt: '生成时间',
    baseResult: '基准结果',
    mostSensitiveVariable: '最敏感变量',
    sensitivityCoefficient: '敏感系数',
    maxImpactPercent: '最大影响幅度',
    impactRanking: '影响排名',
    riskLevel: '风险等级',
  },
} as const;

export const SENSITIVITY_REPORT_FIELD_PATHS = {
  title: 'title',
  description: 'description',
  basicInfo: {
    projectName: 'basicInfo.projectName',
    analysisType: 'basicInfo.analysisType',
    sensitiveVariableType: 'basicInfo.sensitiveVariableType',
    baseCondition: 'basicInfo.baseCondition',
    generatedAt: 'basicInfo.generatedAt',
  },
  resultCards: {
    baseResult: 'resultCards.baseResult',
    mostSensitiveVariable: 'resultCards.mostSensitiveVariable',
    sensitivityCoefficient: 'resultCards.sensitivityCoefficient',
    maxImpactPercent: 'resultCards.maxImpactPercent',
    impactRanking: 'resultCards.impactRanking',
    riskLevel: 'resultCards.riskLevel',
  },
  chartMeta: {
    sensitivityRanking: 'chartMeta.sensitivityRanking',
    changeTrend: 'chartMeta.changeTrend',
    maxImpact: 'chartMeta.maxImpact',
  },
  rankingData: 'rankingData',
  trendData: 'trendData',
  impactData: 'impactData',
  analysis: {
    resultSummary: 'analysis.resultSummary',
    keyChangeAnalysis: 'analysis.keyChangeAnalysis',
    riskRecognition: 'analysis.riskRecognition',
    optimizationSuggestions: 'analysis.optimizationSuggestions',
  },
} as const;

export const SENSITIVITY_REPORT_MOCK_DATA: SensitivitySmartReportPayload = {
  title: '某项目关键变量敏感性分析报告',
  description: SENSITIVITY_REPORT_PAGE_COPY.defaultDescription,
  basicInfo: {
    projectName: '西部分输管线示范项目',
    analysisType: '敏感性分析',
    sensitiveVariableType: '流量',
    baseCondition: '流量 420 m3/h，密度 835 kg/m3，管径 610 mm',
    generatedAt: '2026-04-11 10:30:00',
  },
  resultCards: {
    baseResult: '正常',
    mostSensitiveVariable: '流量',
    sensitivityCoefficient: '0.82',
    maxImpactPercent: '22.5%',
    impactRanking: '第 1 名',
    riskLevel: '较高',
  },
  chartMeta: {
    sensitivityRanking: {
      title: '敏感系数排名图',
      chartType: 'bar-horizontal',
      xField: 'sensitivityCoefficient',
      yFields: ['variableName'],
      description: '展示各敏感变量的敏感系数，并按影响强弱排序。',
    },
    changeTrend: {
      title: '变化比例-结果变化趋势图',
      chartType: 'line',
      xField: 'changeRateLabel',
      yFields: ['pressure', 'frictionLoss'],
      description: '展示不同变化比例下末站压力与摩阻损失的变化趋势。',
    },
    maxImpact: {
      title: '最大影响幅度对比图',
      chartType: 'bar',
      xField: 'variableName',
      yFields: ['maxImpactPercent'],
      description: '对比各敏感变量带来的最大影响幅度。',
    },
  },
  rankingData: [
    { rank: 1, variableName: '流量', sensitivityCoefficient: 0.82, description: '对压力与摩阻损失影响最显著' },
    { rank: 2, variableName: '粘度', sensitivityCoefficient: 0.64, description: '对摩阻损失影响明显' },
    { rank: 3, variableName: '密度', sensitivityCoefficient: 0.46, description: '对压头变化存在中等影响' },
  ],
  trendData: [
    {
      changeRateLabel: '-20%',
      changeRateValue: -20,
      pressure: 40.2,
      frictionLoss: 12.1,
      pressureChangePercent: -5.9,
      frictionChangePercent: -34.9,
      flowState: '过渡流',
    },
    {
      changeRateLabel: '-10%',
      changeRateValue: -10,
      pressure: 41.3,
      frictionLoss: 14.5,
      pressureChangePercent: -3.3,
      frictionChangePercent: -22.0,
      flowState: '过渡流',
    },
    {
      changeRateLabel: '0%',
      changeRateValue: 0,
      pressure: 42.7,
      frictionLoss: 18.6,
      pressureChangePercent: 0,
      frictionChangePercent: 0,
      flowState: '湍流',
    },
    {
      changeRateLabel: '+10%',
      changeRateValue: 10,
      pressure: 44.1,
      frictionLoss: 21.8,
      pressureChangePercent: 3.3,
      frictionChangePercent: 17.2,
      flowState: '湍流',
    },
    {
      changeRateLabel: '+20%',
      changeRateValue: 20,
      pressure: 45.9,
      frictionLoss: 25.4,
      pressureChangePercent: 7.5,
      frictionChangePercent: 36.6,
      flowState: '湍流',
    },
  ],
  impactData: [
    { variableName: '流量', maxImpactPercent: 22.5 },
    { variableName: '粘度', maxImpactPercent: 16.8 },
    { variableName: '密度', maxImpactPercent: 9.7 },
  ],
  analysis: {
    resultSummary: [
      '本次敏感性分析以流量作为敏感变量，对系统在不同变化比例下的运行结果进行了对比计算。',
      '基准工况下系统结果为正常，当前变量的敏感系数为 0.82，最大影响幅度为 22.5%，在影响程度排序中位列第 1 位。',
      '整体来看，该变量对系统运行结果具有较强影响，是评估系统稳定性的重要因素之一。',
    ],
    keyChangeAnalysis: [
      '基准结果反映系统在标准工况下处于稳定状态，可作为后续对比分析的参考基础。',
      '随着流量上升，末站压力与摩阻损失均呈整体上升趋势，表明变量变化会直接放大系统阻力与末端压力响应。',
      '不同变化区间内摩阻损失增长速度存在差异，说明系统对流量变化存在一定非线性响应特征。',
    ],
    riskRecognition: [
      '当前变量敏感系数较高，说明系统对该变量变化反应明显，应重点加强监测与控制。',
      '最大影响幅度较大，表明在设定波动范围内系统结果变化显著，存在较高的不稳定风险。',
      '流态在负向变化区间由湍流转为过渡流，说明该变量波动可能引起系统流动特征切换。',
    ],
    optimizationSuggestions: [
      '建议将流量作为运行控制中的重点监测对象，在实际调度中优先保证该变量稳定。',
      '建议进一步校核不同工况下的压力分布情况，确保关键节点压力满足运行要求。',
      '建议结合管径、粘度和输量参数进一步评估摩阻增长原因，为优化运行方案提供依据。',
    ],
  },
};
