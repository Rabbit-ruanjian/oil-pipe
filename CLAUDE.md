# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Pipeline Energy Consumption Analysis System** (管道能耗分析系统) - a microservices-based platform for analyzing oil pipeline hydraulics and optimizing pump station operations. The system combines a Java Spring Cloud backend with a Python AI agent service.

## Build & Run Commands

### Java Backend (pipeline-energy-cloud)

```bash
# Start infrastructure (MySQL, Redis, Nacos, MinIO, Milvus)
cd pipeline-energy-cloud
docker-compose up -d

# Build all modules
mvn clean package -DskipTests

# Run individual services (from respective module directories)
java -jar pipeline-gateway/target/pipeline-gateway-1.0.0-SNAPSHOT.jar
java -jar pipeline-auth/target/pipeline-auth-1.0.0-SNAPSHOT.jar
java -jar pipeline-data/target/pipeline-data-1.0.0-SNAPSHOT.jar
java -jar pipeline-calculation/target/pipeline-calculation-1.0.0-SNAPSHOT.jar
```

### Python AI Service (pipeline-agent)

```bash
cd pipeline-agent
pip install -r requirements.txt
python main.py
# Or with uvicorn: uvicorn src.api.main:app --host 0.0.0.0 --port 8100
```

## Architecture

### Microservices (Java - Spring Cloud Alibaba)

| Service | Port | Purpose |
|---------|------|---------|
| pipeline-gateway | 8080 | API Gateway with Sa-Token auth filter |
| pipeline-auth | 9200 | Authentication (Sa-Token + Redis sessions) |
| pipeline-system | 9300 | User/role management |
| pipeline-data | 9400 | CRUD for Project, Pipeline, PumpStation, OilProperty |
| pipeline-calculation | 9500 | Hydraulic analysis & pump optimization engine |

### AI Service (Python - FastAPI + LangGraph)

- **Port**: 8100
- **Purpose**: RAG knowledge base Q&A and intelligent agent orchestration
- **Tools**: SQL queries, knowledge base search, hydraulic analysis API calls

### Tech Stack

- **Java 21**, Spring Boot 3.1.5, Spring Cloud Alibaba 2022.0.0.0
- **Python 3.11**, FastAPI, LangChain, LangGraph
- **Databases**: MySQL 8.0, Redis 7, Milvus (vector DB)
- **Auth**: Sa-Token with Redis-distributed sessions
- **ORM**: MyBatis Plus 3.5.4.1

## Key Domain Concepts

### Calculation Algorithms (`pipeline-calculation`)

Two core calculation strategies implement hydraulic engineering formulas (ported from original C# AlgorithmLib):

1. **HydraulicAnalysisStrategy**: Computes Reynolds number, friction head loss, hydraulic slope, station pressures based on flow regime (laminar, smooth, mixed friction, rough)

2. **OptimizationStrategy**: Iterates 8 pump combinations (ZMI480 × ZMI375) to find optimal configuration minimizing end station pressure while maintaining feasibility (end pressure > 0)

### AI Agent (`pipeline-agent/src/agents/`)

- **graph.py**: LangGraph workflow with router → general_agent → END
- **tools.py**: Three tools - SQL_Database, Knowledge_Base, Hydraulic_Analysis (calls Java calculation service)
- **state.py**: Agent state management

## Database Schema

Located at `pipeline-energy-cloud/sql/schema.sql`:
- `t_project` - Project information
- `t_pipeline` - Pipeline parameters (length, diameter, thickness, elevation)
- `t_pump_station` - Pump station specs (efficiency, displacement, lift)
- `t_oil_property` - Oil properties (density, viscosity)
- `sys_user` - User accounts (default: admin/admin123)

## Code Style

- Java: Follow Alibaba Java Coding Guidelines
- Python: Follow PEP8
- Use BigDecimal for all hydraulic calculations (precision matters)

