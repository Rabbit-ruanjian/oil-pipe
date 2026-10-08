package com.pipeline.calculation.domain.vo;

import java.io.Serial;
import java.io.Serializable;
import java.time.LocalDateTime;

import lombok.Data;

/**
 * 计算历史记录视图对象
 * <p>
 * 用于向前端返回计算历史记录信息，
 * 隐藏敏感字段并提供展示友好的数据格式。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Data
public class CalculationHistoryVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 历史记录ID
     */
    private Long id;

    /**
     * 计算类型编码
     */
    private String calcType;

    /**
     * 计算类型名称
     */
    private String calcTypeName;

    /**
     * 项目ID
     */
    private Long projectId;

    /**
     * 项目名称
     */
    private String projectName;

    /**
     * 执行用户ID
     */
    private Long userId;

    /**
     * 执行用户名
     */
    private String userName;

    /**
     * 输入参数（JSON格式）
     */
    private String inputParams;

    /**
     * 输出结果（JSON格式）
     */
    private String outputResult;

    /**
     * 计算状态（0:计算中, 1:成功, 2:失败）
     */
    private Integer status;

    /**
     * 状态名称
     */
    private String statusName;

    /**
     * 错误信息
     */
    private String errorMessage;

    /**
     * 计算耗时（毫秒）
     */
    private Long calcDuration;

    /**
     * 格式化的计算耗时（如：1.5s）
     */
    private String calcDurationFormatted;

    /**
     * 备注
     */
    private String remark;

    /**
     * 创建时间
     */
    private LocalDateTime createTime;

    // ==================== 状态常量 ====================

    /**
     * 获取状态名称
     *
     * @param status 状态码
     * @return 状态名称
     */
    public static String getStatusName(Integer status) {
        if (status == null) {
            return "未知";
        }
        return switch (status) {
            case 0 -> "计算中";
            case 1 -> "成功";
            case 2 -> "失败";
            default -> "未知";
        };
    }

    /**
     * 格式化计算耗时
     *
     * @param duration 耗时（毫秒）
     * @return 格式化字符串
     */
    public static String formatDuration(Long duration) {
        if (duration == null) {
            return "-";
        }
        if (duration < 1000) {
            return duration + "ms";
        }
        double seconds = duration / 1000.0;
        if (seconds < 60) {
            return String.format("%.2fs", seconds);
        }
        long minutes = (long) (seconds / 60);
        double remainSeconds = seconds % 60;
        return String.format("%dm %.1fs", minutes, remainSeconds);
    }
}
