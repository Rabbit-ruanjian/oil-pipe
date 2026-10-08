package com.pipeline.calculation.domain.converter;

import java.util.List;
import java.util.stream.Collectors;

import com.pipeline.calculation.domain.entity.CalculationHistory;
import com.pipeline.calculation.domain.vo.CalculationHistoryVO;
import com.pipeline.common.core.enums.CalcTypeEnum;

/**
 * 计算历史转换器
 * <p>
 * 提供实体与视图对象之间的转换方法。
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
public final class CalculationHistoryConverter {

    private CalculationHistoryConverter() {
        // 工具类，禁止实例化
    }

    /**
     * 实体转视图对象
     *
     * @param entity 计算历史实体
     * @return 视图对象
     */
    public static CalculationHistoryVO toVO(CalculationHistory entity) {
        if (entity == null) {
            return null;
        }

        CalculationHistoryVO vo = new CalculationHistoryVO();
        vo.setId(entity.getId());
        vo.setCalcType(entity.getCalcType());
        vo.setCalcTypeName(getCalcTypeName(entity.getCalcType()));
        vo.setProjectId(entity.getProId());
        vo.setProjectName(entity.getCalcName());
        vo.setUserName(entity.getCreateBy());
        vo.setInputParams(entity.getInputParams());
        vo.setOutputResult(entity.getOutputResult());
        vo.setRemark(entity.getRemark());
        vo.setCreateTime(entity.getCreateTime());

        return vo;
    }

    /**
     * 批量转换实体到视图对象
     *
     * @param entities 实体列表
     * @return 视图对象列表
     */
    public static List<CalculationHistoryVO> toVOList(List<CalculationHistory> entities) {
        if (entities == null || entities.isEmpty()) {
            return List.of();
        }
        return entities.stream()
                .map(CalculationHistoryConverter::toVO)
                .collect(Collectors.toList());
    }

    /**
     * 获取计算类型名称
     *
     * @param calcType 计算类型编码
     * @return 计算类型名称
     */
    private static String getCalcTypeName(String calcType) {
        CalcTypeEnum typeEnum = CalcTypeEnum.fromCode(calcType);
        return typeEnum != null ? typeEnum.getDesc() : "未知类型";
    }
}
