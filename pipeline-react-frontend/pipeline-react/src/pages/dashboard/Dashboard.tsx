/**
 * 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺? *  Dashboard - 娌规皵绠￠亾鏅鸿兘鐩戞祴绯荤粺
 *  璁捐鐞嗗康: Apple + Linear + Vercel 鏋佺畝涓讳箟椋庢牸
 * 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺? */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { EChartsOption } from 'echarts'
import {
  RiDropLine,
  RiTempColdLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiFlashlightLine,
  RiPulseLine,
} from 'react-icons/ri'
import {
  calculationHistoryApi,
  oilPropertyApi,
  pipelineApi,
  projectApi,
  pumpStationApi,
} from '../../api'
import AnimatedPage from '../../components/common/AnimatedPage'
import Chart from '../../components/common/Chart'
import { useChartConfig } from '../../hooks/useChartConfig'
import { useChartGesture } from '../../hooks/useChartGesture'
import type {
  CalculationHistory,
  OilProperty,
  PageResult,
  Pipeline,
  Project,
  PumpStation,
  R,
} from '../../types'
import styles from './Dashboard.module.css'

// 类型定义
interface StatCardData {
  id: string
  label: string
  value: number
  unit: string
  trend: 'up' | 'down' | 'neutral'
  trendValue: string
  icon: React.ReactNode
  colorClass: string
  accentClass: string
}

type ProjectDataProfile = {
  projectId: number
  projectName: string
  projectNumber: string
  pipelineCount: number
  historyCount: number
  totalRecordCount: number
}

type PumpStationMetricKey = 'zmi480Lift' | 'zmi375Lift' | 'displacement'

type PumpStationLineProfile = {
  id: number
  name: string
  metrics: Record<PumpStationMetricKey, number | null>
}

type OilMetricKey = 'density' | 'viscosity'

type PipelineScatterPoint = {
  pipelineId: number
  pipelineName: string
  projectId: number
  projectName: string
  projectNumber: string
  diameter: number
  length: number
  throughput: number | null
  thickness: number | null
  roughness: number | null
  startAltitude: number | null
  endAltitude: number | null
  altitudeSpan: number | null
}

const PUMP_STATION_LINE_OPTIONS: Array<{
  key: PumpStationMetricKey
  label: string
  unit: string
  color: string
  yAxisIndex: number
}> = [
  { key: 'zmi480Lift', label: 'ZMI480扬程', unit: 'm', color: '#2563EB', yAxisIndex: 0 },
  { key: 'zmi375Lift', label: 'ZMI375扬程', unit: 'm', color: '#7C3AED', yAxisIndex: 0 },
  { key: 'displacement', label: '排量', unit: 'm3/h', color: '#14B8A6', yAxisIndex: 1 },
]

const OIL_HEATMAP_OPTIONS: Array<{
  key: OilMetricKey
  label: string
  unit: string
}> = [
  { key: 'density', label: '密度', unit: 'kg/m3' },
  { key: 'viscosity', label: '运动粘度', unit: 'm²/s' },
]

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function hexToRgba(hexColor: string, alpha: number) {
  const normalized = hexColor.replace('#', '')
  const safeColor = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized

  const red = Number.parseInt(safeColor.slice(0, 2), 16)
  const green = Number.parseInt(safeColor.slice(2, 4), 16)
  const blue = Number.parseInt(safeColor.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function formatMetricValue(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPreciseMetricValue(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) < 1 ? 6 : 3,
  }).format(value)
}

function keepTooltipInChart(
  point: unknown,
  size: { contentSize: number[]; viewSize: number[] },
) {
  const defaultOffset = 12
  const [cursorX, cursorY] =
    Array.isArray(point) && point.length >= 2
      ? [Number(point[0]) || 0, Number(point[1]) || 0]
      : [0, 0]
  const [contentWidth = 0, contentHeight = 0] = Array.isArray(size.contentSize)
    ? size.contentSize
    : [0, 0]
  const [viewWidth = 0, viewHeight = 0] = Array.isArray(size.viewSize) ? size.viewSize : [0, 0]

  const nextX =
    cursorX + defaultOffset + contentWidth > viewWidth
      ? Math.max(defaultOffset, cursorX - contentWidth - defaultOffset)
      : cursorX + defaultOffset
  const nextY =
    cursorY + defaultOffset + contentHeight > viewHeight
      ? Math.max(defaultOffset, cursorY - contentHeight - defaultOffset)
      : cursorY + defaultOffset

  return [nextX, nextY]
}

function estimateLegendTextWidth(label: string, fontSize: number) {
  return Array.from(label).reduce((totalWidth, char) => {
    if (/[\u3400-\u9FFF]/u.test(char)) {
      return totalWidth + fontSize
    }

    if (/[A-Z0-9]/.test(char)) {
      return totalWidth + fontSize * 0.72
    }

    if (/[a-z]/.test(char)) {
      return totalWidth + fontSize * 0.62
    }

    return totalWidth + fontSize * 0.58
  }, 0)
}

function getLegendRowCount(
  labels: string[],
  containerWidth: number,
  options: {
    left: number
    right: number
    itemWidth: number
    itemGap: number
    fontSize: number
  },
) {
  if (labels.length === 0) {
    return 0
  }

  const availableWidth = Math.max(containerWidth - options.left - options.right, 220)
  let rowCount = 1
  let currentRowWidth = 0

  for (const label of labels) {
    const estimatedItemWidth = Math.min(
      availableWidth,
      Math.max(
        52,
        options.itemWidth +
          options.itemGap +
          estimateLegendTextWidth(label, options.fontSize) +
          22,
      ),
    )

    if (currentRowWidth > 0 && currentRowWidth + estimatedItemWidth > availableWidth) {
      rowCount += 1
      currentRowWidth = estimatedItemWidth
      continue
    }

    currentRowWidth += estimatedItemWidth
  }

  return rowCount
}

async function fetchAllPagedList<T>(
  requestPage: (pageNum: number, pageSize: number) => Promise<R<PageResult<T>>>,
  pageSize = 200,
  maxPages = 20,
) {
  const records: T[] = []
  let pageNum = 1
  let total = Number.POSITIVE_INFINITY

  while (pageNum <= maxPages && records.length < total) {
    const response = await requestPage(pageNum, pageSize)
    const pageData = response.data
    const list = Array.isArray(pageData?.list) ? pageData.list : []
    const currentTotal =
      typeof pageData?.total === 'number' && Number.isFinite(pageData.total)
        ? pageData.total
        : list.length

    records.push(...list)
    total = currentTotal

    if (list.length < pageSize || records.length >= total) {
      break
    }

    pageNum += 1
  }

  return records
}

// ECharts 主题配置 - Apple HIG 风格
// 主色调定义
const colors = {
  primary: '#007AFF',
  primaryLight: 'rgba(0, 122, 255, 0.12)',
  primaryMedium: 'rgba(0, 122, 255, 0.6)',
  purple: '#5856D6',
  purpleLight: 'rgba(88, 86, 214, 0.12)',
  cyan: '#32ADE6',
  cyanLight: 'rgba(50, 173, 230, 0.12)',
  green: '#34C759',
  orange: '#FF9500',
  textPrimary: '#1D1D1F',
  textSecondary: '#6E6E73',
  textTertiary: '#8E8E93',
  textMuted: '#AEAEB2',
  border: '#E5E5EA',
  borderLight: '#F2F2F7',
  bgElevated: '#FFFFFF',
}

const pipelineScatterPalette = [
  colors.primary,
  colors.orange,
  colors.green,
  colors.purple,
  colors.cyan,
  '#EF4444',
  '#0EA5E9',
  '#F97316',
]

const chartTheme = {
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif',
    color: colors.textSecondary,
  },
  title: {
    textStyle: {
      color: colors.textPrimary,
      fontWeight: 600,
    },
  },
  legend: {
    textStyle: {
      color: colors.textSecondary,
    },
  },
  tooltip: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    textStyle: {
      color: colors.textPrimary,
    },
    extraCssText: 'box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12); border-radius: 12px;',
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '15%',
    containLabel: true,
  },
  xAxis: {
    axisLine: {
      lineStyle: { color: colors.border },
    },
    axisTick: { show: false },
    axisLabel: {
      color: colors.textTertiary,
      fontSize: 11,
    },
    splitLine: { show: false },
  },
  yAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: colors.textTertiary,
      fontSize: 11,
    },
    splitLine: {
      lineStyle: {
        color: colors.borderLight,
        type: 'dashed' as const,
      },
    },
  },
}

export default function Dashboard() {
  const [trendLoading, setTrendLoading] = useState(true)
  const [trendHistories, setTrendHistories] = useState<CalculationHistory[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [pumpStations, setPumpStations] = useState<PumpStation[]>([])
  const [oilProperties, setOilProperties] = useState<OilProperty[]>([])
  const [allPipelines, setAllPipelines] = useState<Pipeline[]>([])
  const [pipelineCount, setPipelineCount] = useState(0)
  const [pumpStationCount, setPumpStationCount] = useState(0)
  const [oilPropertyCount, setOilPropertyCount] = useState(0)
  const [masterDataLoading, setMasterDataLoading] = useState(true)
  const [masterDataWarning, setMasterDataWarning] = useState<string | null>(null)
  const [pipelineDataWarning, setPipelineDataWarning] = useState<string | null>(null)
  const flowChart = useChartConfig()
  const pressureChart = useChartConfig({ mobileSvg: false })
  const energyChart = useChartConfig()
  const heatmapChart = useChartConfig({ mobileSvg: false })

  useChartGesture(flowChart.containerRef)
  useChartGesture(pressureChart.containerRef)
  useChartGesture(energyChart.containerRef)
  useChartGesture(heatmapChart.containerRef)

  useEffect(() => {
    let active = true
    let inflight = false

    const loadTrendData = async ({ withLoading = false }: { withLoading?: boolean } = {}) => {
      if (inflight) {
        return
      }

      inflight = true

      if (withLoading) {
        setTrendLoading(true)
        setMasterDataLoading(true)
      }

      setMasterDataWarning(null)
      setPipelineDataWarning(null)

      const [historyResult, projectResult, pumpStationResult, oilPropertyResult] =
        await Promise.allSettled([
        fetchAllPagedList<CalculationHistory>((pageNum, pageSize) =>
          calculationHistoryApi.page({ pageNum, pageSize }),
        ),
        projectApi.list(),
        pumpStationApi.list(),
        oilPropertyApi.list(),
      ])

      if (!active) {
        inflight = false
        return
      }

      if (historyResult.status === 'fulfilled') {
        setTrendHistories(historyResult.value)
      } else if (withLoading) {
        setTrendHistories([])
      }

      if (projectResult.status === 'fulfilled') {
        setProjects(projectResult.value.data ?? [])
      } else if (withLoading) {
        setProjects([])
      }

      if (pumpStationResult.status === 'fulfilled') {
        const nextPumpStations = pumpStationResult.value.data ?? []
        setPumpStations(nextPumpStations)
        setPumpStationCount(nextPumpStations.length)
      } else if (withLoading) {
        setPumpStations([])
        setPumpStationCount(0)
      }

      if (oilPropertyResult.status === 'fulfilled') {
        const nextOilProperties = oilPropertyResult.value.data ?? []
        setOilProperties(nextOilProperties)
        setOilPropertyCount(nextOilProperties.length)
      } else if (withLoading) {
        setOilProperties([])
        setOilPropertyCount(0)
      }

      let nextPipelineCount = 0
      let pipelineLoadFailed = false
      let loadedPipelines: Pipeline[] = []
      let canReplacePipelineState = false

      if (projectResult.status === 'fulfilled') {
        const loadedProjects = projectResult.value.data ?? []
        canReplacePipelineState = true

        if (loadedProjects.length > 0) {
          const pipelineResults = await Promise.allSettled(
            loadedProjects.map((project) => pipelineApi.listByProject(project.proId)),
          )

          if (!active) {
            inflight = false
            return
          }

          loadedPipelines = pipelineResults.flatMap((result) =>
            result.status === 'fulfilled' ? (result.value.data ?? []) : [],
          )

          nextPipelineCount = pipelineResults.reduce((total, result) => {
            if (result.status !== 'fulfilled') {
              pipelineLoadFailed = true
              return total
            }

            return total + (result.value.data?.length ?? 0)
          }, 0)
        }
      } else {
        pipelineLoadFailed = true
      }

      if (canReplacePipelineState) {
        setAllPipelines(loadedPipelines)
        setPipelineCount(nextPipelineCount)
      } else if (withLoading) {
        setAllPipelines([])
        setPipelineCount(0)
      }
      setPipelineDataWarning(
        projectResult.status !== 'fulfilled'
          ? '项目主数据加载失败，无法生成管道参数散点图。'
          : pipelineLoadFailed
            ? '管道参数加载不完整，已停止渲染散点图。'
            : null,
      )

      const failedSections: string[] = []
      if (projectResult.status !== 'fulfilled') {
        failedSections.push('项目')
      }
      if (pipelineLoadFailed) {
        failedSections.push('管道')
      }
      if (pumpStationResult.status !== 'fulfilled') {
        failedSections.push('泵站')
      }
      if (oilPropertyResult.status !== 'fulfilled') {
        failedSections.push('油品')
      }

      setMasterDataWarning(
        failedSections.length > 0
          ? `部分主数据加载失败：${failedSections.join('、')}`
          : null,
      )
      setTrendLoading(false)
      setMasterDataLoading(false)
      inflight = false
    }

    const refreshData = () => {
      void loadTrendData()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshData()
      }
    }

    void loadTrendData({ withLoading: true })
    const intervalId = window.setInterval(refreshData, 30000)
    window.addEventListener('focus', refreshData)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshData)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const projectMetaById = useMemo(
    () => new Map(projects.map((project) => [project.proId, project] as const)),
    [projects],
  )

  // 统计卡片数据
  const statsData: StatCardData[] = useMemo(() => {
    const trendValue = masterDataLoading
      ? '加载中'
      : masterDataWarning
        ? '部分失败'
        : '实时统计'

    return [
      {
        id: 'projectCount',
        label: '项目个数',
        value: projects.length,
        unit: '个',
        trend: 'neutral',
        trendValue,
        icon: <RiDropLine size={20} />,
        colorClass: styles.statIconBlue,
        accentClass: styles.statCardToneBlue,
      },
      {
        id: 'pipelineCount',
        label: '管道个数',
        value: pipelineCount,
        unit: '个',
        trend: 'neutral',
        trendValue,
        icon: <RiPulseLine size={20} />,
        colorClass: styles.statIconCyan,
        accentClass: styles.statCardToneCyan,
      },
      {
        id: 'pumpStationCount',
        label: '泵站个数',
        value: pumpStationCount,
        unit: '个',
        trend: 'neutral',
        trendValue,
        icon: <RiTempColdLine size={20} />,
        colorClass: styles.statIconGreen,
        accentClass: styles.statCardToneGreen,
      },
      {
        id: 'oilPropertyCount',
        label: '油品个数',
        value: oilPropertyCount,
        unit: '个',
        trend: 'neutral',
        trendValue,
        icon: <RiFlashlightLine size={20} />,
        colorClass: styles.statIconAmber,
        accentClass: styles.statCardToneAmber,
      },
    ]
  }, [masterDataLoading, masterDataWarning, oilPropertyCount, pipelineCount, projects.length, pumpStationCount])

  const projectDataProfiles = useMemo<ProjectDataProfile[]>(
    () =>
      projects
        .map((project) => {
          const projectPipelines = allPipelines.filter((pipeline) => pipeline.proId === project.proId)
          const projectHistories = trendHistories.filter((history) => history.projectId === project.proId)

          const pipelineCountForProject = projectPipelines.length
          const historyCount = projectHistories.length

          return {
            projectId: project.proId,
            projectName: project.name || `项目 ${project.proId}`,
            projectNumber: project.number || '',
            pipelineCount: pipelineCountForProject,
            historyCount,
            totalRecordCount: pipelineCountForProject + historyCount,
          }
        })
        .sort((left, right) => {
          if (right.totalRecordCount !== left.totalRecordCount) {
            return right.totalRecordCount - left.totalRecordCount
          }

          if (right.pipelineCount !== left.pipelineCount) {
            return right.pipelineCount - left.pipelineCount
          }

          return left.projectId - right.projectId
        }),
    [allPipelines, projects, trendHistories],
  )

  const projectDataSubtitle = useMemo(() => {
    if (trendLoading || masterDataLoading) {
      return '正在读取项目、管道、泵站与记录统计'
    }

    if (masterDataWarning) {
      return `${masterDataWarning}；图表仅展示已成功加载的真实数据`
    }

    if (projectDataProfiles.length === 0) {
      return '数据库中暂无项目主数据'
    }

    return `共 ${projectDataProfiles.length} 个项目；横轴显示项目编号，悬浮可查看完整项目名称，纵轴为数量。项目数据记录总数 = 管道 + 计算记录；泵站和油品改为共享资源单独统计`
  }, [
    masterDataLoading,
    masterDataWarning,
    projectDataProfiles.length,
    trendLoading,
  ])

  const projectDataOption = useMemo<EChartsOption>(() => {
    const seriesColors = {
      pipeline: '#2563EB',
      total: '#F59E0B',
    }
    const barMaxWidth = flowChart.isCompact ? 10 : 16

    return {
      ...chartTheme,
      color: [seriesColors.pipeline, seriesColors.total],
      grid: flowChart.isCompact
        ? { ...flowChart.grid, top: 52, right: 12, bottom: 56, left: 44 }
        : { ...flowChart.grid, top: 58, right: 22, bottom: 76, left: 52 },
      tooltip: {
        ...chartTheme.tooltip,
        ...flowChart.tooltipConf,
        trigger: 'axis',
        confine: true,
        position: (point: unknown, _params: unknown, _dom: unknown, _rect: unknown, size: unknown) =>
          keepTooltipInChart(
            point,
            typeof size === 'object' && size !== null
              ? (size as { contentSize: number[]; viewSize: number[] })
              : { contentSize: [], viewSize: [] },
          ),
        axisPointer: {
          type: 'shadow',
          shadowStyle: {
            color: hexToRgba(colors.primary, 0.06),
          },
        },
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]).map((item) =>
            typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {},
          )
          const firstItem = items[0] ?? {}
          const dataIndex = typeof firstItem.dataIndex === 'number' ? firstItem.dataIndex : -1
          const profile = dataIndex >= 0 ? projectDataProfiles[dataIndex] : null
          const title = profile
            ? `${profile.projectName}${profile.projectNumber ? `（${profile.projectNumber}）` : ''}`
            : '项目数据'
          const body = profile
            ? [
                `<div>管道数量：${formatMetricValue(profile.pipelineCount)}</div>`,
                `<div>数据库记录数：${formatMetricValue(profile.totalRecordCount)}</div>`,
              ].join('')
            : items
                .map((item) => {
                  const rawValue = Array.isArray(item.value) ? item.value[0] : item.value
                  const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)
                  return `<div>${String(item.marker ?? '')}${String(item.seriesName ?? '-')}：${formatMetricValue(
                    Number.isFinite(numericValue) ? numericValue : 0,
                  )}</div>`
                })
                .join('')

          return `<div style="font-weight:600;margin-bottom:6px;">${title}</div>${body}`
        },
      },
      legend: {
        ...(flowChart.legend !== false
          ? {
              ...chartTheme.legend,
              top: 0,
              data: ['管道数量', '数据记录总数'],
            }
          : { show: false }),
      },
      xAxis: {
        ...chartTheme.xAxis,
        type: 'category',
        data: projectDataProfiles.map((_, index) => index),
        axisLabel: {
          ...chartTheme.xAxis.axisLabel,
          ...flowChart.xAxisLabel,
          interval: 0,
          lineHeight: flowChart.isCompact ? 14 : 16,
          formatter: (_value: string | number, index: number) => {
            const profile = projectDataProfiles[index]
            if (!profile) {
              return ''
            }

            if (profile.projectNumber) {
              return profile.projectNumber
            }

            const maxLength = flowChart.isCompact ? 4 : 8
            return profile.projectName.length > maxLength
              ? `${profile.projectName.slice(0, maxLength)}…`
              : profile.projectName
          },
        },
      },
      yAxis: {
        ...chartTheme.yAxis,
        type: 'value',
        name: '数量',
        minInterval: 1,
        nameTextStyle: {
          color: colors.textTertiary,
          fontSize: 11,
          padding: [0, 0, 0, 8],
        },
      },
      series: [
        {
          name: '管道数量',
          type: 'bar',
          barMaxWidth,
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: seriesColors.pipeline,
          },
          data: projectDataProfiles.map((profile) => profile.pipelineCount),
        },
        {
          name: '数据记录总数',
          type: 'bar',
          barMaxWidth,
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: seriesColors.total,
          },
          data: projectDataProfiles.map((profile) => profile.totalRecordCount),
        },
      ],
    }
  }, [
    flowChart.grid,
    flowChart.isCompact,
    flowChart.legend,
    flowChart.tooltipConf,
    flowChart.xAxisLabel,
    projectDataProfiles,
  ])

  const pipelineScatterPoints = useMemo<PipelineScatterPoint[]>(
    () =>
      allPipelines.flatMap((pipeline) => {
        const diameter = toFiniteNumber(pipeline.diameter)
        const length = toFiniteNumber(pipeline.length)

        if (diameter === null || length === null) {
          return []
        }

        const throughput = toFiniteNumber(pipeline.throughput)
        const startAltitude = toFiniteNumber(pipeline.startAltitude)
        const endAltitude = toFiniteNumber(pipeline.endAltitude)
        const project = projectMetaById.get(pipeline.proId)

        return [{
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          projectId: pipeline.proId,
          projectName: project?.name ?? `项目 ${pipeline.proId}`,
          projectNumber: project?.number ?? '-',
          diameter,
          length,
          throughput,
          thickness: toFiniteNumber(pipeline.thickness),
          roughness: toFiniteNumber(pipeline.roughness),
          startAltitude,
          endAltitude,
          altitudeSpan:
            startAltitude !== null && endAltitude !== null
              ? Math.abs(endAltitude - startAltitude)
              : null,
        }]
      }),
    [allPipelines, projectMetaById],
  )

  const pipelineScatterSubtitle = useMemo(() => {
    if (masterDataLoading) {
      return '正在读取项目与管道参数'
    }

    if (pipelineDataWarning) {
      return pipelineDataWarning
    }

    if (projects.length === 0) {
      return '数据库中暂无项目主数据'
    }

    if (pipelineScatterPoints.length === 0) {
      return '数据库中暂无管道参数数据'
    }

    const projectCount = new Set(pipelineScatterPoints.map((point) => point.projectId)).size
    return `共 ${projectCount} 个项目、${pipelineScatterPoints.length} 条有效管道；横轴为管径，纵轴为长度，气泡大小映射设计输量，数据每 30 秒自动刷新`
  }, [masterDataLoading, pipelineDataWarning, pipelineScatterPoints, projects.length])

  const pipelineScatterOption = useMemo<EChartsOption>(() => {
    const throughputValues = pipelineScatterPoints
      .map((point) => point.throughput)
      .filter((value): value is number => value !== null)
    const minThroughput = throughputValues.length > 0 ? Math.min(...throughputValues) : 0
    const maxThroughput = throughputValues.length > 0 ? Math.max(...throughputValues) : 0
    const throughputRange = maxThroughput - minThroughput

    const getSymbolSize = (throughput: number | null) => {
      const minSize = pressureChart.isCompact ? 10 : 14
      const maxSize = pressureChart.isCompact ? 22 : 34

      if (throughput === null || throughputValues.length === 0) {
        return minSize + 2
      }

      if (throughputRange <= 0) {
        return (minSize + maxSize) / 2
      }

      const normalized = (throughput - minThroughput) / throughputRange
      return Number((minSize + normalized * (maxSize - minSize)).toFixed(2))
    }

    const groupedPoints = pipelineScatterPoints.reduce<
      Map<number, { projectName: string; color: string; data: Array<Record<string, unknown>> }>
    >((map, point) => {
      const groupIndex = map.size
      const existing = map.get(point.projectId)

      if (existing) {
        existing.data.push({
          value: [point.diameter, point.length],
          symbolSize: getSymbolSize(point.throughput),
          pipelineId: point.pipelineId,
          pipelineName: point.pipelineName,
          projectName: point.projectName,
          projectNumber: point.projectNumber,
          diameter: point.diameter,
          length: point.length,
          throughput: point.throughput,
          thickness: point.thickness,
          roughness: point.roughness,
          startAltitude: point.startAltitude,
          endAltitude: point.endAltitude,
          altitudeSpan: point.altitudeSpan,
        })
        return map
      }

      const color = pipelineScatterPalette[groupIndex % pipelineScatterPalette.length]
      map.set(point.projectId, {
        projectName: point.projectName,
        color,
        data: [{
          value: [point.diameter, point.length],
          symbolSize: getSymbolSize(point.throughput),
          pipelineId: point.pipelineId,
          pipelineName: point.pipelineName,
          projectName: point.projectName,
          projectNumber: point.projectNumber,
          diameter: point.diameter,
          length: point.length,
          throughput: point.throughput,
          thickness: point.thickness,
          roughness: point.roughness,
          startAltitude: point.startAltitude,
          endAltitude: point.endAltitude,
          altitudeSpan: point.altitudeSpan,
        }],
      })
      return map
    }, new Map())

    const series = Array.from(groupedPoints.values()).map((group) => ({
      name: group.projectName,
      type: 'scatter' as const,
      data: group.data,
      itemStyle: {
        color: hexToRgba(group.color, 0.84),
        borderColor: group.color,
        borderWidth: 1.5,
      },
      emphasis: {
        focus: 'series' as const,
        scale: true,
        itemStyle: {
          shadowBlur: 16,
          shadowColor: hexToRgba(group.color, 0.3),
          borderWidth: 2,
        },
      },
    }))

    const legendLabels = series.map((item) => item.name)
    const legendLeft = pressureChart.isCompact ? 8 : 12
    const legendRight = pressureChart.isCompact ? 8 : 12
    const legendTop = pressureChart.isCompact ? 4 : 8
    const legendItemGap = pressureChart.isCompact ? 10 : 14
    const legendItemWidth = pressureChart.isCompact ? 12 : 14
    const legendFontSize = pressureChart.isCompact ? 10 : 11
    const legendRowHeight = pressureChart.isCompact ? 18 : 24
    const estimatedLegendRows =
      pressureChart.legend === false
        ? 0
        : getLegendRowCount(legendLabels, pressureChart.containerWidth, {
            left: legendLeft,
            right: legendRight,
            itemWidth: legendItemWidth,
            itemGap: legendItemGap,
            fontSize: legendFontSize,
          })
    const maxVisibleLegendRows = pressureChart.isMedium ? 2 : 3
    const useScrollableLegend = estimatedLegendRows > maxVisibleLegendRows
    const visibleLegendRows =
      pressureChart.legend === false
        ? 0
        : useScrollableLegend
          ? 1
          : Math.max(estimatedLegendRows, 1)
    const legendBlockHeight =
      visibleLegendRows > 0
        ? visibleLegendRows * legendRowHeight + (visibleLegendRows - 1) * 4
        : 0
    const scatterGridTop = pressureChart.isCompact
      ? 42
      : pressureChart.legend === false
        ? 24
        : legendTop + legendBlockHeight + (pressureChart.isMedium ? 18 : 20)

    const scatterLegend =
      pressureChart.legend === false
        ? { show: false }
        : {
            ...chartTheme.legend,
            type: useScrollableLegend ? 'scroll' as const : 'plain' as const,
            data: legendLabels,
            orient: 'horizontal' as const,
            left: legendLeft,
            right: legendRight,
            top: legendTop,
            width: Math.max(pressureChart.containerWidth - legendLeft - legendRight, 220),
            itemGap: legendItemGap,
            itemWidth: legendItemWidth,
            itemHeight: 4,
            pageButtonPosition: 'end' as const,
            pageButtonGap: 12,
            pageIconColor: colors.primary,
            pageIconInactiveColor: colors.border,
            pageTextStyle: {
              color: colors.textTertiary,
              fontSize: legendFontSize,
            },
            textStyle: {
              ...chartTheme.legend.textStyle,
              color: colors.textSecondary,
              fontSize: legendFontSize,
            },
          }

    return {
      ...chartTheme,
      grid: pressureChart.isCompact
        ? { ...pressureChart.grid, top: 42, right: 16, bottom: 42, left: 56 }
        : {
            ...pressureChart.grid,
            top: scatterGridTop,
            right: 18,
            bottom: 46,
            left: 76,
          },
      tooltip: {
        ...chartTheme.tooltip,
        ...pressureChart.tooltipConf,
        trigger: 'item',
        formatter: (params: unknown) => {
          const record =
            typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
          const data =
            typeof record.data === 'object' && record.data !== null
              ? (record.data as Record<string, unknown>)
              : {}
          const throughput = typeof data.throughput === 'number' ? data.throughput : null
          const thickness = typeof data.thickness === 'number' ? data.thickness : null
          const roughness = typeof data.roughness === 'number' ? data.roughness : null
          const altitudeSpan = typeof data.altitudeSpan === 'number' ? data.altitudeSpan : null

          return [
            `<div style="font-weight:600;margin-bottom:6px;">${String(data.pipelineName ?? '-')}</div>`,
            `<div>项目编号：${String(data.projectNumber ?? '-')}</div>`,
            `<div>所属项目：${String(data.projectName ?? '-')}</div>`,
            `<div>管径：${typeof data.diameter === 'number' ? `${formatMetricValue(data.diameter)} mm` : '暂无数据'}</div>`,
            `<div>长度：${typeof data.length === 'number' ? `${formatMetricValue(data.length)} km` : '暂无数据'}</div>`,
            `<div>设计输量：${throughput === null ? '暂无数据' : `${formatMetricValue(throughput)}`}</div>`,
            `<div>壁厚：${thickness === null ? '暂无数据' : `${formatMetricValue(thickness)} mm`}</div>`,
            `<div>粗糙度：${roughness === null ? '暂无数据' : `${formatMetricValue(roughness)} m`}</div>`,
            `<div>高程差：${altitudeSpan === null ? '暂无数据' : `${formatMetricValue(altitudeSpan)} m`}</div>`,
          ].join('')
        },
      },
      xAxis: {
        ...chartTheme.xAxis,
        type: 'value',
        name: '管径 (mm)',
        nameLocation: 'middle',
        nameGap: pressureChart.isCompact ? 28 : 34,
        splitLine: {
          show: true,
          lineStyle: {
            color: colors.borderLight,
            type: 'dashed' as const,
          },
        },
        axisLabel: {
          ...chartTheme.xAxis.axisLabel,
          ...pressureChart.xAxisLabel,
          rotate: 0,
        },
      },
      yAxis: {
        ...chartTheme.yAxis,
        type: 'value',
        name: '长度 (km)',
        nameTextStyle: {
          color: colors.textTertiary,
          fontSize: pressureChart.isCompact ? 10 : 11,
        },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: pressureChart.isCompact ? 11 : 12,
        },
      },
      legend: pressureChart.legend === false
        ? { show: false }
        : scatterLegend,
      series,
    }
  }, [
    pressureChart.containerWidth,
    pipelineScatterPoints,
    pressureChart.grid,
    pressureChart.isCompact,
    pressureChart.isMedium,
    pressureChart.legend,
    pressureChart.tooltipConf,
    pressureChart.xAxisLabel,
  ])

  const pumpStationLineProfiles = useMemo<PumpStationLineProfile[]>(
    () =>
      pumpStations.map((pumpStation) => ({
        id: pumpStation.id,
        name: pumpStation.name || `泵站 ${pumpStation.id}`,
        metrics: {
          zmi480Lift: toFiniteNumber(pumpStation.zmi480Lift),
          zmi375Lift: toFiniteNumber(pumpStation.zmi375Lift),
          displacement: toFiniteNumber(pumpStation.displacement),
        },
      })),
    [pumpStations],
  )

  const pumpStationLineProfilesWithData = useMemo(
    () =>
      pumpStationLineProfiles.filter((profile) =>
        Object.values(profile.metrics).some((value) => value !== null),
      ),
    [pumpStationLineProfiles],
  )

  const pumpStationLineSubtitle = useMemo(() => {
    if (masterDataLoading) {
      return '正在读取泵站参数主数据'
    }

    if (pumpStations.length === 0) {
      return '数据库中暂无泵站参数主数据'
    }

    if (pumpStationLineProfilesWithData.length === 0) {
      return '当前泵站记录缺少扬程或排量参数，无法生成折线图'
    }

    return `当前数据库暂无泵站时间序列运行日志，改为按泵站编号/名称对比共享泵站主数据中的 ZMI480扬程、ZMI375扬程与排量；共 ${pumpStationLineProfilesWithData.length} 座泵站`
  }, [
    masterDataLoading,
    pumpStationLineProfilesWithData.length,
    pumpStations.length,
  ])

  const pumpStationLineOption = useMemo<EChartsOption>(() => ({
    ...chartTheme,
    color: PUMP_STATION_LINE_OPTIONS.map((item) => item.color),
    grid: energyChart.isCompact
      ? { ...energyChart.grid, top: 52, right: 14, bottom: 60, left: 48 }
      : { ...energyChart.grid, top: 56, right: 18, bottom: 74, left: 58 },
    tooltip: {
      ...chartTheme.tooltip,
      ...energyChart.tooltipConf,
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: hexToRgba(colors.primary, 0.22),
          width: 1.5,
        },
      },
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]).map((item) =>
          typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {},
        )
        const firstItem = items[0] ?? {}
        const dataIndex = typeof firstItem.dataIndex === 'number' ? firstItem.dataIndex : -1
        const profile =
          dataIndex >= 0 ? pumpStationLineProfilesWithData[dataIndex] : null
        const title = profile ? `${profile.name}（#${profile.id}）` : '泵站参数'
        const body = items
          .map((item) => {
            const rawValue = Array.isArray(item.value) ? item.value[1] : item.value
            const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)
            const seriesName = String(item.seriesName ?? '-')
            const unit = PUMP_STATION_LINE_OPTIONS.find((option) => option.label === seriesName)?.unit ?? ''
            return `<div>${String(item.marker ?? '')}${seriesName}：${
              Number.isFinite(numericValue) ? formatMetricValue(numericValue) : '-'
            } ${unit}</div>`
          })
          .join('')
        return `<div style="font-weight:600;margin-bottom:6px;">${title}</div>${body}`
      },
    },
    legend: energyChart.legend === false
      ? { show: false }
      : {
          ...chartTheme.legend,
          data: PUMP_STATION_LINE_OPTIONS.map((item) => item.label),
          ...energyChart.legend,
        },
    xAxis: {
      ...chartTheme.xAxis,
      type: 'category',
      data: pumpStationLineProfilesWithData.map((profile) => profile.id),
      axisLabel: {
        ...chartTheme.xAxis.axisLabel,
        ...energyChart.xAxisLabel,
        interval: 0,
        lineHeight: energyChart.isCompact ? 14 : 16,
        formatter: (_value: string | number, index: number) => {
          const profile = pumpStationLineProfilesWithData[index]
          if (!profile) {
            return ''
          }

          const maxLength = energyChart.isCompact ? 4 : 8
          const stationName =
            profile.name.length > maxLength
              ? `${profile.name.slice(0, maxLength)}…`
              : profile.name

          return `#${profile.id}\n${stationName}`
        },
      },
    },
    yAxis: [
      {
        ...chartTheme.yAxis,
        type: 'value',
        name: '扬程 (m)',
        minInterval: 1,
        nameTextStyle: {
          color: colors.textTertiary,
          fontSize: 11,
          padding: [0, 0, 0, 8],
        },
      },
      {
        ...chartTheme.yAxis,
        type: 'value',
        name: '排量 (m3/h)',
        minInterval: 1,
        nameTextStyle: {
          color: colors.textTertiary,
          fontSize: 11,
          padding: [0, 8, 0, 0],
        },
      },
    ],
    series: PUMP_STATION_LINE_OPTIONS.map((metric) => ({
      name: metric.label,
      type: 'line' as const,
      smooth: true,
      yAxisIndex: metric.yAxisIndex,
      showSymbol: pumpStationLineProfilesWithData.length <= 10,
      symbolSize: energyChart.isCompact ? 6 : 8,
      connectNulls: false,
      lineStyle: {
        width: 2.5,
        color: metric.color,
      },
      itemStyle: {
        color: metric.color,
      },
      emphasis: {
        focus: 'series' as const,
      },
      data: pumpStationLineProfilesWithData.map((profile) => profile.metrics[metric.key]),
    })),
  }), [
    energyChart.grid,
    energyChart.isCompact,
    energyChart.legend,
    energyChart.tooltipConf,
    energyChart.xAxisLabel,
    pumpStationLineProfilesWithData,
  ])

  const oilHeatmapSubtitle = useMemo(() => {
    if (masterDataLoading) {
      return '正在读取油品参数主数据'
    }

    if (oilProperties.length === 0) {
      return '数据库中暂无油品参数主数据'
    }

    return `当前数据库已入库的油品维度为密度与运动粘度；横轴为参数维度，纵轴为油品名称/编号，颜色为真实数据标准化结果；共 ${oilProperties.length} 种油品`
  }, [masterDataLoading, oilProperties.length])

  const oilHeatmapOption = useMemo<EChartsOption>(() => {
    const xLabels = OIL_HEATMAP_OPTIONS.map((item) => item.label)
    const yLabels = oilProperties.map((oil) => `#${oil.id} ${oil.name}`)

    const heatmapData = OIL_HEATMAP_OPTIONS.flatMap((metric, xIndex) => {
      const validValues = oilProperties
        .map((oil) => toFiniteNumber(oil[metric.key]))
        .filter((value): value is number => value !== null)
      const minValue = validValues.length > 0 ? Math.min(...validValues) : 0
      const maxValue = validValues.length > 0 ? Math.max(...validValues) : 0
      const range = maxValue - minValue

      return oilProperties.map((oil, yIndex) => {
        const rawValue = toFiniteNumber(oil[metric.key])
        const normalizedValue =
          rawValue === null
            ? -1
            : range === 0
              ? 0.5
              : Number(((rawValue - minValue) / range).toFixed(4))

        return {
          value: [xIndex, yIndex, normalizedValue],
          oilId: oil.id,
          oilName: oil.name,
          parameterLabel: metric.label,
          unit: metric.unit,
          rawValue,
        }
      })
    })

    return {
      ...chartTheme,
      legend: {
        show: false,
      },
      grid: heatmapChart.isCompact
        ? { ...heatmapChart.grid, top: 12, right: 38, bottom: 34, left: 24 }
        : { ...heatmapChart.grid, top: 12, right: 56, bottom: 38, left: 36 },
      tooltip: {
        ...chartTheme.tooltip,
        ...heatmapChart.tooltipConf,
        trigger: 'item',
        formatter: (params: unknown) => {
          const record =
            typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
          const data =
            typeof record.data === 'object' && record.data !== null
              ? (record.data as Record<string, unknown>)
              : {}
          const rawValue = typeof data.rawValue === 'number' ? data.rawValue : null
          const normalizedValue =
            Array.isArray(data.value) && typeof data.value[2] === 'number' && data.value[2] >= 0
              ? `${Math.round(data.value[2] * 100)}%`
              : '无数据'

          return [
            `<div style="font-weight:600;margin-bottom:6px;">${String(data.oilName ?? '-')}</div>`,
            `<div>油品编号：${String(data.oilId ?? '-')}</div>`,
            `<div>参数项：${String(data.parameterLabel ?? '-')}</div>`,
            `<div>原始值：${rawValue === null ? '暂无数据' : `${formatPreciseMetricValue(rawValue)} ${String(data.unit ?? '')}`}</div>`,
            `<div>标准化：${normalizedValue}</div>`,
          ].join('')
        },
      },
      xAxis: {
        ...chartTheme.xAxis,
        type: 'category',
        data: xLabels,
        axisLabel: {
          ...chartTheme.xAxis.axisLabel,
          ...heatmapChart.xAxisLabel,
          interval: 0,
          margin: heatmapChart.isCompact ? 12 : 16,
        },
      },
      yAxis: {
        ...chartTheme.yAxis,
        type: 'category',
        data: yLabels,
        axisLabel: {
          color: colors.textSecondary,
          fontSize: heatmapChart.isCompact ? 10 : 12,
          width: heatmapChart.isCompact ? 92 : 120,
          overflow: 'truncate',
          align: 'right',
          margin: heatmapChart.isCompact ? 10 : 12,
          formatter: (value: string) => (value.length > 12 ? `${value.slice(0, 12)}…` : value),
        },
      },
      visualMap: {
        min: 0,
        max: 1,
        show: true,
        calculable: false,
        orient: 'vertical',
        right: heatmapChart.isCompact ? 4 : 8,
        top: 'middle',
        itemWidth: heatmapChart.isCompact ? 10 : 12,
        itemHeight: heatmapChart.isCompact ? 108 : 132,
        text: ['高', '低'],
        textGap: 10,
        textStyle: {
          color: colors.textSecondary,
          fontSize: heatmapChart.isCompact ? 10 : 12,
          fontWeight: 600,
        },
        inRange: {
          color: ['#EFF6FF', '#BFDBFE', '#60A5FA', '#2563EB'],
        },
        outOfRange: {
          color: ['#F3F4F6'],
        },
      },
      series: [
        {
          name: '油品参数',
          type: 'heatmap',
          data: heatmapData,
          progressive: 0,
          itemStyle: {
            borderColor: 'rgba(255, 255, 255, 0.78)',
            borderWidth: 2,
          },
          label: {
            show: !heatmapChart.isCompact,
            color: colors.textPrimary,
            fontSize: heatmapChart.isCompact ? 9 : 10,
            formatter: (params: unknown) => {
              const record =
                typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
              const data =
                typeof record.data === 'object' && record.data !== null
                  ? (record.data as Record<string, unknown>)
                  : {}
              return typeof data.rawValue === 'number' ? formatPreciseMetricValue(data.rawValue) : '-'
            },
          },
          emphasis: {
            itemStyle: {
              borderColor: '#FFFFFF',
              borderWidth: 1,
              shadowBlur: 12,
              shadowColor: 'rgba(15, 23, 42, 0.18)',
            },
          },
        },
      ],
    }
  }, [
    heatmapChart.grid,
    heatmapChart.isCompact,
    heatmapChart.tooltipConf,
    heatmapChart.xAxisLabel,
    oilProperties,
  ])

  // 鑾峰彇瓒嬪娍鏍峰紡
  const getTrendClass = (trend: StatCardData['trend']) => {
    const classMap = {
      up: styles.statTrendUp,
      down: styles.statTrendDown,
      neutral: styles.statTrendNeutral,
    }
    return classMap[trend]
  }

  return (
    <AnimatedPage className={styles.dashboard}>
      <div className={styles.dashboardContent}>
        {/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?         * Header 鍖哄煙
         * 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.headerInfo}>
              <h1 className={styles.pageTitle}>
                <span className={styles.pageTitleAccent}>智能监测</span> 控制中心
              </h1>
              <p className={styles.pageSubtitle}>
                油气管道实时数据监控与智能分析平台</p>
            </div>

          </div>
        </header>

        {/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?         * 缁熻鍗＄墖鍖哄煙
         * 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/}
        <section className={`${styles.statsGrid} grid-auto-stats`}>
          {statsData.map((stat, index) => (
            <motion.div
              key={stat.id}
              className={`${styles.statCard} ${stat.accentClass}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 24,
                delay: index * 0.08,
              }}
              whileHover={{ y: -4, boxShadow: 'var(--shadow-lg)' }}
            >
              <div className={styles.statHeader}>
                <span className={styles.statLabel}>{stat.label}</span>
                <div className={`${styles.statIconWrapper} ${stat.colorClass}`}>
                  {stat.icon}
                </div>
              </div>

              <div className={styles.statMetricPanel}>
                <div className={styles.statValueRow}>
                  <div className={styles.statValue}>
                    {formatMetricValue(stat.value)}
                    <span className={styles.statUnit}>{stat.unit}</span>
                  </div>
                  <div className={styles.statGlyph} aria-hidden="true">
                    <span className={styles.statGlyphBar} />
                    <span className={styles.statGlyphBar} />
                    <span className={styles.statGlyphBar} />
                    <span className={styles.statGlyphBar} />
                  </div>
                </div>
              </div>

              <div className={styles.statFooter}>
                <span className={`${styles.statTrend} ${getTrendClass(stat.trend)}`}>
                  {stat.trend === 'up' && <RiArrowUpLine size={12} />}
                  {stat.trend === 'down' && <RiArrowDownLine size={12} />}
                  {stat.trendValue}
                </span>
                <div className={styles.statFooterAccent} aria-hidden="true">
                  <span className={styles.statFooterAccentBar} />
                  <span className={styles.statFooterAccentBar} />
                  <span className={styles.statFooterAccentBar} />
                </div>
              </div>
            </motion.div>
          ))}
        </section>

        {/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?         * 鍥捐〃鍖哄煙
         * 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?*/}
        <section className={`${styles.chartsSection} grid-auto-charts`}>
          {/* 项目数据统计柱状图 */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.chartTitleGroup}>
                <h3 className={styles.chartTitle}>项目数据统计柱状图</h3>
                <p className={styles.chartSubtitle}>{projectDataSubtitle}</p>
              </div>
            </div>
            <div className={styles.chartContainer} ref={flowChart.containerRef}>
              {trendLoading || masterDataLoading ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                  }}
                >
                  正在加载项目统计数据...
                </div>
              ) : null}
              {!trendLoading && !masterDataLoading && projects.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  暂无项目主数据，无法生成项目统计柱状图。
                </div>
              ) : null}
              {!trendLoading && !masterDataLoading && projects.length > 0 ? (
                <Chart option={projectDataOption} renderer={flowChart.renderer} />
              ) : null}
            </div>
          </div>

          {/* 管道参数关系散点图 */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.chartTitleGroup}>
                <h3 className={styles.chartTitle}>管道参数关系散点图</h3>
                <p className={styles.chartSubtitle}>{pipelineScatterSubtitle}</p>
              </div>
            </div>
            <div className={styles.chartContainer} ref={pressureChart.containerRef}>
              {masterDataLoading ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                  }}
                >
                  正在加载项目与管道参数...
                </div>
              ) : null}
              {!masterDataLoading && pipelineDataWarning ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#D92D20',
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  {pipelineDataWarning}
                </div>
              ) : null}
              {!masterDataLoading && !pipelineDataWarning && projects.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  暂无项目主数据，无法生成管道参数散点图。
                </div>
              ) : null}
              {!masterDataLoading && !pipelineDataWarning && projects.length > 0 && pipelineScatterPoints.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  暂无包含有效管径与长度的管道数据，无法生成散点图。
                </div>
              ) : null}
              {!masterDataLoading && !pipelineDataWarning && projects.length > 0 && pipelineScatterPoints.length > 0 ? (
                <Chart option={pipelineScatterOption} renderer={pressureChart.renderer} />
              ) : null}
            </div>
          </div>

          {/* 泵站参数折线图 */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.chartTitleGroup}>
                <h3 className={styles.chartTitle}>泵站参数折线图</h3>
                <p className={styles.chartSubtitle}>{pumpStationLineSubtitle}</p>
              </div>
            </div>
            <div className={`${styles.chartContainer} ${styles.chartContainerLarge}`} ref={energyChart.containerRef}>
              {masterDataLoading ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                  }}
                >
                  正在加载泵站参数...
                </div>
              ) : null}
              {!masterDataLoading && pumpStations.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  暂无泵站参数主数据，无法生成折线图。
                </div>
              ) : null}
              {!masterDataLoading && pumpStations.length > 0 && pumpStationLineProfilesWithData.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  当前泵站记录缺少可用于折线图的真实扬程或排量参数。
                </div>
              ) : null}
              {!masterDataLoading && pumpStationLineProfilesWithData.length > 0 ? (
                <Chart option={pumpStationLineOption} renderer={energyChart.renderer} />
              ) : null}
            </div>
          </div>

          {/* 油品参数热力图 */}
          <div className={styles.chartCard}>
            <div className={styles.chartHeader}>
              <div className={styles.chartTitleGroup}>
                <h3 className={styles.chartTitle}>油品参数热力图</h3>
                <p className={styles.chartSubtitle}>{oilHeatmapSubtitle}</p>
              </div>
            </div>
            <div className={`${styles.chartContainer} ${styles.chartContainerLarge}`} ref={heatmapChart.containerRef}>
              {masterDataLoading ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                  }}
                >
                  正在加载油品参数...
                </div>
              ) : null}
              {!masterDataLoading && oilProperties.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: '0 24px',
                  }}
                >
                  暂无油品参数主数据，无法生成热力图。
                </div>
              ) : null}
              {!masterDataLoading && oilProperties.length > 0 ? (
                <Chart option={oilHeatmapOption} renderer={heatmapChart.renderer} />
              ) : null}
            </div>
          </div>
        </section>

      </div>
    </AnimatedPage>
  )
}






