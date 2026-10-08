import { Steps, Tag } from 'antd';
import type { PlanStep } from '../../types/agent';

interface PlanTimelineProps {
  plan: PlanStep[];
  currentStep: number;
}

function toStepStatus(status: PlanStep['status']): 'wait' | 'process' | 'finish' | 'error' {
  if (status === 'completed') return 'finish';
  if (status === 'failed') return 'error';
  if (status === 'in_progress') return 'process';
  return 'wait';
}

export default function PlanTimeline({ plan, currentStep }: PlanTimelineProps) {
  if (!plan.length) {
    return <Tag color="default">等待规划中</Tag>;
  }

  return (
    <Steps
      direction="vertical"
      size="small"
      current={Math.max(currentStep - 1, 0)}
      items={plan.map((step) => ({
        status: toStepStatus(step.status),
        title: `步骤 ${step.step_number}`,
        description: `${step.description}${step.duration_ms ? ` (${step.duration_ms}ms)` : ''}`,
      }))}
    />
  );
}
