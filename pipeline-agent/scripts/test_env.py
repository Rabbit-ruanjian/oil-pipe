"""
环境测试脚本
验证所有依赖和配置是否正确
"""

import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def test_imports():
    """测试模块导入"""
    print("=" * 50)
    print("测试模块导入...")
    print("=" * 50)

    modules = [
        ("配置模块", "src.config", ["settings", "rag_config"]),
        ("数据模型", "src.models", ["AgentState", "ChatRequest"]),
        ("工具模块", "src.tools", ["DATABASE_TOOLS", "CALCULATION_TOOLS"]),
        ("RAG模块", "src.rag", ["RAGPipeline", "get_rag_pipeline"]),
        ("Agent模块", "src.agents", ["get_supervisor", "get_data_agent"]),
        ("工作流模块", "src.workflows", ["get_workflow", "AgentWorkflow"]),
        ("API模块", "src.api", ["app", "create_app"]),
    ]

    success = True
    for name, module_path, attrs in modules:
        try:
            module = __import__(module_path, fromlist=attrs)
            for attr in attrs:
                if hasattr(module, attr):
                    print(f"  ✓ {name}: {attr}")
                else:
                    print(f"  ✗ {name}: {attr} 不存在")
                    success = False
        except Exception as e:
            print(f"  ✗ {name}: 导入失败 - {e}")
            success = False

    return success


def test_config():
    """测试配置加载"""
    print("\n" + "=" * 50)
    print("测试配置加载...")
    print("=" * 50)

    try:
        from src.config import settings

        configs = [
            ("APP_NAME", settings.APP_NAME),
            ("APP_VERSION", settings.APP_VERSION),
            ("LLM_MODEL", settings.LLM_MODEL),
            ("DB_HOST", settings.DB_HOST),
            ("MILVUS_HOST", settings.MILVUS_HOST),
            ("API_PORT", settings.API_PORT),
        ]

        for name, value in configs:
            print(f"  {name}: {value}")

        return True

    except Exception as e:
        print(f"  ✗ 配置加载失败: {e}")
        return False


def test_database():
    """测试数据库连接"""
    print("\n" + "=" * 50)
    print("测试数据库连接...")
    print("=" * 50)

    try:
        from src.tools.database_tools import get_engine, execute_query

        engine = get_engine()
        result = execute_query("SELECT 1 as test")

        if result:
            print("  ✓ MySQL连接成功")
            return True
        else:
            print("  ✗ MySQL查询无结果")
            return False

    except Exception as e:
        print(f"  ✗ MySQL连接失败: {e}")
        return False


def test_llm():
    """测试LLM连接"""
    print("\n" + "=" * 50)
    print("测试LLM连接...")
    print("=" * 50)

    try:
        from langchain_openai import ChatOpenAI
        from src.config import settings

        llm = ChatOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_API_BASE,
            model=settings.LLM_MODEL,
            max_tokens=10
        )

        response = llm.invoke("Say hi")
        print(f"  ✓ LLM响应: {response.content[:50]}...")
        return True

    except Exception as e:
        print(f"  ✗ LLM连接失败: {e}")
        return False


def test_embedding():
    """测试Embedding"""
    print("\n" + "=" * 50)
    print("测试Embedding...")
    print("=" * 50)

    try:
        from src.rag.embeddings import get_embeddings

        embeddings = get_embeddings()
        vector = embeddings.embed_query("测试文本")

        if vector and len(vector) > 0:
            print(f"  ✓ Embedding维度: {len(vector)}")
            return True
        else:
            print("  ✗ Embedding返回空")
            return False

    except Exception as e:
        print(f"  ✗ Embedding失败: {e}")
        return False


def main():
    """运行所有测试"""
    print("\n" + "=" * 50)
    print("Pipeline Agent 环境测试")
    print("=" * 50)

    results = {
        "模块导入": test_imports(),
        "配置加载": test_config(),
        # "数据库连接": test_database(),  # 需要MySQL运行
        # "LLM连接": test_llm(),  # 需要API Key
        # "Embedding": test_embedding(),  # 需要API Key
    }

    print("\n" + "=" * 50)
    print("测试结果汇总")
    print("=" * 50)

    all_passed = True
    for name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {name}: {status}")
        if not passed:
            all_passed = False

    print("\n" + "=" * 50)
    if all_passed:
        print("所有测试通过！")
    else:
        print("部分测试失败，请检查配置。")
    print("=" * 50)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
