package com.pipeline.auth;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.ComponentScan;

/**
 * 认证授权服务
 */
@EnableDiscoveryClient
@SpringBootApplication
@ComponentScan(basePackages = {"com.pipeline.common", "com.pipeline.auth"})
@MapperScan("com.pipeline.auth.mapper")
public class PipelineAuthApplication {
    public static void main(String[] args) {
        SpringApplication.run(PipelineAuthApplication.class, args);
    }
}
