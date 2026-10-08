# Pipeline Energy Cloud

基于 Spring Cloud Alibaba + Python AI Agent 的管道能耗分析系统。

## 快速开始

### 1. 环境准备
确保本地已安装：
- JDK 21+
- Maven 3.8+
- Docker & Docker Compose
- Python 3.10+

### 2. 启动基础设施
```bash
docker-compose up -d
```
这将启动 MySQL, Redis, Nacos, MinIO, Milvus。

### 3. 编译项目
```bash
mvn clean package -DskipTests
```

### 4. 模块说明
- `pipeline-gateway`: 网关服务 (Port: 8080)
- `pipeline-auth`: 认证服务 (Port: 9200)
- `pipeline-system`: 系统管理服务 (Port: 9300)
- `pipeline-data`: 数据中心服务 (Port: 9440)
- `pipeline-calculation`: 计算引擎服务 (Port: 9500)
