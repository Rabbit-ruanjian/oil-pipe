package com.pipeline.calculation.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pipeline.calculation.domain.dto.CalculationHistoryQuery;
import com.pipeline.calculation.domain.dto.SaveReportRequest;
import com.pipeline.calculation.domain.entity.CalculationHistory;
import com.pipeline.calculation.domain.vo.CalculationHistoryVO;
import com.pipeline.calculation.service.ICalculationHistoryService;
import com.pipeline.common.core.domain.PageResult;
import com.pipeline.common.core.domain.Result;

import cn.dev33.satoken.stp.StpUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;

@Tag(name = "计算历史", description = "计算历史记录查询与管理接口")
@Validated
@RestController
@RequestMapping("/calculation/history")
@RequiredArgsConstructor
public class CalculationHistoryController {

    private final ICalculationHistoryService calculationHistoryService;
    private final ObjectMapper objectMapper;

    @Operation(summary = "分页查询计算历史", description = "支持按计算类型、项目、用户、状态、时间等条件筛选")
    @GetMapping("/page")
    public Result<PageResult<CalculationHistoryVO>> queryPage(CalculationHistoryQuery query) {
        PageResult<CalculationHistoryVO> result = calculationHistoryService.queryPage(query);
        return Result.ok(result);
    }

    @Operation(summary = "查询计算历史详情", description = "根据记录 ID 获取详细历史信息")
    @GetMapping("/{id}")
    public Result<CalculationHistoryVO> getDetail(
            @PathVariable("id") @NotNull(message = "记录ID不能为空") Long id) {
        CalculationHistoryVO detail = calculationHistoryService.getDetail(id);
        return Result.ok(detail);
    }

    @Operation(summary = "获取最近计算记录", description = "获取当前用户最近的计算历史记录")
    @GetMapping("/recent")
    public Result<List<CalculationHistoryVO>> getRecentHistory(
            @RequestParam(value = "userId", required = false) Long userId,
            @RequestParam(value = "limit", required = false, defaultValue = "10") Integer limit) {
        if (userId == null) {
            userId = 1L;
        }
        List<CalculationHistoryVO> histories = calculationHistoryService.getRecentByUser(userId, limit);
        return Result.ok(histories);
    }

    @Operation(summary = "查询项目计算历史", description = "分页查询指定项目的计算历史")
    @GetMapping("/project/{projectId}")
    public Result<PageResult<CalculationHistoryVO>> getByProject(
            @PathVariable("projectId") @NotNull(message = "项目ID不能为空") Long projectId,
            CalculationHistoryQuery query) {
        PageResult<CalculationHistoryVO> result = calculationHistoryService.getByProject(projectId, query);
        return Result.ok(result);
    }

    @Operation(summary = "删除计算历史", description = "根据 ID 删除单条计算历史记录")
    @DeleteMapping("/{id}")
    public Result<Void> deleteHistory(
            @PathVariable("id") @NotNull(message = "记录ID不能为空") Long id) {
        boolean success = calculationHistoryService.deleteHistory(id);
        if (success) {
            return Result.ok();
        }
        return Result.fail("删除失败");
    }

    @Operation(summary = "批量删除计算历史", description = "根据 ID 列表批量删除计算历史记录")
    @PostMapping("/batch-delete")
    public Result<Integer> batchDelete(
            @RequestBody @NotEmpty(message = "ID列表不能为空") List<Long> ids) {
        int count = calculationHistoryService.batchDelete(ids);
        return Result.ok(count);
    }

    @Operation(summary = "归档智能报告", description = "将前端生成的智能报告归档到计算历史中")
    @PostMapping("/report")
    public Result<CalculationHistoryVO> archiveReport(@RequestBody SaveReportRequest request) {
        try {
            Long userId = resolveUserId();
            Long projectId = request.getSelectedProjectIds().isEmpty() ? 0L : request.getSelectedProjectIds().get(0);
            String projectName = resolveProjectName(request);
            String inputJson = objectMapper.writeValueAsString(request);
            String outputJson = objectMapper.writeValueAsString(extractOutputPayload(request));

            Long historyId = calculationHistoryService.createHistory(
                    "AI_REPORT",
                    projectId,
                    projectName,
                    userId,
                    String.valueOf(userId),
                    inputJson
            );
            calculationHistoryService.updateSuccess(historyId, outputJson, 0L);

            CalculationHistory patch = new CalculationHistory();
            patch.setId(historyId);
            patch.setRemark(buildRemark(request));
            calculationHistoryService.updateById(patch);

            return Result.ok(calculationHistoryService.getDetail(historyId), "智能报告已归档");
        } catch (JsonProcessingException e) {
            return Result.fail("智能报告归档失败：序列化内容失败");
        } catch (Exception e) {
            return Result.fail("智能报告归档失败：" + e.getMessage());
        }
    }

    @Operation(summary = "统计项目计算次数", description = "统计指定项目的计算总次数")
    @GetMapping("/count/project/{projectId}")
    public Result<Long> countByProject(
            @PathVariable("projectId") @NotNull(message = "项目ID不能为空") Long projectId) {
        long count = calculationHistoryService.countByProject(projectId);
        return Result.ok(count);
    }

    @Operation(summary = "统计用户计算次数", description = "统计指定用户的计算总次数")
    @GetMapping("/count/user/{userId}")
    public Result<Long> countByUser(
            @PathVariable("userId") @NotNull(message = "用户ID不能为空") Long userId) {
        long count = calculationHistoryService.countByUser(userId);
        return Result.ok(count);
    }

    private Long resolveUserId() {
        try {
            return StpUtil.getLoginIdAsLong();
        } catch (Exception ignored) {
            return 1L;
        }
    }

    private String resolveProjectName(SaveReportRequest request) {
        List<String> projectNames = request.getProjectNames();
        if (projectNames == null || projectNames.isEmpty()) {
            return request.getTitle() != null && !request.getTitle().isBlank() ? request.getTitle() : "智能报告";
        }
        if (projectNames.size() == 1) {
            return projectNames.get(0);
        }
        return projectNames.get(0) + " 等" + projectNames.size() + "个项目";
    }

    private Object extractOutputPayload(SaveReportRequest request) {
        Object result = request.getResult();
        if (result instanceof Map<?, ?> rawMap) {
            Map<String, Object> resultMap = new LinkedHashMap<>();
            rawMap.forEach((key, value) -> resultMap.put(String.valueOf(key), value));
            Object report = resultMap.get("report");
            if (report != null) {
                return report;
            }
            return resultMap;
        }
        return result != null ? result : Map.of();
    }

    private String buildRemark(SaveReportRequest request) {
        Object result = request.getResult();
        if (result instanceof Map<?, ?> resultMap) {
            Object conclusion = resultMap.get("conclusion");
            if (conclusion instanceof String text && !text.isBlank()) {
                return text;
            }
        }

        int projectCount = request.getSelectedProjectIds() == null ? 0 : request.getSelectedProjectIds().size();
        if (projectCount > 0) {
            return "智能报告已生成，来源项目 " + projectCount + " 个";
        }
        return "智能报告已生成";
    }
}
