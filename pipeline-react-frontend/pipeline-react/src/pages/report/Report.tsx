import { Card, Col, Row, Space, Statistic, Typography } from 'antd';

const { Paragraph, Title } = Typography;

const reportCards = [
  { title: '水力分析报告', value: '已接入' },
  { title: '优化调度报告', value: '待生成' },
  { title: '智能诊断摘要', value: '待生成' },
];

export default function Report() {
  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Title level={2} style={{ marginTop: 0 }}>
          报告中心
        </Title>
        <Paragraph style={{ marginBottom: 0 }}>
          这里用于集中查看计算分析、AI总结和导出报告。当前先提供可用页面，确保前端路由正常工作。
        </Paragraph>
      </Card>

      <Row gutter={[16, 16]}>
        {reportCards.map((item) => (
          <Col xs={24} md={8} key={item.title}>
            <Card>
              <Statistic title={item.title} value={item.value} />
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}
