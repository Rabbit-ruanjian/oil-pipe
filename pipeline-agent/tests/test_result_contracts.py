from __future__ import annotations

from src.agents.result_contracts import (
    build_result_contract,
    is_error_result,
    result_to_data,
    result_to_text,
)


def test_wrapper_failure_text_is_recognized_as_error() -> None:
    assert is_error_result("调用失败: query_database: boom")
    assert is_error_result("调用失败: plan_complex_task: timeout")


def test_contract_keeps_nested_data_payload_accessible() -> None:
    contract = build_result_contract(
        "data_agent",
        '{"success": true, "data": {"pipeline": {"id": 1, "name": "A"}}}',
    )

    assert contract["kind"] == "data"
    assert result_to_data(contract) == {"pipeline": {"id": 1, "name": "A"}}
    assert '"success": true' in result_to_text(contract)


def test_plain_text_contract_round_trips_as_raw_text() -> None:
    contract = build_result_contract("calc_agent", "计算完成: 压降=0.25MPa")

    assert contract["kind"] == "text"
    assert result_to_text(contract) == "计算完成: 压降=0.25MPa"
    assert result_to_data(contract) == {"raw": "计算完成: 压降=0.25MPa"}
