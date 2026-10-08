package com.pipeline.calculation;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.ComponentScan;

/**
 * 计算引擎服务启动类
 */
@EnableDiscoveryClient
@SpringBootApplication
@ComponentScan(basePackages = {"com.pipeline.common", "com.pipeline.calculation"})
public class PipelineCalculationApplication {
    public static void main(String[] args) {
        SpringApplication.run(PipelineCalculationApplication.class, args);
    }
}
