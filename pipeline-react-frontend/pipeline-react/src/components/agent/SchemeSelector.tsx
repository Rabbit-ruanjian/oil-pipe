import { Radio, Table, Tag } from 'antd';
import { useMemo } from 'react';
import type { HITLOption } from '../../types/agent';

interface SchemeSelectorProps {
  options: HITLOption[];
  value: string | null;
  onChange: (value: string) => void;
}

export default function SchemeSelector({ options, value, onChange }: SchemeSelectorProps) {
  const columns = useMemo(
    () => [
      {
        title: '方案',
        dataIndex: 'label',
        key: 'label',
        render: (_: unknown, row: HITLOption) => (
          <Radio checked={value === row.id} onChange={() => onChange(row.id)}>
            {row.label}
          </Radio>
        ),
      },
      {
        title: '日能耗(kWh)',
        dataIndex: 'energy',
        key: 'energy',
      },
      {
        title: '末站压力',
        dataIndex: 'end_pressure',
        key: 'end_pressure',
      },
      {
        title: '节能率',
        dataIndex: 'saving_rate',
        key: 'saving_rate',
        render: (value: number | undefined) => (value !== undefined ? `${value}%` : '-'),
      },
      {
        title: '风险',
        dataIndex: 'risk_level',
        key: 'risk_level',
        render: (risk: string | undefined) =>
          risk === 'high' ? <Tag color="red">高风险</Tag> : <Tag color="green">正常</Tag>,
      },
    ],
    [onChange, value]
  );

  return (
    <Table
      rowKey="id"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={options}
    />
  );
}
