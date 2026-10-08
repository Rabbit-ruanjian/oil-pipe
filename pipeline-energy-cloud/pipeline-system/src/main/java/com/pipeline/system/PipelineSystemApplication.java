package com.pipeline.system;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.ComponentScan;

/**
 * 系统管理服务
 */
@EnableDiscoveryClient
@SpringBootApplication
@ComponentScan(basePackages = {"com.pipeline.common", "com.pipeline.system"})
@MapperScan("com.pipeline.system.mapper")
public class PipelineSystemApplication {
    public static void main(String[] args) {
        SpringApplication.run(PipelineSystemApplication.class, args);
    }
}
