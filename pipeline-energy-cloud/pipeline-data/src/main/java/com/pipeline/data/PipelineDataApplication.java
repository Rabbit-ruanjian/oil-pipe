package com.pipeline.data;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.ComponentScan;

/**
 * 数据中心服务启动类
 */
@EnableDiscoveryClient
@SpringBootApplication
@ComponentScan(basePackages = {"com.pipeline.common", "com.pipeline.data"})
public class PipelineDataApplication {
    public static void main(String[] args) {
        SpringApplication.run(PipelineDataApplication.class, args);
    }
}
