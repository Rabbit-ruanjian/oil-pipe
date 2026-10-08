package com.pipeline.calculation.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;

/**
 * Swagger API文档配置
 * <p>
 * 配置Knife4j增强的OpenAPI 3.0文档，
 * 访问地址: http://localhost:9500/doc.html
 * </p>
 *
 * @author Pipeline Team
 * @since 1.0.0
 */
@Configuration
public class SwaggerConfig {

    /**
     * 配置OpenAPI基本信息
     *
     * @return OpenAPI配置
     */
    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("管道能耗分析系统 - 计算服务API")
                        .version("1.0.0")
                        .description(buildDescription())
                        .contact(new Contact()
                                .name("Pipeline Team")
                                .email("pipeline@example.com"))
                        .license(new License()
                                .name("MIT License")
                                .url("https://opensource.org/licenses/MIT")));
    }

    /**
     * 构建API描述信息
     */
    private String buildDescription() {
        return """
                ## 管道能耗分析系统计算服务

                提供以下核心功能：

                ### 水力分析
                - 基于雷诺数的流态判断
                - 沿程摩阻损失计算
                - 水力坡降计算
                - 首末站压力计算

                ### 泵站优化
                - 多泵组合遍历优化
                - 能耗最优方案推荐
                - 可行性约束检验

                ### 敏感性分析
                - 单因素敏感性分析
                - 多因素交叉分析
                - 敏感性系数排序

                ### 报告生成
                - 水力分析报告（Word格式）
                - 优化方案报告
                - 敏感性分析报告

                ### 统计分析
                - 计算历史查询
                - 统计数据概览
                - 趋势分析

                ---
                **技术支持**: pipeline@example.com
                """;
    }
}
