package com.pipeline.common.core.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 计算类型枚举
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Getter
@AllArgsConstructor
public enum CalcTypeEnum {

    /**
     * 水力分析
     */
    HYDRAULIC("HYDRAULIC", "水力分析"),

    /**
     * 泵站优化
     */
    OPTIMIZATION("OPTIMIZATION", "泵站优化"),

    /**
     * 敏感性分析
     */
    SENSITIVITY("SENSITIVITY", "敏感性分析"),

    /**
     * AI 智能报告
     */
    AI_REPORT("AI_REPORT", "智能报告");

    /**
     * 类型编码
     */
    private final String code;

    /**
     * 类型描述
     */
    private final String desc;

    /**
     * 根据编码获取枚举
     *
     * @param code 类型编码
     * @return 枚举值，未找到返回null
     */
    public static CalcTypeEnum fromCode(String code) {
        if (code == null) {
            return null;
        }
        for (CalcTypeEnum type : values()) {
            if (type.getCode().equals(code)) {
                return type;
            }
        }
        return null;
    }
}
